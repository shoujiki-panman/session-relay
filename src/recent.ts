/**
 * 「最近、どのAIと何を話したか」を1つの答えにまとめる純関数。
 *
 * Claude Code・Codex の会話は手元の記録にある。Dots やスマホの Claude の会話は、
 * 預けてもらった分だけが受け口にある。どのエージェントと何を話しているかを1か所で見る場所が無い
 * （2026-10-31 本人。ページではなく、AIに聞けば答える形がいい）。
 *
 * ある時刻より後に動いたものだけを返す。ブートキャンプで dots と併用する道具を作っている人も、
 * 「全件を取り直して差分を探すのは無駄で、漏れや間違いが起きる。ある時刻以降の変動を一括で取りたい」
 * と言っていた。読む側のAIが毎回全部を読み直さなくて済むようにする。
 */
import type { Answer } from "./mcp-answers.ts";
import type { Deposit, DepositSource } from "./inbox.ts";
import type { Listed } from "./list.ts";
import { stamp } from "./list.ts";

/** since を言われなかったときに振り返る長さ */
export const DEFAULT_HOURS = 24;
/** 1回に返す件数の上限。多すぎると読む側のAIがまた全部を読むことになる */
export const RECENT_LIMIT = 30;

export interface Activity {
  readonly kind: "session" | "deposit";
  readonly ref: string;
  /** 最後に動いた時刻（ミリ秒） */
  readonly at: number;
  readonly who: string;
  readonly where: string;
  readonly topic: string;
  readonly utterances: number;
}

const HARNESS_LABEL: Readonly<Record<string, string>> = { claude: "Claude Code", codex: "Codex" };

const SOURCE_LABEL: Record<DepositSource, string> = {
  "claude-mobile": "スマホのClaude",
  "claude-web": "WebのClaude",
  other: "ほかのAI（Dots など）",
};

export const sessionActivity = (row: Listed, at: number): Activity => ({
  kind: "session",
  ref: row.ref,
  at,
  who: HARNESS_LABEL[row.harness] ?? row.harness,
  where: row.place,
  topic: row.topic,
  utterances: row.utterances,
});

export const depositActivity = (deposit: Deposit): Activity => ({
  kind: "deposit",
  ref: deposit.id.slice(0, 8),
  at: Date.parse(deposit.createdAt),
  who: SOURCE_LABEL[deposit.source],
  where: "預かった会話",
  topic: deposit.title,
  utterances: deposit.userMessages.length,
});

/**
 * since の指定を時刻（ミリ秒）にする。ISO の日時か、何時間前か。
 * 読めなければ null（勝手に既定の長さへ置き換えると、頼まれた範囲と違う答えになる）。
 */
export function sinceOf(since: string | undefined, hours: number | undefined, now: number): number | null {
  if (since !== undefined && since !== "") {
    const at = Date.parse(since);
    return Number.isNaN(at) ? null : at;
  }
  const back = hours ?? DEFAULT_HOURS;
  return Number.isFinite(back) && back > 0 ? now - back * 60 * 60 * 1000 : null;
}

const nextCall = (item: Activity): string =>
  item.kind === "deposit" ? `get_deposit ref ${item.ref}` : `get_context ref ${item.ref}`;

const line = (item: Activity): string =>
  `- ${stamp(item.at)} | ${item.who} | ${item.where} | ${item.topic} | 発話 ${String(item.utterances)} | 中身: ${nextCall(item)}`;

/** since より後に動いたものを、新しい順に返す */
export function answerRecent(items: readonly Activity[], since: number): Answer {
  const recent = items
    .filter((item) => item.at > since)
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT_LIMIT);
  const from = stamp(since);
  if (recent.length === 0) {
    return { ok: true, text: `${from} より後に動いた会話はありません。` };
  }
  const total = items.filter((item) => item.at > since).length;
  return {
    ok: true,
    text: [
      `${from} より後に動いた会話（新しい順・${String(recent.length)}件${total > recent.length ? `／全${String(total)}件のうち新しい分` : ""}）。`,
      "中身を読むときは、各行の最後にある道具と ref を使う。",
      ...recent.map(line),
    ].join("\n"),
  };
}
