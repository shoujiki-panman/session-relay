import { describe as describeSuite, expect, it } from "vitest";
import type { Listed } from "../src/list.ts";
import { groupByProject, pickProject, renderProjects } from "../src/projects.ts";

const row = (ref: string, cwd: string | null, place: string, when: string, topic: string): Listed => ({
  path: `/p/${ref}`, ref, cwd, place, harness: "claude", when, topic, utterances: 3, typed: true,
});

/** 一覧は新しい順で渡ってくる */
const listed: Listed[] = [
  row("aaaa1111", "/w/mulmoclaude", "mulmoclaude", "08/27 23:50", "これだとわからんな"),
  row("bbbb2222", "/w/ai-samples", "ai-samples", "08/27 10:00", "テストを直す"),
  row("cccc3333", "/w/mulmoclaude", "mulmoclaude", "08/26 09:00", "買い物エージェント"),
];

describeSuite("groupByProject: 会話をプロジェクトに束ねる", () => {
  it("正常系: 同じプロジェクトの会話が1つにまとまる", () => {
    const projects = groupByProject(listed);
    expect(projects.map((p) => p.name)).toEqual(["mulmoclaude", "ai-samples"]);
    expect(projects[0]?.sessions).toHaveLength(2);
  });
  it("正常系: 並びは「最新の会話が新しい順」", () => {
    expect(groupByProject(listed)[0]?.name).toBe("mulmoclaude");
  });
  it("正常系: プロジェクトの時刻は、その中で一番新しい会話の時刻", () => {
    expect(groupByProject(listed)[0]?.when).toBe("08/27 23:50");
  });
  it("Edge: 名前が同じでも場所が違えば別のプロジェクトにする", () => {
    const same = [row("a", "/w/a/work", "work", "08/27 12:00", "A"), row("b", "/w/b/work", "work", "08/27 11:00", "B")];
    expect(groupByProject(same)).toHaveLength(2);
  });
  it("Corner: 場所が分からない会話も落とさない", () => {
    expect(groupByProject([row("z", null, "-", "08/27 12:00", "謎")])).toHaveLength(1);
  });
  it("Error: 空でも落ちない", () => {
    expect(groupByProject([])).toEqual([]);
  });
});

describeSuite("pickProject: プロジェクトを1つに決める", () => {
  const projects = groupByProject(listed);
  it("正常系: 番号で選べる（1始まり）", () => {
    expect(pickProject(projects, "2")?.name).toBe("ai-samples");
  });
  it("正常系: 名前の先頭一致で選べる", () => {
    expect(pickProject(projects, "mulmo")?.name).toBe("mulmoclaude");
  });
  it("Edge: 大文字小文字は問わない", () => {
    expect(pickProject(projects, "MULMO")?.name).toBe("mulmoclaude");
  });
  it("Error: 当たらなければ null", () => {
    expect(pickProject(projects, "zzz")).toBeNull();
    expect(pickProject(projects, "99")).toBeNull();
  });
});

describeSuite("renderProjects: 見て選べる形にする", () => {
  it("正常系: プロジェクト名・会話数・直近の話が並ぶ", () => {
    const table = renderProjects(groupByProject(listed));
    expect(table).toContain("mulmoclaude");
    expect(table).toContain("これだとわからんな");
    expect(table).toContain("  1  ");
  });
  it("Edge: 空でも落ちない", () => {
    expect(renderProjects([])).toContain("#");
  });
});
