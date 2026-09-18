/**
 * 「いま `/clear` するといい」を、道具の側から言う。
 *
 * `/clear` で会話は軽くなるが、打つタイミングが分からない（本人の言葉:
 * 「このクリアってやるタイミングがわからないよなあ」）。人が覚えておく形は続かないので、
 * AIの返事が終わった瞬間（Stopフック）に会話の重さを見て、育っていたら画面に一行出す。
 *
 * - 出すだけ。自動では区切らない（調査の最中に切られると読み直しで損をする）
 * - しつこくしない。閾値を超えたとき1回、あとは一定量育つごとに1回
 * - 閾値は使いながら決める（本人）。環境変数で変えられる
 */
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isRecord } from "./types.ts";

/** 試算（入力58%減・区切り1日1.6回）に使った値。実測で見直す前提 */
export const DEFAULT_THRESHOLD = 300_000;
export const DEFAULT_STEP = 100_000;
/** 記録の末尾だけ読む。返事のたびに走るので、何MBもある記録を全部は読まない */
const TAIL_BYTES = 1024 * 1024;
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** 1行から「その返事でAIが読んだ量」を取る。本筋のAIの返事でなければ null */
function contextTokensOf(line: string): number | null {
  if (!line.includes('"usage"')) return null;
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(row) || row["type"] !== "assistant" || row["isSidechain"] === true) return null;
  const message = row["message"];
  const usage = isRecord(message) ? message["usage"] : null;
  if (!isRecord(usage)) return null;
  const total = num(usage["input_tokens"]) + num(usage["cache_read_input_tokens"]) + num(usage["cache_creation_input_tokens"]);
  return total > 0 ? total : null;
}

/** 記録（の末尾）から、いちばん新しい返事が読んだ量を返す。分からなければ null */
export function lastContextTokens(tail: string): number | null {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const tokens = contextTokensOf(lines[i] ?? "");
    if (tokens !== null) return tokens;
  }
  return null;
}

/** 何段目まで育ったか。0 は閾値未満 */
export const nudgeLevel = (tokens: number, threshold: number, step: number): number =>
  tokens < threshold ? 0 : 1 + Math.floor((tokens - threshold) / Math.max(1, step));

export const nudgeMessage = (tokens: number): string =>
  `relay: この会話は${String(Math.round(tokens / 10_000))}万トークンまで育ちました。切りのいいところで /clear すると軽くなります（話は続きます）`;

export function readTail(path: string, bytes: number = TAIL_BYTES): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    // 途中から読んだ最初の行は欠けている
    return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } finally {
    closeSync(fd);
  }
}

const positive = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export interface NudgeOptions {
  readonly threshold: number;
  readonly step: number;
}

export const nudgeOptions = (env: Readonly<Record<string, string | undefined>> = process.env): NudgeOptions => ({
  threshold: positive(env["RELAY_NUDGE_TOKENS"], DEFAULT_THRESHOLD),
  step: positive(env["RELAY_NUDGE_STEP"], DEFAULT_STEP),
});

const stateFile = (dir: string, sessionId: string): string =>
  join(dir, `nudge-${createHash("sha1").update(sessionId).digest("hex").slice(0, 12)}`);

function readLevel(file: string): number {
  try {
    return positive(readFileSync(file, "utf8").trim(), 0);
  } catch {
    return 0;
  }
}

/** `/clear` で終わらなかった会話の控えが溜まらないように、古いものを消す */
function prune(dir: string, now: Date): void {
  for (const name of readdirSync(dir)) {
    if (!name.startsWith("nudge-")) continue;
    const file = join(dir, name);
    if (now.getTime() - statSync(file).mtimeMs > STATE_TTL_MS) rmSync(file, { force: true });
  }
}

export function forgetNudge(dir: string, sessionId: string): void {
  rmSync(stateFile(dir, sessionId), { force: true });
}

/** 返事が終わったときに呼ぶ。画面に出す一行を返す（出さないなら空） */
export function nudge(
  transcriptPath: string,
  sessionId: string,
  dir: string,
  options: NudgeOptions = nudgeOptions(),
  now: Date = new Date(),
): string {
  if (transcriptPath === "" || sessionId === "") return "";
  const tokens = lastContextTokens(readTail(transcriptPath));
  if (tokens === null) return "";
  const level = nudgeLevel(tokens, options.threshold, options.step);
  const file = stateFile(dir, sessionId);
  if (level <= readLevel(file)) return "";
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, String(level));
  prune(dir, now);
  return nudgeMessage(tokens);
}
