/**
 * プロジェクト単位の一覧。
 *
 * 会話を単位にすると、選ぶときに出るのが「会話の切れ端」になる。
 * 本人の言葉（2026-08-27）:
 * 「選択するチャットも取り組んでいるプロジェクト名ではないし、
 *   会話の途切れたところなのでわからない」
 *
 * 世の中の道具も、跨ぐ単位を会話にしていない
 * （AGENTS.md はリポジトリ直下の1枚、Cline の Memory Bank はプロジェクトの状態）。
 * ここでも束ねる単位をプロジェクトにして、選んでから会話に降りる。
 */
import { type Listed, NO_TALK } from "./list.ts";

export interface Project {
  readonly name: string;
  readonly cwd: string | null;
  /** そのプロジェクトで一番新しい会話の時刻 */
  readonly when: string;
  /** 新しい順。先頭が最新 */
  readonly sessions: readonly Listed[];
}

/**
 * 束ねる鍵は cwd。
 * 名前（ディレクトリ名）で束ねると、`~/a/work` と `~/b/work` が混ざる。
 */
const keyOf = (row: Listed): string => row.cwd ?? `?${row.place}`;

/** 会話の一覧（新しい順）をプロジェクトに束ねる。並びは「最新の会話が新しい順」 */
export function groupByProject(listed: readonly Listed[]): Project[] {
  const order: string[] = [];
  const byKey = new Map<string, Listed[]>();
  for (const row of listed) {
    const key = keyOf(row);
    const bucket = byKey.get(key);
    if (bucket === undefined) {
      byKey.set(key, [row]);
      order.push(key);
    } else bucket.push(row);
  }
  return order.map((key) => {
    const rows = byKey.get(key) ?? [];
    const head = rows[0];
    return {
      name: head?.place ?? "-",
      cwd: head?.cwd ?? null,
      when: head?.when ?? "-",
      sessions: rows,
    };
  });
}

/** 一覧のうち、番号（1始まり）か名前の先頭一致で1つに決める */
export function pickProject(projects: readonly Project[], key: string): Project | null {
  const asNumber = Number(key);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= projects.length) {
    return projects[asNumber - 1] ?? null;
  }
  const lower = key.toLowerCase();
  return projects.find((row) => row.name.toLowerCase().startsWith(lower)) ?? null;
}

/**
 * そのプロジェクトが「何の話か」。
 * 一番新しい会話が空（スクショ1枚だけ、起動しただけ）のことがあり、
 * それを見出しにするとプロジェクトごと「(発話なし)」になって選べない（実測 2026-08-28）。
 */
export function headline(project: Project): string {
  const talked = project.sessions.find((session) => session.topic !== NO_TALK);
  return (talked ?? project.sessions[0])?.topic ?? "";
}

export function renderProjects(projects: readonly Project[]): string {
  const width = Math.max(10, ...projects.map((row) => row.name.length));
  const header = `  #  ${"プロジェクト".padEnd(width)}  最終          会話  直近の話`;
  const rows = projects.map((row, i) => {
    const no = String(i + 1).padStart(3);
    const count = String(row.sessions.length).padStart(4);
    const topic = headline(row);
    return `${no}  ${row.name.padEnd(width)}  ${row.when}  ${count}  ${topic}`;
  });
  return [header, ...rows, ""].join("\n");
}
