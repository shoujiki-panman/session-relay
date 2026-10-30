/**
 * 一覧を1枚のHTMLにする。
 *
 * 本人の要望（2026-08-30）:「この機能はMulmoClaudeでやりたいわけではなく、
 * どのツールでもすぐに連携できるようにしたい」。だから特定のアプリの画面ではなく、
 * ブラウザさえあれば開くファイルを1つ吐く。
 */
import type { Deposit, DepositSource } from "./inbox.ts";
import { stamp } from "./list.ts";
import type { Project } from "./projects.ts";
import { ROWS_MARK, TEMPLATE } from "./page-template.ts";

export interface PageRow {
  readonly ref: string;
  readonly project: string;
  readonly topic: string;
  readonly when: string;
  readonly harness: string;
  readonly utterances: number;
  /** 預かった会話だけに付ける。ページの「続きから」が get_deposit を使うための目印 */
  readonly kind?: "deposit";
}

/**
 * 預かった会話の見出し。Claude Code・Codex の会話と同じ一覧に並べる。
 *
 * どのエージェントと何を話しているかを1か所で見る場所が無い（2026-10-31 本人）。
 * Dots やスマホの Claude の会話は手元の記録に残らないので、預けてもらった分を並べる。
 */
export const DEPOSITS_HEADING = "預かった会話（Dots・スマホのClaude など）";

const SOURCE_LABEL: Record<DepositSource, string> = {
  "claude-mobile": "スマホのClaude",
  "claude-web": "WebのClaude",
  other: "ほかのAI",
};

export const depositRows = (deposits: readonly Deposit[]): PageRow[] =>
  deposits.map((deposit) => ({
    ref: deposit.id.slice(0, 8),
    project: DEPOSITS_HEADING,
    topic: deposit.title,
    when: stamp(Date.parse(deposit.createdAt)),
    harness: SOURCE_LABEL[deposit.source],
    utterances: deposit.userMessages.length,
    kind: "deposit",
  }));

export const toPageRows = (projects: readonly Project[]): PageRow[] =>
  projects.flatMap((project) =>
    project.sessions.map((session) => ({
      ref: session.ref,
      project: project.name,
      topic: session.topic,
      when: session.when,
      harness: session.harness,
      utterances: session.utterances,
    })),
  );

/**
 * `<` を潰してから埋める。会話の見出しに `</script>` が入っていると、
 * そこでスクリプトが終わってページが壊れる——見出しは本人が打った文字なので、
 * 何が入っていてもおかしくない。
 */
const embed = (rows: readonly PageRow[]): string =>
  JSON.stringify(rows).replace(/</g, "\\u003c");

/**
 * 差し込みは関数で渡す。文字列で渡すと `$&` などが置換の指示として食われて、
 * 見出しにその2文字が入っていた会話だけ中身が化ける。
 */
export const buildPage = (projects: readonly Project[], deposits: readonly Deposit[] = []): string => {
  const rows = embed([...depositRows(deposits), ...toPageRows(projects)]);
  return TEMPLATE.replace(ROWS_MARK, () => rows);
};
