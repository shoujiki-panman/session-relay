/**
 * いまのリポジトリの状態。会話の記録ではなく、渡す瞬間に取る生の信号。
 * 「どこまで本当に出来ているか」は、会話より git のほうが正直なので。
 */
import { spawnSync } from "node:child_process";

export interface RepoSignals {
  /** どこのリポジトリを見た値なのか。会話の話題と違うことがあるので必ず添える */
  readonly dir: string;
  readonly branch: string | null;
  readonly log: readonly string[];
  readonly dirty: readonly string[];
}

const empty = (dir: string): RepoSignals => ({ dir, branch: null, log: [], dirty: [] });

function git(cwd: string, args: readonly string[]): string | null {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") return null;
  return result.stdout.trimEnd();
}

const lines = (raw: string | null): string[] =>
  raw === null || raw === "" ? [] : raw.split("\n");

export function readRepoSignals(cwd: string): RepoSignals {
  if (git(cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") return empty(cwd);
  return {
    dir: git(cwd, ["rev-parse", "--show-toplevel"]) ?? cwd,
    branch: git(cwd, ["branch", "--show-current"]),
    log: lines(git(cwd, ["log", "--oneline", "-n", "10"])),
    dirty: lines(git(cwd, ["status", "--short"])).slice(0, 20),
  };
}
