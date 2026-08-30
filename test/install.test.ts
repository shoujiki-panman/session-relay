import { existsSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type World, apply, plan } from "../src/install.ts";

const nothing: World = { has: () => true, registered: () => false, exists: () => false };
const done: World = { has: () => true, registered: () => true, exists: () => true };
const bare: World = { ...nothing, has: () => false };

const ROOT = "/pkg";
const BIN = "/pkg/bin/relay.js";
const HOME = "/home/me";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("relay install", () => {
  it("何も無い機械では、ハーネス2つ×（MCP・スキル）の4手を出す", () => {
    const steps = plan(ROOT, BIN, HOME, nothing);
    expect(steps).toHaveLength(4);
    expect(steps.every((step) => !step.already)).toBe(true);
  });

  it("MCPには**絶対パス**を渡す（起動するのは別のプロセスでPATHが違う）", () => {
    const [claudeMcp] = plan(ROOT, BIN, HOME, nothing);
    expect(claudeMcp?.command).toEqual([
      "claude",
      "mcp",
      "add",
      "relay",
      "--scope",
      "user",
      "--",
      BIN,
      "mcp",
    ]);
  });

  it("Codexには --scope が無い（同じ引数を渡すと落ちる）", () => {
    const codexMcp = plan(ROOT, BIN, HOME, nothing)[2];
    expect(codexMcp?.command).toEqual(["codex", "mcp", "add", "relay", "--", BIN, "mcp"]);
  });

  it("入っていないハーネスは飛ばす（エラーにしない）", () => {
    expect(plan(ROOT, BIN, HOME, bare).every((step) => step.already)).toBe(true);
  });

  it("2度目は何もしない（登録済み・設置済みを見て飛ばす）", () => {
    expect(plan(ROOT, BIN, HOME, done).every((step) => step.already)).toBe(true);
  });

  it("--dry-run は何も実行しない", () => {
    const lines = apply(plan(ROOT, BIN, HOME, nothing), true);
    expect(lines.every((line) => line.startsWith("→"))).toBe(true);
    expect(existsSync(join(HOME, ".claude", "skills", "relay"))).toBe(false);
  });

  it("スキルは実際にリンクとして置かれる", () => {
    const home = mkdtempSync(join(tmpdir(), "relay-install-"));
    temps.push(home);
    const steps = plan(ROOT, BIN, home, { ...nothing, has: (command) => command === "claude" });
    const skill = steps.find((step) => step.link !== undefined);
    expect(skill).toBeDefined();
    if (skill === undefined) return;
    apply([skill], false);
    expect(readlinkSync(join(home, ".claude", "skills", "relay"))).toBe(join(ROOT, "skills", "relay"));
  });
});
