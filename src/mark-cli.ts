/**
 * `relay mark` — いまの会話に「次はこれ」の印をつける。
 *
 * `relay` との違いは**新しいセッションを起動しないこと**。
 * 起動しないので対話TTYが要らず、ヘッダーのボタンやキー1つから押せて、
 * 利用枠で止まってしまった会話からでも押せる。
 * 拾うのは受け取る側（「続きから」）で、そちらは `query.ts` が印を先に見る。
 *
 * `--recent` は**cwdを持たない入口**のためにある（Raycast・ランチャー・メニューバー）。
 * そこから見た「いまの会話」は「この場所の会話」ではなく
 * 「最後に動いていた会話」になる。`codex resume --last` と同じ割り切り。
 */
import { statSync } from "node:fs";
import { type Handoff, defaultHandoffPath, peekHandoff, putHandoff } from "./handoff.ts";
import { type Listed, describe } from "./list.ts";
import { humanSessions } from "./query.ts";
import { currentSessionFor, defaultRoots } from "./sessions.ts";

/** 印をつける会話を決める。--recent なら場所を問わず、最後に人が打った会話 */
function targetOf(
  recent: boolean,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  roots: readonly string[],
): Listed | null {
  if (recent) return humanSessions(1, null, roots)[0] ?? null;
  const path = currentSessionFor(cwd, env, roots);
  return path === null ? null : describe({ path, cwd, mtimeMs: statSync(path).mtimeMs });
}

const notFound = (recent: boolean, cwd: string): string =>
  recent
    ? "会話の記録が1つも見つかりませんでした\n"
    : `いまの会話の記録が見つかりませんでした（この場所: ${cwd}）。` +
      "場所を問わず最後の会話に付けるなら relay mark --recent\n";

/** --recent で拾ったときは、押した人のセッションIDとは限らないので id を書かない */
const idOf = (recent: boolean, env: Readonly<Record<string, string | undefined>>): string =>
  recent ? "" : (env["CLAUDE_CODE_SESSION_ID"] ?? "");

/** 場所は会話自身のものを使う。gitの欄をどこから採るかがこれで決まる */
const markOf = (listed: Listed, cwd: string, id: string, now: Date): Handoff => ({
  at: now.toISOString(),
  id,
  path: listed.path,
  cwd: listed.cwd ?? cwd,
  topic: listed.topic,
});

export function runMark(
  cwd: string = process.cwd(),
  env: Readonly<Record<string, string | undefined>> = process.env,
  roots: readonly string[] = defaultRoots(),
  file: string = defaultHandoffPath(),
  now: Date = new Date(),
  recent = false,
): number {
  const listed = targetOf(recent, cwd, env, roots);
  if (listed === null) {
    process.stderr.write(notFound(recent, cwd));
    return 1;
  }
  putHandoff(markOf(listed, cwd, idOf(recent, env), now), file);
  process.stdout.write(
    `📌 「${listed.topic}」に印をつけました\n` +
      "新しいセッションで「続きから」と言えば、この会話が読まれます（一度読まれると印は消えます）\n",
  );
  return 0;
}

/**
 * いま印がついている会話を見る。
 * 印は押しても画面が変わらないので、**確かめる口が無いと本当に効いたのか分からない**。
 */
export function runMarkShow(file: string = defaultHandoffPath(), now: Date = new Date()): number {
  const mark = peekHandoff(now, file);
  if (mark === null) {
    process.stdout.write("印はついていません（「続きから」はこの場所の直前の会話を探します）\n");
    return 1;
  }
  process.stdout.write(`📌 「${mark.topic}」\n   印をつけた時刻: ${mark.at}\n   場所: ${mark.cwd || "-"}\n`);
  return 0;
}

const MARK_USAGE = `  relay mark            いまいる場所の会話に印をつける
  relay mark --recent   場所を問わず、最後に動いていた会話に印をつける（Raycast等・cwdが無い入口用）
  relay mark --show     いま印がついている会話を見る
`;

const KNOWN = new Set(["--recent", "--show"]);

/**
 * `relay mark` の入口。知らない指定は黙って読み飛ばさない——
 * 読み飛ばすと `relay mark --recnt` が**別の会話に印をつけて**終わる。
 */
export function runMarkCommand(args: readonly string[] = []): number {
  const unknown = args.find((arg) => !KNOWN.has(arg));
  if (unknown !== undefined) {
    process.stderr.write(`知らない指定です: ${unknown}\n\n${MARK_USAGE}`);
    return 2;
  }
  if (args.includes("--show")) return runMarkShow();
  return runMark(
    process.cwd(),
    process.env,
    defaultRoots(),
    defaultHandoffPath(),
    new Date(),
    args.includes("--recent"),
  );
}
