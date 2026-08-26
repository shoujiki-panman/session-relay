import { describe as describeSuite, expect, it } from "vitest";
import type { Listed } from "../src/list.ts";
import { backspace, filterRows, initial, move, render, selected, setQuery, typed } from "../src/picker.ts";
import { step } from "../src/run-picker.ts";

const ESC = "\u001B";
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;

const row = (place: string, topic: string, ref: string): Listed => ({
  path: `/${ref}`, ref, cwd: `/w/${place}`, place, harness: "claude",
  when: "08/27 01:00", topic, utterances: 3, typed: true,
});

const rows: Listed[] = [
  row("ai-samples", "session-relayの続き", "aaaa1111"),
  row("mulmoclaude", "ローカルが強くなったら", "bbbb2222"),
  row("aidoku", "都知事杯の提出", "cccc3333"),
];

describeSuite("filterRows: 打つと絞れる", () => {
  it("正常系: 場所で当たる", () => {
    expect(filterRows(rows, "mulmo").map((r) => r.ref)).toEqual(["bbbb2222"]);
  });
  it("正常系: 話の中身でも当たる", () => {
    expect(filterRows(rows, "都知事").map((r) => r.ref)).toEqual(["cccc3333"]);
  });
  it("正常系: refでも当たる", () => {
    expect(filterRows(rows, "aaaa").map((r) => r.ref)).toEqual(["aaaa1111"]);
  });
  it("Edge: 空なら全部", () => {
    expect(filterRows(rows, "").length).toBe(3);
  });
  it("Edge: 空白だけでも全部", () => {
    expect(filterRows(rows, "   ").length).toBe(3);
  });
  it("Corner: 大文字小文字は区別しない", () => {
    expect(filterRows(rows, "MULMO").map((r) => r.ref)).toEqual(["bbbb2222"]);
  });
  it("Error: 当たらなければ空", () => {
    expect(filterRows(rows, "ざぶとん")).toEqual([]);
  });
});

describeSuite("move: 端で止まる（行き過ぎて選び間違えない）", () => {
  it("正常系: 下に動く", () => {
    expect(move(initial(rows), 1).cursor).toBe(1);
  });
  it("Edge: 先頭より上には行かない", () => {
    expect(move(initial(rows), -1).cursor).toBe(0);
  });
  it("Edge: 末尾より下には行かない", () => {
    expect(move(move(move(move(initial(rows), 1), 1), 1), 1).cursor).toBe(2);
  });
  it("Corner: 当たる行が無いときは0のまま", () => {
    expect(move(setQuery(initial(rows), "ざぶとん"), 1).cursor).toBe(0);
  });
});

describeSuite("setQuery: 絞ったら選択位置は先頭に戻す", () => {
  it("正常系: 3番目を選んでから絞ると、絞った先の1件目になる", () => {
    const moved = move(move(initial(rows), 1), 1);
    expect(moved.cursor).toBe(2);
    const narrowed = setQuery(moved, "mulmo");
    expect(narrowed.cursor).toBe(0);
    expect(selected(narrowed)?.ref).toBe("bbbb2222");
  });
  it("正常系: 1文字ずつ打てる／消せる", () => {
    const s = backspace(typed(typed(initial(rows), "m"), "x"));
    expect(s.query).toBe("m");
  });
  it("Edge: 空のときにbackspaceしても落ちない", () => {
    expect(backspace(initial(rows)).query).toBe("");
  });
});

describeSuite("step: キーの割り当て", () => {
  it("正常系: ↑↓で動く", () => {
    expect(step(initial(rows), DOWN).next.cursor).toBe(1);
    expect(step(move(initial(rows), 1), UP).next.cursor).toBe(0);
  });
  it("正常系: Enterで決まる", () => {
    expect(step(initial(rows), "\r").done).toBe("select");
    expect(step(initial(rows), "\n").done).toBe("select");
  });
  it("正常系: Escで取り消す", () => {
    expect(step(initial(rows), ESC).done).toBe("cancel");
  });
  it("正常系: Ctrl-Cでも取り消す", () => {
    expect(step(initial(rows), "\u0003").done).toBe("cancel");
  });
  it("正常系: 文字は検索語になる", () => {
    expect(step(initial(rows), "m").next.query).toBe("m");
  });
  it("正常系: backspaceで1文字消える", () => {
    expect(step(typed(initial(rows), "m"), "\u007F").next.query).toBe("");
  });
  it("Corner: 矢印以外のエスケープ列で検索語が汚れない", () => {
    expect(step(initial(rows), `${ESC}[5~`).next.query).toBe("");
  });
  it("Corner: 制御文字は捨てる", () => {
    expect(step(initial(rows), "\u0001").next.query).toBe("");
  });
});

describeSuite("render: 見て選べる画面", () => {
  it("正常系: 選択中の行に印が付く", () => {
    const out = render(move(initial(rows), 1));
    expect(out).toContain("\u276f");
    expect(out.split("\n").find((l) => l.startsWith("\u276f"))).toContain("mulmoclaude");
  });
  it("正常系: 操作方法と件数が出る", () => {
    const out = render(initial(rows));
    expect(out).toContain("Enter");
    expect(out).toContain("Esc");
    expect(out).toContain("3件");
  });
  it("正常系: 絞った件数が反映される", () => {
    expect(render(setQuery(initial(rows), "mulmo"))).toContain("1件");
  });
  it("Edge: 当たる行が無いと、そう言う", () => {
    expect(render(setQuery(initial(rows), "ざぶとん"))).toContain("当たる会話がありません");
  });
  it("Edge: 幅が狭いと行を切る", () => {
    const long = [row("p", "あ".repeat(200), "dddd4444")];
    for (const line of render(initial(long), 60).split("\n")) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });
});
