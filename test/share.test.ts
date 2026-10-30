import { describe, expect, it } from "vitest";
import { RELAY_HEADER } from "../src/relay-block.ts";
import { SHARE_RECENT_TURNS, SHARE_TURN_CHARS, toShareable } from "../src/share.ts";

const HOME = "/Users/someone";
// 鍵の形をした文字列はリポジトリに直書きしない（redact.test.ts と同じ理由）
const fakeKey = `ghp_${"z".repeat(36)}`;

/** context.ts が書く形に合わせた文脈 */
const context = (utterances: readonly string[], turns: readonly string[]): string =>
  [
    RELAY_HEADER,
    "これは同じ人物の直前までの会話です。話が途切れないように、ここから続けてください。",
    "",
    `作業場所: ${HOME}/work/voice-particles (branch: main)`,
    "期間: 2026-09-22T14:32:52.172Z 〜 2026-09-25T17:08:10.185Z",
    "",
    "## 本人が実際に打った言葉（時系列・全件）",
    ...utterances.map((u, i) => `${String(i + 1)}. ${u}`),
    "",
    "## 直近の経過（AIが各ターンの最後に報告したこと・原文・最後の10ターン）",
    ...turns.map((t, i) => `${String(i + 1)}. ${t}`),
    "",
    "## 触ったファイル",
    `- ${HOME}/work/voice-particles/src/app.ts`,
    "",
    "## 実行したコマンド（後半20件）",
    `- rsync -a ${HOME}/a ${HOME}/b`,
    "",
  ].join("\n");

const shared = (utterances: readonly string[], turns: readonly string[] = ["できました"]): string => {
  const out = toShareable(context(utterances, turns), HOME);
  if (out === null) throw new Error("relay の文脈として読めなかった");
  return out;
};

describe("共有用に書き出す", () => {
  it("本人の言葉は全部、順番どおりに残す", () => {
    const out = shared(["粒子で形を作りたい", "日本語で", "元の動画をダウンロードに入れて"]);
    expect(out).toContain("1. 粒子で形を作りたい\n2. 日本語で\n3. 元の動画をダウンロードに入れて");
  });

  it("手元のパスは ~ にし、作業場所はフォルダの名前とブランチだけにする", () => {
    const out = shared([`${HOME}/work/voice-particles/README.md を見て`]);
    expect(out).toContain("1. ~/work/voice-particles/README.md を見て");
    expect(out).toContain("作業: voice-particles（branch: main）");
    expect(out).not.toContain(HOME);
  });

  it("触ったファイルと実行したコマンドの節は出さない", () => {
    const out = shared(["見て"]);
    expect(out).not.toContain("## 触ったファイル");
    expect(out).not.toContain("## 実行したコマンド");
    expect(out).not.toContain("rsync");
  });

  it("画像の置き場所は [画像] にする", () => {
    const out = shared([`[Image: source: /private/tmp/abc/images/1.webp]`, "これで"]);
    expect(out).toContain("1. [画像]\n2. これで");
    expect(out).not.toContain("/private/tmp");
  });

  it("本人が打ったコマンドと、その出力は [コマンドの実行] にする", () => {
    const typed = `<bash-input>gh pr merge 19</bash-input><bash-stdout>✓ Merged</bash-stdout><bash-stderr></bash-stderr>`;
    const out = shared([typed, "マージした"]);
    expect(out).toContain("1. [コマンドの実行]\n2. マージした");
    expect(out).not.toContain("gh pr merge");
  });

  it(`AIの報告は最後の${String(SHARE_RECENT_TURNS)}ターンだけ残す`, () => {
    const out = shared(["続けて"], ["一つ目", "二つ目", "三つ目", "四つ目", "五つ目"]);
    expect(out).toContain("1. 三つ目\n2. 四つ目\n3. 五つ目");
    expect(out).not.toContain("二つ目");
  });

  it(`長い報告は${String(SHARE_TURN_CHARS)}字で切って、切ったと分かるようにする`, () => {
    const out = shared(["続けて"], ["あ".repeat(SHARE_TURN_CHARS + 50)]);
    expect(out).toContain(`1. ${"あ".repeat(SHARE_TURN_CHARS)}…（以下略）`);
  });

  it("鍵は伏せる", () => {
    const out = shared([`このトークンで ${fakeKey}`], [`${fakeKey} で push した`]);
    expect(out).not.toContain(fakeKey);
    expect(out).toContain("1. このトークンで [伏せた: GitHubのトークン]");
  });

  it("共有用に書き出したことと、何を外したかを冒頭に書く", () => {
    const out = shared(["見て"]);
    expect(out.startsWith("# 前の会話（共有用）")).toBe(true);
    expect(out).toContain("手元のパス・画像の置き場所・コマンドの中身は外しています");
  });

  it("relay の文脈でなければ null を返す（勝手に別の形に作り替えない）", () => {
    expect(toShareable("ただの文章", HOME)).toBeNull();
  });
});
