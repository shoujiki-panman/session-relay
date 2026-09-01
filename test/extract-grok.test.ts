/**
 * Grok Build CLIの射影。fixtureは公式ソース（conversation.rs / persistence.rs）の
 * serde定義から起こした形式。実機サンプルでの答え合わせは実機入手後（Issue #5）。
 */
import { expect, it } from "vitest";
import { extractGrok, parseGrokSummary } from "../src/extract-grok.ts";
import { detectHarness, parseJsonl } from "../src/parse.ts";

const line = (v: object): string => JSON.stringify(v);

const CHAT = [
  // <user_info> の前置き（synthetic_reasonなしでも本文が < で始まる）
  line({ type: "user", content: [{ type: "text", text: "<user_info>os: mac</user_info>" }] }),
  // 注入（system_reminder）
  line({
    type: "user",
    content: [{ type: "text", text: "リマインダー本文" }],
    synthetic_reason: "system_reminder",
  }),
  // 本人の発話（user_queryの包みつき）
  line({
    type: "user",
    content: [{ type: "text", text: "前置き\n<user_query>テストを直して</user_query>" }],
  }),
  line({
    type: "assistant",
    content: "直します。",
    tool_calls: [
      { id: "c1", name: "edit_file", arguments: JSON.stringify({ path: "src/a.ts" }) },
      { id: "c2", name: "bash", arguments: JSON.stringify({ command: "npm test" }) },
    ],
  }),
  line({ type: "tool_result", tool_call_id: "c1", content: "ok" }),
  line({ type: "assistant", content: "テストが通りました。" }),
  // 包みなしの素の発話
  line({ type: "user", content: [{ type: "text", text: "ありがとう。次はビルド" }] }),
  line({ type: "assistant", content: "ビルドも通りました。" }),
].join("\n");

const SUMMARY = JSON.stringify({
  info: { id: "0199a-grok-session", cwd: "/Users/dev/proj" },
  session_summary: "テスト修正",
  generated_title: "テストを直す",
  title_is_manual: false,
  created_at: "2026-09-02T01:00:00Z",
  updated_at: "2026-09-02T01:20:00Z",
  num_messages: 8,
  current_model_id: "grok-4",
});

it("chat_history.jsonlをgrokと判定する", () => {
  expect(detectHarness(parseJsonl(CHAT))).toBe("grok");
});

it("本人の発話だけをhumanにし、user_queryの包みを外す", () => {
  const record = extractGrok(parseJsonl(CHAT), SUMMARY);
  const human = record.utterances.filter((u) => u.kind === "human").map((u) => u.text);
  expect(human).toEqual(["テストを直して", "ありがとう。次はビルド"]);
  const injected = record.utterances.filter((u) => u.kind === "injected");
  expect(injected.length).toBe(2); // user_info前置きとsystem_reminder
});

it("ターンの最後のAI報告とツール・ファイル・コマンドを拾う", () => {
  const record = extractGrok(parseJsonl(CHAT), SUMMARY);
  expect(record.turnEndings.map((t) => t.text)).toEqual(["テストが通りました。", "ビルドも通りました。"]);
  expect(record.tools).toEqual(["edit_file", "bash"]);
  expect(record.files).toEqual(["src/a.ts"]);
  expect(record.commands).toEqual(["npm test"]);
});

it("summary.jsonからセッションID・cwd・期間・題名を読む", () => {
  const record = extractGrok(parseJsonl(CHAT), SUMMARY);
  expect(record.harness).toBe("grok");
  expect(record.sessionId).toBe("0199a-grok-session");
  expect(record.cwd).toBe("/Users/dev/proj");
  expect(record.startedAt).toBe("2026-09-02T01:00:00Z");
  expect(record.endedAt).toBe("2026-09-02T01:20:00Z");
  expect(record.title).toBe("テストを直す");
});

it("summaryが無くても壊れず、壊れたsummaryは無視する", () => {
  expect(extractGrok(parseJsonl(CHAT)).sessionId).toBeNull();
  expect(parseGrokSummary("{broken")).toEqual({});
  expect(parseGrokSummary(null)).toEqual({});
});
