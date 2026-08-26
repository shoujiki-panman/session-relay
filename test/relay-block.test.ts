import { describe, expect, it } from "vitest";
import { type SessionRecord, extractSession, humanUtterances } from "../src/extract.ts";
import { RELAY_HEADER, isRelayContext, parseRelayContext } from "../src/relay-block.ts";

/** relayが実際に書く形の文脈ブロックを作る（context.ts と同じ並び） */
const contextBlock = (utterances: readonly string[], files: readonly string[] = [], commands: readonly string[] = []): string =>
  [
    RELAY_HEADER,
    "これは同じ人物の直前までの会話です。",
    "",
    "作業場所: /w (branch: main)",
    "期間: A 〜 B",
    "",
    "## 本人が実際に打った言葉（時系列・全件）",
    ...utterances.map((t, i) =>
      t.split("\n").map((line, j) => (j === 0 ? `${String(i + 1)}. ${line}` : `   ${line}`)).join("\n"),
    ),
    "",
    "## 触ったファイル",
    ...files.map((f) => `- ${f}`),
    "",
    "## 実行したコマンド（後半20件）",
    ...commands.map((c) => `- ${c}`),
    "",
    "---",
    "上を読んだうえで、まず一言だけ現在地を確認してから続けてください。",
  ].join("\n");

/** 射影できなかったら落とす（テストで `!` を使わないため） */
const recordOf = (raw: string): SessionRecord => {
  const record = extractSession(raw);
  if (record === null) throw new Error("射影できなかった");
  return record;
};

const humanOf = (raw: string): readonly string[] => humanUtterances(recordOf(raw));

const userRow = (text: string): string =>
  JSON.stringify({ type: "user", sessionId: "s1", cwd: "/w", timestamp: "2026-08-26T00:00:00Z", message: { role: "user", content: text } });

describe("isRelayContext: relayが渡した文脈かどうか", () => {
  it("正常系: 見出しで始まれば true", () => {
    expect(isRelayContext(contextBlock(["あ"]))).toBe(true);
  });
  it("Edge: 先頭に空白や改行があっても true", () => {
    expect(isRelayContext(`\n  ${contextBlock(["あ"])}`)).toBe(true);
  });
  it("正常系: 普通の発話は false", () => {
    expect(isRelayContext("需要あるか？")).toBe(false);
  });
  it("Corner: 途中に見出しがあるだけなら false（先頭のみ見る）", () => {
    expect(isRelayContext(`前置き\n${RELAY_HEADER}`)).toBe(false);
  });
});

describe("parseRelayContext: 元の発話の並びに畳み直す", () => {
  it("正常系: 発話・ファイル・コマンドを取り出す", () => {
    const block = parseRelayContext(contextBlock(["おけ", "次"], ["/a.ts"], ["ls -la"]));
    expect(block?.utterances).toEqual(["おけ", "次"]);
    expect(block?.files).toEqual(["/a.ts"]);
    expect(block?.commands).toEqual(["ls -la"]);
  });
  it("正常系: 複数行の発話も1件のまま戻る", () => {
    const block = parseRelayContext(contextBlock(["一行目\n二行目\n三行目", "つぎ"]));
    expect(block?.utterances).toEqual(["一行目\n二行目\n三行目", "つぎ"]);
  });
  it("Corner: 発話の中に「3. 」で始まる行があっても割れない（番号が続く時だけ区切る）", () => {
    const block = parseRelayContext(contextBlock(["手順は\n3. これ\n4. あれ"]));
    expect(block?.utterances).toEqual(["手順は\n3. これ\n4. あれ"]);
  });
  it("Edge: 発話ゼロ件でも壊れない", () => {
    expect(parseRelayContext(contextBlock([]))?.utterances).toEqual([]);
  });
  it("Edge: ファイル欄・コマンド欄が無くても発話は取れる", () => {
    const text = [RELAY_HEADER, "", "## 本人が実際に打った言葉（時系列・全件）", "1. やった"].join("\n");
    expect(parseRelayContext(text)?.utterances).toEqual(["やった"]);
  });
  it("Error: 文脈ブロックでなければ null", () => {
    expect(parseRelayContext("ふつうの発話")).toBeNull();
  });
});

describe("入れ子にならないこと（このプロジェクトで実際に起きたバグ）", () => {
  it("正常系: relayで開いたセッションを再びrelayしても、前の発話が1件ずつ復活する", () => {
    const raw = [userRow(contextBlock(["最初の話", "次の話"])), userRow("そのあとの話")].join("\n");
    expect(humanOf(raw)).toEqual(["最初の話", "次の話", "そのあとの話"]);
  });
  it("正常系: 2回渡しても平らなまま（発話数が二乗に膨らまない）", () => {
    const once = contextBlock(["あ", "い"]);
    const twice = contextBlock([once, "う"]);
    expect(humanOf(userRow(twice))).toEqual(["あ", "い", "う"]);
  });
  it("正常系: 前の会話のファイルとコマンドも引き継がれる", () => {
    const record = recordOf(userRow(contextBlock(["あ"], ["/前.ts"], ["npm test"])));
    expect(record.files).toContain("/前.ts");
    expect(record.commands).toContain("npm test");
  });
  it("Corner: 入れ子が深すぎたら人間の発話として数えない（保険が効く）", () => {
    let text = contextBlock(["底"]);
    for (let i = 0; i < 8; i += 1) text = contextBlock([text]);
    expect(humanOf(userRow(text))).toEqual([]);
  });
});

describe("ハーネスの通知は本人の発話ではない", () => {
  it("正常系: <task-notification> は human に数えない", () => {
    const raw = [userRow("<task-notification>\n<task-id>x</task-id>\n</task-notification>"), userRow("おけ")].join("\n");
    expect(humanOf(raw)).toEqual(["おけ"]);
  });
  it("正常系: 中断マーカーも human に数えない", () => {
    expect(humanOf(userRow("[Request interrupted by user]"))).toEqual([]);
  });
});

describe("字下げが無い旧形式（すでに実セッションに入っている分）", () => {
  const legacyBlock = (utterances: readonly string[]): string =>
    [
      RELAY_HEADER,
      "",
      "## 本人が実際に打った言葉（時系列・全件）",
      ...utterances.map((t, i) => `${String(i + 1)}. ${t}`),
      "",
      "## 触ったファイル",
      "",
      "---",
    ].join("\n");

  it("正常系: 旧形式でも1段なら畳める（過去の会話が読めなくならない）", () => {
    const raw = [userRow(legacyBlock(["最初", "つぎ"])), userRow("いま")].join("\n");
    expect(humanOf(raw)).toEqual(["最初", "つぎ", "いま"]);
  });
  it("正常系: 旧形式の複数行発話も1件のまま", () => {
    expect(humanOf(userRow(legacyBlock(["一行目\n二行目"])))).toEqual(["一行目\n二行目"]);
  });
});
