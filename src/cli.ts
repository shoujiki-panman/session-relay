/**
 * 会話を別スレッド／別ハーネスへ渡す。
 *   relay --list [件数]                 どのプロジェクトの会話でも一覧で見る
 *   relay [--to claude|codex] [--print] [--previous] [--from <#|ref>]
 *       いまの会話を新しいセッションで開く。
 *       --previous を付けると「自分ではなく直前の会話」を引く
 *       （新しいセッションが「続きから」と言われたときに使う）
 *   show <session.jsonl>                  射影の中身を確かめる
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildContext, buildContextFrom } from "./context.ts";
import { describe, pick, renderTable } from "./list.ts";
import { extractSession, humanUtterances } from "./extract.ts";
import { readRepoSignals } from "./repo.ts";
import { currentSessionFor, previousSessionsFor, recentSessions } from "./sessions.ts";

function show(path: string): number {
  const record = extractSession(readFileSync(path, "utf8"));
  if (record === null) {
    process.stderr.write("形式を判定できませんでした\n");
    return 1;
  }
  const human = humanUtterances(record);
  process.stdout.write(
    [
      `harness   : ${record.harness}`,
      `session   : ${record.sessionId ?? "-"}`,
      `title     : ${record.title ?? "(なし)"}`,
      `人間の発話: ${String(human.length)} 件 / ${String(Math.round(human.join("").length / 1024))} KB`,
      `ファイル  : ${String(record.files.length)} 件  コマンド: ${String(record.commands.length)} 件`,
      `結果の信号: ${String(record.turnEndings.length)} ターン分`,
      "",
    ].join("\n"),
  );
  return 0;
}

/** 直前の会話（自分ではない方）を引く。中身のある最初の1本を返す */
function previousContext(cwd: string): string | null {
  const built = buildContextFrom(previousSessionsFor(cwd), readRepoSignals(cwd));
  if (built === null) return null;
  process.stderr.write(`直前の会話: ${built.path}\n`);
  return built.context;
}

function currentContext(cwd: string): string | null {
  const sessionPath = currentSessionFor(cwd);
  if (sessionPath === null) return null;
  return buildContext(sessionPath, readRepoSignals(cwd));
}

/** 一覧を出す。ディレクトリを問わず、新しい順 */
function humanSessions(limit: number): ReturnType<typeof describe>[] {
  // 下請けの記録が混ざるので、多めに拾ってから人が打った会話だけ残す
  return recentSessions(undefined, limit * 8)
    .map(describe)
    .filter((row) => row.typed)
    .slice(0, limit);
}

function list(limit: number): number {
  const listed = humanSessions(limit);
  if (listed.length === 0) {
    process.stderr.write("会話の記録が見つかりませんでした\n");
    return 1;
  }
  process.stdout.write(renderTable(listed));
  process.stdout.write("選ぶには: relay --from <#かref>（--print を足すと中身だけ出る）\n");
  return 0;
}

/** 一覧から選んだ1本を渡す。ディレクトリが違っても引ける */
function chosenContext(key: string, cwd: string): string | null {
  const chosen = pick(humanSessions(40), key);
  if (chosen === null) return null;
  process.stderr.write(`選んだ会話: ${chosen.place} / ${chosen.topic}\n`);
  // gitは「選んだ会話が動いていた場所」を見る。いまいる場所ではない
  return buildContext(chosen.path, readRepoSignals(chosen.cwd ?? cwd));
}

function relay(target: string, printOnly: boolean, usePrevious: boolean, from: string | null): number {
  const cwd = process.cwd();
  const context =
    from !== null ? chosenContext(from, cwd) : usePrevious ? previousContext(cwd) : currentContext(cwd);
  if (context === null) {
    process.stderr.write(chooseMessage(usePrevious, from));
    return 1;
  }
  if (printOnly) {
    process.stdout.write(context);
    return 0;
  }
  process.stderr.write(
    `${target} を新しいセッションで開きます（文脈 ${String(Math.round(context.length / 1024))} KB）\n`,
  );
  const result = spawnSync(target, [context], { stdio: "inherit" });
  return result.status ?? 1;
}

function chooseMessage(usePrevious: boolean, from: string | null): string {
  if (from !== null) return `「${from}」に当たる会話が一覧にありません（relay --list で番号かrefを確認）\n`;
  return usePrevious
    ? "前の会話が見つかりません（このディレクトリには、自分以外の中身のある会話がありません）\n"
    : "このディレクトリの会話が見つかりませんでした\n";
}

const args = process.argv.slice(2);
const command = args[0];
if (command === "relay") {
  const toIndex = args.indexOf("--to");
  const target = toIndex >= 0 ? (args[toIndex + 1] ?? "claude") : "claude";
  const fromIndex = args.indexOf("--from");
  const from = fromIndex >= 0 ? (args[fromIndex + 1] ?? null) : null;
  if (args.includes("--list")) {
    const listIndex = args.indexOf("--list");
    const asked = Number(args[listIndex + 1]);
    process.exitCode = list(Number.isInteger(asked) && asked > 0 ? asked : 15);
  } else {
    process.exitCode = relay(target, args.includes("--print"), args.includes("--previous"), from);
  }
} else if (command === "show" && args[1] !== undefined) {
  process.exitCode = show(args[1]);
} else {
  process.stderr.write("使い方: relay --list [件数] / relay [--to claude|codex] [--print] [--previous] [--from <#|ref>] / relay show <path>\n");
  process.exitCode = 2;
}
