/**
 * 一覧を1枚のHTMLにする。
 *
 * 本人の要望（2026-08-30）:「この機能はMulmoClaudeでやりたいわけではなく、
 * どのツールでもすぐに連携できるようにしたい」。だから特定のアプリの画面ではなく、
 * ブラウザさえあれば開くファイルを1つ吐く。
 */
import type { Project } from "./projects.ts";
import { ROWS_MARK, TEMPLATE } from "./page-template.ts";

export interface PageRow {
  readonly ref: string;
  readonly project: string;
  readonly topic: string;
  readonly when: string;
  readonly harness: string;
  readonly utterances: number;
}

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
export const buildPage = (projects: readonly Project[]): string => {
  const rows = embed(toPageRows(projects));
  return TEMPLATE.replace(ROWS_MARK, () => rows);
};
