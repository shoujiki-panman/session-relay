import { describe, expect, it } from "vitest";
import { classifyUtterance, detectHarness, extractSession, humanUtterances, parseJsonl } from "../src/extract.ts";

const claudeLine = (o: unknown): string => JSON.stringify(o);

describe("parseJsonl: 壊れていても読めるところまで読む", () => {
  it("正常系: 各行をオブジェクトとして読む", () => {
    expect(parseJsonl('{"a":1}\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it("Edge: 空文字列は空配列", () => {
    expect(parseJsonl("")).toEqual([]);
  });
  it("Edge: 空行・空白行は飛ばす", () => {
    expect(parseJsonl('\n  \n{"a":1}\n\n')).toEqual([{ a: 1 }]);
  });
  it("Error: 壊れた行は飛ばして続行する（途中終了は日常的に起きる）", () => {
    expect(parseJsonl('{"a":1}\n{壊れ\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it("Error: 末尾が切れていても直前までは読める", () => {
    expect(parseJsonl('{"a":1}\n{"b":')).toEqual([{ a: 1 }]);
  });
  it("Corner: 配列やプリミティブの行は採らない（レコードのみ）", () => {
    expect(parseJsonl('[1,2]\n"文字列"\n3\nnull\n{"a":1}')).toEqual([{ a: 1 }]);
  });
});

describe("classifyUtterance: 人間の発話と注入されたものを分ける", () => {
  it("正常系: 普通の文は human", () => {
    expect(classifyUtterance("需要あるか？")).toBe("human");
  });
  it("正常系: スラッシュコマンドの展開は injected", () => {
    expect(classifyUtterance("<command-name>/model</command-name>")).toBe("injected");
  });
  it("正常系: スキル本文の注入は injected", () => {
    expect(classifyUtterance("Base directory for this skill: /x")).toBe("injected");
  });
  it("Edge: 先頭の空白があっても判定できる", () => {
    expect(classifyUtterance("\n  <system-reminder>x")).toBe("injected");
  });
  it("Corner: 途中に目印があっても human（先頭のみ見る）", () => {
    expect(classifyUtterance("これは <command-name> の話")).toBe("human");
  });
});

describe("detectHarness", () => {
  it("Claude Code: sessionIdを持つ", () => {
    expect(detectHarness([{ sessionId: "x", type: "user" }])).toBe("claude-code");
  });
  it("Codex: payloadを持つ", () => {
    expect(detectHarness([{ payload: { type: "user_message" } }])).toBe("codex");
  });
  it("Error: 判別できなければ null", () => {
    expect(detectHarness([{ foo: 1 }])).toBe(null);
  });
  it("Edge: 空配列は null", () => {
    expect(detectHarness([])).toBe(null);
  });
});

describe("extractSession: Claude Code形式", () => {
  const raw = [
    claudeLine({ type: "custom-title", sessionId: "s1", customTitle: "題名" }),
    claudeLine({
      type: "user", sessionId: "s1", cwd: "/repo", gitBranch: "main",
      timestamp: "2026-08-25T01:00:00Z",
      message: { content: "文字列で入る発話" },
    }),
    claudeLine({
      type: "user", sessionId: "s1", timestamp: "2026-08-25T02:00:00Z",
      message: { content: [{ type: "text", text: "配列で入る発話" }, { type: "image" }] },
    }),
    claudeLine({
      type: "assistant", sessionId: "s1", timestamp: "2026-08-25T03:00:00Z",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/repo/a.ts" } },
          { type: "tool_use", name: "Bash", input: { command: "npm test" } },
        ],
      },
    }),
  ].join("\n");

  it("★回帰: contentの文字列と配列の両方を拾う（片方だけだと発話を落とす）", () => {
    const r = extractSession(raw);
    expect(r?.utterances.map((u) => u.text)).toEqual(["文字列で入る発話", "配列で入る発話"]);
  });
  it("メタ情報を拾う", () => {
    const r = extractSession(raw);
    expect(r?.sessionId).toBe("s1");
    expect(r?.cwd).toBe("/repo");
    expect(r?.gitBranch).toBe("main");
    expect(r?.title).toBe("題名");
    expect(r?.harness).toBe("claude-code");
  });
  it("時刻の範囲を取る", () => {
    const r = extractSession(raw);
    expect(r?.startedAt).toBe("2026-08-25T01:00:00Z");
    expect(r?.endedAt).toBe("2026-08-25T03:00:00Z");
  });
  it("ツール・ファイル・コマンドを拾う", () => {
    const r = extractSession(raw);
    expect(r?.tools).toEqual(["Read", "Bash"]);
    expect(r?.files).toEqual(["/repo/a.ts"]);
    expect(r?.commands).toEqual(["npm test"]);
  });
  it("Edge: messageが無い行で落ちない", () => {
    const r = extractSession(claudeLine({ type: "user", sessionId: "s" }));
    expect(r?.utterances).toEqual([]);
  });
  it("Edge: 空文字の発話は採らない", () => {
    const r = extractSession(claudeLine({ type: "user", sessionId: "s", message: { content: "" } }));
    expect(r?.utterances).toEqual([]);
  });
});

describe("extractSession: Codex形式", () => {
  const raw = [
    claudeLine({ type: "session_meta", timestamp: "2026-08-25T01:00:00Z", payload: { id: "c1", cwd: "/w" } }),
    claudeLine({ type: "event_msg", timestamp: "2026-08-25T02:00:00Z", payload: { type: "user_message", message: "これは何をしているの？" } }),
    claudeLine({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "ls -la" } }),
  ].join("\n");

  it("発話・メタ・ツールを拾う", () => {
    const r = extractSession(raw);
    expect(r?.harness).toBe("codex");
    expect(r?.sessionId).toBe("c1");
    expect(r?.cwd).toBe("/w");
    expect(r?.utterances.map((u) => u.text)).toEqual(["これは何をしているの？"]);
    expect(r?.tools).toEqual(["exec"]);
    expect(r?.commands).toEqual(["ls -la"]);
  });
  it("Edge: turn_contextからもcwdを補える", () => {
    const r = extractSession(claudeLine({ type: "turn_context", payload: { cwd: "/from-turn" } }));
    expect(r?.cwd).toBe("/from-turn");
  });
});

describe("humanUtterances / 入口", () => {
  it("注入されたものを除いて人間の発話だけ返す", () => {
    const raw = [
      claudeLine({ type: "user", sessionId: "s", message: { content: "本物の発話" } }),
      claudeLine({ type: "user", sessionId: "s", message: { content: "<command-name>/model</command-name>" } }),
    ].join("\n");
    const r = extractSession(raw);
    expect(r).not.toBe(null);
    expect(r && humanUtterances(r)).toEqual(["本物の発話"]);
  });
  it("Error: 形式が判定できなければ null", () => {
    expect(extractSession('{"unknown":1}')).toBe(null);
  });
  it("Edge: 空入力は null", () => {
    expect(extractSession("")).toBe(null);
  });
});
