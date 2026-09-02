import { RELAY_HEADER } from "./relay-block.ts";
import { type Harness, type Row, type UtteranceKind, isRecord } from "./types.ts";

/**
 * JSONLを行ごとに読む。壊れた行は飛ばす。
 * （セッションはCtrl-Cや電源断で途中終了するので、末尾が壊れているのは異常ではない）
 */
export function parseJsonl(raw: string): Row[] {
  const rows: Row[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (isRecord(value)) rows.push(value);
    } catch {
      // 壊れた行は無視する（記録の途中終了は日常的に起きる）
    }
  }
  return rows;
}

/** ハーネスが自動注入した発話の目印。人間が打った文と区別するため */
const INJECTED_PREFIXES = [
  "<local-command-",
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<system-reminder>",
  "<user-memory-input>",
  "<task-notification>",
  "[Request interrupted by user",
  "Base directory for this skill:",
  "Caveat: The messages below",
  // Codex（desktop）が毎ターン差し込む前置き
  "<recommended_plugins>",
  "<environment_context>",
  "<app-context>",
  "# Files mentioned by the user:",
  // Codexの承認確認セッション。人の会話ではないので一覧に出さない（実測で見出しを占領していた）
  "The following is the Codex agent history",
  // relayが渡した文脈そのもの。通常は relay-block.ts で畳まれるが、
  // 畳めなかったとき（入れ子が深すぎるなど）に人間の発話として数えないための保険
  RELAY_HEADER,
] as const;

export function classifyUtterance(text: string): UtteranceKind {
  const head = text.trimStart();
  return INJECTED_PREFIXES.some((prefix) => head.startsWith(prefix))
    ? "injected"
    : "human";
}

/**
 * 中身からハーネスを判定する。
 * Claude Codeは各行が sessionId を持ち、Codexは payload を持つ。
 */
const GROK_TYPES = new Set(["user", "assistant", "tool_result", "system", "backend_tool_call", "reasoning"]);

export function detectHarness(rows: readonly Row[]): Harness | null {
  for (const row of rows) {
    if (typeof row["sessionId"] === "string") return "claude-code";
    if (isRecord(row["payload"])) return "codex";
    // Grokのchat_history.jsonl: sessionId/payloadを持たず、typeがConversationItemのタグ
    if (
      typeof row["type"] === "string" &&
      GROK_TYPES.has(row["type"]) &&
      row["message"] === undefined &&
      "content" in row
    )
      return "grok";
  }
  return null;
}
