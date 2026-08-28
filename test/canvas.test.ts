import { describe as describeSuite, expect, it } from "vitest";
import type { Listed } from "../src/list.ts";
import { buildCanvas, toCanvas } from "../src/canvas.ts";
import { groupByProject } from "../src/projects.ts";

const row = (ref: string, cwd: string, place: string, topic: string): Listed => ({
  path: `/p/${ref}`, ref, cwd, place, harness: "claude", when: "08/27 23:50", topic, utterances: 7, typed: true,
});

const canvasOf = (rows: readonly Listed[]) => buildCanvas(groupByProject(rows));

describeSuite("buildCanvas: プロジェクトと会話をキャンバスに組む", () => {
  const rows = [
    row("aaaa1111", "/w/mulmoclaude", "mulmoclaude", "これだとわからんな"),
    row("bbbb2222", "/w/mulmoclaude", "mulmoclaude", "買い物エージェント"),
  ];

  it("正常系: プロジェクト1つ＋会話2つで、ノード3・線2", () => {
    const canvas = canvasOf(rows);
    expect(canvas.nodes).toHaveLength(3);
    expect(canvas.edges).toHaveLength(2);
  });
  it("正常系: 線はプロジェクトから会話へ向く", () => {
    const [edge] = canvasOf(rows).edges;
    expect(edge?.fromNode).toBe("p0");
    expect(edge?.toNode).toBe("s0-0");
  });
  it("正常系: 会話のカードに、続けるためのコマンドが書いてある", () => {
    const card = canvasOf(rows).nodes.find((node) => node.id === "s0-0");
    expect(card?.text).toContain("relay --from aaaa1111");
  });
  it("正常系: プロジェクトのカードに名前と会話数が入る", () => {
    const card = canvasOf(rows).nodes.find((node) => node.id === "p0");
    expect(card?.text).toContain("mulmoclaude");
    expect(card?.text).toContain("会話 2 件");
  });
  it("Edge: ノードのidは全部ちがう（同じだと繋ぎ先が壊れる）", () => {
    const ids = canvasOf([...rows, row("cccc3333", "/w/other", "other", "別の話")]).nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("Corner: プロジェクトどうしは縦に重ならない", () => {
    const canvas = canvasOf([
      row("a", "/w/one", "one", "A"),
      row("b", "/w/one", "one", "B"),
      row("c", "/w/two", "two", "C"),
    ]);
    const firstBottom = Math.max(...canvas.nodes.filter((node) => node.id.startsWith("s0")).map((node) => node.y));
    const secondTop = canvas.nodes.find((node) => node.id === "p1")?.y ?? 0;
    expect(secondTop).toBeGreaterThan(firstBottom);
  });
  it("Error: 空でも落ちない", () => {
    expect(canvasOf([]).nodes).toHaveLength(0);
  });
});

describeSuite("toCanvas: .canvas の中身にする", () => {
  it("正常系: そのままJSONとして読める", () => {
    const text = toCanvas(groupByProject([row("a", "/w/one", "one", "A")]));
    expect(() => { JSON.parse(text); }).not.toThrow();
    expect(text.endsWith("\n")).toBe(true);
  });
  it("Edge: 会話が無くてもJSONとして壊れない", () => {
    expect(() => { JSON.parse(toCanvas([])); }).not.toThrow();
  });
});
