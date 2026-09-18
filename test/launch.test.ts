import { describe, expect, it } from "vitest";
import { describeLaunch, destinationOf, launchArgs, valueOf } from "../src/launch.ts";

describe("渡す先とモデルを引数から決める", () => {
  it("何も言わなければ claude・モデルは既定に任せる", () => {
    expect(destinationOf([])).toEqual({ target: "claude", model: null });
  });

  it("--to と --model を順番を問わず拾う", () => {
    const want = { target: "codex", model: "gpt-5.6-luna" };
    expect(destinationOf(["--to", "codex", "--model", "gpt-5.6-luna"])).toEqual(want);
    expect(destinationOf(["--model", "gpt-5.6-luna", "--to", "codex"])).toEqual(want);
  });

  it("値が無い --model は無視する（次のフラグをモデル名にしない）", () => {
    expect(valueOf(["--model"], "--model")).toBeNull();
    expect(valueOf(["--model", "--print"], "--model")).toBeNull();
    expect(destinationOf(["--to", "codex", "--model"]).model).toBeNull();
  });
});

describe("起動の引数", () => {
  it("モデル指定なしなら文脈だけ（今までと同じ）", () => {
    expect(launchArgs({ target: "codex", model: null }, "文脈")).toEqual(["文脈"]);
  });

  it("モデル指定ありなら --model を前に置き、文脈は最後", () => {
    expect(launchArgs({ target: "codex", model: "gpt-5.6-luna" }, "文脈")).toEqual([
      "--model",
      "gpt-5.6-luna",
      "文脈",
    ]);
  });

  it("起動の知らせにモデル名を出す（どのモデルで開くか見えるように）", () => {
    expect(describeLaunch({ target: "codex", model: null })).toBe("codex");
    expect(describeLaunch({ target: "codex", model: "gpt-5.6-luna" })).toBe("codex（gpt-5.6-luna）");
  });
});
