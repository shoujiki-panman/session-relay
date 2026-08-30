import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type Memory, load, remember, remembered, save } from "../src/cache.ts";
import type { Listed } from "../src/list.ts";

const temps: string[] = [];
const tempFile = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "relay-cache-"));
  temps.push(dir);
  return join(dir, name);
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const row = (over: Partial<Listed> = {}): Listed => ({
  path: "/rec/a.jsonl",
  ref: "01a00143",
  cwd: "/w/relay",
  place: "~/w/relay",
  harness: "claude",
  when: "08/28 12:33",
  topic: "MCPやるか",
  utterances: 5,
  typed: true,
  words: "",
  ...over,
});

const withOne = (path: string, mtimeMs: number): Memory => {
  const memory: Memory = new Map();
  remember(memory, path, mtimeMs, row({ path }));
  return memory;
};

describe("一覧の覚え書き", () => {
  it("更新時刻が同じなら、読み直さずに返す", () => {
    expect(remembered(withOne("/rec/a.jsonl", 100), "/rec/a.jsonl", 100)?.topic).toBe("MCPやるか");
  });

  it("会話が続いて更新時刻が変われば、覚えていても使わない", () => {
    expect(remembered(withOne("/rec/a.jsonl", 100), "/rec/a.jsonl", 101)).toBeNull();
  });

  it("知らない記録は null", () => {
    expect(remembered(withOne("/rec/a.jsonl", 100), "/rec/b.jsonl", 100)).toBeNull();
  });

  it("書いて読み直すと、同じ見出しが戻る", () => {
    const path = tempFile("list.json");
    const file = tempFile("a.jsonl");
    writeFileSync(file, "{}", "utf8");
    save(withOne(file, 100), path);
    expect(remembered(load(path), file, 100)?.topic).toBe("MCPやるか");
  });

  it("消えた記録は書き出さない（放っておくと際限なく増える）", () => {
    const path = tempFile("list.json");
    save(withOne("/rec/消えた.jsonl", 100), path);
    expect(load(path).size).toBe(0);
  });

  it("壊れていたら黙って捨てる（速くするための仕組みで止まらない）", () => {
    const path = tempFile("list.json");
    writeFileSync(path, "これはJSONではない", "utf8");
    expect(load(path).size).toBe(0);
  });

  it("形が違う覚え書きは読まない（作りを変えたときに古い形を掴まない）", () => {
    const path = tempFile("list.json");
    writeFileSync(path, JSON.stringify({ shape: 3, rows: { "/rec/a.jsonl": { mtimeMs: 100 } } }), "utf8");
    expect(load(path).size).toBe(0);
  });

  it("見出しの作り方を変えた版の覚え書きは、まるごと捨てる", () => {
    const path = tempFile("list.json");
    // 記録は変わっていないので更新時刻では気づけない。版でしか気づけない
    const old = { shape: 1, rows: { "/rec/a.jsonl": { mtimeMs: 100, row: row() } } };
    writeFileSync(path, JSON.stringify(old), "utf8");
    expect(load(path).size).toBe(0);
  });

  it("版が無い（古い形の）覚え書きも読まない", () => {
    const path = tempFile("list.json");
    writeFileSync(path, JSON.stringify({ "/rec/a.jsonl": { mtimeMs: 100, row: {} } }), "utf8");
    expect(load(path).size).toBe(0);
  });

  it("そもそも無いときは空で始まる", () => {
    expect(load(tempFile("まだ無い.json")).size).toBe(0);
  });
});
