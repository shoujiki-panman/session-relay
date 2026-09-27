import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runDeposits } from "../src/deposits-cli.ts";
import { type Deposit, createInbox, renderDeposit } from "../src/inbox.ts";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function inboxWithTwo() {
  const root = mkdtempSync(join(tmpdir(), "session-relay-deposits-cli-"));
  roots.push(root);
  let n = 0;
  const inbox = createInbox(join(root, "inbox"), {
    id: () => `${String(++n).repeat(8)}-1111-4111-8111-111111111111`,
    now: () => `2026-09-28T10:0${String(n)}:00.000Z`,
  });
  const older = inbox.put({ title: "古い", source: "claude-mobile", userMessages: ["前の話"], progress: [] });
  const newer = inbox.put({ title: "新しい", source: "claude-mobile", userMessages: ["続きの話"], progress: ["決めた"] });
  return { inbox, older, newer };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => (out.push(String(chunk)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => (err.push(String(chunk)), true));
  return { out, err };
}

it("show は ref 省略で最新を、get_deposit と同じ中身で出し、既読にする", () => {
  const { inbox, newer } = inboxWithTwo();
  const read: Deposit[] = [];
  const { out } = capture();

  expect(runDeposits(["show"], inbox, (d) => read.push(d))).toBe(0);
  expect(out.join("")).toBe(`${renderDeposit(newer)}\n`);
  expect(read.map((d) => d.id)).toEqual([newer.id]);
});

it("show <ref> は前方一致で1件を選ぶ", () => {
  const { inbox, older } = inboxWithTwo();
  const { out } = capture();

  expect(runDeposits(["show", older.id.slice(0, 8)], inbox, () => undefined)).toBe(0);
  expect(out.join("")).toContain("前の話");
});

it("show で見つからなければ 1 を返し、既読にしない", () => {
  const { inbox } = inboxWithTwo();
  const read: Deposit[] = [];
  const { out, err } = capture();

  expect(runDeposits(["show", "ffff"], inbox, (d) => read.push(d))).toBe(1);
  expect(out).toEqual([]);
  expect(err.join("")).toContain("refが1件に絞れません");
  expect(read).toEqual([]);
});

it("show の引数が多すぎれば使い方を出して 2", () => {
  const { inbox } = inboxWithTwo();
  const { err } = capture();

  expect(runDeposits(["show", "a", "b"], inbox, () => undefined)).toBe(2);
  expect(err.join("")).toContain("relay deposits show");
});
