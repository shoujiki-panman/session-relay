/** `relay show <path>` — 射影の中身を確かめる。何が引き継がれるかを人が目で見るための口。 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractSession, humanUtterances, parseJsonl } from "./extract.ts";
import { extractGrok } from "./extract-grok.ts";

export function runShow(path: string): number {
  // Grokのセッションはディレクトリ2ファイル構成。chat_history.jsonlを見せられたら隣のsummary.jsonも読む
  const summaryPath = join(dirname(path), "summary.json");
  const record = path.endsWith("chat_history.jsonl") && existsSync(summaryPath)
    ? extractGrok(parseJsonl(readFileSync(path, "utf8")), readFileSync(summaryPath, "utf8"))
    : extractSession(readFileSync(path, "utf8"));
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
