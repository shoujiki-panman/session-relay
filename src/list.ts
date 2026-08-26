/**
 * 会話の一覧。
 *
 * `relay` は「このディレクトリの前の会話」しか引けなかった。
 * 並行して10個以上のプロジェクトを動かしていると、それでは足りない
 * （本人の言葉:「一つのプロジェクトしか扱えないじゃん？」）。
 * どの会話でも選んで引けるようにするための一覧を作る。
 */
import { basename } from "node:path";
import { extractSession, humanUtterances } from "./extract.ts";
import { parseJsonl } from "./parse.ts";
import { asString, isRecord } from "./types.ts";
import { type SessionEntry, headOf } from "./sessions.ts";

/**
 * 人が実際に打った会話かどうか。
 * サブエージェントの記録は `promptSource: "sdk"` / `entrypoint: "sdk-cli"` で、
 * 人が打った行は `promptSource: "typed"` かつ `origin: {kind: "human"}`（実測）。
 * これを見ないと、一覧が下請けの記録で埋まる。
 */
function typedByHuman(raw: string): boolean {
  return parseJsonl(raw).some((row) => {
    if (asString(row["promptSource"]) === "typed") return true;
    const origin = row["origin"];
    if (isRecord(origin) && origin["kind"] === "human") return true;
    // Codexは人が打った発話しか user_message に入れない
    const payload = row["payload"];
    return isRecord(payload) && payload["type"] === "user_message";
  });
}

export interface Listed {
  readonly path: string;
  /** 一覧から選ぶための短い名前。ファイル名の先頭8文字 */
  readonly ref: string;
  /** その会話が動いていた作業ディレクトリ。選んだ会話のgitを見るために要る */
  readonly cwd: string | null;
  readonly place: string;
  readonly harness: string;
  readonly when: string;
  readonly topic: string;
  readonly utterances: number;
  /** 人が実際に打った会話か（下請けの記録を一覧から外すため） */
  readonly typed: boolean;
}

const HOME_PREFIX = /^\/Users\/[^/]+/;
/** Codexのファイル名は `rollout-<ISO時刻>-<uuid>.jsonl`。idは末尾のuuid（実測） */
const CODEX_NAME = /^rollout-.*?-([0-9a-f]{8})/;

/**
 * 一覧から選ぶための短い名前。
 * Claude Codeは `<id>.jsonl` なので先頭8文字でよいが、
 * Codexは全部 `rollout-` で始まるので、それだと**全部同じrefになって選べない**（実測）。
 */
function refOf(path: string): string {
  const name = basename(path).replace(".jsonl", "");
  return CODEX_NAME.exec(name)?.[1] ?? name.slice(0, 8);
}

/** 場所は「どのプロジェクトか」が分かればいい。ホームは ~ に畳む */
function placeOf(cwd: string | null): string {
  if (cwd === null) return "-";
  return basename(cwd) === "" ? cwd.replace(HOME_PREFIX, "~") : basename(cwd);
}

/** 会話の見出し。最初の発話が一番「何の話か」を表す */
function topicOf(utterances: readonly string[]): string {
  const first = utterances[0];
  if (first === undefined) return "(発話なし)";
  const oneLine = first.split("\n")[0] ?? "";
  return oneLine.length > 44 ? `${oneLine.slice(0, 44)}…` : oneLine;
}

const stamp = (mtimeMs: number): string => {
  const at = new Date(mtimeMs);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(at.getMonth() + 1)}/${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

export function describe(entry: SessionEntry): Listed {
  const head = headOf(entry.path);
  const record = extractSession(head);
  const human = record === null ? [] : humanUtterances(record);
  return {
    path: entry.path,
    ref: refOf(entry.path),
    cwd: entry.cwd,
    place: placeOf(entry.cwd),
    harness: record?.harness === "codex" ? "codex" : "claude",
    when: stamp(entry.mtimeMs),
    topic: topicOf(human),
    utterances: human.length,
    typed: typedByHuman(head),
  };
}

/** 一覧のうち、番号（1始まり）か ref の先頭一致で1本に決める */
export function pick(listed: readonly Listed[], key: string): Listed | null {
  const asNumber = Number(key);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= listed.length) {
    return listed[asNumber - 1] ?? null;
  }
  return listed.find((row) => row.ref.startsWith(key)) ?? null;
}

export function renderTable(listed: readonly Listed[]): string {
  const width = Math.max(4, ...listed.map((row) => row.place.length));
  const header = `  #  ref       いつ         ${"場所".padEnd(width)}  発話  何の話か`;
  const rows = listed.map((row, i) => {
    const no = String(i + 1).padStart(3);
    const count = String(row.utterances).padStart(4);
    return `${no}  ${row.ref}  ${row.when}  ${row.place.padEnd(width)}  ${count}  ${row.topic}`;
  });
  return [header, ...rows, ""].join("\n");
}
