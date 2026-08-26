import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSessionById, previousSessionsFor, sessionsFor } from "../src/sessions.ts";

/** Codexの記録: 先頭が session_meta で、cwdは payload の中（実測） */
const codexSession = (cwd: string, id: string): string =>
  [
    JSON.stringify({ timestamp: "2026-08-27T00:00:00Z", payload: { session_id: id, cwd } }),
    JSON.stringify({ timestamp: "2026-08-27T00:00:01Z", payload: { type: "user_message", message: "前の話" } }),
  ].join("\n");

/** Claude Codeの記録: 各行が cwd を持つ */
const claudeSession = (cwd: string): string =>
  JSON.stringify({ type: "user", sessionId: "s", cwd, message: { role: "user", content: "こっちの話" } });

const write = (path: string, body: string, ageMs: number): void => {
  writeFileSync(path, body, "utf8");
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
};

const names = (paths: readonly string[]): string[] => paths.map((p) => p.split("/").pop() ?? "");

describe("Codexの記録も見つける", () => {
  const codexRoot = (cwd: string, id: string, ageMs = 0): string => {
    const root = mkdtempSync(join(tmpdir(), "codex-root-"));
    const dir = join(root, "2026", "08", "27");
    mkdirSync(dir, { recursive: true });
    write(join(dir, `rollout-2026-08-27T00-00-00-${id}.jsonl`), codexSession(cwd, id), ageMs);
    return root;
  };

  it("正常系: YYYY/MM/DD と深く掘られていても見つける", () => {
    const root = codexRoot("/w", "abc123");
    expect(names(sessionsFor("/w", [root]))).toEqual(["rollout-2026-08-27T00-00-00-abc123.jsonl"]);
  });
  it("正常系: cwdは payload の中にある（トップレベルには無い）", () => {
    const root = codexRoot("/別の場所", "abc123");
    expect(sessionsFor("/w", [root])).toEqual([]);
  });
  it("正常系: ファイル名が rollout-<時刻>-<id> でもIDで引ける", () => {
    const root = codexRoot("/w", "abc123");
    expect(findSessionById([root], "abc123")).toContain("abc123.jsonl");
  });
  it("Edge: 無いIDなら null", () => {
    expect(findSessionById([codexRoot("/w", "abc123")], "いない")).toBeNull();
  });
  it("Edge: 存在しない置き場所を渡しても落ちない", () => {
    expect(sessionsFor("/w", ["/どこにも無い場所"])).toEqual([]);
  });
});

describe("ハーネスをまたいで新しい順に並ぶ（移動の相手が見える）", () => {
  it("正常系: ClaudeとCodexの記録が混ざって、新しい順になる", () => {
    const claude = mkdtempSync(join(tmpdir(), "claude-root-"));
    const cdir = join(claude, "-w");
    mkdirSync(cdir);
    write(join(cdir, "claude-new.jsonl"), claudeSession("/w"), 0);
    write(join(cdir, "claude-old.jsonl"), claudeSession("/w"), 120_000);

    const codex = mkdtempSync(join(tmpdir(), "codex-root-"));
    const xdir = join(codex, "2026", "08", "27");
    mkdirSync(xdir, { recursive: true });
    write(join(xdir, "rollout-x-mid.jsonl"), codexSession("/w", "mid"), 60_000);

    expect(names(sessionsFor("/w", [claude, codex]))).toEqual([
      "claude-new.jsonl",
      "rollout-x-mid.jsonl",
      "claude-old.jsonl",
    ]);
  });
  it("正常系: Claudeのセッションから --previous を引くと、Codexの会話も候補に入る", () => {
    const claude = mkdtempSync(join(tmpdir(), "claude-root-"));
    const cdir = join(claude, "-w");
    mkdirSync(cdir);
    write(join(cdir, "mine.jsonl"), claudeSession("/w"), 0);
    const codex = mkdtempSync(join(tmpdir(), "codex-root-"));
    const xdir = join(codex, "2026", "08", "27");
    mkdirSync(xdir, { recursive: true });
    write(join(xdir, "rollout-x-prev.jsonl"), codexSession("/w", "prev"), 60_000);

    const got = previousSessionsFor("/w", { CLAUDE_CODE_SESSION_ID: "mine" }, [claude, codex]);
    expect(names(got)).toEqual(["rollout-x-prev.jsonl"]);
  });
});

describe("最初の発話が巨大でも取りこぼさない（実測で7件落ちていた）", () => {
  it("正常系: 1行目が32KBを超えていても cwd を読める", () => {
    const root = mkdtempSync(join(tmpdir(), "big-root-"));
    const dir = join(root, "-w");
    mkdirSync(dir);
    const huge = "あ".repeat(40_000); // relayで開いた会話は最初の発話が36KBある
    write(join(dir, "big.jsonl"), JSON.stringify({ type: "user", sessionId: "s", cwd: "/w", message: { role: "user", content: huge } }), 0);
    expect(names(sessionsFor("/w", [root]))).toEqual(["big.jsonl"]);
  });
  it("Corner: どこにも cwd が無い記録は候補にしない", () => {
    const root = mkdtempSync(join(tmpdir(), "nocwd-root-"));
    const dir = join(root, "-w");
    mkdirSync(dir);
    write(join(dir, "nocwd.jsonl"), JSON.stringify({ type: "user", message: { role: "user", content: "x" } }), 0);
    expect(sessionsFor("/w", [root])).toEqual([]);
  });
});
