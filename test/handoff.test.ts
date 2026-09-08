/** 「次はこの会話」の印。押した側が名指しするので、受け取る側は当て推量をしない。 */
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HANDOFF_TTL_MS, type Handoff, clearHandoff, peekHandoff, putHandoff } from "../src/handoff.ts";
import { markedContext } from "../src/query.ts";
import { isRelayContext, parseRelayContext } from "../src/relay-block.ts";
import { buildContext } from "../src/context.ts";
import { runMark, runMarkCommand, runMarkShow } from "../src/mark-cli.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const temp = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
};

const row = (o: unknown): string => JSON.stringify(o);

const session = (cwd: string, texts: readonly string[]): string =>
  texts
    .map((text) =>
      row({
        type: "user",
        sessionId: "s",
        cwd,
        promptSource: "typed",
        origin: { kind: "human" },
        timestamp: "2026-09-08T00:00:00Z",
        message: { role: "user", content: text },
      }),
    )
    .join("\n");

/** 偽のセッション置き場。`<root>/-w/<name>.jsonl` に置く（Claude Codeと同じ形） */
const fakeRoot = (files: Readonly<Record<string, readonly string[]>>, cwd = "/w"): string => {
  const root = temp("relay-handoff-root-");
  const dir = join(root, "-w");
  mkdirSync(dir);
  let ageMs = 0;
  for (const [name, texts] of Object.entries(files)) {
    const path = join(dir, `${name}.jsonl`);
    writeFileSync(path, session(cwd, texts), "utf8");
    const when = new Date(Date.now() - ageMs);
    utimesSync(path, when, when);
    ageMs += 10_000;
  }
  return root;
};

const markFile = (): string => join(temp("relay-handoff-"), "handoff");

const mark = (over: Partial<Handoff> = {}): Handoff => ({
  at: new Date().toISOString(),
  id: "",
  path: "",
  cwd: "/w",
  topic: "前の話",
  ...over,
});

const someFile = (): string => {
  const path = join(temp("relay-handoff-target-"), "a.jsonl");
  writeFileSync(path, session("/w", ["前の話"]), "utf8");
  return path;
};

describe("印の読み書き", () => {
  it("正常系: 置いた印がそのまま読める", () => {
    const file = markFile();
    const path = someFile();
    putHandoff(mark({ path, id: "abc", topic: "地図の話" }), file);
    const got = peekHandoff(new Date(), file);
    expect(got?.path).toBe(path);
    expect(got?.id).toBe("abc");
    expect(got?.topic).toBe("地図の話");
  });

  it("正常系: 押し直すと上書きされる（押し間違いの取り消しになる）", () => {
    const file = markFile();
    const first = someFile();
    const second = someFile();
    putHandoff(mark({ path: first }), file);
    putHandoff(mark({ path: second }), file);
    expect(peekHandoff(new Date(), file)?.path).toBe(second);
  });

  it("正常系: 印は本人しか読めない権限で書く（0600）", () => {
    const file = markFile();
    putHandoff(mark({ path: someFile() }), file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("Edge: 印が無ければ null（読むだけで作らない）", () => {
    expect(peekHandoff(new Date(), markFile())).toBeNull();
  });

  it("Edge: 期限を過ぎた印は無視する（忘れられた印に翌日を乗っ取らせない）", () => {
    const file = markFile();
    const path = someFile();
    const now = new Date();
    putHandoff(mark({ path, at: new Date(now.getTime() - HANDOFF_TTL_MS - 1000).toISOString() }), file);
    expect(peekHandoff(now, file)).toBeNull();
    // 境界のすぐ内側はまだ効く
    putHandoff(mark({ path, at: new Date(now.getTime() - HANDOFF_TTL_MS + 1000).toISOString() }), file);
    expect(peekHandoff(now, file)?.path).toBe(path);
  });

  it("Edge: 指す記録が消えていたら null（空の文脈を渡さない）", () => {
    const file = markFile();
    putHandoff(mark({ path: join(tmpdir(), "いない.jsonl") }), file);
    expect(peekHandoff(new Date(), file)).toBeNull();
  });

  it("Error: 壊れた印でも落ちない", () => {
    const file = markFile();
    writeFileSync(file, "{これはJSONではない", "utf8");
    expect(peekHandoff(new Date(), file)).toBeNull();
  });

  it("Error: 形は合っていても path が無ければ印として扱わない", () => {
    const file = markFile();
    writeFileSync(file, row({ at: new Date().toISOString(), topic: "path無し" }), "utf8");
    expect(peekHandoff(new Date(), file)).toBeNull();
  });

  it("Corner: 消した印は残らない。無い印を消しても落ちない", () => {
    const file = markFile();
    putHandoff(mark({ path: someFile() }), file);
    clearHandoff(file);
    expect(peekHandoff(new Date(), file)).toBeNull();
    expect(() => {
      clearHandoff(file);
    }).not.toThrow();
  });
});

describe("markedContext: 受け取る側が印を拾う", () => {
  it("正常系: 印がついた会話の原文が返り、印は消える", () => {
    const file = markFile();
    const path = someFile();
    putHandoff(mark({ path, topic: "前の話" }), file);
    const got = markedContext("/別の場所", {}, new Date(), file);
    expect(got?.path).toBe(path);
    expect(got?.context).toContain("前の話");
    // 一度拾われたら消える（後の無関係な「続きから」が掴まないように）
    expect(peekHandoff(new Date(), file)).toBeNull();
    expect(markedContext("/別の場所", {}, new Date(), file)).toBeNull();
  });

  it("Corner: 印を置いた本人が読もうとしたら無視する（自分を読み返さない）", () => {
    const file = markFile();
    putHandoff(mark({ path: someFile(), id: "mine" }), file);
    expect(markedContext("/w", { CLAUDE_CODE_SESSION_ID: "mine" }, new Date(), file)).toBeNull();
    // 無視しただけなので印は残る。別のセッションが拾える
    expect(markedContext("/w", { CLAUDE_CODE_SESSION_ID: "他" }, new Date(), file)?.context).toContain("前の話");
  });

  it("Edge: 印が無ければ null（呼んだ側は当て推量に落ちる）", () => {
    expect(markedContext("/w", {}, new Date(), markFile())).toBeNull();
  });
});

describe("relay mark: 押す側", () => {
  it("正常系: IDが分かっていれば、その会話に印がつく", () => {
    const file = markFile();
    const root = fakeRoot({ mine: ["いま話している内容"], other: ["別の会話"] });
    expect(runMark("/w", { CLAUDE_CODE_SESSION_ID: "mine" }, [root], file)).toBe(0);
    const got = peekHandoff(new Date(), file);
    expect(got?.path.endsWith("mine.jsonl")).toBe(true);
    expect(got?.id).toBe("mine");
    expect(got?.cwd).toBe("/w");
    expect(got?.topic).toBe("いま話している内容");
  });

  it("Corner: 同じ場所で会話が2つ動いていても、IDが分かれば取り違えない", () => {
    const file = markFile();
    // newest の方が新しい。当て推量だとこちらを掴む
    const root = fakeRoot({ newest: ["新しい方"], mine: ["こちらに印をつけたい"] });
    runMark("/w", { CLAUDE_CODE_SESSION_ID: "mine" }, [root], file);
    expect(peekHandoff(new Date(), file)?.topic).toBe("こちらに印をつけたい");
  });

  it("Edge: この場所に会話が無ければ印をつけず 1 を返す", () => {
    const file = markFile();
    expect(runMark("/どこでもない", {}, [temp("relay-empty-")], file)).toBe(1);
    expect(peekHandoff(new Date(), file)).toBeNull();
  });

  it("正常系: 押した会話は、別の場所の新しいセッションからでも拾える", () => {
    const file = markFile();
    const root = fakeRoot({ mine: ["この続きをやりたい"] });
    runMark("/w", { CLAUDE_CODE_SESSION_ID: "mine" }, [root], file);
    const got = markedContext("/まったく別のリポジトリ", { CLAUDE_CODE_SESSION_ID: "新しい方" }, new Date(), file);
    expect(got?.context).toContain("この続きをやりたい");
  });
});

describe("relay mark --recent: cwdを持たない入口（Raycast等）", () => {
  it("正常系: 場所を問わず、最後に人が打った会話に印がつく", () => {
    const file = markFile();
    // fakeRoot は先頭ほど新しい（10秒ずつ古くしている）
    const root = fakeRoot({ newest: ["ついさっき話していた"], older: ["もっと前"] });
    // cwd はホーム相当＝会話が1本も無い場所。--recent 無しでは失敗する場所
    expect(runMark("/会話の無い場所", {}, [root], file, new Date(), true)).toBe(0);
    expect(peekHandoff(new Date(), file)?.topic).toBe("ついさっき話していた");
  });

  it("Corner: --recent は場所を問わないので、cwdが違っても失敗しない", () => {
    const file = markFile();
    const root = fakeRoot({ mine: ["どこからでも拾える"] }, "/w");
    expect(runMark("/まったく別の場所", {}, [root], file, new Date(), false)).toBe(1);
    expect(runMark("/まったく別の場所", {}, [root], file, new Date(), true)).toBe(0);
  });

  it("Corner: --recent の印には id を書かない（押した人の会話とは限らないため）", () => {
    const file = markFile();
    const root = fakeRoot({ mine: ["最後の会話"] });
    runMark("/w", { CLAUDE_CODE_SESSION_ID: "押した人" }, [root], file, new Date(), true);
    expect(peekHandoff(new Date(), file)?.id).toBe("");
  });

  it("Corner: 印の場所は会話自身のcwd（gitの欄をそこから採るため）", () => {
    const file = markFile();
    const root = fakeRoot({ mine: ["会話の場所は /w"] }, "/w");
    runMark("/押した場所は別", {}, [root], file, new Date(), true);
    expect(peekHandoff(new Date(), file)?.cwd).toBe("/w");
  });

  it("Edge: 記録が1つも無ければ印をつけず 1 を返す", () => {
    const file = markFile();
    expect(runMark("/w", {}, [temp("relay-empty-recent-")], file, new Date(), true)).toBe(1);
    expect(peekHandoff(new Date(), file)).toBeNull();
  });
});

describe("印を確かめる口（押しても画面が変わらないので要る）", () => {
  it("正常系: 印があれば見出しを出して 0", () => {
    const file = markFile();
    putHandoff(mark({ path: someFile(), topic: "確かめたい話" }), file);
    expect(runMarkShow(file)).toBe(0);
  });

  it("Edge: 印が無ければ 1（フックから呼んでも黙って成功しない）", () => {
    expect(runMarkShow(markFile())).toBe(1);
  });
});

describe("relay mark の引数", () => {
  it("Error: 知らない指定は読み飛ばさず 2 を返す（別の会話に印がつくのを防ぐ）", () => {
    expect(runMarkCommand(["--recnt"])).toBe(2);
    expect(runMarkCommand(["--all"])).toBe(2);
  });
});

describe("印で来たことが見えるか（押しても拾われても画面が変わらないので）", () => {
  it("正常系: 印から読んだ文脈には、そう名乗る行が入る", () => {
    const file = markFile();
    putHandoff(mark({ path: someFile() }), file);
    const got = markedContext("/w", {}, new Date(), file);
    expect(got?.context).toContain("relay mark");
    expect(got?.context).toContain("📌");
  });

  it("Corner: 名乗る行を足しても、入れ子を畳む処理が効かなくならない", () => {
    const file = markFile();
    putHandoff(mark({ path: someFile() }), file);
    const context = markedContext("/w", {}, new Date(), file)?.context ?? "";
    // 見出しより前に足すと、ここが false になって入れ子が畳めなくなる
    expect(isRelayContext(context)).toBe(true);
    expect(parseRelayContext(context)?.utterances).toEqual(["前の話"]);
  });

  it("Corner: 印を使っていない普通の文脈には、その行を入れない", () => {
    const path = someFile();
    const plain = markedContext("/w", {}, new Date(), markFile());
    expect(plain).toBeNull();
    // 印なしで組み立てた文脈（buildContextFrom 経由と同じ形）には印の行が無い
    expect(buildContext(path)).not.toContain("relay mark");
  });
});
