import { describe, expect, it } from "vitest";
import {
  answerContext,
  answerConversations,
  answerMatches,
  answerProjects,
  noPrevious,
  noSuchRef,
} from "../src/mcp-answers.ts";
import type { Listed } from "../src/list.ts";
import type { Project } from "../src/projects.ts";

const session = (over: Partial<Listed> = {}): Listed => ({
  path: "/tmp/a.jsonl",
  ref: "01a00143",
  cwd: "/Users/me/work/relay",
  place: "~/work/relay",
  harness: "claude",
  when: "08/14 12:33",
  topic: "一覧の見出しが読めない",
  utterances: 42,
  typed: true,
  words: "",
  ...over,
});

const project = (over: Partial<Project> = {}): Project => ({
  name: "relay",
  cwd: "/Users/me/work/relay",
  when: "08/28 01:08",
  sessions: [session()],
  ...over,
});

describe("MCPが返す文面", () => {
  it("プロジェクト一覧に、次の呼び出しに要る名前と件数が入る", () => {
    const answer = answerProjects([project()]);
    expect(answer.ok).toBe(true);
    expect(answer.text).toContain("relay");
    expect(answer.text).toContain("会話 1");
    expect(answer.text).toContain("list_conversations");
  });

  it("記録がゼロなら失敗として返す（空の一覧を成功と混ぜない）", () => {
    const answer = answerProjects([]);
    expect(answer.ok).toBe(false);
  });

  it("会話一覧には ref が入る。無いとAIがもう一度探しに行く", () => {
    const answer = answerConversations(project(), "relay");
    expect(answer.text).toContain("ref 01a00143");
    expect(answer.text).toContain("get_context");
  });

  it("当たらないプロジェクト名は、探し直す手順を添えて失敗を返す", () => {
    const answer = answerConversations(null, "そんなの");
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("list_projects");
  });

  it("射影は切り詰めない（要約しないのがこの道具の取り柄）", () => {
    const long = "あ".repeat(50_000);
    expect(answerContext(long).text).toHaveLength(50_000);
  });

  it("前の会話が無いときは、場所を書いて次の手を示す", () => {
    const answer = noPrevious("/Users/me/work/relay");
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("/Users/me/work/relay");
    expect(answer.text).toContain("list_projects");
  });

  it("当たらない ref も失敗として返す", () => {
    expect(noSuchRef("deadbeef").ok).toBe(false);
  });
});

describe("本人の言葉で探したとき", () => {
  it("複数当たったら候補を返し、選ぶのはAIの仕事だと書く", () => {
    const answer = answerMatches("地図", [session(), session({ ref: "0b11", topic: "地図の色" })]);
    expect(answer.ok).toBe(true);
    expect(answer.text).toContain("2本");
    expect(answer.text).toContain("あなたが");
  });

  it("当たらなければ理由まで書く（言葉を変えれば済むと分かる）", () => {
    const answer = answerMatches("ぜんぜん無い話", []);
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("見出しと置き場所");
  });

  it("一覧の締めくくりで、refを本人に聞き返すなと書く", () => {
    expect(answerConversations(project(), "relay").text).toContain("聞き返さない");
  });
});
