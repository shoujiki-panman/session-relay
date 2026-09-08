/**
 * 「次はこの会話の続き」の印。
 *
 * これが無いと、新しいセッションは**当て推量**でしか前の会話を選べない
 * （その場所で一番新しいもの）。同じ場所で会話を2つ動かしていると別の方を掴む——
 * `previousSessionsFor` に残っている既知の限界そのもの。
 * だから「渡す側が指す」経路を1本足す。渡す側は、自分が誰かを知っている。
 *
 * 印は**一度拾われたら消える**。渡し終えた印が残っていると、何時間も後の
 * 無関係な「続きから」までこれを掴む。拾われないまま忘れられた印は期限で失効する。
 *
 * 投函の既読印（`read-at`）と同じ置き場に、同じ作法（0600・1ファイル）で置く。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultInboxDir } from "./inbox.ts";
import { asString, isRecord } from "./types.ts";

export interface Handoff {
  /** 印をつけた時刻（ISO）。期限切れの判定に使う */
  readonly at: string;
  /** 印をつけた側のセッションID。分からなければ空文字（Codexは渡してこない） */
  readonly id: string;
  /** 会話の記録そのもの */
  readonly path: string;
  /** その会話が動いていた場所。gitの欄をどこから採るかに使う */
  readonly cwd: string;
  /** 人が見て「これで合っている」と分かるための見出し */
  readonly topic: string;
}

export const defaultHandoffPath = (): string => join(dirname(defaultInboxDir()), "handoff");

/**
 * 印の寿命。
 * 押したまま拾わずに忘れることはある。その印が翌日の無関係な「続きから」を
 * 乗っ取るのは、当て推量よりたちが悪い（本人には理由が見えない）。
 */
export const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

/** 印を置く。すでにあれば上書きする（押し直しが取り消しになる） */
export function putHandoff(mark: Handoff, file: string = defaultHandoffPath()): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(mark)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** 印を消す。無くても落ちない */
export function clearHandoff(file: string = defaultHandoffPath()): void {
  rmSync(file, { force: true });
}

/** 書きかけ・手で壊した印でも落ちない。読めなければ null（＝印は無い） */
function readJson(raw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function parseHandoff(raw: string): Handoff | null {
  const value = readJson(raw);
  if (!isRecord(value)) return null;
  const at = asString(value["at"]);
  const path = asString(value["path"]);
  if (at === null || path === null) return null;
  return { at, path, id: asString(value["id"]) ?? "", cwd: asString(value["cwd"]) ?? "", topic: asString(value["topic"]) ?? "" };
}

const fresh = (at: string, now: Date): boolean => {
  const stamped = Date.parse(at);
  return !Number.isNaN(stamped) && now.getTime() - stamped <= HANDOFF_TTL_MS;
};

/**
 * 置かれている印。無い・壊れている・期限切れ・指す記録が消えている、のどれでも null。
 * **読むだけで消さない。** 消すのは実際に拾えた側の仕事（`clearHandoff`）。
 */
function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function peekHandoff(now: Date = new Date(), file: string = defaultHandoffPath()): Handoff | null {
  const raw = readText(file);
  if (raw === null) return null;
  const mark = parseHandoff(raw.trim());
  if (mark === null) return null;
  if (!fresh(mark.at, now)) return null;
  // 記録ごと消えた会話を指している印は、拾っても空の文脈にしかならない
  return existsSync(mark.path) ? mark : null;
}
