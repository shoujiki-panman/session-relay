/**
 * Codexの射影。記録形式が2026-09に変わったので、旧・新の両方を読めることを確かめる。
 * 旧: event_msg/user_message ／ 新: response_item/message (role: user)
 */
import { expect, it } from "vitest";
import { extractSession } from "../src/extract.ts";

const line = (v: object): string => JSON.stringify(v);

const OLD_FORMAT = [
  line({
    timestamp: "2026-08-01T00:00:00.000Z",
    type: "session_meta",
    payload: { id: "01a00001", cwd: "/Users/dev/old" },
  }),
  line({
    timestamp: "2026-08-01T00:00:01.000Z",
    type: "event_msg",
    payload: { type: "user_message", message: "テストを直して" },
  }),
  line({
    timestamp: "2026-08-01T00:00:02.000Z",
    type: "event_msg",
    payload: { type: "agent_message", message: "直しました。" },
  }),
  line({
    timestamp: "2026-08-01T00:00:03.000Z",
    type: "response_item",
    payload: { type: "custom_tool_call", name: "shell", input: "npm test" },
  }),
].join("\n");

const NEW_FORMAT = [
  line({
    timestamp: "2026-09-01T00:00:00.000Z",
    type: "session_meta",
    payload: { id: "01a05840", cwd: "/Users/dev/proj" },
  }),
  // システム側の指示。人の発話ではない
  line({
    timestamp: "2026-09-01T00:00:01.000Z",
    type: "response_item",
    payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<app-context>…" }] },
  }),
  // Codexが毎ターン差し込む前置き（role: user だが人が打っていない）
  line({
    timestamp: "2026-09-01T00:00:02.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "<recommended_plugins>\nAirtable…" }],
    },
  }),
  line({
    timestamp: "2026-09-01T00:00:03.000Z",
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "なんでわかるんだ？" }] },
  }),
  line({
    timestamp: "2026-09-01T00:00:04.000Z",
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "こう直しました。" }] },
  }),
  line({
    timestamp: "2026-09-01T00:00:05.000Z",
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "やって見ますか" }] },
  }),
].join("\n");

it("旧形式（user_message）を読む", () => {
  const record = extractSession(OLD_FORMAT);
  expect(record?.harness).toBe("codex");
  expect(record?.utterances.filter((u) => u.kind === "human").map((u) => u.text)).toEqual(["テストを直して"]);
  expect(record?.turnEndings.map((t) => t.text)).toEqual(["直しました。"]);
  expect(record?.tools).toEqual(["shell"]);
  expect(record?.commands).toEqual(["npm test"]);
  expect(record?.cwd).toBe("/Users/dev/old");
});

it("新形式（message role:user）でも本人の発話を拾う", () => {
  const record = extractSession(NEW_FORMAT);
  expect(record?.harness).toBe("codex");
  const human = record?.utterances.filter((u) => u.kind === "human").map((u) => u.text);
  // 前置き（recommended_plugins）とdeveloperは人の発話に混ぜない
  expect(human).toEqual(["なんでわかるんだ？", "やって見ますか"]);
  expect(record?.turnEndings.map((t) => t.text)).toEqual(["こう直しました。"]);
  expect(record?.cwd).toBe("/Users/dev/proj");
  expect(record?.sessionId).toBe("01a05840");
});

it("承認確認のセッションは人の会話として数えない", () => {
  const approval = [
    line({ timestamp: "2026-09-01T00:00:00.000Z", type: "session_meta", payload: { id: "x", cwd: "/tmp" } }),
    line({
      timestamp: "2026-09-01T00:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "The following is the Codex agent history whose request action…" }],
      },
    }),
  ].join("\n");
  const record = extractSession(approval);
  expect(record?.utterances.filter((u) => u.kind === "human")).toEqual([]);
});
