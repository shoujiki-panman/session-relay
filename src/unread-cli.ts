/** `relay unread` — 未読の投函を1行で知らせる。SessionStartフックから呼ぶ用。 */
import { type Inbox, createInbox } from "./inbox.ts";
import { unreadDeposits, unreadLine } from "./unread.ts";

export function runUnread(inbox: Inbox = createInbox()): number {
  const line = unreadLine(unreadDeposits(inbox.list()));
  // 未読が無いときは何も出さない。フックが毎回うるさくならないように
  if (line !== "") process.stdout.write(`${line}\n`);
  return 0;
}
