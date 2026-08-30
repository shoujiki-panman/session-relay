import { describe, expect, it } from "vitest";
import { USAGE, unknownArg, wantsHelp } from "../src/usage.ts";

describe("打ち間違いを黙って通さない", () => {
  it("知らないフラグを返す（これが無いと --lst が会話を起動していた）", () => {
    expect(unknownArg(["--lst"])).toBe("--lst");
  });

  it("--help も -h も help も、使い方を出す合図として拾う", () => {
    expect(wantsHelp(["--help"])).toBe(true);
    expect(wantsHelp(["-h"])).toBe(true);
    expect(wantsHelp(["help"])).toBe(true);
    expect(wantsHelp(["--print"])).toBe(false);
  });

  it("値を取るフラグの直後は値なので叱らない", () => {
    expect(unknownArg(["--in", "mulmoclaude"])).toBeNull();
    expect(unknownArg(["--from", "01a00143"])).toBeNull();
    expect(unknownArg(["--projects", "20"])).toBeNull();
    expect(unknownArg(["--to", "codex"])).toBeNull();
  });

  it("宙に浮いた言葉も返す（relay mulmo のつもりで会話が起動しない）", () => {
    expect(unknownArg(["mulmo"])).toBe("mulmo");
  });

  it("値を取らないフラグの後ろの言葉は、値ではないので返す", () => {
    expect(unknownArg(["--print", "mulmo"])).toBe("mulmo");
  });

  it("正しい組み合わせは通す", () => {
    expect(unknownArg([])).toBeNull();
    expect(unknownArg(["--print", "--previous"])).toBeNull();
    expect(unknownArg(["--list", "--in", "relay", "--all"])).toBeNull();
    expect(unknownArg(["--pick", "mulmo", "--all"])).toBeNull();
  });

  it("使い方には、実際に打てる形が並んでいる", () => {
    expect(USAGE).toContain("relay --projects");
    expect(USAGE).toContain("relay mcp");
    expect(USAGE).toContain("relay install");
  });
});
