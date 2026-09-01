/**
 * Grok Build CLI（xai-org/grok-build）の射影。
 * 記録: ~/.grok/sessions/<encoded-cwd>/<session-id>/ の chat_history.jsonl（会話）と summary.json（メタ）。
 * 形式の根拠は公式ソース（xai-grok-sampling-types/src/conversation.rs / xai-grok-shell/src/session/persistence.rs）。
 * ⚠️ 実機のセッションでの答え合わせはまだ（Grok Buildは有料ログインが要るため）。
 */
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

/** ツール引数のうち、ファイルパスが入りうるキー（Grokのツール名は実機で未確認のため広めに拾う） */
const FILE_KEYS = ["path", "file_path", "filename"] as const;

/** user行のcontent（ContentPart[]）からテキストを連結する */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return recordsOf(content)
    .filter((block) => block["type"] === "text")
    .map((block) => asString(block["text"]) ?? "")
    .join("\n");
}

/**
 * 本人の発話を取り出す。Grokは本文を `<user_query>…</user_query>` で包むことがある
 * （公式の extract_first_user_prompt と同じ扱い）。包みが無く `<` で始まる行は
 * `<user_info>` 等の前置きなので注入扱いにする。
 */
function utteranceOf(row: Row): Utterance | null {
  const text = textOf(row["content"]).trim();
  if (text === "") return null;
  if (row["synthetic_reason"] !== undefined) return { at: null, kind: "injected", text };
  const start = text.indexOf("<user_query>");
  if (start >= 0) {
    const after = text.slice(start + "<user_query>".length);
    const end = after.indexOf("</user_query>");
    const query = (end >= 0 ? after.slice(0, end) : after).trim();
    if (query !== "") return { at: null, kind: classifyUtterance(query), text: query };
  }
  if (text.startsWith("<")) return { at: null, kind: "injected", text };
  return { at: null, kind: classifyUtterance(text), text };
}

function collectToolCalls(row: Row, tools: Set<string>, files: Set<string>, commands: string[]): void {
  for (const call of recordsOf(row["tool_calls"])) {
    const name = asString(call["name"]);
    if (name !== null) tools.add(name);
    const rawArguments = asString(call["arguments"]);
    if (rawArguments === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawArguments);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    for (const key of FILE_KEYS) {
      const file = asString(parsed[key]);
      if (file !== null) files.add(file);
    }
    const command = asString(parsed["command"]);
    if (command !== null) commands.push(command);
  }
}

/** summary.json からメタを読む。無くても射影は成立する */
export function parseGrokSummary(raw: string | null): Partial<SessionRecord> {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const info = isRecord(parsed["info"]) ? parsed["info"] : {};
  return {
    sessionId: asString(info["id"]),
    cwd: asString(info["cwd"]),
    startedAt: asString(parsed["created_at"]),
    endedAt: asString(parsed["updated_at"]),
    title: asString(parsed["generated_title"]),
  };
}

interface Acc {
  readonly utterances: Utterance[];
  readonly tools: Set<string>;
  readonly files: Set<string>;
  readonly commands: string[];
  readonly turns: TurnAcc;
}

function applyRow(row: Row, acc: Acc): void {
  if (row["type"] === "user") {
    const utterance = utteranceOf(row);
    if (utterance === null) return;
    if (utterance.kind === "human") endTurn(acc.turns);
    acc.utterances.push(utterance);
  } else if (row["type"] === "assistant") {
    noteAssistantText(acc.turns, null, asString(row["content"]) ?? "");
    collectToolCalls(row, acc.tools, acc.files, acc.commands);
  }
}

export function extractGrok(rows: readonly Row[], summaryRaw: string | null = null): SessionRecord {
  const acc: Acc = {
    utterances: [],
    tools: new Set(),
    files: new Set(),
    commands: [],
    turns: emptyTurnAcc(),
  };
  for (const row of rows) applyRow(row, acc);
  const meta = parseGrokSummary(summaryRaw);
  return {
    sessionId: meta.sessionId ?? null,
    harness: "grok",
    cwd: meta.cwd ?? null,
    gitBranch: null,
    startedAt: meta.startedAt ?? null,
    endedAt: meta.endedAt ?? null,
    title: meta.title ?? null,
    utterances: acc.utterances,
    turnEndings: finishTurns(acc.turns),
    tools: [...acc.tools],
    files: [...acc.files],
    commands: acc.commands,
  };
}
