/** `/clear` だけで会話を軽くする。フックは何があっても落ちず、無関係な会話を流し込まない。 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLEAR_NOTE, SLOT_TTL_MS, notice, parseHookInput, runHook, slotFor } from "../src/hook.ts";
import { isRelayContext, unwrapHookStdout } from "../src/relay-block.ts";
import { isRecord } from "../src/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temp = (): string => {
  const root = mkdtempSync(join(tmpdir(), "relay-hook-"));
  roots.push(root);
  return root;
};

const session = (dir: string, cwd: string, texts: readonly string[]): string => {
  const path = join(dir, "old.jsonl");
  const rows = texts.map((text) =>
    JSON.stringify({ type: "user", sessionId: "old", cwd, promptSource: "typed", message: { role: "user", content: text } }),
  );
  writeFileSync(path, `${rows.join("\n")}\n`);
  return path;
};

const input = (event: string, trigger: Record<string, string>, cwd: string, transcript = ""): string =>
  JSON.stringify({ hook_event_name: event, cwd, session_id: "s", transcript_path: transcript, ...trigger });

const T0 = new Date("2026-09-18T12:00:00Z");
const after = (ms: number): Date => new Date(T0.getTime() + ms);

describe("/clear の前後をつなぐ", () => {
  it("終わる会話を控え、次の会話の頭に本人の発話を原文で出す", () => {
    const dir = temp();
    const old = session(dir, "/w", ["地図の色を羊皮紙にしたい", "ボタンは臙脂で"]);
    expect(runHook(input("SessionEnd", { reason: "clear" }, "/w", old), T0, dir)).toBe("");
    const out = unwrapHookStdout(runHook(input("SessionStart", { source: "clear" }, "/w"), after(2000), dir));
    expect(isRelayContext(out)).toBe(true);
    expect(out).toContain("地図の色を羊皮紙にしたい");
    expect(out).toContain("ボタンは臙脂で");
    expect(out).toContain(CLEAR_NOTE);
  });

  it("一度出したら控えは消える（次の無関係な /clear に流れ込まない）", () => {
    const dir = temp();
    const old = session(dir, "/w", ["一度だけ出てほしい話"]);
    runHook(input("SessionEnd", { reason: "clear" }, "/w", old), T0, dir);
    expect(runHook(input("SessionStart", { source: "clear" }, "/w"), after(1000), dir)).not.toBe("");
    expect(runHook(input("SessionStart", { source: "clear" }, "/w"), after(2000), dir)).toBe("");
    expect(existsSync(slotFor("/w", dir))).toBe(false);
  });

  it("別の場所の /clear には出さない", () => {
    const dir = temp();
    const old = session(dir, "/a", ["プロジェクトAの話"]);
    runHook(input("SessionEnd", { reason: "clear" }, "/a", old), T0, dir);
    expect(runHook(input("SessionStart", { source: "clear" }, "/b"), after(1000), dir)).toBe("");
  });

  it("期限を過ぎた控えは出さず、消す", () => {
    const dir = temp();
    const old = session(dir, "/w", ["昼の話"]);
    runHook(input("SessionEnd", { reason: "clear" }, "/w", old), T0, dir);
    expect(runHook(input("SessionStart", { source: "clear" }, "/w"), after(SLOT_TTL_MS + 1), dir)).toBe("");
    expect(existsSync(slotFor("/w", dir))).toBe(false);
  });
});

describe("引き継いだことを本人の画面にも出す", () => {
  it("文脈はAIに、一行は本人に（フックのJSON形式）", () => {
    const dir = temp();
    const old = session(dir, "/w", ["地図の色を羊皮紙にしたい", "ボタンは臙脂で"]);
    runHook(input("SessionEnd", { reason: "clear" }, "/w", old), T0, dir);
    const out = runHook(input("SessionStart", { source: "clear" }, "/w"), after(1000), dir);
    const parsed: unknown = JSON.parse(out);
    const message = isRecord(parsed) ? parsed["systemMessage"] : null;
    expect(message).toContain("本人の発話 2件");
    expect(unwrapHookStdout(out)).toContain("ボタンは臙脂で");
  });

  it("一行には件数と大きさが入り、1KB未満でも0KBとは書かない", () => {
    expect(notice("短い")).toContain("0件・1KB");
  });

  it("素の文脈（以前の形）とJSONでない出力は、そのまま返す", () => {
    expect(unwrapHookStdout("caffeinate started")).toBe("caffeinate started");
    expect(unwrapHookStdout("{ 壊れたJSON")).toBe("{ 壊れたJSON");
    expect(unwrapHookStdout(JSON.stringify({ other: 1 }))).toBe(JSON.stringify({ other: 1 }));
  });
});

describe("関係ない合図では何もしない", () => {
  it("/clear 以外の終わり方は控えない（ログアウトや終了で次の会話を汚さない）", () => {
    const dir = temp();
    const old = session(dir, "/w", ["終了しただけ"]);
    runHook(input("SessionEnd", { reason: "logout" }, "/w", old), T0, dir);
    expect(existsSync(slotFor("/w", dir))).toBe(false);
  });

  it("普通の起動・再開・圧縮では出さない", () => {
    const dir = temp();
    const old = session(dir, "/w", ["話"]);
    runHook(input("SessionEnd", { reason: "clear" }, "/w", old), T0, dir);
    for (const source of ["startup", "resume", "compact"]) {
      expect(runHook(input("SessionStart", { source }, "/w"), after(1000), dir)).toBe("");
    }
  });
});

describe("壊れた入力でも落ちない", () => {
  it("JSONでない・空・項目が欠けている入力は、黙って何も出さない", () => {
    const dir = temp();
    for (const raw of ["", "not json", "[]", "{}", JSON.stringify({ hook_event_name: "SessionStart" })]) {
      expect(parseHookInput(raw)).toBeNull();
      expect(runHook(raw, T0, dir)).toBe("");
    }
  });

  it("記録の場所が空なら控えない", () => {
    const dir = temp();
    runHook(input("SessionEnd", { reason: "clear" }, "/w", ""), T0, dir);
    expect(existsSync(slotFor("/w", dir))).toBe(false);
  });

  it("控えた記録が消えていたら出さない", () => {
    const dir = temp();
    runHook(input("SessionEnd", { reason: "clear" }, "/w", join(dir, "gone.jsonl")), T0, dir);
    expect(runHook(input("SessionStart", { source: "clear" }, "/w"), after(1000), dir)).toBe("");
  });
});

describe("/clear を重ねても最初の会話が落ちない", () => {
  it("フックが入れた文脈（添付として記録される）を、次の引き継ぎで発話に開く", async () => {
    const { buildContext } = await import("../src/context.ts");
    const dir = temp();
    const first = session(dir, "/w", ["合言葉はたぬき。覚えておいて"]);
    runHook(input("SessionEnd", { reason: "clear" }, "/w", first), T0, dir);
    const injected = runHook(input("SessionStart", { source: "clear" }, "/w"), after(1000), dir);
    // 2つ目の会話の記録: フックの出力は attachment、本人の発話は user 行（実測の形）
    const second = join(dir, "second.jsonl");
    const rows = [
      { type: "attachment", sessionId: "new", cwd: "/w", timestamp: "2026-09-18T12:00:01Z", attachment: { type: "hook_success", hookEvent: "SessionStart", stdout: injected } },
      { type: "user", sessionId: "new", cwd: "/w", promptSource: "typed", message: { role: "user", content: "合言葉は？" } },
    ];
    writeFileSync(second, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    const out = buildContext(second) ?? "";
    expect(out).toContain("合言葉はたぬき。覚えておいて");
    expect(out).toContain("合言葉は？");
    expect(out.indexOf("覚えておいて")).toBeLessThan(out.indexOf("合言葉は？"));
    // 見出しが二重にならない＝入れ子のまま持ち越していない
    expect(out.split("# 前の会話の記録").length - 1).toBe(1);
  });

  it("relayの文脈でないフック出力は、本人の発話にしない", async () => {
    const { buildContext } = await import("../src/context.ts");
    const dir = temp();
    const path = join(dir, "other.jsonl");
    const rows = [
      { type: "attachment", sessionId: "s", cwd: "/w", attachment: { type: "hook_success", stdout: "caffeinate started" } },
      { type: "user", sessionId: "s", cwd: "/w", promptSource: "typed", message: { role: "user", content: "本人の言葉" } },
    ];
    writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    expect(buildContext(path) ?? "").not.toContain("caffeinate started");
  });
});
