/** 「いま /clear するといい」を道具の側から言う。しつこくせず、分からないときは黙る。 */
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runHook } from "../src/hook.ts";
import { isRecord } from "../src/types.ts";
import { DEFAULT_STEP, DEFAULT_THRESHOLD, lastContextTokens, nudge, nudgeLevel, nudgeOptions, readTail } from "../src/nudge.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temp = (): string => {
  const root = mkdtempSync(join(tmpdir(), "relay-nudge-"));
  roots.push(root);
  return root;
};

const reply = (read: number, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "assistant",
    ...extra,
    message: { role: "assistant", usage: { input_tokens: 10, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: 5 } },
  });

const transcript = (dir: string, rows: readonly string[]): string => {
  const path = join(dir, "t.jsonl");
  writeFileSync(path, `${rows.join("\n")}\n`);
  return path;
};

const OPTIONS = { threshold: 300_000, step: 100_000 };
const NOW = new Date("2026-09-18T15:00:00Z");

describe("会話の重さを記録から読む", () => {
  it("いちばん新しい返事が読んだ量（入力＋キャッシュ）を返す", () => {
    expect(lastContextTokens([reply(1000), reply(250_000)].join("\n"))).toBe(250_010);
  });

  it("下請け（サイドチェーン）の返事は数えない", () => {
    expect(lastContextTokens([reply(320_000), reply(5000, { isSidechain: true })].join("\n"))).toBe(320_010);
  });

  it("返事が無い・壊れた行だけなら null", () => {
    expect(lastContextTokens("")).toBeNull();
    expect(lastContextTokens('{"usage" 壊れ\n{"type":"user"}')).toBeNull();
  });

  it("大きな記録は末尾だけ読み、欠けた先頭行は捨てる", () => {
    const dir = temp();
    const path = transcript(dir, ["x".repeat(5000), reply(400_000)]);
    const tail = readTail(path, 600);
    expect(tail.startsWith("x")).toBe(false);
    expect(lastContextTokens(tail)).toBe(400_010);
  });
});

describe("しつこくしない", () => {
  it("段の数え方: 閾値未満は0、超えたら1、あとは一定量ごとに1つ上がる", () => {
    expect(nudgeLevel(299_999, 300_000, 100_000)).toBe(0);
    expect(nudgeLevel(300_000, 300_000, 100_000)).toBe(1);
    expect(nudgeLevel(399_999, 300_000, 100_000)).toBe(1);
    expect(nudgeLevel(400_000, 300_000, 100_000)).toBe(2);
  });

  it("閾値を超えたとき1回だけ出し、同じ段では黙り、次の段でまた出す", () => {
    const dir = temp();
    expect(nudge(transcript(dir, [reply(200_000)]), "s", dir, OPTIONS, NOW)).toBe("");
    expect(nudge(transcript(dir, [reply(320_000)]), "s", dir, OPTIONS, NOW)).toContain("32万トークン");
    expect(nudge(transcript(dir, [reply(350_000)]), "s", dir, OPTIONS, NOW)).toBe("");
    expect(nudge(transcript(dir, [reply(410_000)]), "s", dir, OPTIONS, NOW)).toContain("41万トークン");
  });

  it("別の会話の控えとは混ざらない", () => {
    const dir = temp();
    const path = transcript(dir, [reply(320_000)]);
    expect(nudge(path, "a", dir, OPTIONS, NOW)).not.toBe("");
    expect(nudge(path, "b", dir, OPTIONS, NOW)).not.toBe("");
  });

  it("古い控えは片づける", () => {
    const dir = temp();
    const stale = join(dir, "nudge-old");
    writeFileSync(stale, "1");
    const old = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    nudge(transcript(dir, [reply(320_000)]), "s", dir, OPTIONS, NOW);
    expect(existsSync(stale)).toBe(false);
  });
});

describe("閾値は使いながら決める", () => {
  it("環境変数で変えられ、おかしな値は既定に戻す", () => {
    expect(nudgeOptions({})).toEqual({ threshold: DEFAULT_THRESHOLD, step: DEFAULT_STEP });
    expect(nudgeOptions({ RELAY_NUDGE_TOKENS: "200000", RELAY_NUDGE_STEP: "50000" })).toEqual({ threshold: 200_000, step: 50_000 });
    expect(nudgeOptions({ RELAY_NUDGE_TOKENS: "abc", RELAY_NUDGE_STEP: "-1" })).toEqual({ threshold: DEFAULT_THRESHOLD, step: DEFAULT_STEP });
  });
});

describe("フックとして（Stop）", () => {
  const stop = (path: string, id = "s"): string =>
    JSON.stringify({ hook_event_name: "Stop", cwd: "/w", session_id: id, transcript_path: path });

  it("育った会話では、本人の画面に出す一行だけを返す（AIの文脈には足さない）", () => {
    const dir = temp();
    const out = runHook(stop(transcript(dir, [reply(320_000)])), NOW, dir);
    const parsed: unknown = JSON.parse(out);
    expect(isRecord(parsed) ? Object.keys(parsed) : []).toEqual(["systemMessage"]);
    expect(out).toContain("/clear");
  });

  it("軽い会話・記録が無い・読めないときは黙る（フックを落とさない）", () => {
    const dir = temp();
    expect(runHook(stop(transcript(dir, [reply(1000)])), NOW, dir)).toBe("");
    expect(runHook(stop(""), NOW, dir)).toBe("");
  });

  it("/clear したら控えを消す（同じIDで出直しても、また知らせる）", () => {
    const dir = temp();
    const path = transcript(dir, [reply(320_000)]);
    runHook(stop(path), NOW, dir);
    runHook(JSON.stringify({ hook_event_name: "SessionEnd", reason: "clear", cwd: "/w", session_id: "s", transcript_path: path }), NOW, dir);
    expect(readdirSync(dir).filter((name) => name.startsWith("nudge-"))).toEqual([]);
  });
});
