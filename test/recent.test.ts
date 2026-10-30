import { describe, expect, it } from "vitest";
import type { Deposit } from "../src/inbox.ts";
import type { Listed } from "../src/list.ts";
import {
  DEFAULT_HOURS,
  RECENT_LIMIT,
  answerRecent,
  depositActivity,
  sessionActivity,
  sinceOf,
} from "../src/recent.ts";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-31T12:00:00+09:00");

const session = (over: Partial<Listed> = {}): Listed => ({
  path: "/rec/x.jsonl",
  ref: "ca011a8f",
  cwd: "/w/ai-samples",
  place: "ai-samples",
  harness: "claude",
  when: "10/31 11:00",
  topic: "原文を確かめて",
  utterances: 2,
  typed: true,
  words: "",
  ...over,
});

const deposit = (over: Partial<Deposit> = {}): Deposit => ({
  shape: 1,
  id: "7d96d293-975a-48b9-8648-4b971db826d8",
  createdAt: "2026-10-31T10:00:00+09:00",
  title: "ちゃまからの試し",
  source: "other",
  userMessages: ["預けて"],
  progress: [],
  ...over,
});

describe("いつから見るか", () => {
  it(`何も言われなければ${String(DEFAULT_HOURS)}時間前から`, () => {
    expect(sinceOf(undefined, undefined, NOW)).toBe(NOW - DEFAULT_HOURS * HOUR);
  });

  it("hours で何時間前からかを決める", () => {
    expect(sinceOf(undefined, 3, NOW)).toBe(NOW - 3 * HOUR);
  });

  it("since の日時があれば、それを使う", () => {
    expect(sinceOf("2026-10-30T09:00:00+09:00", 3, NOW)).toBe(Date.parse("2026-10-30T09:00:00+09:00"));
  });

  it.each([
    ["日時として読めない since", "きのう", undefined],
    ["0時間", undefined, 0],
    ["負の時間", undefined, -5],
  ])("%s は null（既定の長さに勝手に置き換えない）", (_label, since, hours) => {
    expect(sinceOf(since, hours, NOW)).toBeNull();
  });
});

describe("最近どのAIと何を話したか", () => {
  it("手元の会話と預かった会話を、新しい順に1つにまとめる", () => {
    const items = [
      sessionActivity(session(), NOW - 1 * HOUR),
      depositActivity(deposit()),
      sessionActivity(session({ ref: "4a357ec0", harness: "codex", topic: "返信文頼む" }), NOW - 3 * HOUR),
    ];
    const { ok, text } = answerRecent(items, NOW - 24 * HOUR);
    expect(ok).toBe(true);
    const lines = text.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Claude Code | ai-samples | 原文を確かめて");
    expect(lines[1]).toContain("ほかのAI（Dots など） | 預かった会話 | ちゃまからの試し");
    expect(lines[2]).toContain("Codex | ai-samples | 返信文頼む");
  });

  it("since より前に動いたものは返さない（差分だけを渡す）", () => {
    const items = [
      sessionActivity(session(), NOW - 1 * HOUR),
      sessionActivity(session({ ref: "old00000", topic: "おととい" }), NOW - 48 * HOUR),
    ];
    const { text } = answerRecent(items, NOW - 24 * HOUR);
    expect(text).toContain("原文を確かめて");
    expect(text).not.toContain("おととい");
  });

  it("各行に、中身を読む道具と ref を書く（読む側のAIがもう一度探しに行かないため）", () => {
    const { text } = answerRecent(
      [sessionActivity(session(), NOW - HOUR), depositActivity(deposit())],
      NOW - 24 * HOUR,
    );
    expect(text).toContain("中身: get_context ref ca011a8f");
    expect(text).toContain("中身: get_deposit ref 7d96d293");
  });

  it("預かった中身（本人の言葉）は入れない。見出しと数だけ", () => {
    const { text } = answerRecent(
      [depositActivity(deposit({ userMessages: ["非公開の話"] }))],
      NOW - 24 * HOUR,
    );
    expect(text).not.toContain("非公開の話");
    expect(text).toContain("発話 1");
  });

  it(`多すぎるときは新しい${String(RECENT_LIMIT)}件までにして、全部で何件かを書く`, () => {
    const items = Array.from({ length: RECENT_LIMIT + 5 }, (_, i) =>
      sessionActivity(session({ ref: `r${String(i).padStart(7, "0")}`, topic: `話${String(i)}` }), NOW - i * 60_000),
    );
    const { text } = answerRecent(items, NOW - 24 * HOUR);
    expect(text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(RECENT_LIMIT);
    expect(text).toContain(`全${String(RECENT_LIMIT + 5)}件のうち新しい分`);
    expect(text).toContain("話0");
    expect(text).not.toContain(`話${String(RECENT_LIMIT + 4)}`);
  });

  it("何も無ければ、そう言う（失敗にはしない）", () => {
    const answer = answerRecent([], NOW - 24 * HOUR);
    expect(answer.ok).toBe(true);
    expect(answer.text).toContain("動いた会話はありません");
  });
});
