import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createBoard } from "../src/board.ts";
import { BOARD_USAGE, failureText, runBoard } from "../src/board-cli.ts";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-10-31T12:00:00Z");

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-board-cli-"));
  temps.push(dir);
  let tick = 0;
  const board = createBoard(dir, {
    id: () => `00000000-0000-4000-8000-${String((tick += 1)).padStart(12, "0")}`,
    now: () => new Date(NOW - 60_000 + tick * 1000).toISOString(),
  });
  const out: string[] = [];
  const err: string[] = [];
  const run = (...args: string[]): number =>
    runBoard(args, board, NOW, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { run, out, err };
};

describe("relay board", () => {
  it("post で書いて、read で読める（MCP を使わない Dots 向け）", () => {
    const { run, out } = setup();
    expect(run("post", "--from", "ちゃま", "--to", "Claude Code", "動画の続きを", "お願い")).toBe(0);
    expect(run("read", "--to", "Claude Code")).toBe(0);
    expect(out.join("")).toContain("ちゃま → Claude Code | 動画の続きを お願い");
  });

  it("read --to は自分あてと全員あてだけを出す", () => {
    const { run, out } = setup();
    run("post", "--from", "ちゃま", "--to", "Muse", "Museへ");
    run("post", "--from", "ちゃま", "みんなへ");
    out.length = 0;
    run("read", "--to", "Claude Code");
    const text = out.join("");
    expect(text).toContain("みんなへ");
    expect(text).not.toContain("Museへ");
  });

  it("--since より後の分だけを出す", () => {
    const { run, out } = setup();
    run("post", "--from", "ちゃま", "古い伝言");
    out.length = 0;
    run("read", "--since", new Date(NOW).toISOString());
    expect(out.join("")).toContain("伝言はありません");
  });

  it.each([
    ["サブコマンドが無い", []],
    ["知らないサブコマンド", ["list"]],
    ["--from が無い", ["post", "こんにちは"]],
    ["伝言が無い", ["post", "--from", "ちゃま"]],
    ["知らない指定", ["read", "--all"]],
    ["値の無い指定", ["read", "--to"]],
  ])("%s なら使い方を出して 2 で終わる", (_label, args) => {
    const { run, err } = setup();
    expect(run(...args)).toBe(2);
    expect(err.join("")).toBe(BOARD_USAGE);
  });

  it("--hours が正の数でなければ断る", () => {
    const { run, err } = setup();
    expect(run("read", "--hours", "-1")).toBe(2);
    expect(err.join("")).toContain("--hours は正の数");
  });
});

describe("relay board を入口（bin/relay.js）から呼ぶ", () => {
  it("board を cli に回し、書いて読める", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-board-bin-"));
    temps.push(dir);
    const env = { ...process.env, SESSION_RELAY_BOARD_DIR: dir };
    const posted = spawnSync(process.execPath, ["bin/relay.js", "board", "post", "--from", "ちゃま", "入口から"], {
      encoding: "utf8",
      env,
    });
    expect(posted.status).toBe(0);
    const read = spawnSync(process.execPath, ["bin/relay.js", "board", "read", "--hours", "1"], { encoding: "utf8", env });
    expect(read.status).toBe(0);
    expect(read.stdout).toContain("ちゃま → all | 入口から");
  }, 20_000);
});

describe("書けなかったときの理由", () => {
  const withCode = (code: string): Error => Object.assign(new Error(`${code}: /Users/someone/.local/share/x`), { code });

  it.each(["EPERM", "EACCES", "EROFS"])("%s は、書き込みを止められたと分かる言葉にし、パスは出さない", (code) => {
    const text = failureText(withCode(code));
    expect(text).toContain(`（${code}）`);
    expect(text).toContain("書き込みを止められています");
    expect(text).not.toContain("/Users/someone");
  });

  it("ほかのファイルの失敗は、コードだけ添える", () => {
    expect(failureText(withCode("ENOSPC"))).toBe("保存に失敗しました（ENOSPC）");
  });

  it("自分で投げた検証のエラーは、そのまま出す", () => {
    expect(failureText(new Error("伝言が空です"))).toBe("伝言が空です");
  });
});
