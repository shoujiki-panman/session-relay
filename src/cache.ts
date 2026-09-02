/**
 * 一覧の見出しを覚えておく。
 *
 * 一覧を作るには記録を1本ずつ読む必要があり、手元では **250本で4.7秒** かかる（実測）。
 * MCPから呼ぶと毎回この待ちが乗る。会話は**終わったら二度と変わらない**ので、
 * 更新時刻が同じなら前に読んだ結果をそのまま使える。
 *
 * 置き場所は `~/.cache/session-relay/list.json`。中身には発話の先頭44文字（見出し）と
 * 作業ディレクトリが入る。**手元から出さない**のはこの道具の設計前提そのまま。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Listed } from "./list.ts";
import { isRecord } from "./types.ts";

interface Remembered {
  readonly mtimeMs: number;
  readonly row: Listed;
}

export type Memory = Map<string, Remembered>;

const cachePath = (): string => join(homedir(), ".cache", "session-relay", "list.json");

/**
 * 見出しの作り方を変えたら、この数字を1つ上げる。
 *
 * 更新時刻が同じなら読み直さない仕組みなので、**記録が変わらなくても
 * こちらの作り方が変われば覚えた内容は古くなる**。実測（2026-08-29）:
 * 予約実行の自動文を見出しから外したのに、覚えていた35件がそのまま残った。
 */
const SHAPE = 7; // 6: Codexの新形式に対応（古い覚え書きは捨てる）

/** 壊れていたら黙って捨てる。速くするための仕組みで止まるのは本末転倒 */
export function load(path: string = cachePath()): Memory {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(raw) || raw["shape"] !== SHAPE) return new Map();
    const rows = raw["rows"];
    if (!isRecord(rows)) return new Map();
    return new Map(Object.entries(rows).filter(hasShape));
  } catch {
    return new Map();
  }
}

/** 保存した形が今のコードと合っているか。合わなければ読み直す */
function hasShape(pair: [string, unknown]): pair is [string, Remembered] {
  const [, value] = pair;
  if (!isRecord(value) || typeof value["mtimeMs"] !== "number") return false;
  const row = value["row"];
  return (
    isRecord(row) &&
    typeof row["ref"] === "string" &&
    typeof row["topic"] === "string" &&
    typeof row["words"] === "string"
  );
}

/**
 * 覚えた分を書き出す。消えた記録は落とす（放っておくと際限なく増える）。
 * 書き途中で読まれないよう、別名で書いてから置き換える。
 */
export function save(memory: Memory, path: string = cachePath()): void {
  const alive = [...memory].filter(([file]) => existsSync(file));
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ shape: SHAPE, rows: Object.fromEntries(alive) }), "utf8");
  renameSync(tmp, path);
}

/**
 * 覚えていれば返す。更新時刻が1msでも違えば読み直す——
 * 会話が続いていれば mtime は必ず動くので、古い見出しを掴まない。
 */
export function remembered(memory: Memory, path: string, mtimeMs: number): Listed | null {
  const found = memory.get(path);
  return found !== undefined && found.mtimeMs === mtimeMs ? found.row : null;
}

export const remember = (memory: Memory, path: string, mtimeMs: number, row: Listed): void => {
  memory.set(path, { mtimeMs, row });
};
