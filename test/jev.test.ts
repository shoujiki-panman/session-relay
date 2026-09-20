/** 区切りの知らせを会話の中身で決める。鍵が無ければ何もせず、失敗したら今までどおりに倒す。 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ASKING_QUESTION,
  CLOSING_QUESTION,
  DEFAULT_CLOSING_MIN,
  DEFAULT_QUESTION_MAX,
  ENDPOINT,
  type FetchLike,
  jevOptions,
  looksLikeStoppingPoint,
  recentTurnsText,
} from "../src/jev.ts";
import { nudge } from "../src/nudge.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temp = (): string => {
  const root = mkdtempSync(join(tmpdir(), "relay-jev-"));
  roots.push(root);
  return root;
};

const OPTIONS = {
  key: "test-key",
  model: "jev-latest",
  closingMin: DEFAULT_CLOSING_MIN,
  questionMax: DEFAULT_QUESTION_MAX,
  timeoutMs: 1500,
};

const said = (role: "user" | "assistant", text: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: role, ...extra, message: { role, content: text } });

/** 答えを決め打ちする偽の fetch。送った本文も覗ける */
const fakeFetch = (
  answers: unknown,
  seen: { body?: unknown; url?: string; auth?: string | undefined } = {},
  status = 200,
): FetchLike =>
  (url, init) => {
    seen.url = url;
    seen.auth = new Headers(init.headers).get("Authorization") ?? undefined;
    seen.body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    return Promise.resolve(
      new Response(JSON.stringify({ model: "jev-1.13.0", answers }), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

const noul = (closing: number, question: number): unknown => ({
  ends_with_closing: { type: "noul", noul: closing },
  user_asked_question: { type: "noul", noul: question },
});

describe("記録の末尾を、話者つきの素のテキストにする", () => {
  it("本人とAIに印をつけて並べる", () => {
    const text = recentTurnsText([said("user", "これ直して"), said("assistant", "直しました")].join("\n"));
    expect(text).toBe("本人：これ直して\nAI：直しました");
  });

  it("下請け（サイドチェーン）と裏方の行は入れない", () => {
    const text = recentTurnsText(
      [
        said("user", "本題"),
        said("assistant", "下請けの返事", { isSidechain: true }),
        said("user", "裏方", { isMeta: true }),
      ].join("\n"),
    );
    expect(text).toBe("本人：本題");
  });

  it("注入された発話（system-reminder など）は本人の言葉として入れない", () => {
    const text = recentTurnsText(
      [said("user", "<system-reminder>お知らせ</system-reminder>"), said("user", "おやすみ")].join("\n"),
    );
    expect(text).toBe("本人：おやすみ");
  });

  it("直近の往復だけ渡す（余計な文脈を入れると精度が落ちる）", () => {
    const rows = ["1", "2", "3", "4", "5"].map((n) => said("user", n));
    expect(recentTurnsText(rows.join("\n"), 2)).toBe("本人：4\n本人：5");
  });

  it("長い発話は切り詰める", () => {
    const text = recentTurnsText(said("assistant", "あ".repeat(500)));
    expect(text.length).toBeLessThan(260);
    expect(text.endsWith("…")).toBe(true);
  });

  it("ブロックの配列でも本文を拾う", () => {
    const row = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "内心" }, { type: "text", text: "本文" }] },
    });
    expect(recentTurnsText(row)).toBe("AI：本文");
  });
});

describe("区切りかどうかを聞く", () => {
  it("あいさつで終わっていて質問もしていなければ true", async () => {
    expect(await looksLikeStoppingPoint("本人：了解。おやすみ", OPTIONS, fakeFetch(noul(0.97, 0.03)))).toBe(true);
  });

  it("質問で終わっていれば false", async () => {
    expect(await looksLikeStoppingPoint("本人：これどうなってる？", OPTIONS, fakeFetch(noul(0.04, 0.9)))).toBe(false);
  });

  it("あいさつでも、同時に質問していれば false", async () => {
    expect(await looksLikeStoppingPoint("本人：ありがとう。ついでにこれは？", OPTIONS, fakeFetch(noul(0.95, 0.8)))).toBe(false);
  });

  it("どちらでもない真ん中は false（迷ったら知らせない）", async () => {
    expect(await looksLikeStoppingPoint("本人：うーん", OPTIONS, fakeFetch(noul(0.5, 0.5)))).toBe(false);
  });

  it("鍵が無ければ何もしない（null）", async () => {
    const seen = {};
    expect(await looksLikeStoppingPoint("本人：おやすみ", { ...OPTIONS, key: "" }, fakeFetch(noul(0.97, 0.03), seen))).toBeNull();
    expect(seen).toEqual({});
  });

  it("渡す中身が空なら聞かない（null）", async () => {
    expect(await looksLikeStoppingPoint("", OPTIONS, fakeFetch(noul(0.97, 0.03)))).toBeNull();
  });

  it("200 以外が返ったら null", async () => {
    expect(await looksLikeStoppingPoint("本人：おやすみ", OPTIONS, fakeFetch(noul(0.97, 0.03), {}, 500))).toBeNull();
  });

  it("形が違えば null", async () => {
    expect(await looksLikeStoppingPoint("本人：おやすみ", OPTIONS, fakeFetch({ ends_with_closing: {} }))).toBeNull();
  });

  it("呼び出しが失敗しても落ちない（null）", async () => {
    const broken: FetchLike = () => Promise.reject(new Error("つながらない"));
    expect(await looksLikeStoppingPoint("本人：おやすみ", OPTIONS, broken)).toBeNull();
  });

  it("公式の形で送る: state / model / noul 2問と Bearer", async () => {
    const seen: { body?: unknown; url?: string; auth?: string | undefined } = {};
    await looksLikeStoppingPoint("本人：おやすみ", OPTIONS, fakeFetch(noul(0.97, 0.03), seen));
    expect(seen.url).toBe(ENDPOINT);
    expect(seen.auth).toBe("Bearer test-key");
    expect(seen.body).toEqual({
      state: "本人：おやすみ",
      model: "jev-latest",
      questions: {
        ends_with_closing: { type: "noul", instructions: CLOSING_QUESTION },
        user_asked_question: { type: "noul", instructions: ASKING_QUESTION },
      },
    });
  });
});

describe("設定", () => {
  it("鍵が無いときは空。しきい値は既定", () => {
    expect(jevOptions({})).toEqual({
      key: "",
      model: "jev-latest",
      closingMin: DEFAULT_CLOSING_MIN,
      questionMax: DEFAULT_QUESTION_MAX,
      timeoutMs: 1500,
    });
  });

  it("環境変数で変えられる。0〜1の外や壊れた値は既定に戻す", () => {
    const options = jevOptions({
      TYPESAFE_API_KEY: "k",
      RELAY_JEV_CLOSING_MIN: "0.6",
      RELAY_JEV_QUESTION_MAX: "9",
      RELAY_JEV_TIMEOUT_MS: "0",
    });
    expect(options.key).toBe("k");
    expect(options.closingMin).toBe(0.6);
    expect(options.questionMax).toBe(DEFAULT_QUESTION_MAX);
    expect(options.timeoutMs).toBe(1500);
  });
});

describe("知らせを出すかどうか（nudge と組み合わせる）", () => {
  const NOW = new Date("2026-09-20T02:00:00Z");
  const NUDGE_OPTIONS = { threshold: 300_000, step: 100_000 };

  const grown = (dir: string): string => {
    const path = join(dir, "t.jsonl");
    writeFileSync(
      path,
      [
        said("user", "これ調べて"),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", usage: { input_tokens: 10, cache_read_input_tokens: 320_000, cache_creation_input_tokens: 0, output_tokens: 5 } },
        }),
      ].join("\n"),
    );
    return path;
  };

  it("「途中」と言われたら黙る。段は進めないので、次の返事でまた見る", async () => {
    const dir = temp();
    const path = grown(dir);
    const middle = (): Promise<boolean | null> => Promise.resolve(false);
    expect(await nudge(path, "s", dir, NUDGE_OPTIONS, NOW, middle)).toBe("");
    // 段が進んでいないので、切れ目になったら出せる
    const stopping = (): Promise<boolean | null> => Promise.resolve(true);
    expect(await nudge(path, "s", dir, NUDGE_OPTIONS, NOW, stopping)).toContain("32万トークン");
  });

  it("判定できないとき（鍵が無い・失敗）は今までどおり出す", async () => {
    const dir = temp();
    const unknown = (): Promise<boolean | null> => Promise.resolve(null);
    expect(await nudge(grown(dir), "s", dir, NUDGE_OPTIONS, NOW, unknown)).toContain("32万トークン");
  });

  it("重さが足りなければ、中身は見に行かない", async () => {
    const dir = temp();
    const path = join(dir, "small.jsonl");
    writeFileSync(
      path,
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 5 } },
      }),
    );
    let asked = false;
    const gate = (): Promise<boolean | null> => {
      asked = true;
      return Promise.resolve(true);
    };
    expect(await nudge(path, "s", dir, NUDGE_OPTIONS, NOW, gate)).toBe("");
    expect(asked).toBe(false);
  });
});
