/**
 * `relay install` — MCPとスキルをまとめて登録する。
 *
 * 手で入れると4コマンド（claude / codex / スキル2本）あり、しかも
 * MCPの登録は**絶対パス**で書かないと動かない（起動するのは別のプロセスで、
 * `~/.local/bin` が PATH に入っていないことがある）。ここで間違えると
 * 「繋がらない」だけが残って原因が見えない。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Step {
  readonly what: string;
  /** もう済んでいる。実行しない */
  readonly already: boolean;
  readonly command?: readonly string[];
  /** [繋ぐ先, 置く場所] */
  readonly link?: readonly [string, string];
}

export interface World {
  readonly has: (command: string) => boolean;
  readonly registered: (command: string) => boolean;
  readonly exists: (path: string) => boolean;
}

const HARNESSES = [
  { command: "claude", label: "Claude Code", skills: [".claude", "skills"] },
  { command: "codex", label: "Codex", skills: [".codex", "skills"] },
] as const;

/** `claude mcp add` と `codex mcp add` は引数の並びが同じ */
const addArgs = (command: string, bin: string): string[] =>
  command === "claude"
    ? ["mcp", "add", "relay", "--scope", "user", "--", bin, "mcp"]
    : ["mcp", "add", "relay", "--", bin, "mcp"];

function mcpStep(harness: (typeof HARNESSES)[number], bin: string, world: World): Step {
  const { command, label } = harness;
  if (world.registered(command)) return { what: `${label}: MCPは登録済み`, already: true };
  return { what: `${label}: MCPに relay を登録`, already: false, command: [command, ...addArgs(command, bin)] };
}

function skillStep(harness: (typeof HARNESSES)[number], root: string, home: string, world: World): Step {
  const { label, skills } = harness;
  const to = join(home, ...skills, "relay");
  if (world.exists(to)) return { what: `${label}: スキルは置いてある`, already: true };
  return { what: `${label}: 「続きから」のスキルを置く`, already: false, link: [join(root, "skills", "relay"), to] };
}

/**
 * 何をするかを先に決める。実行しないので、そのまま --dry-run に使える。
 * 入っていないハーネスには**何も置かない**。スキルだけ置くと、使う人のいない
 * `~/.claude/skills` を勝手に作ることになる（テストが捕まえた）。
 */
export function plan(root: string, bin: string, home: string, world: World): Step[] {
  return HARNESSES.flatMap((harness) =>
    world.has(harness.command)
      ? [mcpStep(harness, bin, world), skillStep(harness, root, home, world)]
      : [{ what: `${harness.label}: 見つからないので飛ばす`, already: true }],
  );
}

export const realWorld: World = {
  has: (command) => spawnSync("which", [command], { stdio: "ignore" }).status === 0,
  registered: (command) => spawnSync(command, ["mcp", "get", "relay"], { stdio: "ignore" }).status === 0,
  exists: existsSync,
};

function act(step: Step): string {
  if (step.command !== undefined) {
    const [head, ...rest] = step.command;
    if (head === undefined) return "×  コマンドが空";
    const result = spawnSync(head, rest, { stdio: "ignore" });
    return result.status === 0 ? `✓  ${step.what}` : `×  ${step.what}（${head} が失敗）`;
  }
  if (step.link === undefined) return `-  ${step.what}`;
  const [from, to] = step.link;
  mkdirSync(dirname(to), { recursive: true });
  symlinkSync(from, to);
  return `✓  ${step.what}`;
}

/** 実行して、何をしたかを行で返す。dryRun のときは何もせず「これをやる」だけ返す */
export const apply = (steps: readonly Step[], dryRun: boolean): string[] =>
  steps.map((step) => {
    if (step.already) return `-  ${step.what}`;
    return dryRun ? `→  ${step.what}` : act(step);
  });

/** MCPに登録するのは**絶対パス**。起動するのは別のプロセスで、PATHが違う */
export function install(dryRun: boolean): number {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const steps = plan(root, join(root, "bin", "relay.js"), homedir(), realWorld);
  process.stdout.write(`${apply(steps, dryRun).join("\n")}\n`);
  process.stdout.write(
    dryRun
      ? "（--dry-run なので何もしていません）\n"
      : "新しいセッションで「続きから」と言えば、前の会話を読み込みます\n",
  );
  return 0;
}
