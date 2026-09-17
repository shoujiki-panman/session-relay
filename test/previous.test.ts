import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContextFrom } from "../src/context.ts";
import { currentSessionFor, previousSessionsFor, sessionsFor } from "../src/sessions.ts";

const row = (o: unknown): string => JSON.stringify(o);

const session = (utterances: readonly string[]): string =>
  utterances
    .map((text) => row({ type: "user", sessionId: "s", cwd: "/w", timestamp: "2026-08-27T00:00:00Z", message: { role: "user", content: text } }))
    .join("\n");

/** name -> {何秒前に書かれたか, 発話} の偽のセッション置き場を作る */
const fakeRoot = (files: Readonly<Record<string, readonly [number, readonly string[]]>>): string => {
  const root = mkdtempSync(join(tmpdir(), "relay-prev-"));
  const dir = join(root, "-w");
  mkdirSync(dir);
  for (const [name, [ageMs, utterances]] of Object.entries(files)) {
    const path = join(dir, `${name}.jsonl`);
    writeFileSync(path, session(utterances), "utf8");
    const when = new Date(Date.now() - ageMs);
    utimesSync(path, when, when);
  }
  return root;
};

const names = (paths: readonly string[]): string[] =>
  paths.map((p) => (p.split("/").pop() ?? "").replace(".jsonl", ""));

describe("previousSessionsFor: 自分を除いた直前の会話", () => {
  it("正常系: 自分のIDが分かれば、自分を外して新しい順に返す", () => {
    const root = fakeRoot({ mine: [0, ["いま始まった"]], prev: [10_000, ["前の話"]], old: [90_000, ["もっと前"]] });
    const got = previousSessionsFor("/w", { CLAUDE_CODE_SESSION_ID: "mine" }, [root]);
    expect(names(got)).toEqual(["prev", "old"]);
  });
  it("正常系: IDが無くてもClaude Codeの中からなら、一番新しい（＝自分）を外す", () => {
    const root = fakeRoot({ mine: [0, ["いま始まった"]], prev: [10_000, ["前の話"]] });
    expect(names(previousSessionsFor("/w", { CLAUDECODE: "1" }, [root]))).toEqual(["prev"]);
  });
  it("Corner: Claude Codeの外（ただのシェル）からなら、一番新しいものも候補に残す", () => {
    const root = fakeRoot({ newest: [0, ["いちばん新しい"]], prev: [10_000, ["前の話"]] });
    expect(names(previousSessionsFor("/w", {}, [root]))).toEqual(["newest", "prev"]);
  });
  it("Edge: 自分しかいなければ空（＝前の会話は無い）", () => {
    const root = fakeRoot({ mine: [0, ["いま始まった"]] });
    expect(previousSessionsFor("/w", { CLAUDE_CODE_SESSION_ID: "mine" }, [root])).toEqual([]);
  });
  it("Edge: 記録が1つも無くても落ちない", () => {
    expect(previousSessionsFor("/w", {}, [mkdtempSync(join(tmpdir(), "empty-"))])).toEqual([]);
  });
  it("Corner: 作業ディレクトリが違う会話は混ざらない", () => {
    const root = fakeRoot({ prev: [0, ["前の話"]] });
    expect(previousSessionsFor("/別の場所", {}, [root])).toEqual([]);
  });
  it("正常系: sessionsFor は自分も含めて新しい順に返す", () => {
    const root = fakeRoot({ mine: [0, ["a"]], prev: [10_000, ["b"]] });
    expect(names(sessionsFor("/w", [root]))).toEqual(["mine", "prev"]);
  });
});

/**
 * 同じフォルダで Claude と Codex を並べている状況を作る。
 * **Claude のほうが新しい**——向こうは絶えず書いているので、実際こうなる。
 */
const bothHarnesses = (): { roots: string[]; base: string } => {
  const base = mkdtempSync(join(tmpdir(), "relay-harness-"));
  const claudeRoot = join(base, ".claude", "projects");
  const codexRoot = join(base, ".codex", "sessions");
  const claudeDir = join(claudeRoot, "-w");
  const codexDir = join(codexRoot, "2026", "09", "17");
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(codexDir, { recursive: true });
  const put = (dir: string, name: string, ageMs: number, text: string): void => {
    const path = join(dir, `${name}.jsonl`);
    writeFileSync(path, session([text]), "utf8");
    const when = new Date(Date.now() - ageMs);
    utimesSync(path, when, when);
  };
  put(claudeDir, "claude-now", 0, "Claudeで進めている話");
  put(codexDir, "rollout-2026-09-17T00-00-00-abcdef12", 20_000, "Codexで進めている話");
  put(claudeDir, "claude-old", 90_000, "前のClaudeの話");
  return { roots: [claudeRoot, codexRoot], base };
};

const nameOf = (path: string | null): string =>
  path === null ? "(なし)" : (path.split("/").pop() ?? "").replace(".jsonl", "");

describe("RELAY_HARNESS: いま居るハーネスを名乗れる（Codexから押せるようにするため）", () => {
  it("正常系: codex と名乗れば、Claudeのほうが新しくてもCodexの記録を掴む", () => {
    const { roots } = bothHarnesses();
    const got = currentSessionFor("/w", { RELAY_HARNESS: "codex" }, roots);
    expect(nameOf(got)).toContain("rollout-");
  });
  it("Corner: 名乗りが無ければ今までどおり、一番新しいものを掴む（＝Claudeを掴む）", () => {
    const { roots } = bothHarnesses();
    expect(nameOf(currentSessionFor("/w", {}, roots))).toBe("claude-now");
  });
  it("Corner: IDが分かっているときは、名乗りよりIDが勝つ", () => {
    const { roots } = bothHarnesses();
    const got = currentSessionFor("/w", { RELAY_HARNESS: "codex", CLAUDE_CODE_SESSION_ID: "claude-old" }, roots);
    expect(nameOf(got)).toBe("claude-old");
  });
  it("Edge: 知らない名前は名乗っていない扱い（勝手に空にしない）", () => {
    const { roots } = bothHarnesses();
    expect(nameOf(currentSessionFor("/w", { RELAY_HARNESS: "そんなものは無い" }, roots))).toBe("claude-now");
  });
  it("正常系: 直前の会話では、自分（Codexの最新）は外すが、Claudeの会話は候補に残す", () => {
    const { roots } = bothHarnesses();
    const got = previousSessionsFor("/w", { RELAY_HARNESS: "codex" }, roots);
    expect(names(got)).toEqual(["claude-now", "claude-old"]);
  });
});

describe("buildContextFrom: 空の文脈は返さない", () => {
  const pathIn = (root: string, name: string): string => join(root, "-w", `${name}.jsonl`);

  it("正常系: 中身のある最初の会話を返す", () => {
    const root = fakeRoot({ prev: [0, ["前の話"]], old: [10_000, ["もっと前"]] });
    const built = buildContextFrom([pathIn(root, "prev"), pathIn(root, "old")]);
    expect(built?.context).toContain("前の話");
    expect(built?.path).toContain("prev");
  });
  it("正常系: 発話ゼロの会話は飛ばして、その次を返す", () => {
    const root = fakeRoot({ empty: [0, ["<system-reminder>差し込みだけ"]], prev: [10_000, ["前の話"]] });
    const built = buildContextFrom([pathIn(root, "empty"), pathIn(root, "prev")]);
    expect(built?.path).toContain("prev");
    expect(built?.context).toContain("前の話");
  });
  it("Edge: どれも中身が無ければ null（受け手に「前は無かった」と誤解させない）", () => {
    const root = fakeRoot({ empty: [0, ["<system-reminder>差し込みだけ"]] });
    expect(buildContextFrom([pathIn(root, "empty")])).toBeNull();
  });
  it("Edge: 候補ゼロなら null", () => {
    expect(buildContextFrom([])).toBeNull();
  });
});
