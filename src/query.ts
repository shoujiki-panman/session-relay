/**
 * 会話を探す処理。CLIとMCPの両方から使う。
 *
 * ここに画面への出力は書かない（MCPサーバーは標準出力がJSON-RPCで埋まっていて、
 * 1行でも余計に書くと通信が壊れる）。出すのは呼んだ側の仕事。
 */
import { type Memory, load, remember, remembered, save } from "./cache.ts";
import { type Listed, describe, isSubagentRecord, pick } from "./list.ts";
import { type Project, groupByProject, pickProject } from "./projects.ts";
import { type BuiltContext, buildContext, buildContextFrom } from "./context.ts";
import { readRepoSignals } from "./repo.ts";
import { type KnownCwd, defaultRoots, peekOf, previousSessionsFor, recentSessions } from "./sessions.ts";

/**
 * ファイル数で切ってはいけない。下請け（サブエージェント）の記録は桁違いに多く、
 * 実測（2026-08-28）では**新しい480本のうち469本が1つのプロジェクトの下請け**で、
 * 人が打った会話は7本しか残らなかった（プロジェクト一覧が2件になった）。
 * 数えるのは会話であって、ファイルではない。
 */
export const SCAN_LIMIT = 4000;

/**
 * プロジェクトに束ねるために先に拾う会話の数。
 * 束ねる前に切ると、下の方のプロジェクトが1件しか無いように見える。
 */
export const SCAN = 250;

/** `--list` の既定件数。番号はこの一覧で数える */
export const LIST_LIMIT = 15;

/**
 * 人が打った会話を、必要な数だけ新しい順に集める。
 * 一度読んだ会話は覚えておく（更新時刻が同じなら読み直さない）。
 * 読み直すと250本で4.7秒かかり、MCPから呼ぶたびにその待ちが乗る。
 */
/** 覚えている作業ディレクトリ。分からなければ null（そのときだけ読む） */
const lookup =
  (memory: Memory): KnownCwd =>
  (path, mtimeMs) =>
    remembered(memory, path, mtimeMs)?.cwd ?? null;

export function humanSessions(limit: number, onlyCwd: string | null): Listed[] {
  const memory = load();
  const knownCwd = lookup(memory);
  const rows: Listed[] = [];
  let learned = false;
  for (const entry of recentSessions(undefined, SCAN_LIMIT, onlyCwd, knownCwd)) {
    const known = remembered(memory, entry.path, entry.mtimeMs);
    // 覚えていないものは、まず8KBだけ見て下請けの記録を落とす（深く読むのは人の会話だけ）
    if (known === null && isSubagentRecord(peekOf(entry.path))) continue;
    const row = known ?? describe(entry);
    if (known === null) {
      remember(memory, entry.path, entry.mtimeMs, row);
      learned = true;
    }
    if (row.typed) rows.push(row);
    if (rows.length >= limit) break;
  }
  if (learned) save(memory);
  return rows;
}

export const projectsOf = (): Project[] => groupByProject(humanSessions(SCAN, null));

/**
 * 本人の言葉で探す。「地図の話の続き」の"地図"がここに来る。
 *
 * 番号や ref を言わせないため。**打つのが苦手な人にとって、refを聞き返すのは
 * コマンドを打たせているのと同じ**（本人の指摘 2026-08-29）。
 *
 * 見出しだけでなく発話の書き出しも見る。見出しが `(発話なし)`（スクショ1枚）や
 * `github.com`（URLを貼っただけ）の会話は、見出しだけを見ていると
 * **どんな言葉でも呼べない**（実測 2026-08-30）。
 */
const hits = (row: Listed, needle: string): boolean =>
  row.topic.toLowerCase().includes(needle) ||
  row.place.toLowerCase().includes(needle) ||
  row.words.includes(needle);

export function findByWords(words: string, limit = 6): Listed[] {
  const needle = words.trim().toLowerCase();
  if (needle === "") return [];
  return humanSessions(SCAN, null)
    .filter((row) => hits(row, needle))
    .slice(0, limit);
}

/**
 * 選ぶ対象の会話たち。
 * `--in` を付けたときは**そのプロジェクトの中だけ**を見る。
 */
export function candidates(inKey: string | null, cwd: string | null, limit: number): Listed[] {
  if (inKey === null) return humanSessions(limit, cwd);
  const chosen = pickProject(projectsOf(), inKey);
  return chosen === null ? [] : [...chosen.sessions];
}

/**
 * 一覧から1本を選ぶ。
 *
 * **番号と ref で数える相手を変える。**
 * 番号は「画面に出ていた一覧」の中でしか意味を持たない。広い一覧で数えると
 * 番号が指す会話がずれる（この道具が何度も踏んだ穴）。
 * ref は一意なのでずれない。だから ref のときだけ広く探す。
 * キャンバスのカードに書いてあるのも ref。
 */
export function chooseByKey(
  key: string,
  cwd: string | null,
  inKey: string | null,
  all: boolean,
): Listed | null {
  const byNumber = Number.isInteger(Number(key));
  const rows = byNumber
    ? candidates(inKey, all ? null : cwd, LIST_LIMIT)
    : candidates(inKey, null, SCAN);
  return pick(rows, key);
}

/** 選んだ会話の射影。gitは「その会話が動いていた場所」を見る。いまいる場所ではない */
export const contextOf = (chosen: Listed, fallbackCwd: string): string | null =>
  buildContext(chosen.path, readRepoSignals(chosen.cwd ?? fallbackCwd));

/**
 * 自分ではない「直前の会話」。中身のある最初の1本を返す。
 * 「続きから」の本命の経路なので、覚えている分は読み飛ばす（3.4秒かかっていた）。
 * 中身そのものは毎回読む——会話は続いているので、覚えたら古くなる。
 */
export const previousIn = (cwd: string): BuiltContext | null =>
  buildContextFrom(
    previousSessionsFor(cwd, process.env, defaultRoots(), lookup(load())),
    readRepoSignals(cwd),
  );
