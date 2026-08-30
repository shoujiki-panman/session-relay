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
      PICK_BY_WORDS,
    ].join("\n"),
  );
}

/**
 * **ref を本人に聞き返させない。**
 * 打つのが苦手な人にとって、refを言わせるのはコマンドを打たせているのと同じ。
 * 選ぶのはAIの仕事で、人は「地図の話」と言えばいい。
 */
export const PICK_BY_WORDS =
  "続きに入るには get_context を呼ぶ。ref は上から選んで**あなたが**渡すこと。" +
  "本人にrefや番号を聞き返さない——本人の言葉（「地図の話」など）は about にそのまま渡せる。";

export function answerMatches(words: string, hits: readonly Listed[]): Answer {
  if (hits.length === 0) {
    return fail(
      `「${words}」に当たる会話が見つかりません。list_projects で近いものを探してください。` +
        "（見出しと置き場所しか見ていないので、話の途中にしか出てこない言葉は当たりません）",
    );
  }
  return done(
    [
      `「${words}」に当たる会話が${String(hits.length)}本あります:`,
      ...hits.map(sessionLine),
      "",
      "どれかを**あなたが**選んで get_context に ref を渡す。迷うなら、見出しを並べて本人に聞く。",
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
