/**
 * `relay hook` — 同じ画面のまま、会話だけ軽くする。
 *
 * 実測（2026-09-18）: 直近14日のFableの入力13.6億トークンのうち79%を、長く続けた8本が
 * 使っていた。1回の呼び出しで最大99万トークンを読み直している。区切れば減るが、
 * 「新しいセッションを開いて『続きから』と打つ」は面倒で続かない（本人の言葉）。
 *
 * Claude Codeのフックに乗る。本人が打つのは `/clear` だけ:
 *   SessionEnd（reason=clear）   … 終わる会話の記録の場所を控える
 *   SessionStart（source=clear） … 控えた会話の文脈を標準出力に出す（＝新しい会話に入る）
 *   Stop                         … 会話が育っていたら「いま区切るといい」を画面に出す
 *
 * **フックは何があっても失敗させない。** ここで落ちると `/clear` のたびに赤い字が出る。
 * 分からない入力・控えが無い・期限切れは、どれも黙って何も出さない。
 */
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { buildContext } from "./context.ts";
import { clearHandoff, defaultHandoffPath, peekHandoff, putHandoff } from "./handoff.ts";
import { forgetNudge, nudge } from "./nudge.ts";
import { parseRelayContext } from "./relay-block.ts";
import { readRepoSignals } from "./repo.ts";
import { asString, isRecord } from "./types.ts";

/**
 * 控えの寿命。`/clear` の前後は数秒しか空かない。
 * 長くすると、昼に控えた会話が夜の無関係な `/clear` に流れ込む。
 */
export const SLOT_TTL_MS = 10 * 60 * 1000;

export const CLEAR_NOTE =
  "（同じ画面で /clear された直前の会話です。本人は区切ったつもりはありません。挨拶や要約はせず、そのまま続けてください）";

export interface HookInput {
  readonly event: string;
  /** SessionEnd の reason / SessionStart の source */
  readonly trigger: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly cwd: string;
}

export function parseHookInput(raw: string): HookInput | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const event = asString(value["hook_event_name"]);
  const cwd = asString(value["cwd"]);
  if (event === null || cwd === null) return null;
  return {
    event,
    cwd,
    trigger: asString(value["reason"]) ?? asString(value["source"]) ?? "",
    sessionId: asString(value["session_id"]) ?? "",
    transcriptPath: asString(value["transcript_path"]) ?? "",
  };
}

/**
 * 控えは場所ごとに分ける。別のプロジェクトで同時に `/clear` しても混ざらない。
 * 「次はこれ」の印（handoff）とは別のファイル——あちらは24時間生きる、人が押した印。
 */
export const slotFor = (cwd: string, dir: string = dirname(defaultHandoffPath())): string =>
  join(dir, `clear-${createHash("sha1").update(cwd).digest("hex").slice(0, 12)}`);

function remember(input: HookInput, now: Date, dir?: string): void {
  if (input.transcriptPath === "") return;
  putHandoff(
    { at: now.toISOString(), id: input.sessionId, path: input.transcriptPath, cwd: input.cwd, topic: "" },
    slotFor(input.cwd, dir),
  );
}

function recall(input: HookInput, now: Date, dir?: string): string {
  const file = slotFor(input.cwd, dir);
  const slot = peekHandoff(now, file);
  // 拾えても拾えなくても消す。残すと次の無関係な /clear に流れ込む
  clearHandoff(file);
  if (slot === null || now.getTime() - Date.parse(slot.at) > SLOT_TTL_MS) return "";
  return buildContext(slot.path, readRepoSignals(input.cwd), CLEAR_NOTE) ?? "";
}

/**
 * 本人の画面に出す一行。`/clear` で画面が真っ白になると「消えた」と感じる（本人の言葉:
 * 「文章が消えるからビビるな」）。文脈はAIにしか見えないので、入ったことを人にも見せる。
 */
export function notice(context: string): string {
  const count = parseRelayContext(context)?.utterances.length ?? 0;
  const kb = Math.max(1, Math.round(Buffer.byteLength(context, "utf8") / 1024));
  return `relay: 前の会話を引き継ぎました（本人の発話 ${String(count)}件・${String(kb)}KB）。消えたのは画面だけで、記録は残っています`;
}

/**
 * 文脈をAIに、一行を本人に。素の標準出力だとAIにしか届かないので、フックのJSON形式で出す
 * （実測 2026-09-18: systemMessage は画面に、additionalContext は文脈に入る）。
 */
export const wrapForClaude = (context: string): string =>
  JSON.stringify({
    systemMessage: notice(context),
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  });

/** 返事が終わったとき。会話が育っていたら「いま区切るといい」を本人の画面に出す（nudge.ts） */
function afterReply(input: HookInput, now: Date, dir: string): string {
  const message = nudge(input.transcriptPath, input.sessionId, dir, undefined, now);
  return message === "" ? "" : JSON.stringify({ systemMessage: message });
}

/** フックの入力を受けて、標準出力に出す文字列を返す（出すものが無ければ空） */
export function runHook(raw: string, now: Date = new Date(), dir?: string): string {
  const input = parseHookInput(raw);
  if (input === null) return "";
  const stateDir = dir ?? dirname(defaultHandoffPath());
  if (input.event === "Stop") return afterReply(input, now, stateDir);
  if (input.trigger !== "clear") return "";
  if (input.event === "SessionEnd") {
    remember(input, now, dir);
    forgetNudge(stateDir, input.sessionId);
  }
  if (input.event !== "SessionStart") return "";
  const context = recall(input, now, dir);
  return context === "" ? "" : wrapForClaude(context);
}
