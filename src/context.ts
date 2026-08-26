import { readFileSync } from "node:fs";
import { type SessionRecord, extractSession, humanUtterances } from "./extract.ts";
import { CONTINUATION_INDENT } from "./relay-block.ts";
import type { RepoSignals } from "./repo.ts";

/**
 * 経過として渡すターン数。
 * 全部入れると110KB、ターンの最後だけで77KB、直近10件で15KB（実測）。
 * 「いまどこ」を伝えるのに効くのは直近なので10件にしている。
 */
const RECENT_TURNS = 10;

/**
 * 「N. 本文」として書く。2行目以降は字下げする。
 * 発話の中に見出しや番号（前回の文脈がまるごと入っている場合など）があっても、
 * 読み戻すときに外側と混ざらないようにするため。
 */
const numbered = (text: string, index: number): string =>
  text
    .split("\n")
    .map((line, i) => (i === 0 ? `${String(index + 1)}. ${line}` : `${CONTINUATION_INDENT}${line}`))
    .join("\n");

/**
 * 別スレッド／別ハーネスに渡す文脈を組み立てる。
 * 要約はしない——本人の発話は原文のまま、順番も保つ。
 */
/** リポジトリの生の信号。会話より git のほうが「どこまで出来ているか」に正直 */
function repoSection(repo: RepoSignals | undefined): string[] {
  if (repo === undefined || (repo.branch === null && repo.log.length === 0)) return [];
  return [
    "## いまのリポジトリ（渡した時点の実物）",
    `場所: ${repo.dir}`,
    `ブランチ: ${repo.branch ?? "-"}`,
    ...(repo.log.length > 0 ? ["直近のコミット:", ...repo.log.map((l) => `- ${l}`)] : []),
    repo.dirty.length > 0
      ? `未コミットの変更: ${String(repo.dirty.length)} 件`
      : "未コミットの変更: なし（作業ツリーはきれい）",
    ...repo.dirty.map((l) => `- ${l}`),
    "",
  ];
}

export function buildContext(sessionPath: string, repo?: RepoSignals): string | null {
  const record = extractSession(readFileSync(sessionPath, "utf8"));
  return record === null ? null : render(record, repo);
}

export interface BuiltContext {
  readonly path: string;
  readonly context: string;
}

/**
 * 新しい順に候補を試して、**中身のある**最初の会話を返す。
 * 空の文脈を渡すと、受け手は「前の会話は無かった」と誤解するので返さない。
 */
export function buildContextFrom(
  paths: readonly string[],
  repo?: RepoSignals,
): BuiltContext | null {
  for (const path of paths) {
    const record = extractSession(readFileSync(path, "utf8"));
    if (record === null || humanUtterances(record).length === 0) continue;
    return { path, context: render(record, repo) };
  }
  return null;
}

function render(record: SessionRecord, repo: RepoSignals | undefined): string {
  const human = humanUtterances(record);
  const recent = record.turnEndings.slice(-RECENT_TURNS);
  return [
    "# 前の会話の記録（要約なし・本人の発話は原文のまま）",
    "これは同じ人物の直前までの会話です。話が途切れないように、ここから続けてください。",
    "",
    `作業場所: ${record.cwd ?? "-"} (branch: ${record.gitBranch ?? "-"})`,
    `期間: ${record.startedAt ?? "-"} 〜 ${record.endedAt ?? "-"}`,
    "",
    "## 本人が実際に打った言葉（時系列・全件）",
    ...human.map(numbered),
    "",
    `## 直近の経過（AIが各ターンの最後に報告したこと・原文・最後の${String(RECENT_TURNS)}ターン）`,
    "本人の発話だけでは「どこまで出来たか」が分からないので添えている。",
    ...recent.map((t, i) => numbered(t.text, i)),
    "",
    ...repoSection(repo),
    "## 触ったファイル",
    ...record.files.map((f) => `- ${f}`),
    "",
    "## 実行したコマンド（後半20件）",
    ...record.commands.slice(-20).map((c) => `- ${c.split("\n")[0] ?? ""}`),
    "",
    "---",
    "上を読んだうえで、まず一言だけ現在地を確認してから続けてください。",
  ].join("\n");
}
