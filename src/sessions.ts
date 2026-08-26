import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseJsonl } from "./parse.ts";
import { asString } from "./types.ts";

const claudeRoot = (): string => join(homedir(), ".claude", "projects");

interface Found {
  readonly path: string;
  readonly mtimeMs: number;
}

function jsonlIn(dir: string): Found[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => {
      const path = join(dir, e.name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    });
}

/** そのファイルが記録している作業ディレクトリ（先頭付近の行から拾う） */
function cwdOf(path: string): string | null {
  const head = readFileSync(path, "utf8").slice(0, 200_000);
  for (const row of parseJsonl(head)) {
    const cwd = asString(row["cwd"]);
    if (cwd !== null) return cwd;
  }
  return null;
}

/** セッションIDから記録を探す。IDが分かるなら取り違えようがない */
export function findSessionById(root: string, id: string): string | null {
  if (!existsSync(root)) return null;
  for (const dir of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const path = join(root, dir.name, `${id}.jsonl`);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * いましゃべっている会話の記録を返す。引数なしでボタンから押せるようにするための入口。
 *
 * 同じディレクトリで会話を2つ動かしていると、更新時刻だけでは取り違える
 * （実測: 17秒新しいだけの別の会話を掴んだ）。
 * Claude Codeは `CLAUDE_CODE_SESSION_ID` を渡してくるので、あるなら必ずそれを使う。
 */
export function currentSessionFor(
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  root: string = claudeRoot(),
): string | null {
  const id = env["CLAUDE_CODE_SESSION_ID"];
  const byId = id === undefined || id === "" ? null : findSessionById(root, id);
  return byId ?? newestSessionFor(cwd, root);
}

/** その作業ディレクトリの会話を、新しい順に並べて返す */
export function sessionsFor(cwd: string, root: string = claudeRoot()): string[] {
  if (!existsSync(root)) return [];
  const candidates: Found[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const found of jsonlIn(join(root, dir.name))) {
      if (cwdOf(found.path) === cwd) candidates.push(found);
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.map((found) => found.path);
}

/** IDが分からないときの当て推量。同じディレクトリで2つ動いていると外すことがある */
function newestSessionFor(cwd: string, root: string): string | null {
  return sessionsFor(cwd, root)[0] ?? null;
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
  root: string = claudeRoot(),
): string[] {
  const all = sessionsFor(cwd, root);
  const id = env["CLAUDE_CODE_SESSION_ID"];
  const self = id === undefined || id === "" ? null : findSessionById(root, id);
  if (self !== null) return all.filter((path) => path !== self);
  return env["CLAUDECODE"] === undefined ? all : all.slice(1);
}
