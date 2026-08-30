import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Listed } from "../src/list.ts";
import type { Project } from "../src/projects.ts";
import { toRecords, writeRecords } from "../src/records.ts";

const temps: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "relay-records-"));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const session = (path: string, ref: string, over: Partial<Listed> = {}): Listed => ({
  path,
  ref,
  cwd: "/w/relay",
  place: "relay",
  harness: "claude",
  when: "08/28 12:33",
  topic: "MCPやるか",
  utterances: 5,
  typed: true,
  words: "",
  ...over,
});

const project = (name: string, sessions: readonly Listed[]): Project => ({
  name,
  cwd: `/w/${name}`,
  when: "08/28 12:33",
  sessions,
});

describe("画面から読める形に書き出す", () => {
  it("refが同じ会話でも、別のファイルなら別のレコードになる", () => {
    // 実測（2026-08-29）: refは8文字。160件中4件がぶつかって上書きされ、会話が消えた
    const records = toRecords([
      project("a", [session("/rec/01a00143-aaa.jsonl", "01a00143")]),
      project("b", [session("/rec/01a00143-bbb.jsonl", "01a00143")]),
    ]);
    expect(new Set(records.map((record) => record.id)).size).toBe(2);
    expect(records.every((record) => record.ref === "01a00143")).toBe(true);
  });

  it("会話の本文は書き出さない（選ぶのに要るのは見出しだけ）", () => {
    const [record] = toRecords([project("a", [session("/rec/x.jsonl", "x")])]);
    expect(Object.keys(record ?? {}).sort()).toEqual([
      "harness",
      "id",
      "place",
      "project",
      "ref",
      "topic",
      "utterances",
      "when",
    ]);
  });

  it("書き出すと1会話＝1ファイルになる", () => {
    const dir = tempDir();
    const written = writeRecords(toRecords([project("a", [session("/rec/x.jsonl", "x")])]), dir);
    expect(written).toBe(1);
    expect(readdirSync(dir)).toEqual(["x.json"]);
    expect(readFileSync(join(dir, "x.json"), "utf8")).toContain('"topic": "MCPやるか"');
  });

  it("もう無い会話のファイルは消す（開けない会話が一覧に居座らない）", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "古い.json"), "{}", "utf8");
    writeRecords(toRecords([project("a", [session("/rec/x.jsonl", "x")])]), dir);
    expect(readdirSync(dir)).toEqual(["x.json"]);
  });

  it("json以外は触らない（他人のファイルを消さない）", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "メモ.txt"), "手で置いたもの", "utf8");
    writeRecords([], dir);
    expect(readdirSync(dir)).toEqual(["メモ.txt"]);
  });
});
