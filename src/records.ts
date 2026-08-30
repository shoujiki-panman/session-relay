/**
 * 会話の一覧を、画面から読める形（1会話＝1ファイル）で書き出す。
 *
 * 本人の指摘（2026-08-29）:「エンジニアじゃないからコマンド形式は使いにくいし、
 * 複数チャットはあるんだから」。**見えているものから選べる**ようにするための出口で、
 * MulmoTerminalのコレクションがこの形（`data/<slug>/items/<id>.json`）を読む。
 *
 * 中身は見出し（発話の先頭44文字）と置き場所だけ。会話の本文は入れない——
 * 本文が要るのは選んだ後で、それは `get_context` の仕事。
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Project } from "./projects.ts";

export interface ChatRecord {
  /**
   * 記録ファイルの名前。**refでは足りない**——refは8文字なので、
   * 実測（2026-08-29）で160件中4件がぶつかって上書きされ、会話が黙って消えた。
   */
  readonly id: string;
  /** 短い名前。そのまま `get_context` に渡せる */
  readonly ref: string;
  readonly project: string;
  readonly topic: string;
  readonly when: string;
  readonly harness: string;
  readonly utterances: number;
  readonly place: string;
}

export const toRecords = (projects: readonly Project[]): ChatRecord[] =>
  projects.flatMap((project) =>
    project.sessions.map((session) => ({
      id: basename(session.path).replace(/\.jsonl$/, ""),
      ref: session.ref,
      project: project.name,
      topic: session.topic,
      when: session.when,
      harness: session.harness,
      utterances: session.utterances,
      place: session.place,
    })),
  );

/**
 * 書き出す。**もう無い会話のファイルは消す**——残すと、開けない会話が
 * 一覧に居座る（選んで空振りするのが一番いらだつ）。
 * 消すのはこのディレクトリの `.json` だけ。
 */
export function writeRecords(records: readonly ChatRecord[], dir: string): number {
  mkdirSync(dir, { recursive: true });
  const keep = new Set(records.map((record) => `${record.id}.json`));
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json") && !keep.has(name)) rmSync(join(dir, name));
  }
  for (const record of records) {
    writeFileSync(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
  return records.length;
}
