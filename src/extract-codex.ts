import { classifyUtterance } from "./parse.ts";
import { type TurnAcc, emptyTurnAcc, endTurn, finishTurns, noteAssistantText } from "./turns.ts";
import {
  type Row,
  type SessionRecord,
  type Utterance,
  asString,
  isRecord,
  recordsOf,
} from "./types.ts";

interface Acc {
  readonly utterances: Utterance[];
  readonly tools: Set<string>;
  readonly commands: string[];
  readonly times: string[];
  readonly turns: TurnAcc;
  sessionId: string | null;
  cwd: string | null;
}

const emptyAcc = (): Acc => ({
  utterances: [], tools: new Set(), commands: [], times: [], turns: emptyTurnAcc(),
  sessionId: null, cwd: null,
});

/**
 * Codexのツール呼び出し。`custom_tool_call` は `{name, input}` を持ち、
 * inputはシェルやJSのコード文字列（実測）。
 */
function collectToolCall(payload: Row, acc: Acc): void {
  const name = asString(payload["name"]);
  if (name !== null) acc.tools.add(name);
  const input = asString(payload["input"]);
  if (input !== null) acc.commands.push(input);
}

function pushUtterance(text: string, at: string | null, acc: Acc): void {
  if (text === "") return;
  const kind = classifyUtterance(text);
  if (kind === "human") endTurn(acc.turns);
  acc.utterances.push({ at, kind, text });
}

function applyUserMessage(payload: Row, at: string | null, acc: Acc): void {
  pushUtterance(asString(payload["message"]) ?? "", at, acc);
}

/**
 * 2026-09の記録形式。発話は `event_msg/user_message` ではなく
 * `response_item/message`（role: user / assistant）に入る（実測）。
 * 古い形式のセッションも残っているので、両方読む。
 */
function applyMessage(payload: Row, at: string | null, acc: Acc): void {
  const role = asString(payload["role"]);
  if (role !== "user" && role !== "assistant") return; // developerはシステム側の指示
  const text = recordsOf(payload["content"])
    .map((block) => asString(block["text"]) ?? "")
    .filter((part) => part !== "")
    .join("\n")
    .trim();
  if (text === "") return;
  if (role === "assistant") noteAssistantText(acc.turns, at, text);
  else pushUtterance(text, at, acc);
}

function applyMeta(rowType: unknown, payload: Row, acc: Acc): void {
  if (rowType === "session_meta") {
    acc.sessionId ??= asString(payload["id"]);
    acc.cwd ??= asString(payload["cwd"]);
  } else if (rowType === "turn_context") {
    acc.cwd ??= asString(payload["cwd"]);
  }
}

function applyRow(row: Row, acc: Acc): void {
  const at = asString(row["timestamp"]);
  if (at !== null) acc.times.push(at);
  const payload = row["payload"];
  if (!isRecord(payload)) return;

  applyMeta(row["type"], payload, acc);
  const payloadType = payload["type"];
  if (payloadType === "message") applyMessage(payload, at, acc);
  else if (payloadType === "user_message") applyUserMessage(payload, at, acc);
  else if (payloadType === "agent_message") noteAssistantText(acc.turns, at, asString(payload["message"]) ?? "");
  else if (payloadType === "custom_tool_call" || payloadType === "function_call") {
    collectToolCall(payload, acc);
  }
}

export function extractCodex(rows: readonly Row[]): SessionRecord {
  const acc = emptyAcc();
  for (const row of rows) applyRow(row, acc);
  acc.times.sort();
  return {
    sessionId: acc.sessionId,
    harness: "codex",
    cwd: acc.cwd,
    gitBranch: null, // Codexは記録に持たない
    startedAt: acc.times[0] ?? null,
    endedAt: acc.times[acc.times.length - 1] ?? null,
    title: null, // Codexはタイトルを持たない。索引側で最初の発話から作る
    utterances: acc.utterances,
    turnEndings: finishTurns(acc.turns),
    tools: [...acc.tools],
    files: [], // ツール入力がコード文字列なので、パスは確実には取れない
    commands: acc.commands,
  };
}
