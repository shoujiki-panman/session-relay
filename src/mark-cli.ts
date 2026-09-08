/**
 * `relay mark` — いまの会話に「次はこれ」の印をつける。
 *
 * `relay` との違いは**新しいセッションを起動しないこと**。
 * 起動しないので対話TTYが要らず、ヘッダーのボタンやキー1つから押せて、
 * 利用枠で止まってしまった会話からでも押せる。
 * 拾うのは受け取る側（「続きから」）で、そちらは `query.ts` が印を先に見る。
 */
import { statSync } from "node:fs";
import { defaultHandoffPath, putHandoff } from "./handoff.ts";
import { describe } from "./list.ts";
import { currentSessionFor, defaultRoots } from "./sessions.ts";

export function runMark(
  cwd: string = process.cwd(),
  env: Readonly<Record<string, string | undefined>> = process.env,
  roots: readonly string[] = defaultRoots(),
  file: string = defaultHandoffPath(),
  now: Date = new Date(),
): number {
  const path = currentSessionFor(cwd, env, roots);
  if (path === null) {
    process.stderr.write(`いまの会話の記録が見つかりませんでした（この場所: ${cwd}）\n`);
    return 1;
  }
  const listed = describe({ path, cwd, mtimeMs: statSync(path).mtimeMs });
  putHandoff({ at: now.toISOString(), id: env["CLAUDE_CODE_SESSION_ID"] ?? "", path, cwd, topic: listed.topic }, file);
  process.stdout.write(
    `📌 この会話に印をつけました: 「${listed.topic}」\n` +
      "新しいセッションで「続きから」と言えば、この会話が読まれます（一度読まれると印は消えます）\n",
  );
  return 0;
}
