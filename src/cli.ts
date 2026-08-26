/**
 * 会話を別スレッド／別ハーネスへ渡す。
 *   relay [--to claude|codex] [--print] [--previous]
 *       いまの会話を新しいセッションで開く。
 *       --previous を付けると「自分ではなく直前の会話」を引く
 *       （新しいセッションが「続きから」と言われたときに使う）
 *   show <session.jsonl>                  射影の中身を確かめる
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildContext, buildContextFrom } from "./context.ts";
import { extractSession, humanUtterances } from "./extract.ts";
import { readRepoSignals } from "./repo.ts";
import { currentSessionFor, previousSessionsFor } from "./sessions.ts";

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

function relay(target: string, printOnly: boolean, usePrevious: boolean): number {
  const cwd = process.cwd();
  const context = usePrevious ? previousContext(cwd) : currentContext(cwd);
  if (context === null) {
    process.stderr.write(
      usePrevious
        ? "前の会話が見つかりません（このディレクトリには、自分以外の中身のある会話がありません）\n"
        : "このディレクトリの会話が見つかりませんでした\n",
    );
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

const args = process.argv.slice(2);
const command = args[0];
if (command === "relay") {
  const toIndex = args.indexOf("--to");
  const target = toIndex >= 0 ? (args[toIndex + 1] ?? "claude") : "claude";
  process.exitCode = relay(target, args.includes("--print"), args.includes("--previous"));
} else if (command === "show" && args[1] !== undefined) {
  process.exitCode = show(args[1]);
} else {
  process.stderr.write("使い方: relay [--to claude|codex] [--print] [--previous] / show <session.jsonl>\n");
  process.exitCode = 2;
}
