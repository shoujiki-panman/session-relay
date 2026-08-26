/**
 * relayが渡した文脈ブロックを読み戻すための純関数。
 *
 * relayで開いたセッションを **もう一度relayする** と、
 * 前回の文脈がまるごと「本人の発話1件」として入ってしまう（実測で確認）。
 * 放置すると渡すたびに入れ子になって膨らむので、
 * ここで元の発話の並びに畳み直す。
 */

/** 文脈ブロックの目印。context.ts が書く見出しと必ず同じにすること */
export const RELAY_HEADER = "# 前の会話の記録（要約なし・本人の発話は原文のまま）";
const UTTERANCES_SECTION = "## 本人が実際に打った言葉（時系列・全件）";
const FILES_SECTION = "## 触ったファイル";
const COMMANDS_SECTION = "## 実行したコマンド";
const PROGRESS_SECTION = "## 直近の経過";
/** 発話の2行目以降につける字下げ。context.ts が書く幅と必ず同じにすること */
export const CONTINUATION_INDENT = "   ";

export interface RelayBlock {
  readonly utterances: readonly string[];
  /** 前の会話で何が起きたか。渡すたびに落ちると進捗が過小評価されるので引き継ぐ */
  readonly turnEndings: readonly string[];
  readonly files: readonly string[];
  readonly commands: readonly string[];
}

export const isRelayContext = (text: string): boolean =>
  text.trimStart().startsWith(RELAY_HEADER);

/** 見出しの次の行から、次の見出し（または区切り線）までを返す */
function sectionAfter(lines: readonly string[], heading: string): string[] {
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## ") || line === "---");
  return end === -1 ? rest : rest.slice(0, end);
}

const bulletItems = (lines: readonly string[]): string[] =>
  lines.filter((line) => line.startsWith("- ")).map((line) => line.slice(2));

/**
 * 「N. 本文」の並びを元の発話に戻す。
 * 番号が 1,2,3... と続くところだけを区切りとして採るので、
 * 発話の本文に "3. " のような行があっても割れない。
 */
function numberedItems(lines: readonly string[]): string[] {
  const items: string[] = [];
  let buffer: string[] = [];
  let open = false;
  let next = 1;
  for (const line of lines) {
    const marker = `${String(next)}. `;
    if (line.startsWith(marker)) {
      if (open) items.push(buffer.join("\n").trimEnd());
      buffer = [line.slice(marker.length)];
      open = true;
      next += 1;
    } else if (open) {
      buffer.push(line.startsWith(CONTINUATION_INDENT) ? line.slice(CONTINUATION_INDENT.length) : line);
    }
  }
  if (open) items.push(buffer.join("\n").trimEnd());
  return items;
}

/** 文脈ブロックでなければ null */
export function parseRelayContext(text: string): RelayBlock | null {
  if (!isRelayContext(text)) return null;
  const lines = text.split("\n");
  return {
    utterances: numberedItems(sectionAfter(lines, UTTERANCES_SECTION)),
    turnEndings: numberedItems(sectionAfter(lines, PROGRESS_SECTION)),
    files: bulletItems(sectionAfter(lines, FILES_SECTION)),
    commands: bulletItems(sectionAfter(lines, COMMANDS_SECTION)),
  };
}
