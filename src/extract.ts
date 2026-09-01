import { extractClaude } from "./extract-claude.ts";
import { extractCodex } from "./extract-codex.ts";
import { extractGrok } from "./extract-grok.ts";
import { detectHarness, parseJsonl } from "./parse.ts";
import type { SessionRecord } from "./types.ts";

export * from "./types.ts";
export { parseJsonl, classifyUtterance, detectHarness } from "./parse.ts";

/**
 * セッションの生JSONLを射影する。形式が判定できなければ null。
 * 要約は一切しない——人間の発話は1件も落とさず、順序も保つ。
 */
export function extractSession(raw: string): SessionRecord | null {
  const rows = parseJsonl(raw);
  const harness = detectHarness(rows);
  if (harness === null) return null;
  if (harness === "grok") return extractGrok(rows);
  return harness === "claude-code" ? extractClaude(rows) : extractCodex(rows);
}

/** 人間が実際に打った発話だけを取り出す（注入されたものを除く） */
export function humanUtterances(record: SessionRecord): readonly string[] {
  return record.utterances.filter((u) => u.kind === "human").map((u) => u.text);
}
