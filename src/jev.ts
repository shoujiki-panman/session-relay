/**
 * 区切りの知らせを、会話の**中身**で決める（任意）。
 *
 * 今までの知らせはトークン数だけで出していたので、調べものの真ん中でも出た
 * （nudge.ts の「調査の最中に切られると読み直しで損をする」と裏表）。
 * TypeSafe の Jev（判断モデル）に、目で見て確かめられる事実を2つだけ聞いて、
 * 終わりのあいさつで終わっているときだけ出す。
 *
 * - 鍵（TYPESAFE_API_KEY）が無ければ何もしない＝今までどおり
 * - 失敗・遅い・形が違う → null を返す。呼び側は今までどおりに動く
 * - **会話の中身を外（TypeSafe）に送る。** だから鍵を入れた人だけ有効にする
 *
 * 聞き方は「判断」ではなく観測できる事実を1問1つ。実測（2026-09-19、本人の環境）:
 *   おやすみで終わる会話 … あいさつ 0.97 / 質問 0.03
 *   調べものの途中       … あいさつ 0.04 / 質問 0.90
 * しきい値 0.8 / 0.2 は、どちらからも十分離れている。
 */
import type { StoppingGate } from "./nudge.ts";
import { classifyUtterance, parseJsonl } from "./parse.ts";
import { type Row, asString, isRecord, recordsOf } from "./types.ts";

export const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";
export const DEFAULT_CLOSING_MIN = 0.8;
export const DEFAULT_QUESTION_MAX = 0.2;
/** フックの中で待つ時間。超えたら諦めて今までどおり出す */
export const DEFAULT_TIMEOUT_MS = 1500;
/** state に入れる往復の数。公式: 余計なものを入れると精度が落ちる（context rot） */
const MAX_TURNS = 6;
const MAX_CHARS_PER_TURN = 200;

export const CLOSING_QUESTION = "最後の発話は、お礼・あいさつ・了解など、話を終える合図か？";
export const ASKING_QUESTION = "最後の発話は、相手に答えを求める質問か？";

export interface JevOptions {
  readonly key: string;
  readonly model: string;
  readonly closingMin: number;
  readonly questionMax: number;
  readonly timeoutMs: number;
}

const ratio = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
};

const positive = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const jevOptions = (env: Readonly<Record<string, string | undefined>> = process.env): JevOptions => ({
  key: env["TYPESAFE_API_KEY"] ?? "",
  model: env["RELAY_JEV_MODEL"] ?? DEFAULT_MODEL,
  closingMin: ratio(env["RELAY_JEV_CLOSING_MIN"], DEFAULT_CLOSING_MIN),
  questionMax: ratio(env["RELAY_JEV_QUESTION_MAX"], DEFAULT_QUESTION_MAX),
  timeoutMs: positive(env["RELAY_JEV_TIMEOUT_MS"], DEFAULT_TIMEOUT_MS),
});

const clip = (text: string): string =>
  text.length <= MAX_CHARS_PER_TURN ? text : `${text.slice(0, MAX_CHARS_PER_TURN)}…`;

/**
 * 発話の中の改行を空白に畳む。
 * Jev には「1行＝1発話」として読ませているので、
 * 箇条書きやコード片で改行の入った発話が1つあるだけで、行数と発話数がずれる
 * （実測 2026-09-20: 6往復のつもりが11行になっていた）。
 */
const flatten = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** 1行の message から本文を取る。文字列でもブロックの配列でも拾う */
function textOf(message: unknown): string {
  if (!isRecord(message)) return "";
  const content = message["content"];
  const direct = asString(content);
  if (direct !== null) return direct.trim();
  const parts: string[] = [];
  for (const block of recordsOf(content)) {
    if (block["type"] !== "text") continue;
    const text = asString(block["text"]);
    if (text !== null) parts.push(text);
  }
  return parts.join("\n").trim();
}

/** 1行を「本人：…」「AI：…」の1行にする。渡せない行は null */
function turnOf(row: Row): string | null {
  if (row["isSidechain"] === true || row["isMeta"] === true) return null;
  const type = asString(row["type"]);
  if (type !== "user" && type !== "assistant") return null;
  const text = textOf(row["message"]);
  if (text === "") return null;
  // 注入された発話（system-reminder など）は本人の言葉ではない
  if (type === "user" && classifyUtterance(text) !== "human") return null;
  return `${type === "user" ? "本人" : "AI"}：${clip(flatten(text))}`;
}

/** 記録の末尾から、直近の往復を話者つきの素のテキストにする */
export function recentTurnsText(tail: string, maxTurns: number = MAX_TURNS): string {
  const lines: string[] = [];
  for (const row of parseJsonl(tail)) {
    const line = turnOf(row);
    if (line !== null) lines.push(line);
  }
  return lines.slice(-maxTurns).join("\n");
}

export interface JevVerdict {
  readonly closing: number;
  readonly question: number;
}

const noulOf = (answers: unknown, key: string): number | null => {
  if (!isRecord(answers)) return null;
  const answer = answers[key];
  if (!isRecord(answer)) return null;
  const value = answer["noul"];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Jev に2問投げる。何かおかしければ null（黙って今までどおりに倒す） */
export async function askStoppingPoint(
  state: string,
  options: JevOptions,
  fetchImpl: FetchLike = fetch,
): Promise<JevVerdict | null> {
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs),
      body: JSON.stringify({
        state,
        model: options.model,
        questions: {
          ends_with_closing: { type: "noul", instructions: CLOSING_QUESTION },
          user_asked_question: { type: "noul", instructions: ASKING_QUESTION },
        },
      }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body)) return null;
    const closing = noulOf(body["answers"], "ends_with_closing");
    const question = noulOf(body["answers"], "user_asked_question");
    if (closing === null || question === null) return null;
    return { closing, question };
  } catch {
    return null;
  }
}

/** 区切りか。true=区切り / false=途中 / null=判定なし（鍵が無い・失敗） */
export async function looksLikeStoppingPoint(
  state: string,
  options: JevOptions = jevOptions(),
  fetchImpl?: FetchLike,
): Promise<boolean | null> {
  if (options.key === "" || state === "") return null;
  const verdict = await askStoppingPoint(state, options, fetchImpl);
  if (verdict === null) return null;
  return verdict.closing >= options.closingMin && verdict.question <= options.questionMax;
}

/** nudge に渡す門。記録の末尾を受けて、区切りかどうかを返す */
export const jevGate = (options: JevOptions = jevOptions(), fetchImpl?: FetchLike): StoppingGate =>
  async (tail: string) => looksLikeStoppingPoint(recentTurnsText(tail), options, fetchImpl);
