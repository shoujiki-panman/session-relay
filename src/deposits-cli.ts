/** 受信箱（スマホ等から預けられた会話）の一覧と削除。読むのは relay mcp の get_deposit。 */
import { type Inbox, createInbox } from "./inbox.ts";

const DEPOSITS_USAGE = "使い方: relay deposits（一覧）／ relay deposits rm <ref>（削除）\n";

const when = (iso: string): string => iso.slice(5, 16).replace("T", " ");

function removeOne(inbox: Inbox, ref: string | undefined): number {
  if (ref === undefined || ref === "") {
    process.stderr.write(DEPOSITS_USAGE);
    return 2;
  }
  const removed = inbox.remove(ref);
  if (removed === null) {
    process.stderr.write(`refが1件に絞れません: ${ref}（relay deposits で一覧を確認）\n`);
    return 1;
  }
  process.stdout.write(`消しました: ${when(removed.createdAt)}  ${removed.title}\n`);
  return 0;
}

export function runDeposits(args: readonly string[], inbox: Inbox = createInbox()): number {
  if (args[0] === "rm") return removeOne(inbox, args[1]);
  if (args.length > 0) {
    process.stderr.write(DEPOSITS_USAGE);
    return 2;
  }
  const rows = inbox.list();
  if (rows.length === 0) {
    process.stdout.write("受信箱は空です\n");
    return 0;
  }
  for (const item of rows) {
    process.stdout.write(`${item.id.slice(0, 8)}  ${when(item.createdAt)}  ${item.source}  ${item.title}\n`);
  }
  return 0;
}
