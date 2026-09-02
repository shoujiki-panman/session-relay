/**
 * 未読の投函を数える。
 * 投函ファイルは書き換えない（0600のまま・壊さない）。
 * 代わりに「最後に読んだ投函の時刻」を1ファイルに置き、それより新しいものを未読とする。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Deposit, defaultInboxDir } from "./inbox.ts";

const markerPath = (inboxDir: string): string => join(dirname(inboxDir), "read-at");

/**
 * 並べ替えの鍵。時刻だけだと、同じミリ秒に届いた2件が巻き添えで既読になる（テストで実測）。
 * idまで入れると同時刻でも順序が決まる。
 */
const key = (deposit: Deposit): string => `${deposit.createdAt}\t${deposit.id}`;

/** 最後に読んだ投函の印（`時刻\tid`）。読んだことが無ければ null */
export function lastReadAt(inboxDir: string = defaultInboxDir()): string | null {
  try {
    const text = readFileSync(markerPath(inboxDir), "utf8").trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

/** 読んだ投函の時刻を記録する。古いものを読んでも印は後退させない */
export function markRead(deposit: Deposit, inboxDir: string = defaultInboxDir()): void {
  const previous = lastReadAt(inboxDir);
  if (previous !== null && previous >= key(deposit)) return;
  const path = markerPath(inboxDir);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${key(deposit)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** まだ読んでいない投函（新しい順） */
export function unreadDeposits(all: readonly Deposit[], inboxDir: string = defaultInboxDir()): Deposit[] {
  const since = lastReadAt(inboxDir);
  return all.filter((deposit) => since === null || key(deposit) > since);
}

/** フックから呼ぶ1行。未読が無ければ空文字（＝何も言わない） */
export function unreadLine(unread: readonly Deposit[]): string {
  const newest = unread[0];
  if (newest === undefined) return "";
  const count = unread.length;
  const more = count > 1 ? `（ほか${String(count - 1)}件）` : "";
  return `📮 未読の投函が${String(count)}件あります: 「${newest.title}」${more} — 読むなら「預けた会話の続き」と言ってください`;
}
