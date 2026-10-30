/**
 * エージェントの伝言板。Dots・Muse・Claude Code などが、同じ場所に伝言を書いて読み合う。
 *
 * 2026-10-31 本人「dot や muse などが連携して話せるようになればいい」「せっかくのセッションリレーなのに」。
 * 外の部屋（Slack など）を借りず、relay の受け口の中に話す場所を置く。
 *
 * 線引き: 外向きの受け口から読めるのは、この伝言板に書かれたものだけ。手元の会話は今までどおり外から読めない。
 * 書かれた伝言は、保存する前に鍵やトークンの形をした文字列を伏せる（読む側が誰でも、元の値は残さない）。
 */
import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { redactSecrets } from "./redact.ts";
import { isRecord } from "./types.ts";

const SHAPE = 1;
const FILE_NAME = /^[0-9a-f-]{36}\.json$/;
/** 1件の長さの上限（文字）。伝言なので長い資料は貼らない（資料は預ける道具で渡す） */
export const MAX_TEXT_CHARS = 8000;
/** 名前（from / to）の長さの上限 */
export const MAX_NAME_CHARS = 40;
/** 貯めておく件数。超えたら古いものから消す（会話を止めないため、満杯で断らない） */
export const MAX_MESSAGES = 500;
/** 宛先を決めない伝言の宛先 */
export const EVERYONE = "all";

export interface Message {
  readonly shape: number;
  readonly id: string;
  readonly createdAt: string;
  readonly from: string;
  readonly to: string;
  readonly text: string;
}

export interface PostInput {
  readonly from: string;
  readonly to?: string;
  readonly text: string;
}

export interface Board {
  readonly post: (input: PostInput) => Message;
  /** since より後の伝言を、古い順に返す。to を渡すと、その宛先と全員あての分だけ */
  readonly since: (since: string, to?: string) => Message[];
}

interface Identity {
  readonly id: () => string;
  readonly now: () => string;
}

const realIdentity: Identity = { id: randomUUID, now: () => new Date().toISOString() };

export const defaultBoardDir = (): string =>
  process.env.SESSION_RELAY_BOARD_DIR ?? join(homedir(), ".local", "share", "session-relay", "board");

const nameOf = (value: string, label: string): string => {
  const name = value.replaceAll(/\s+/g, " ").trim();
  if (name === "") throw new Error(`${label}が空です`);
  if (name.length > MAX_NAME_CHARS) throw new Error(`${label}は${String(MAX_NAME_CHARS)}文字までです`);
  return name;
};

/** 書かれた伝言を、保存できる形にする。鍵はここで伏せる */
export function normalizePost(input: PostInput): { from: string; to: string; text: string } {
  const text = input.text.trim();
  if (text === "") throw new Error("伝言が空です");
  if (text.length > MAX_TEXT_CHARS) throw new Error(`伝言は${String(MAX_TEXT_CHARS)}文字までです`);
  return {
    from: nameOf(input.from, "書いた人"),
    to: input.to === undefined || input.to.trim() === "" ? EVERYONE : nameOf(input.to, "宛先"),
    text: redactSecrets(text),
  };
}

function parseMessage(raw: string): Message | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value["shape"] !== SHAPE) return null;
  const { id, createdAt, from, to, text } = value;
  if (
    typeof id !== "string" ||
    typeof createdAt !== "string" ||
    typeof from !== "string" ||
    typeof to !== "string" ||
    typeof text !== "string"
  ) {
    return null;
  }
  return { shape: SHAPE, id, createdAt, from, to, text };
}

function readAll(dir: string): Message[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => FILE_NAME.test(name));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const path = join(dir, name);
      try {
        return lstatSync(path).isFile() ? parseMessage(readFileSync(path, "utf8")) : null;
      } catch {
        return null;
      }
    })
    .filter((item): item is Message => item !== null)
    .sort((a, b) => `${a.createdAt}\t${a.id}`.localeCompare(`${b.createdAt}\t${b.id}`));
}

/** 宛先が to の人に届く伝言か（全員あて、または本人あて。大文字小文字は区別しない） */
export const isFor = (message: Message, to: string | undefined): boolean =>
  to === undefined ||
  to.trim() === "" ||
  message.to === EVERYONE ||
  message.to.toLowerCase() === to.trim().toLowerCase();

export function createBoard(dir: string = defaultBoardDir(), identity: Identity = realIdentity): Board {
  return {
    post: (input) => {
      const clean = normalizePost(input);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      const existing = readAll(dir);
      for (const old of existing.slice(0, Math.max(0, existing.length - MAX_MESSAGES + 1))) {
        rmSync(join(dir, `${old.id}.json`), { force: true });
      }
      const message: Message = { shape: SHAPE, id: identity.id(), createdAt: identity.now(), ...clean };
      writeFileSync(join(dir, `${message.id}.json`), `${JSON.stringify(message, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return message;
    },
    since: (since, to) => {
      const from = Date.parse(since);
      return readAll(dir).filter((message) => Date.parse(message.createdAt) > from && isFor(message, to));
    },
  };
}

/** 読む側のAIに返す形。古い順に、誰から誰へ、いつ、何を */
export function renderMessages(messages: readonly Message[], since: string): string {
  if (messages.length === 0) return `${since} より後の伝言はありません。`;
  return [
    `${since} より後の伝言（古い順・${String(messages.length)}件）。続きを読むときは、最後の伝言の時刻を since に渡す。`,
    ...messages.map((m) => `- ${m.createdAt} | ${m.from} → ${m.to} | ${m.text.replaceAll("\n", "\n  ")}`),
  ].join("\n");
}
