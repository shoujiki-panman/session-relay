import type { TurnEnding } from "./turns.ts";

/** 対応ハーネス */
export type Harness = "claude-code" | "codex" | "grok";

/**
 * 発話の種類。
 * ハーネスが自動注入したもの（スラッシュコマンドの展開、スキル本文など）は
 * 捨てずに `injected` の印をつける。捨てると射影が不可逆になるため。
 */
export type UtteranceKind = "human" | "injected";

export interface Utterance {
  readonly at: string | null;
  readonly kind: UtteranceKind;
  readonly text: string;
}

/**
 * セッションの射影。要約ではない——残すものと落とすものが定義で決まっている。
 * 人間の発話は1件も落とさない（実測でセッション全体の0.09%しかないため）。
 */
export interface SessionRecord {
  readonly sessionId: string | null;
  readonly harness: Harness;
  readonly cwd: string | null;
  readonly gitBranch: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly title: string | null;
  readonly utterances: readonly Utterance[];
  /** 各ターンの最後にAIが報告した文＝そのターンで何が起きたか */
  readonly turnEndings: readonly TurnEnding[];
  readonly tools: readonly string[];
  readonly files: readonly string[];
  readonly commands: readonly string[];
}

export type Row = Record<string, unknown>;

export const isRecord = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const asString = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

/** 配列のうちレコードのものだけを返す */
export const recordsOf = (v: unknown): Row[] =>
  Array.isArray(v) ? v.filter(isRecord) : [];
