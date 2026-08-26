import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContext } from "../src/context.ts";
import { type SessionRecord, extractSession } from "../src/extract.ts";
import { parseRelayContext } from "../src/relay-block.ts";
import { readRepoSignals } from "../src/repo.ts";
import { currentSessionFor } from "../src/sessions.ts";

const recordOf = (raw: string): SessionRecord => {
  const record = extractSession(raw);
  if (record === null) throw new Error("射影できなかった");
  return record;
};

const endingsOf = (raw: string): readonly string[] => recordOf(raw).turnEndings.map((t) => t.text);

const user = (text: string): string =>
  JSON.stringify({ type: "user", sessionId: "s1", cwd: "/w", timestamp: "2026-08-26T00:00:00Z", message: { role: "user", content: text } });

const ai = (...blocks: readonly unknown[]): string =>
  JSON.stringify({ type: "assistant", sessionId: "s1", timestamp: "2026-08-26T00:00:01Z", message: { role: "assistant", content: blocks } });

const text = (t: string): unknown => ({ type: "text", text: t });
const toolUse = (name: string): unknown => ({ type: "tool_use", name, input: {} });

describe("結果の信号: 各ターンの最後にAIが報告したこと", () => {
  it("正常系: 1ターンぶんの報告が採れる", () => {
    expect(endingsOf([user("やって"), ai(text("できました")), user("次")].join("\n"))).toEqual(["できました"]);
  });
  it("正常系: ターンの途中の発言は採らず、最後だけ採る（全部入れると110KBになる実測）", () => {
    const raw = [user("やって"), ai(text("調べます")), ai(toolUse("Bash")), ai(text("できました")), user("次")].join("\n");
    expect(endingsOf(raw)).toEqual(["できました"]);
  });
  it("正常系: 最後のターンが終わっていなくても、いまの状態として採る", () => {
    expect(endingsOf([user("やって"), ai(text("進行中です"))].join("\n"))).toEqual(["進行中です"]);
  });
  it("正常系: 複数ターンが順番どおり並ぶ", () => {
    const raw = [user("一つ目"), ai(text("A")), user("二つ目"), ai(text("B")), user("三つ目"), ai(text("C"))].join("\n");
    expect(endingsOf(raw)).toEqual(["A", "B", "C"]);
  });
  it("Edge: ツールを呼んだだけで発言が無いターンは何も残さない", () => {
    expect(endingsOf([user("やって"), ai(toolUse("Bash")), user("次")].join("\n"))).toEqual([]);
  });
  it("Edge: 空白だけの発言は採らない", () => {
    expect(endingsOf([user("やって"), ai(text("できた")), ai(text("  \n ")), user("次")].join("\n"))).toEqual(["できた"]);
  });
  it("Corner: システムの差し込みはターンの区切りにしない", () => {
    const raw = [user("やって"), ai(text("A")), user("<system-reminder>x"), ai(text("B")), user("次")].join("\n");
    expect(endingsOf(raw)).toEqual(["B"]);
  });
  it("Error: assistant行が壊れていても落ちない", () => {
    expect(endingsOf([user("やって"), '{"type":"assistant","sessionId":"s1"}', ai(text("A"))].join("\n"))).toEqual(["A"]);
  });
});

describe("Codexでも同じ形で採れる（ハーネス跨ぎで同じ引き継ぎになる）", () => {
  const codex = (payload: unknown): string => JSON.stringify({ timestamp: "2026-08-26T00:00:00Z", payload });
  it("正常系: agent_message がターンの報告になる", () => {
    const raw = [
      codex({ type: "user_message", message: "やって" }),
      codex({ type: "agent_message", message: "できました" }),
      codex({ type: "user_message", message: "次" }),
      codex({ type: "agent_message", message: "つぎも出来ました" }),
    ].join("\n");
    expect(endingsOf(raw)).toEqual(["できました", "つぎも出来ました"]);
  });
});

describe("渡すたびに経過が消えないこと", () => {
  const sessionFile = (rows: readonly string[]): string => {
    const dir = mkdtempSync(join(tmpdir(), "relay-test-"));
    const path = join(dir, "s.jsonl");
    writeFileSync(path, rows.join("\n"), "utf8");
    return path;
  };

  it("正常系: 射影を読み戻すと発話も経過もそのまま戻る（往復して同じ）", () => {
    const path = sessionFile([user("一つ目"), ai(text("Aできた")), user("二つ目"), ai(text("Bできた"))]);
    const context = buildContext(path);
    if (context === null) throw new Error("組み立てられなかった");
    const block = parseRelayContext(context);
    expect(block?.utterances).toEqual(["一つ目", "二つ目"]);
    expect(block?.turnEndings).toEqual(["Aできた", "Bできた"]);
  });

  it("正常系: 渡された文脈を持つ会話をもう一度渡しても、前の経過が残る", () => {
    const first = buildContext(sessionFile([user("一つ目"), ai(text("Aできた"))]));
    if (first === null) throw new Error("組み立てられなかった");
    const second = buildContext(sessionFile([user(first), ai(text("Bできた"))]));
    if (second === null) throw new Error("組み立てられなかった");
    const block = parseRelayContext(second);
    expect(block?.utterances).toEqual(["一つ目"]);
    expect(block?.turnEndings).toEqual(["Aできた", "Bできた"]);
  });

  it("正常系: リポジトリの状態が入る", () => {
    const path = sessionFile([user("やって"), ai(text("できた"))]);
    const context = buildContext(path, { dir: "/repo", branch: "main", log: ["abc1234 直したところ"], dirty: [] });
    expect(context).toContain("## いまのリポジトリ（渡した時点の実物）");
    expect(context).toContain("abc1234 直したところ");
    expect(context).toContain("作業ツリーはきれい");
    expect(context).toContain("場所: /repo");
  });

  it("Edge: リポジトリの信号が無ければその欄ごと出さない", () => {
    const path = sessionFile([user("やって"), ai(text("できた"))]);
    expect(buildContext(path)).not.toContain("## いまのリポジトリ");
  });
});

describe("readRepoSignals: 生のgitを読む", () => {
  it("正常系: リポジトリの中ならブランチとコミットが取れる", () => {
    const signals = readRepoSignals(process.cwd());
    expect(signals.dir).toContain("session-relay");
    expect(signals.branch).not.toBeNull();
    expect(signals.log.length).toBeGreaterThan(0);
  });
  it("Error: リポジトリでなければ空（例外にしない）", () => {
    const signals = readRepoSignals(mkdtempSync(join(tmpdir(), "not-a-repo-")));
    expect(signals.branch).toBeNull();
    expect(signals.log).toEqual([]);
  });
});

describe("いましゃべっている会話を取り違えないこと（実測で起きた）", () => {
  const fakeRoot = (files: Readonly<Record<string, number>>): string => {
    const root = mkdtempSync(join(tmpdir(), "relay-root-"));
    const dir = join(root, "-w");
    mkdirSync(dir);
    for (const [name, ageMs] of Object.entries(files)) {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify({ type: "user", sessionId: name, cwd: "/w", message: { role: "user", content: "x" } }), "utf8");
      const when = new Date(Date.now() - ageMs);
      utimesSync(path, when, when);
    }
    return root;
  };

  it("正常系: セッションIDが渡っていれば、更新が新しい別の会話に取り違えない", () => {
    const root = fakeRoot({ "mine.jsonl": 60_000, "other.jsonl": 0 });
    const path = currentSessionFor("/w", { CLAUDE_CODE_SESSION_ID: "mine" }, root);
    expect(path).toContain("mine.jsonl");
  });
  it("Edge: IDが無ければ従来どおり一番新しいものを使う", () => {
    const root = fakeRoot({ "mine.jsonl": 60_000, "other.jsonl": 0 });
    expect(currentSessionFor("/w", {}, root)).toContain("other.jsonl");
  });
  it("Error: IDに対応する記録が無ければ、更新時刻の方に落とす", () => {
    const root = fakeRoot({ "other.jsonl": 0 });
    expect(currentSessionFor("/w", { CLAUDE_CODE_SESSION_ID: "いない" }, root)).toContain("other.jsonl");
  });
  it("Corner: 作業ディレクトリが違う記録は選ばない", () => {
    const root = fakeRoot({ "other.jsonl": 0 });
    expect(currentSessionFor("/別の場所", {}, root)).toBeNull();
  });
});
