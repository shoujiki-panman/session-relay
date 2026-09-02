import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseJsonl } from "./parse.ts";
import { asString, isRecord } from "./types.ts";

const claudeRoot = (): string => join(homedir(), ".claude", "projects");
/** Codexは `~/.codex/sessions/YYYY/MM/DD/rollout-<時刻>-<uuid>.jsonl`（実測51件） */
const codexRoot = (): string => join(homedir(), ".codex", "sessions");

/** 会話の記録が置かれている場所。ハーネスが増えたらここに足す */
export const defaultRoots = (): string[] => [claudeRoot(), codexRoot()];

/** 掘る深さの上限。Claudeは1階層、Codexは3階層（YYYY/MM/DD） */
const MAX_DEPTH = 4;

interface Found {
  readonly path: string;
  readonly mtimeMs: number;
}

function jsonlUnder(dir: string, depth: number = MAX_DEPTH): Found[] {
  if (depth < 0 || !existsSync(dir)) return [];
  const found: Found[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...jsonlUnder(path, depth - 1));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      found.push({ path, mtimeMs: statSync(path).mtimeMs });
    }
  }
  return found;
}

/**
 * ファイルの先頭だけ読む。
 * 記録は1本で13MBになることがあり、手元には合計3.0GB・1219本ある（実測）。
 * 全部読んでから切ると、cwdを見るためだけに全部をメモリに載せることになる。
 */
const HEAD_BYTES = 32_768;
/** 先頭だけで読めなかったときに読む量 */
const DEEP_BYTES = 1_048_576;

function readHead(path: string, bytes: number): string {
  const buffer = Buffer.allocUnsafe(bytes);
  const fd = openSync(path, "r");
  try {
    return buffer.toString("utf8", 0, readSync(fd, buffer, 0, bytes, 0));
  } finally {
    closeSync(fd);
  }
}

/** 先頭を読んで cwd を探す。見つからなければ null */
function cwdIn(raw: string): string | null {
  for (const row of parseJsonl(raw)) {
    const direct = asString(row["cwd"]);
    if (direct !== null) return direct;
    const payload = row["payload"];
    if (isRecord(payload)) {
      const nested = asString(payload["cwd"]);
      if (nested !== null) return nested;
    }
  }
  return null;
}

/**
 * そのファイルが記録している作業ディレクトリ（先頭付近の行から拾う）。
 * Claude Codeは各行の `cwd`、Codexは先頭 `session_meta` 行の `payload.cwd`（実測）。
 */
function cwdOf(path: string): string | null {
  // 1行目が巨大なことがある（relayで開いた会話は最初の発話が36KB）。
  // 先頭だけで読めなければ、その時だけ深く読む
  return cwdIn(readHead(path, HEAD_BYTES)) ?? cwdIn(readHead(path, DEEP_BYTES));
}

/**
 * セッションIDから記録を探す。IDが分かるなら取り違えようがない。
 * Claude Codeは `<id>.jsonl`、Codexは `rollout-<時刻>-<id>.jsonl`（実測）。
 */
export function findSessionById(roots: readonly string[], id: string): string | null {
  for (const found of roots.flatMap((root) => jsonlUnder(root))) {
    const name = basename(found.path);
    if (name === `${id}.jsonl` || name.endsWith(`-${id}.jsonl`)) return found.path;
  }
  return null;
}

export interface SessionEntry {
  readonly path: string;
  readonly cwd: string | null;
  readonly mtimeMs: number;
}

/**
 * 前に読んだ作業ディレクトリを教えてもらう口。
 * 知らないときは null を返す（そのときだけファイルを読む）。
 */
export type KnownCwd = (path: string, mtimeMs: number) => string | null;

/** 置き場所にある会話を、作業ディレクトリを問わず新しい順に返す */
export function recentSessions(
  roots: readonly string[] = defaultRoots(),
  limit = 20,
  onlyCwd: string | null = null,
  knownCwd: KnownCwd = () => null,
): SessionEntry[] {
  const found = roots.flatMap((root) => jsonlUnder(root));
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const entries: SessionEntry[] = [];
  for (const entry of found) {
    if (entries.length >= limit) break;
    // 1本につき32KB読む。4000本だと効くので、分かっているものは読まない
    const cwd = knownCwd(entry.path, entry.mtimeMs) ?? cwdOf(entry.path);
    if (onlyCwd !== null && cwd !== onlyCwd) continue;
    entries.push({ path: entry.path, cwd, mtimeMs: entry.mtimeMs });
  }
  return entries;
}

/**
 * 一覧の見出しを作るために読む量。少ない方から試し、**足りなければ深く読む**。
 *
 * 常に1MB読むと、Codexのような大きい記録が並ぶだけで一覧が数秒かかる
 * （実測2026-09-03: 初回6.1秒。MCP越しだと丸ごと待ち時間になる）。
 * かといって浅く固定すると、前置きが長い記録で発話を取りこぼす（実測: 128KB固定で20本中3本）。
 */
const HEAD_STEPS = [65_536, 262_144, DEEP_BYTES] as const;

/** 下請けの記録かどうかを見分けるためだけの、ごく浅い読み */
export const peekOf = (path: string): string => readHead(path, 8_192);

/**
 * ファイルの先頭を返す（一覧に出す要約を作るため）。
 * `enough` が真を返した時点で止める。最後まで満たさなければ一番深く読んだ分を返す。
 */
export function headOf(path: string, enough: (raw: string) => boolean = () => true): string {
  const size = statSync(path).size;
  let raw = "";
  for (const bytes of HEAD_STEPS) {
    raw = readHead(path, bytes);
    if (enough(raw) || bytes >= size) return raw;
  }
  return raw;
}

/**
 * その作業ディレクトリの会話を、ハーネスをまたいで新しい順に並べて返す。
 * ここは**全部のファイル**を見る（どれが該当するか先に分からないため）。
 * 1本32KB読むので、分かっているものは `knownCwd` で飛ばす——
 * 実測（2026-08-29）で「続きから」が 3.4秒 かかっていたのはここ。
 */
export function sessionsFor(
  cwd: string,
  roots: readonly string[] = defaultRoots(),
  knownCwd: KnownCwd = () => null,
): string[] {
  const candidates = roots.flatMap((root) => jsonlUnder(root));
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates
    .filter((found) => (knownCwd(found.path, found.mtimeMs) ?? cwdOf(found.path)) === cwd)
    .map((found) => found.path);
}

/**
 * いましゃべっている会話の記録を返す。引数なしでボタンから押せるようにするための入口。
 *
 * 同じディレクトリで会話を2つ動かしていると、更新時刻だけでは取り違える
 * （実測: 17秒新しいだけの別の会話を掴んだ）。
 * Claude Codeは `CLAUDE_CODE_SESSION_ID` を渡してくるので、あるなら必ずそれを使う。
 * Codexは渡してこない（codex-cli 0.147.0 で実測）ので、当て推量に頼るしかない。
 */
export function currentSessionFor(
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  roots: readonly string[] = defaultRoots(),
): string | null {
  const id = env["CLAUDE_CODE_SESSION_ID"];
  const byId = id === undefined || id === "" ? null : findSessionById(roots, id);
  return byId ?? sessionsFor(cwd, roots)[0] ?? null;
}

/**
 * **自分自身を除いた**直前の会話たちを、新しい順に返す。
 *
 * 新しいセッションが「続きから」と言われて前の会話を引くときに使う。
 * 自分を除かないと、始まったばかりの**空の自分の会話**を読んでしまう。
 * IDが分からない場合も、Claude Codeの中から呼ばれているなら
 * 一番新しい記録＝いま書き込み中の自分なので落とす。
 */
export function previousSessionsFor(
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  roots: readonly string[] = defaultRoots(),
  knownCwd: KnownCwd = () => null,
): string[] {
  const all = sessionsFor(cwd, roots, knownCwd);
  const id = env["CLAUDE_CODE_SESSION_ID"];
  const self = id === undefined || id === "" ? null : findSessionById(roots, id);
  if (self !== null) return all.filter((path) => path !== self);
  return env["CLAUDECODE"] === undefined ? all : all.slice(1);
}
