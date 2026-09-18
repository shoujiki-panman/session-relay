/**
 * 「下請けに出さずに、自分で手を動かし続けている」をAIに知らせる。
 *
 * 分担は決まっている（考えるのはメインのFable、手を動かす作業はOpusのサブエージェント）。
 * それでもメインが出し忘れて、読み込み・実行を延々と自分で続けることがある。人が気づいて
 * 止める形は続かないので、道具（PostToolUseフック）の側から数えて、続いたら一行差し込む。
 *
 * - 出すのは**AIの文脈**（additionalContext）。人に見せる知らせではなく、AIへの申し送り
 * - Agent（旧名 Task）を呼んだら0に戻す。出した直後に叱り続けない
 * - しつこくしない。閾値に達したとき1回、あとは閾値ぶん増えるごとに1回
 * - **メインがFableのときだけ**。Opus（＝下請け側や、本人がOpusで回している時）には言わない
 * - **サブエージェント自身の道具使用は数えない**（フック入力の `agent_id` で見分ける。公式ドキュメント
 *   「Present only when the hook fires inside a subagent call.」／2026-09-19確認）
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTail } from "./nudge.ts";
import { asString, isRecord } from "./types.ts";

/** 既定の閾値。8回も続けて自分で触っていたら、それはもう作業 */
export const DEFAULT_DELEGATE_CALLS = 8;
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** モデルを読むための末尾。1行が大きいので少し余裕をみる（読むのは知らせる時だけ） */
const MODEL_TAIL_BYTES = 256 * 1024;

/** 下請けに出す道具。呼ばれたら数えは0に戻る（Task は旧名） */
const DELEGATING_TOOLS: readonly string[] = ["Agent", "Task"];

export const isDelegatingTool = (toolName: string): boolean => DELEGATING_TOOLS.includes(toolName);

/**
 * 閾値。既定は8回。`RELAY_DELEGATE_CALLS` で変えられる。
 * 0や不正値は**無効**（nudgeの流儀と違い既定に戻さない。止めたい人が止められるように）
 */
export function delegateThreshold(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env["RELAY_DELEGATE_CALLS"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_DELEGATE_CALLS;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** 次の数え。下請けに出したら0、それ以外は1つ増える */
export const nextCount = (current: number, toolName: string): number =>
  isDelegatingTool(toolName) ? 0 : current + 1;

/** その数えで知らせるか。閾値ちょうどと、そこから閾値ぶん増えた時だけ */
export const shouldTell = (count: number, threshold: number): boolean =>
  threshold > 0 && count > 0 && count % threshold === 0;

export const delegateMessage = (count: number): string =>
  `relay: サブエージェントに出さずに道具を${String(count)}回続けて使っています。実装・集計・大量の読み込みは下請け(Opusのサブエージェント)に渡し、メインは判断だけにしてください`;

/** 1行から本筋の返事のモデル名を取る。本筋のAIの返事でなければ null */
function modelOf(line: string): string | null {
  if (!line.includes('"model"')) return null;
  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  // 下請けの返事（サイドチェーン）は同じ記録に混ざる。メインのモデルだけを見る
  if (!isRecord(row) || row["type"] !== "assistant" || row["isSidechain"] === true) return null;
  const message = row["message"];
  const model = isRecord(message) ? asString(message["model"]) : null;
  return model === null || model === "" ? null : model;
}

/** 記録（の末尾）から、いちばん新しい本筋の返事のモデル名を返す。分からなければ null */
export function lastAssistantModel(tail: string): string | null {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const model = modelOf(lines[i] ?? "");
    if (model !== null) return model;
  }
  return null;
}

/** メインがFableか。読めなければ false（分からないときは黙る） */
export const isFableModel = (model: string | null): boolean =>
  model !== null && model.toLowerCase().includes("fable");

const stateFile = (dir: string, sessionId: string): string =>
  join(dir, `delegate-${createHash("sha1").update(sessionId).digest("hex").slice(0, 12)}`);

function readCount(file: string): number {
  try {
    const value = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** `/clear` で終わらなかった会話の数えが溜まらないように、古いものを消す */
function prune(dir: string, now: Date): void {
  for (const name of readdirSync(dir)) {
    if (!name.startsWith("delegate-")) continue;
    const file = join(dir, name);
    if (now.getTime() - statSync(file).mtimeMs > STATE_TTL_MS) rmSync(file, { force: true });
  }
}

export function forgetDelegate(dir: string, sessionId: string): void {
  rmSync(stateFile(dir, sessionId), { force: true });
}

/** メインがFableか。記録が読めない・モデルが分からないときは false（黙る） */
function mainIsFable(transcriptPath: string): boolean {
  if (transcriptPath === "") return false;
  try {
    return isFableModel(lastAssistantModel(readTail(transcriptPath, MODEL_TAIL_BYTES)));
  } catch {
    return false;
  }
}

export interface DelegateInput {
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly toolName: string;
  /** サブエージェントの中から来た印。空ならメインの道具使用 */
  readonly agentId: string;
}

/**
 * 道具を使い終わったときに呼ぶ。AIの文脈に足す一行を返す（足さないなら空）。
 *
 * 記録を読むのは**知らせる回だけ**。毎回の道具使用で数MBをなめると遅くなる。
 */
export function delegateNudge(
  input: DelegateInput,
  dir: string,
  threshold: number = delegateThreshold(),
  now: Date = new Date(),
): string {
  if (threshold <= 0) return "";
  // サブエージェント自身の道具使用は数えない（数えるとメインが叱られ続ける）
  if (input.agentId !== "" || input.sessionId === "" || input.toolName === "") return "";
  const file = stateFile(dir, input.sessionId);
  const count = nextCount(readCount(file), input.toolName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, String(count));
  prune(dir, now);
  if (!shouldTell(count, threshold)) return "";
  return mainIsFable(input.transcriptPath) ? delegateMessage(count) : "";
}
