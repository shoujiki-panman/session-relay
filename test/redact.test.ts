import { describe, expect, it } from "vitest";
import { renderDeposit } from "../src/inbox.ts";
import { redactSecrets } from "../src/redact.ts";

// 鍵の形をした文字列をリポジトリに直書きしない（GitHubの秘密検査や他の道具に本物と誤認されるため）。
// テストの中で組み立てる。
const run = (char: string, length: number): string => char.repeat(length);
const fake = {
  anthropic: `sk-ant-api03-${run("a", 40)}`,
  openai: `sk-proj-${run("B", 48)}`,
  github: `ghp_${run("c", 36)}`,
  githubPat: `github_pat_${run("D", 30)}`,
  npm: `npm_${run("e", 36)}`,
  aws: `AKIA${run("F", 16)}`,
  google: `AIza${run("g", 35)}`,
  slack: `xoxb-${run("1", 12)}-${run("h", 20)}`,
  stripe: `sk_live_${run("I", 24)}`,
  jwt: `eyJ${run("j", 20)}.eyJ${run("k", 20)}.${run("l", 30)}`,
  pem: ["-----BEGIN RSA PRIVATE KEY-----", run("M", 64), "-----END RSA PRIVATE KEY-----"].join("\n"),
};

describe("redactSecrets", () => {
  it.each([
    ["Anthropicの鍵", fake.anthropic],
    ["OpenAIの鍵", fake.openai],
    ["GitHubのトークン", fake.github],
    ["GitHubのトークン", fake.githubPat],
    ["npmのトークン", fake.npm],
    ["AWSの鍵", fake.aws],
    ["Googleの鍵", fake.google],
    ["Slackのトークン", fake.slack],
    ["Stripeの鍵", fake.stripe],
    ["JWT", fake.jwt],
    ["秘密鍵", fake.pem],
  ])("%s を伏せる", (kind, secret) => {
    const out = redactSecrets(`この鍵を使って: ${secret} で試した`);
    expect(out).toBe(`この鍵を使って: [伏せた: ${kind}] で試した`);
  });

  it("Anthropicの鍵を OpenAI の鍵と取り違えない（sk-ant- を先に当てる）", () => {
    expect(redactSecrets(fake.anthropic)).toBe("[伏せた: Anthropicの鍵]");
  });

  it("Bearer の後ろだけを伏せ、Bearer という語は残す", () => {
    const header = `Authorization: Bearer ${run("t", 32)}`;
    expect(redactSecrets(header)).toBe("Authorization: Bearer [伏せた: Bearerトークン]");
  });

  it("1つの文に複数あれば全部伏せる", () => {
    const out = redactSecrets(`${fake.github} と ${fake.aws}`);
    expect(out).toBe("[伏せた: GitHubのトークン] と [伏せた: AWSの鍵]");
  });

  it("何度かけても同じ結果になる", () => {
    const once = redactSecrets(`${fake.openai} / Bearer ${fake.jwt}`);
    expect(redactSecrets(once)).toBe(once);
  });

  it.each([
    "sk-learn を入れた",
    "skills/relay/SKILL.md を直した",
    "コミット a5375be4c1f0e9d2b7a6c3e8f1d0b9a8c7e6f5d4 を見た",
    "ref 7d96d293-975a-48b9-8648-4b971db826d8",
    "AKIA だけでは鍵ではない",
    "ghp_short",
    "Bearer token の話をしているだけ",
    "パスワード=のような言葉では伏せない",
    "TYPESAFE_API_KEY を入れた人だけ",
  ])("鍵ではないものは変えない: %s", (text) => {
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("預けた会話を渡すとき", () => {
  it("本人が貼った鍵を伏せてから渡す", () => {
    const text = renderDeposit({
      id: "7d96d293-975a-48b9-8648-4b971db826d8",
      title: "鍵の試し",
      source: "other",
      createdAt: "2026-10-30T00:00:00.000Z",
      userMessages: [`このキーで動かして ${fake.openai}`],
      progress: [`${fake.github} で push した`],
      shape: 1,
    });
    expect(text).toContain("このキーで動かして [伏せた: OpenAIの鍵]");
    expect(text).toContain("[伏せた: GitHubのトークン] で push した");
    expect(text).not.toContain(fake.openai);
    expect(text).not.toContain(fake.github);
  });
});
