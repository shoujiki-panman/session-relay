import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EVERYONE, MAX_MESSAGES, MAX_TEXT_CHARS, createBoard, renderMessages } from "../src/board.ts";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** 時刻を1秒ずつ進める伝言板（並び順を決めるため） */
const boardAt = (start = Date.parse("2026-10-31T10:00:00Z")) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-board-"));
  temps.push(dir);
  let tick = 0;
  let n = 0;
  const board = createBoard(dir, {
    id: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
    now: () => new Date(start + (tick += 1) * 1000).toISOString(),
  });
  return { board, dir };
};

// 鍵の形をした文字列はリポジトリに直書きしない
const fakeKey = `sk-proj-${"Q".repeat(40)}`;
const BEFORE = "2026-10-31T09:00:00Z";

describe("伝言板", () => {
  it("書いた伝言を、古い順に読める", () => {
    const { board } = boardAt();
    board.post({ from: "ちゃま", to: "Muse", text: "資料を分析して" });
    board.post({ from: "Muse", to: "ちゃま", text: "分析しました" });
    expect(board.since(BEFORE).map((m) => `${m.from}→${m.to}:${m.text}`)).toEqual([
      "ちゃま→Muse:資料を分析して",
      "Muse→ちゃま:分析しました",
    ]);
  });

  it("鍵やトークンの形をしたものは、保存する前に伏せる（ファイルにも元の値を残さない）", () => {
    const { board, dir } = boardAt();
    const saved = board.post({ from: "ちゃま", text: `このキーで動かして ${fakeKey}` });
    expect(saved.text).toBe("このキーで動かして [伏せた: OpenAIの鍵]");
    const onDisk = readdirSync(dir).map((name) => readFileSync(join(dir, name), "utf8")).join("");
    expect(onDisk).not.toContain(fakeKey);
  });

  it("宛先を省くと全員あて", () => {
    const { board } = boardAt();
    expect(board.post({ from: "ちゃま", text: "みんなへ" }).to).toBe(EVERYONE);
  });

  it("to を渡すと、その人あてと全員あての分だけ（大文字小文字は区別しない）", () => {
    const { board } = boardAt();
    board.post({ from: "ちゃま", to: "Muse", text: "Museへ" });
    board.post({ from: "ちゃま", to: "Claude Code", text: "Claude Codeへ" });
    board.post({ from: "ちゃま", text: "みんなへ" });
    expect(board.since(BEFORE, "muse").map((m) => m.text)).toEqual(["Museへ", "みんなへ"]);
  });

  it("since より後の分だけ返す（差分だけを読む）", () => {
    const { board } = boardAt();
    const first = board.post({ from: "ちゃま", text: "1つ目" });
    board.post({ from: "ちゃま", text: "2つ目" });
    expect(board.since(first.createdAt).map((m) => m.text)).toEqual(["2つ目"]);
  });

  it.each([
    ["空の伝言", { from: "ちゃま", text: "   " }, "伝言が空です"],
    ["書いた人が空", { from: " ", text: "こんにちは" }, "書いた人が空です"],
    ["長すぎる伝言", { from: "ちゃま", text: "あ".repeat(MAX_TEXT_CHARS + 1) }, `伝言は${String(MAX_TEXT_CHARS)}文字までです`],
  ])("%s は断る", (_label, input, message) => {
    const { board } = boardAt();
    expect(() => board.post(input)).toThrow(message);
  });

  it(`${String(MAX_MESSAGES)}件を超えたら、古いものから消す（満杯で会話を止めない）`, () => {
    const { board, dir } = boardAt();
    for (let i = 0; i < MAX_MESSAGES + 2; i += 1) board.post({ from: "ちゃま", text: `伝言${String(i)}` });
    expect(readdirSync(dir)).toHaveLength(MAX_MESSAGES);
    const texts = board.since(BEFORE).map((m) => m.text);
    expect(texts[0]).toBe("伝言2");
    expect(texts.at(-1)).toBe(`伝言${String(MAX_MESSAGES + 1)}`);
  }, 30_000);

  it("読む側には、誰から誰へ・いつ・何をを1行ずつ返す", () => {
    const { board } = boardAt();
    board.post({ from: "ちゃま", to: "Muse", text: "1行目\n2行目" });
    const text = renderMessages(board.since(BEFORE), BEFORE);
    expect(text).toContain("ちゃま → Muse | 1行目\n  2行目");
    expect(renderMessages([], BEFORE)).toContain("伝言はありません");
  });
});
