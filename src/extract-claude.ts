import { classifyUtterance } from "./parse.ts";
import { parseRelayContext } from "./relay-block.ts";
import { type TurnAcc, emptyTurnAcc, endTurn, finishTurns, noteAssistantText } from "./turns.ts";
import {
  type Row,
  type SessionRecord,
  type Utterance,
  asString,
  isRecord,
  recordsOf,
} from "./types.ts";

/** ツール入力のうち、ファイルパスが入りうるキー */
const FILE_KEYS = ["file_path", "notebook_path", "path", "filePath"] as const;

interface Acc {
  readonly utterances: Utterance[];
  readonly tools: Set<string>;
  readonly files: Set<string>;
  readonly commands: string[];
  readonly times: string[];
  readonly turns: TurnAcc;
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  title: string | null;
}

const emptyAcc = (): Acc => ({
  utterances: [], tools: new Set(), files: new Set(), commands: [], times: [], turns: emptyTurnAcc(),
  sessionId: null, cwd: null, gitBranch: null, title: null,
});

/**
 * user行から発話を取り出す。
 * `message.content` は **文字列とブロック配列の両方**を取る。
 * 片方だけ見ると発話を大量に取りこぼす（実測: 11件しか取れず、正しくは80件だった）。
 */
function utterancesFromUserRow(row: Row): Utterance[] {
  const message = row["message"];
  if (!isRecord(message)) return [];
  const at = asString(row["timestamp"]);
  const content = message["content"];

  const texts: string[] =
    typeof content === "string"
      ? [content]
      : recordsOf(content)
          .filter((block) => block["type"] === "text")
          .map((block) => asString(block["text"]) ?? "");

  return texts
    .filter((text) => text !== "")
    .map((text) => ({ at, kind: classifyUtterance(text), text }));
}

/** 入れ子の上限。壊れた入力で無限に潜らないための止め */
const MAX_RELAY_DEPTH = 5;

/**
 * relayが渡した文脈ブロックなら、中の発話に開いて並べ直す。
 * ブロックでなければ、その発話をそのまま1件返す。
 */
function expandRelayed(text: string, at: string | null, acc: Acc, depth: number): Utterance[] {
  const block = depth < MAX_RELAY_DEPTH ? parseRelayContext(text) : null;
  if (block === null) return [{ at, kind: classifyUtterance(text), text }];
  for (const file of block.files) acc.files.add(file);
  for (const text of block.turnEndings) acc.turns.endings.push({ at, text });
  acc.commands.push(...block.commands);
  return block.utterances.flatMap((inner) => expandRelayed(inner, at, acc, depth + 1));
}

function applyUserRow(row: Row, acc: Acc): void {
  for (const utterance of utterancesFromUserRow(row)) {
    const expanded = expandRelayed(utterance.text, utterance.at, acc, 0);
    // 注入（システムの差し込み）はターンの区切りにしない
    if (expanded.some((u) => u.kind === "human")) endTurn(acc.turns);
    acc.utterances.push(...expanded);
  }
}

function collectToolUse(block: Row, acc: Acc): void {
  const name = asString(block["name"]);
  if (name !== null) acc.tools.add(name);
  const input = block["input"];
  if (!isRecord(input)) return;
  for (const key of FILE_KEYS) {
    const file = asString(input[key]);
    if (file !== null) acc.files.add(file);
  }
  const command = asString(input["command"]);
  if (command !== null) acc.commands.push(command);
}

function applyAssistantRow(row: Row, acc: Acc): void {
  const message = row["message"];
  if (!isRecord(message)) return;
  const at = asString(row["timestamp"]);
  for (const block of recordsOf(message["content"])) {
    if (block["type"] === "tool_use") collectToolUse(block, acc);
    else if (block["type"] === "text") noteAssistantText(acc.turns, at, asString(block["text"]) ?? "");
  }
}

function applyMeta(row: Row, acc: Acc): void {
  acc.sessionId ??= asString(row["sessionId"]);
  acc.cwd ??= asString(row["cwd"]);
  acc.gitBranch ??= asString(row["gitBranch"]);
  const at = asString(row["timestamp"]);
  if (at !== null) acc.times.push(at);
}

function applyRow(row: Row, acc: Acc): void {
  applyMeta(row, acc);
  const type = row["type"];
  if (type === "custom-title") acc.title ??= asString(row["customTitle"]);
  else if (type === "user") applyUserRow(row, acc);
  else if (type === "assistant") applyAssistantRow(row, acc);
}

export function extractClaude(rows: readonly Row[]): SessionRecord {
  const acc = emptyAcc();
  for (const row of rows) applyRow(row, acc);
  acc.times.sort();
  return {
    sessionId: acc.sessionId,
    harness: "claude-code",
    cwd: acc.cwd,
    gitBranch: acc.gitBranch,
    startedAt: acc.times[0] ?? null,
    endedAt: acc.times[acc.times.length - 1] ?? null,
    title: acc.title,
    utterances: acc.utterances,
    turnEndings: finishTurns(acc.turns),
    tools: [...acc.tools],
    files: [...acc.files],
    commands: acc.commands,
  };
}
