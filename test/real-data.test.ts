/**
 * 実データでの検証。
 * 手元にセッション記録があるときだけ走る（無ければskip）。
 * 実セッションは鍵や個人情報を含むためリポジトリには入れない。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSession, humanUtterances, parseJsonl } from "../src/extract.ts";

function findJsonl(root: string, depth = 3): string[] {
  if (!existsSync(root) || depth < 0) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...findJsonl(path, depth - 1));
    else if (entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}

const biggest = (paths: string[]): string | null =>
  paths.length === 0
    ? null
    : paths.reduce((a, b) => (statSync(a).size >= statSync(b).size ? a : b));

const claudeFiles = findJsonl(join(homedir(), ".claude", "projects"), 1);
const codexFiles = findJsonl(join(homedir(), ".codex", "sessions"), 4);

describe.skipIf(claudeFiles.length === 0)("実データ: Claude Code", () => {
  const path = biggest(claudeFiles) ?? "";
  const raw = path === "" ? "" : readFileSync(path, "utf8");

  it("最大のセッションを射影できる", () => {
    const record = extractSession(raw);
    expect(record?.harness).toBe("claude-code");
    expect(record?.sessionId).not.toBe(null);
    expect(record).not.toBe(null);
    if (record !== null) expect(humanUtterances(record).length).toBeGreaterThan(0);
  });

  it("★回帰: contentが文字列の発話を、実データでも取りこぼさない", () => {
    // 実データから「文字列content」の発話を1つ独立に見つける
    let stringFormText: string | null = null;
    for (const row of parseJsonl(raw)) {
      if (row["type"] !== "user") continue;
      const message: unknown = row["message"];
      if (typeof message !== "object" || message === null) continue;
      const content: unknown = Object.getOwnPropertyDescriptor(message, "content")?.value;
      if (typeof content === "string" && content.length > 0) {
        stringFormText = content;
        break;
      }
    }
    // 実データにこの形が存在すること自体が、この分岐が必要な理由
    expect(stringFormText).not.toBe(null);
    // 抽出結果がそれを含むこと（文字列分岐を消すとここで落ちる）
    const record = extractSession(raw);
    const texts = record?.utterances.map((u) => u.text) ?? [];
    expect(texts).toContain(stringFormText);
  });

  it("発話に空文字が混ざらない", () => {
    const record = extractSession(raw);
    expect(record?.utterances.every((u) => u.text.length > 0)).toBe(true);
  });

  it("時系列が壊れていない（開始 <= 終了）", () => {
    const record = extractSession(raw);
    if (record?.startedAt != null && record.endedAt != null) {
      expect(record.startedAt <= record.endedAt).toBe(true);
    }
  });
});

describe.skipIf(codexFiles.length === 0)("実データ: Codex", () => {
  it("Codexのセッションも同じ形に射影できる", () => {
    const path = biggest(codexFiles) ?? "";
    const record = extractSession(readFileSync(path, "utf8"));
    expect(record?.harness).toBe("codex");
    expect(record?.utterances.length).toBeGreaterThan(0);
  });
});
