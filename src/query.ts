/**
 * 会話を探す処理。CLIとMCPの両方から使う。
 *
 * ここに画面への出力は書かない（MCPサーバーは標準出力がJSON-RPCで埋まっていて、
 * 1行でも余計に書くと通信が壊れる）。出すのは呼んだ側の仕事。
 */
import { type Listed, describe, pick } from "./list.ts";
import { type Project, groupByProject, pickProject } from "./projects.ts";
import { type BuiltContext, buildContext, buildContextFrom } from "./context.ts";
import { readRepoSignals } from "./repo.ts";
import { previousSessionsFor, recentSessions } from "./sessions.ts";

/**
 * ファイル数で切ってはいけない。下請け（サブエージェント）の記録は桁違いに多く、
 * 実測（2026-08-28）では**新しい480本のうち469本が1つのプロジェクトの下請け**で、
 * 人が打った会話は7本しか残らなかった（プロジェクト一覧が2件になった）。
 * 数えるのは会話であって、ファイルではない。
 */
export const SCAN_LIMIT = 4000;

/**
 * プロジェクトに束ねるために先に拾う会話の数。
 * 束ねる前に切ると、下の方のプロジェクトが1件しか無いように見える。
 */
export const SCAN = 250;

/** `--list` の既定件数。番号はこの一覧で数える */
export const LIST_LIMIT = 15;

/** 人が打った会話を、必要な数だけ新しい順に集める */
export function humanSessions(limit: number, onlyCwd: string | null): Listed[] {
  const rows: Listed[] = [];
  for (const entry of recentSessions(undefined, SCAN_LIMIT, onlyCwd)) {
    const row = describe(entry);
    if (row.typed) rows.push(row);
    if (rows.length >= limit) break;
  }
  return rows;
}

export const projectsOf = (): Project[] => groupByProject(humanSessions(SCAN, null));

/**
 * 選ぶ対象の会話たち。
 * `--in` を付けたときは**そのプロジェクトの中だけ**を見る。
 */
export function candidates(inKey: string | null, cwd: string | null, limit: number): Listed[] {
  if (inKey === null) return humanSessions(limit, cwd);
  const chosen = pickProject(projectsOf(), inKey);
  return chosen === null ? [] : [...chosen.sessions];
}

/**
 * 一覧から1本を選ぶ。
 *
 * **番号と ref で数える相手を変える。**
 * 番号は「画面に出ていた一覧」の中でしか意味を持たない。広い一覧で数えると
 * 番号が指す会話がずれる（この道具が何度も踏んだ穴）。
 * ref は一意なのでずれない。だから ref のときだけ広く探す。
 * キャンバスのカードに書いてあるのも ref。
 */
export function chooseByKey(
  key: string,
  cwd: string | null,
  inKey: string | null,
  all: boolean,
): Listed | null {
  const byNumber = Number.isInteger(Number(key));
  const rows = byNumber
    ? candidates(inKey, all ? null : cwd, LIST_LIMIT)
    : candidates(inKey, null, SCAN);
  return pick(rows, key);
}

/** 選んだ会話の射影。gitは「その会話が動いていた場所」を見る。いまいる場所ではない */
export const contextOf = (chosen: Listed, fallbackCwd: string): string | null =>
  buildContext(chosen.path, readRepoSignals(chosen.cwd ?? fallbackCwd));

/** 自分ではない「直前の会話」。中身のある最初の1本を返す */
export const previousIn = (cwd: string): BuiltContext | null =>
  buildContextFrom(previousSessionsFor(cwd), readRepoSignals(cwd));
