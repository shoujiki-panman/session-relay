/**
 * MCPのツールが返す文面。
 *
 * 読むのは人ではなくAIなので、表組みにしない（桁を揃えても意味がない）。
 * 代わりに「次に何を渡せば次の呼び出しができるか」を必ず1行に入れる——
 * ref を書かない一覧は、AIが結局もう一度探しに行くことになる。
 */
import type { Listed } from "./list.ts";
import { type Project, headline } from "./projects.ts";

export interface Answer {
  readonly text: string;
  readonly ok: boolean;
}

const fail = (text: string): Answer => ({ text, ok: false });
const done = (text: string): Answer => ({ text, ok: true });

const projectLine = (project: Project): string =>
  [
    `- ${project.name}`,
    `会話 ${String(project.sessions.length)}`,
    `最終 ${project.when}`,
    project.cwd ?? "場所不明",
    `直近: ${headline(project) || "-"}`,
  ].join(" | ");

export function answerProjects(projects: readonly Project[]): Answer {
  if (projects.length === 0) return fail("会話の記録が見つかりませんでした。");
  return done(
    [
      "この人がAIと話してきたプロジェクト（新しい順）:",
      ...projects.map(projectLine),
      "",
      "会話まで降りるには list_conversations にプロジェクト名を渡す。",
    ].join("\n"),
  );
}

const sessionLine = (session: Listed): string =>
  [
    `- ref ${session.ref}`,
    session.when,
    session.harness,
    `発話 ${String(session.utterances)}`,
    session.topic,
  ].join(" | ");

export function answerConversations(project: Project | null, key: string): Answer {
  if (project === null) {
    return fail(`「${key}」に当たるプロジェクトがありません。list_projects で名前を確認してください。`);
  }
  return done(
    [
      `${project.name} の会話（新しい順）:`,
      ...project.sessions.map(sessionLine),
      "",
      "続きから始めるには get_context に ref を渡す。",
    ].join("\n"),
  );
}

/** 引数なしで呼ばれたとき、いる場所に会話が無かった場合 */
export const noPrevious = (cwd: string): Answer =>
  fail(
    `この場所（${cwd}）には、中身のある前の会話がありません。\n` +
      "list_projects でプロジェクトを選び、list_conversations → get_context の順に辿ってください。",
  );

export const noSuchRef = (ref: string): Answer =>
  fail(`ref「${ref}」に当たる会話がありません。list_conversations で ref を確認してください。`);

/** 射影そのもの。要約しないのがこの道具の取り柄なので、切り詰めない */
export const answerContext = (context: string): Answer => done(context);
