/**
 * 渡す文脈を、共有の場所（Googleドライブの共有フォルダなど）に置ける形にする純関数。
 *
 * relay の文脈は、同じ人の別のAIへ渡す前提で作っている。そのまま共有フォルダに置くと、
 * ユーザー名の入った手元のパス、画像の置き場所、実行したコマンドの中身まで出てしまう
 * （2026-10-30 に実際に置こうとして、手で消した）。ここで外す。
 *
 * 本人の言葉は全部残す。AIの報告は最後の数ターンだけ、長いものは途中まで残す。
 * 本人の言葉だけを置いたら、読んだ Dots に「保存まで終わったかは確認できない」と言われた。
 * どこまで進んだかは、報告が無いと伝わらない。
 */
import { basename } from "node:path";
import { redactSecrets } from "./redact.ts";
import { parseRelayContext } from "./relay-block.ts";

/** 残すAIの報告のターン数。「いまどこ」を伝えるのに効くのは最後のほう */
export const SHARE_RECENT_TURNS = 3;
/** AIの報告1件の長さの上限（文字）。共有の場所では全文より、どこまで進んだかが分かればいい */
export const SHARE_TURN_CHARS = 600;

const IMAGE_MARKER = /\[Image(?: #\d+)?: source: [^\]]*\]/g;
const COMMAND_BLOCK = /<bash-input>[\s\S]*?<\/bash-input>(?:\s*<bash-stdout>[\s\S]*?<\/bash-stdout>)?(?:\s*<bash-stderr>[\s\S]*?<\/bash-stderr>)?/g;

const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 手元の場所や道具の出力を、共有してよい言葉に置き換える */
function clean(text: string, home: string): string {
  const withoutHome =
    home === "" ? text : text.replace(new RegExp(`${escapeForRegExp(home)}(?=/|\\b)`, "g"), "~");
  return withoutHome.replace(IMAGE_MARKER, "[画像]").replace(COMMAND_BLOCK, "[コマンドの実行]");
}

const shorten = (text: string): string =>
  text.length > SHARE_TURN_CHARS ? `${text.slice(0, SHARE_TURN_CHARS)}…（以下略）` : text;

const numbered = (items: readonly string[]): string[] =>
  items.flatMap((item, index) => {
    const [first = "", ...rest] = item.split("\n");
    return [`${String(index + 1)}. ${first}`, ...rest.map((line) => `   ${line}`)];
  });

/** 作業場所の行から、フォルダの名前とブランチだけを取り出す（手元の場所は出さない） */
function placeOf(context: string): string | null {
  const match = /^作業場所: (.+?) \(branch: (.+)\)$/m.exec(context);
  if (match === null) return null;
  const [, dir = "", branch = ""] = match;
  return `${dir === "-" ? "-" : basename(dir)}（branch: ${branch}）`;
}

const periodOf = (context: string): string | null => /^期間: .+$/m.exec(context)?.[0] ?? null;

/** relay の文脈を共有用に書き直す。relay の文脈でなければ null */
export function toShareable(context: string, home: string): string | null {
  const block = parseRelayContext(context);
  if (block === null) return null;
  const place = placeOf(context);
  const period = periodOf(context);
  const recent = block.turnEndings.slice(-SHARE_RECENT_TURNS).map((turn) => shorten(clean(turn, home)));
  const lines = [
    "# 前の会話（共有用）",
    "",
    "> session-relay が書き出しました。鍵やトークンの形をした文字列は伏せ、手元のパス・画像の置き場所・コマンドの中身は外しています。",
    "",
    ...(place === null ? [] : [`作業: ${place}`]),
    ...(period === null ? [] : [period]),
    "",
    "## 本人が実際に打った言葉（時系列・全件）",
    ...numbered(block.utterances.map((utterance) => clean(utterance, home))),
    "",
    `## どこまで進んだか（AIの報告・最後の${String(SHARE_RECENT_TURNS)}ターン・長いものは途中まで）`,
    ...(recent.length === 0 ? ["（報告なし）"] : numbered(recent)),
    "",
  ];
  return redactSecrets(lines.join("\n"));
}
