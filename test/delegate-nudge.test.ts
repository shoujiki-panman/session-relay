/** 下請けに出さず道具を続けていたら、AIの文脈に一行足す。数えるのはメインだけ、言うのはFableにだけ。 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DELEGATE_CALLS,
  delegateMessage,
  delegateNudge,
  delegateThreshold,
  forgetDelegate,
  isDelegatingTool,
  isFableModel,
  lastAssistantModel,
  nextCount,
  shouldTell,
} from "../src/delegate-nudge.ts";
import { runHook } from "../src/hook.ts";
import { isRecord } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temp = (): string => {
  const root = mkdtempSync(join(tmpdir(), "relay-delegate-"));
  roots.push(root);
  return root;
};

const reply = (model: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: "assistant", ...extra, message: { role: "assistant", model, usage: { input_tokens: 10 } } });

const transcript = (dir: string, rows: readonly string[], name = "t.jsonl"): string => {
  const path = join(dir, name);
  writeFileSync(path, `${rows.join("\n")}\n`);
  return path;
};

const NOW = new Date("2026-09-19T10:00:00Z");
const fable = (dir: string): string => transcript(dir, [reply("claude-fable-5-1")]);

const use = (dir: string, path: string, toolName = "Read", extra: Partial<Record<"sessionId" | "agentId", string>> = {}): string =>
  delegateNudge(
    { sessionId: extra.sessionId ?? "s", transcriptPath: path, toolName, agentId: extra.agentId ?? "" },
    dir,
    3,
    NOW,
  );

describe("数え方", () => {
  it("Agent（旧名 Task）を呼んだら0に戻り、それ以外の道具は1つ増える", () => {
    expect(isDelegatingTool("Agent")).toBe(true);
    expect(isDelegatingTool("Task")).toBe(true);
    expect(isDelegatingTool("Read")).toBe(false);
    expect(nextCount(7, "Read")).toBe(8);
    expect(nextCount(7, "Agent")).toBe(0);
    expect(nextCount(7, "Task")).toBe(0);
  });

  it("知らせるのは閾値ちょうどと、そこから閾値ぶん増えた時だけ", () => {
    expect(shouldTell(0, 8)).toBe(false);
    expect(shouldTell(7, 8)).toBe(false);
    expect(shouldTell(8, 8)).toBe(true);
    expect(shouldTell(9, 8)).toBe(false);
    expect(shouldTell(16, 8)).toBe(true);
    // 無効（閾値0）のときは何回続いても知らせない
    expect(shouldTell(100, 0)).toBe(false);
  });

  it("文面には続いた回数と、下請けに渡す指示が入る", () => {
    expect(delegateMessage(8)).toContain("8回");
    expect(delegateMessage(8)).toContain("サブエージェント");
  });
});

describe("閾値は環境変数で変えられる", () => {
  it("既定は8回、正の整数なら従い、0や不正値は無効（0）", () => {
    expect(delegateThreshold({})).toBe(DEFAULT_DELEGATE_CALLS);
    expect(delegateThreshold({ RELAY_DELEGATE_CALLS: "" })).toBe(DEFAULT_DELEGATE_CALLS);
    expect(delegateThreshold({ RELAY_DELEGATE_CALLS: "3" })).toBe(3);
    expect(delegateThreshold({ RELAY_DELEGATE_CALLS: "0" })).toBe(0);
    expect(delegateThreshold({ RELAY_DELEGATE_CALLS: "-2" })).toBe(0);
    expect(delegateThreshold({ RELAY_DELEGATE_CALLS: "abc" })).toBe(0);
    expect(delegateThreshold({ RELAY_DELEGATE_CALLS: "2.5" })).toBe(0);
  });

  it("無効にしたら、続けても何も出さず、数えの控えも作らない", () => {
    const dir = temp();
    const path = fable(dir);
    for (let i = 0; i < 20; i++) {
      expect(delegateNudge({ sessionId: "s", transcriptPath: path, toolName: "Read", agentId: "" }, dir, 0, NOW)).toBe("");
    }
    expect(readdirSync(dir).filter((name) => name.startsWith("delegate-"))).toEqual([]);
  });
});

describe("メインのモデルを記録から読む", () => {
  it("いちばん新しい本筋の返事のモデル名を返す", () => {
    expect(lastAssistantModel([reply("claude-opus-5"), reply("claude-fable-5")].join("\n"))).toBe("claude-fable-5");
  });

  it("下請け（サイドチェーン）の返事は見ない", () => {
    expect(lastAssistantModel([reply("claude-fable-5"), reply("claude-opus-5", { isSidechain: true })].join("\n"))).toBe("claude-fable-5");
  });

  it("返事が無い・壊れた行だけなら null", () => {
    expect(lastAssistantModel("")).toBeNull();
    expect(lastAssistantModel('{"model" 壊れ\n{"type":"user","message":{"model":"claude-fable-5"}}')).toBeNull();
  });

  it("Fableの判定は名前に fable を含むかどうか（読めなければ出さない）", () => {
    expect(isFableModel("claude-fable-5")).toBe(true);
    expect(isFableModel("claude-fable-5-1")).toBe(true);
    expect(isFableModel("claude-opus-5[1m]")).toBe(false);
    expect(isFableModel(null)).toBe(false);
  });
});

describe("知らせる／黙る", () => {
  it("閾値に達したとき1回だけ出し、そのあとは閾値ぶん増えるまで黙る", () => {
    const dir = temp();
    const path = fable(dir);
    expect(use(dir, path)).toBe("");
    expect(use(dir, path)).toBe("");
    expect(use(dir, path)).toContain("3回");
    expect(use(dir, path)).toBe("");
    expect(use(dir, path)).toBe("");
    expect(use(dir, path)).toContain("6回");
  });

  it("Agentに出したら数えが0に戻り、また最初から数える", () => {
    const dir = temp();
    const path = fable(dir);
    use(dir, path);
    use(dir, path);
    expect(use(dir, path, "Agent")).toBe("");
    expect(use(dir, path)).toBe("");
    expect(use(dir, path)).toBe("");
    expect(use(dir, path)).toContain("3回");
  });

  it("メインがFableでなければ、続けていても出さない（数えは進む）", () => {
    const dir = temp();
    const opus = transcript(dir, [reply("claude-opus-5")]);
    for (let i = 0; i < 7; i++) expect(use(dir, opus)).toBe("");
    // Fableに戻ったら、次の節目で出る（数えは 8→9 と進んでいる）
    expect(use(dir, fable(dir), "Read")).toBe("");
    expect(use(dir, fable(dir), "Read")).toContain("9回");
  });

  it("モデルが読めない・記録が無いときは黙る", () => {
    const dir = temp();
    const empty = transcript(dir, ["{}"], "empty.jsonl");
    for (let i = 0; i < 3; i++) expect(use(dir, empty)).toBe("");
    expect(use(dir, join(dir, "gone.jsonl"))).toBe("");
  });

  it("サブエージェント自身の道具使用は数えない（agent_id があるもの）", () => {
    const dir = temp();
    const path = fable(dir);
    for (let i = 0; i < 10; i++) expect(use(dir, path, "Read", { agentId: "a1" })).toBe("");
    expect(readdirSync(dir).filter((name) => name.startsWith("delegate-"))).toEqual([]);
  });

  it("会話ごとに数える（別の会話とは混ざらない）", () => {
    const dir = temp();
    const path = fable(dir);
    use(dir, path, "Read", { sessionId: "a" });
    use(dir, path, "Read", { sessionId: "a" });
    expect(use(dir, path, "Read", { sessionId: "b" })).toBe("");
    expect(use(dir, path, "Read", { sessionId: "a" })).toContain("3回");
  });

  it("会話IDや道具名が空なら何もしない", () => {
    const dir = temp();
    const path = fable(dir);
    expect(use(dir, path, "", { sessionId: "s" })).toBe("");
    expect(use(dir, path, "Read", { sessionId: "" })).toBe("");
    expect(readdirSync(dir).filter((name) => name.startsWith("delegate-"))).toEqual([]);
  });

  it("古い控えは片づける／控えは消せる", () => {
    const dir = temp();
    const stale = join(dir, "delegate-old");
    writeFileSync(stale, "5");
    const old = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    use(dir, fable(dir));
    expect(existsSync(stale)).toBe(false);
    forgetDelegate(dir, "s");
    expect(readdirSync(dir).filter((name) => name.startsWith("delegate-"))).toEqual([]);
  });

  it("壊れた控えは0として読み直す（フックを落とさない）", () => {
    const dir = temp();
    const path = fable(dir);
    use(dir, path);
    const file = readdirSync(dir).filter((name) => name.startsWith("delegate-"))[0] ?? "";
    writeFileSync(join(dir, file), "こわれた");
    expect(use(dir, path)).toBe("");
    expect(readFileSync(join(dir, file), "utf8")).toBe("1");
  });
});

describe("フックとして（PostToolUse）", () => {
  const post = (path: string, toolName = "Read", extra: Record<string, string> = {}): string =>
    JSON.stringify({ hook_event_name: "PostToolUse", cwd: "/w", session_id: "s", transcript_path: path, tool_name: toolName, ...extra });

  it("続けたらAIの文脈に足す（人に見せる systemMessage は出さない）", () => {
    const dir = temp();
    const path = fable(dir);
    let out = "";
    for (let i = 0; i < DEFAULT_DELEGATE_CALLS; i++) out = runHook(post(path), NOW, dir);
    const parsed: unknown = JSON.parse(out);
    expect(isRecord(parsed) ? Object.keys(parsed) : []).toEqual(["hookSpecificOutput"]);
    const specific: unknown = isRecord(parsed) ? parsed["hookSpecificOutput"] : null;
    expect(isRecord(specific) ? specific["hookEventName"] : null).toBe("PostToolUse");
    expect(isRecord(specific) ? specific["additionalContext"] : null).toContain("サブエージェント");
  });

  it("閾値の手前では何も出さない", () => {
    const dir = temp();
    const path = fable(dir);
    for (let i = 0; i < DEFAULT_DELEGATE_CALLS - 1; i++) expect(runHook(post(path), NOW, dir)).toBe("");
  });

  it("サブエージェントの中からの道具使用（agent_id つき）は数えない", () => {
    const dir = temp();
    const path = fable(dir);
    for (let i = 0; i < DEFAULT_DELEGATE_CALLS * 2; i++) {
      expect(runHook(post(path, "Read", { agent_id: "sub-1" }), NOW, dir)).toBe("");
    }
  });

  it("/clear したら数えも消える", () => {
    const dir = temp();
    const path = fable(dir);
    runHook(post(path), NOW, dir);
    runHook(JSON.stringify({ hook_event_name: "SessionEnd", reason: "clear", cwd: "/w", session_id: "s", transcript_path: path }), NOW, dir);
    expect(readdirSync(dir).filter((name) => name.startsWith("delegate-"))).toEqual([]);
  });
});
