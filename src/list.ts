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

/**
 * ドロップされたファイル。
 * MulmoTerminalに画像を落とすと、絶対パスがそのまま発話として記録される（実測）。
 * 引用符つきのパスは**名前に空白が入る**ので `\S+` では届かない
 * （実測: `'/Users/me/Desktop/スクリーンショット 2026-08-25 23.30.34.png'`）。
 */
const QUOTED_PATH = /['"][~/][^'"\n]*['"]/g;
const BARE_PATH = /\S*\/\S+\.(?:png|jpe?g|gif|webp|heic|pdf|mov|mp4)\b/gi;
/** 画像の後ろにハーネスが足す説明。人の言葉ではない */
const IMAGE_NOTE = /\[Image:[^\]]*\]/g;
/**
 * ハーネスが差し込むタグ。中身は残して囲いだけ落とす。
 * 実測: 予約実行の会話が `<scheduled-task name="weekly-report-draft" f…` で埋まり、
 * 何の話かが見えなかった。囲いを外せば `weekly-report-draft` が見出しになる。
 */
const WRAP_TAG = /<\/?[A-Za-z][\w-]*(?:\s[^>]*)?>/g;
/**
 * URLはホスト名まで畳む。
 * 記事のURLは1本で見出しを食い潰すが、ホスト名だけ残れば何の話かは伝わる。
 * 日本語はURLの一部ではないので、ASCIIのURL文字で止める
 * （`\S*` にすると「…/2-0これ入れようかな」の後半まで飲み込む）。
 */
const URL_ANY = /https?:\/\/([A-Za-z0-9.-]+)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*/g;

/** 一時ファイルの名前（uuid）。名前自体が何も語らないので落とす */
const TEMP_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}/i;

/**
 * パスは**ファイル名だけ**残す。
 * 丸ごと落とすと、スクショを1枚落としただけの会話が全部「(発話なし)」になって
 * また見分けがつかなくなる。`スクリーンショット 2026-08-24 21.52.32` なら区別できる。
 */
function stemOf(path: string): string {
  const name = path.replaceAll(/['"]/g, "").split("/").pop() ?? "";
  const stem = name.replace(/\.[A-Za-z0-9]+$/, "");
  return TEMP_NAME.test(stem) ? " " : ` ${stem} `;
}

/** 発話から「見出しにならないもの」を落として1行にする */
function gist(text: string, onPath: (path: string) => string): string {
  const cleaned = text
    .replaceAll(QUOTED_PATH, onPath)
    .replaceAll(BARE_PATH, onPath)
    .replaceAll(IMAGE_NOTE, " ")
    .replaceAll(WRAP_TAG, " ")
    // ホスト名の後ろに区切りを入れる。入れないと「raycast.comこれ入れようかな」と詰まる
    .replaceAll(URL_ANY, (_all, host: string) => `${host.replace(/^www\./, "")} `);
  // 1行目だけ見ると空のことがある（改行で始まる発話。実測で「(発話なし)」になった）
  const lines = cleaned.split("\n").map((line) => line.replaceAll(/\s+/g, " ").trim());
  return lines.find((line) => line !== "") ?? "";
}

/** 相槌だけの発話。これが見出しになると、どの会話か分からない */
const FILLER = new Set([
  "続き", "つづき", "続きから", "つづきから", "はい", "いいえ",
  "yes", "no", "ok", "やって", "うん", "そう", "お願い", "おねがい",
]);
/** ホスト名だけ残った発話（＝URLを貼っただけ）も、それ自体は何の話か言っていない */
const HOST_ONLY = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** 見出しとして意味を持つか */
const meaty = (text: string): boolean =>
  text.length >= 6 && !FILLER.has(text) && !HOST_ONLY.test(text);

const clean = (text: string): string => gist(text, () => " ");
const withNames = (text: string): string => gist(text, stemOf);
const alive = (list: readonly string[]): string[] => list.filter((text) => text !== "");

/**
 * 会話の見出し。
 *
 * 以前は「最初の発話が一番『何の話か』を表す」としていた。実データで崩れた
 * （2026-08-27 実測: 一覧15本のうち6本は最初の発話がスクショの絶対パスだけで、
 * 4行が見分けのつかない同じ見た目になった。本人の言葉:「これだとわからんな」）。
 *
 * パス・画像の説明・URLを落として、**中身のある最初の発話**を見出しにする。
 * ファイル名は「他に何も残らなかったとき」だけ使う。先に混ぜると
 * `スクリーンショット 2026-08-25 23.30.34` が44文字の枠を食って本文を押し出す（実測）。
 */
/** 見出しに出せるものが何も残らなかった会話（スクショ1枚だけ、など） */
export const NO_TALK = "(発話なし)";

function topicOf(utterances: readonly string[]): string {
  const bare = alive(utterances.map(clean));
  const named = alive(utterances.map(withNames));
  const shown = bare.find(meaty) ?? named.find(meaty) ?? bare[0] ?? named[0];
  if (shown === undefined) return NO_TALK;
  return shown.length > 44 ? `${shown.slice(0, 44)}…` : shown;
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
