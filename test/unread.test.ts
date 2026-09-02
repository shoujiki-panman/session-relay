/** 未読の勘定。投函ファイルを書き換えず、印を1つ置くだけで数える。 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createInbox } from "../src/inbox.ts";
import { lastReadAt, markRead, unreadDeposits, unreadLine } from "../src/unread.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "session-relay-unread-"));
  roots.push(root);
  return join(root, "inbox");
}

const deposit = (dir: string, title: string) =>
  createInbox(dir).put({ title, source: "claude-mobile", userMessages: ["a"], progress: [] });

/** 時刻を決めて預ける（同じミリ秒に固まると順序が確かめられないため） */
const at = (dir: string, title: string, when: string) =>
  createInbox(dir, { id: () => randomUUID(), now: () => when }).put({
    title,
    source: "claude-mobile",
    userMessages: ["a"],
    progress: [],
  });

it("読む前はすべて未読", () => {
  const dir = fixture();
  deposit(dir, "ひとつめ");
  deposit(dir, "ふたつめ");
  const all = createInbox(dir).list();
  expect(unreadDeposits(all, dir).length).toBe(2);
  expect(lastReadAt(dir)).toBeNull();
});

it("読んだ投函より新しいものだけが未読として残る", () => {
  const dir = fixture();
  const first = at(dir, "古い方", "2026-09-01T00:00:00.000Z");
  markRead(first, dir);
  const afterFirst = unreadDeposits(createInbox(dir).list(), dir);
  expect(afterFirst.length).toBe(0);

  const second = at(dir, "新しい方", "2026-09-02T00:00:00.000Z");
  const now = unreadDeposits(createInbox(dir).list(), dir);
  expect(now.map((d) => d.title)).toEqual(["新しい方"]);

  markRead(second, dir);
  expect(unreadDeposits(createInbox(dir).list(), dir).length).toBe(0);
});

it("古いものを読み返しても印は後退しない", () => {
  const dir = fixture();
  const first = at(dir, "古い方", "2026-09-01T00:00:00.000Z");
  const second = at(dir, "新しい方", "2026-09-02T00:00:00.000Z");
  markRead(second, dir);
  markRead(first, dir); // 読み返し
  expect(lastReadAt(dir)).toBe(`${second.createdAt}\t${second.id}`);
  expect(unreadDeposits(createInbox(dir).list(), dir).length).toBe(0);
});

it("同じミリ秒に届いた2件を巻き添えで既読にしない", () => {
  const dir = fixture();
  const a = deposit(dir, "同時A");
  const b = deposit(dir, "同時B");
  // 実装が時刻だけを見ていると、createdAtが同値のときに両方既読になる
  const [newest, older] = [a, b].sort((x, y) => (x.id > y.id ? -1 : 1));
  if (newest === undefined || older === undefined) throw new Error("fixture");
  markRead(older, dir);
  const left = unreadDeposits(createInbox(dir).list(), dir);
  if (a.createdAt === b.createdAt) expect(left.map((d) => d.id)).toEqual([newest.id]);
});

it("印のファイルは0600で、受信箱の外に置く", () => {
  const dir = fixture();
  markRead(deposit(dir, "x"), dir);
  const marker = join(dirname(dir), "read-at");
  expect(statSync(marker).mode & 0o777).toBe(0o600);
  expect(readFileSync(marker, "utf8").trim()).not.toBe("");
});

it("未読が無ければ何も言わない", () => {
  expect(unreadLine([])).toBe("");
});

it("未読があれば件数と最新の題名を1行で返す", () => {
  const dir = fixture();
  at(dir, "ひとつめ", "2026-09-01T00:00:00.000Z");
  at(dir, "ふたつめ", "2026-09-02T00:00:00.000Z");
  const line = unreadLine(unreadDeposits(createInbox(dir).list(), dir));
  expect(line).toContain("2件");
  expect(line).toContain("ふたつめ"); // 新しい順の先頭
  expect(line).toContain("ほか1件");
});
