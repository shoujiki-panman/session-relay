/**
 * 一覧の見出しを作るためだけの、軽い読み取り。
 *
 * `extractSession` は全行を解析して経過・ツール・コマンドまで組み立てる。
 * 一覧はそのどれも使わないのに、手元では**1本575MBの記録**が何本もあり、
 * 数千本ぶん積むと初回に6秒かかっていた（実測 2026-09-03）。
 * ここでは人の発話だけを、必要な数だけ拾って**すぐ止める**。
 */
import { classifyUtterance } from "./parse.ts";
import { type Harness, type Row, asString, isRecord, recordsOf } from "./types.ts";

/** 見出しと検索語に要る発話の数。これだけ集まれば以降は読まない */
const ENOUGH = 8;

export interface ScannedHead {
  readonly harness: Harness;
  readonly human: string[];
  /** 人が打った行が1つでもあったか（下請けの記録と区別する印） */
  readonly typed: boolean;
}

/** Claude Codeのuser行から本文を取り出す（文字列とブロック配列の両方を取る） */
function claudeText(message: unknown): string {
  if (!isRecord(message)) return "";
  const content = message["content"];
  if (typeof content === "string") return content;
  return recordsOf(content)
    .filter((block) => block["type"] === "text")
    .map((block) => asString(block["text"]) ?? "")
    .join("\n");
}

/** Codexの2形式（user_message／message role:user）から本文を取り出す */
function codexText(payload: Row): string {
  if (payload["type"] === "user_message") return asString(payload["message"]) ?? "";
  if (payload["type"] !== "message" || payload["role"] !== "user") return "";
  return recordsOf(payload["content"])
    .map((block) => asString(block["text"]) ?? "")
    .join("\n");
}

function textOf(row: Row): { harness: Harness | null; text: string } {
  if (row["type"] === "user") return { harness: "claude-code", text: claudeText(row["message"]) };
  const payload = row["payload"];
  if (isRecord(payload)) return { harness: "codex", text: codexText(payload) };
  if (typeof row["sessionId"] === "string") return { harness: "claude-code", text: "" };
  return { harness: null, text: "" };
}

/** 先頭から順に読み、人の発話が `ENOUGH` 件たまったら止める */
/** その行が「人が打った」印を持つか（Claude Codeの promptSource / origin、Codexの発話） */
function typedMark(row: Row): boolean {
  if (asString(row["promptSource"]) === "typed") return true;
  const origin = row["origin"];
  if (isRecord(origin) && origin["kind"] === "human") return true;
  const payload = row["payload"];
  if (!isRecord(payload)) return false;
  if (payload["type"] === "user_message") return true;
  return payload["type"] === "message" && payload["role"] === "user";
}

/** 途中で切れた行は捨てる。JSONでなければ null */
function parseLine(line: string): Row | null {
  if (line === "") return null;
  try {
    const row: unknown = JSON.parse(line);
    return isRecord(row) ? row : null;
  } catch {
    return null;
  }
}

interface Acc {
  readonly human: string[];
  harness: Harness;
  typed: boolean;
}

function applyLine(row: Row, acc: Acc): void {
  if (!acc.typed && typedMark(row)) acc.typed = true;
  const found = textOf(row);
  if (found.harness !== null) acc.harness = found.harness;
  const text = found.text.trim();
  if (text !== "" && classifyUtterance(text) === "human") acc.human.push(text);
}

export function scanHead(raw: string): ScannedHead {
  const acc: Acc = { human: [], harness: "claude-code", typed: false };
  for (const line of raw.split("\n")) {
    const row = parseLine(line);
    if (row !== null) applyLine(row, acc);
    if (acc.human.length >= ENOUGH) break;
  }
  return { harness: acc.harness, human: acc.human, typed: acc.typed };
}
