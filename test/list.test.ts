import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe as describeSuite, expect, it } from "vitest";
import { type Listed, describe, pick, renderTable } from "../src/list.ts";

const row = (o: unknown): string => JSON.stringify(o);

/** 人が打った会話（promptSource: typed） */
const typedSession = (cwd: string, texts: readonly string[]): string =>
  texts
    .map((text) =>
      row({ type: "user", sessionId: "s", cwd, promptSource: "typed", origin: { kind: "human" }, timestamp: "2026-08-27T00:00:00Z", message: { role: "user", content: text } }),
    )
    .join("\n");

/** サブエージェントの会話（promptSource: sdk） */
const sdkSession = (cwd: string, text: string): string =>
  row({ type: "user", sessionId: "s", cwd, promptSource: "sdk", entrypoint: "sdk-cli", timestamp: "2026-08-27T00:00:00Z", message: { role: "user", content: text } });

const write = (name: string, body: string): { path: string; cwd: string | null; mtimeMs: number } => {
  const dir = mkdtempSync(join(tmpdir(), "list-"));
  mkdirSync(join(dir, "d"));
  const path = join(dir, "d", name);
  writeFileSync(path, body, "utf8");
  const when = new Date(2026, 7, 27, 1, 30);
  utimesSync(path, when, when);
  return { path, cwd: "/w/myproject", mtimeMs: when.getTime() };
};

describeSuite("describe: 一覧の1行を作る", () => {
  it("正常系: 場所・発話数・何の話かが入る", () => {
    const listed = describe(write("abcdef1234.jsonl", typedSession("/w/myproject", ["最初の話", "つぎ"])));
    expect(listed.place).toBe("myproject");
    expect(listed.utterances).toBe(2);
    expect(listed.topic).toBe("最初の話");
    expect(listed.ref).toBe("abcdef12");
    expect(listed.typed).toBe(true);
  });
  it("正常系: 人が打った会話とサブエージェントの記録を見分ける", () => {
    expect(describe(write("a.jsonl", sdkSession("/w/myproject", "下請けへの指示"))).typed).toBe(false);
  });
  it("正常系: Codexの発話も人が打ったものとして扱う", () => {
    const body = row({ timestamp: "2026-08-27T00:00:00Z", payload: { type: "user_message", message: "こっちの話" } });
    expect(describe(write("b.jsonl", body)).typed).toBe(true);
  });
  it("Edge: 長い発話は切って「…」を付ける", () => {
    const listed = describe(write("c.jsonl", typedSession("/w/myproject", ["あ".repeat(80)])));
    expect(listed.topic.endsWith("…")).toBe(true);
    expect(listed.topic.length).toBe(45);
  });
  it("Edge: 複数行の発話は1行目だけ出す", () => {
    expect(describe(write("d.jsonl", typedSession("/w/myproject", ["1行目\n2行目"]))).topic).toBe("1行目");
  });
  it("Error: 発話が無くても落ちない", () => {
    expect(describe(write("e.jsonl", typedSession("/w/myproject", ["<system-reminder>x"]))).topic).toBe("(発話なし)");
  });
});

describeSuite("pick: 一覧から1本に決める", () => {
  const rows: Listed[] = [
    { path: "/a", ref: "aaaa1111", cwd: "/w/a", place: "a", harness: "claude", when: "08/27 01:00", topic: "A", utterances: 3, typed: true },
    { path: "/b", ref: "bbbb2222", cwd: "/w/b", place: "b", harness: "codex", when: "08/27 00:00", topic: "B", utterances: 5, typed: true },
  ];
  it("正常系: 番号で選べる（1始まり）", () => {
    expect(pick(rows, "2")?.path).toBe("/b");
  });
  it("正常系: refの先頭一致で選べる", () => {
    expect(pick(rows, "bbbb")?.path).toBe("/b");
  });
  it("Edge: 範囲外の番号は null", () => {
    expect(pick(rows, "0")).toBeNull();
    expect(pick(rows, "99")).toBeNull();
  });
  it("Error: 当たらないキーは null", () => {
    expect(pick(rows, "zzz")).toBeNull();
  });
  it("Corner: 空の一覧なら常に null", () => {
    expect(pick([], "1")).toBeNull();
  });
});

describeSuite("renderTable: 見て選べる形にする", () => {
  it("正常系: 番号・ref・場所・話が並ぶ", () => {
    const table = renderTable([
      { path: "/a", ref: "aaaa1111", cwd: "/w/a", place: "myproject", harness: "claude", when: "08/27 01:00", topic: "最初の話", utterances: 3, typed: true },
    ]);
    expect(table).toContain("aaaa1111");
    expect(table).toContain("myproject");
    expect(table).toContain("最初の話");
    expect(table).toContain("  1  ");
  });
  it("Edge: 空でも落ちない", () => {
    expect(renderTable([])).toContain("#");
  });
});
