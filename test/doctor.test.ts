/** relay doctor — 登録と生存の検査。実環境は触らず、作ったtmpホームで確かめる。 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { collectChecks } from "../src/doctor.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-relay-doctor-"));
  roots.push(dir);
  return dir;
}

it("ハーネスが無ければそう言う", async () => {
  const checks = await collectChecks(home(), 1);
  expect(checks.map((c) => c.name)).toEqual(["ハーネス"]);
  expect(checks[0]?.ok).toBe(false);
});

it("登録漏れとスキル欠けを検出し、揃っていれば通す", async () => {
  const h = home();
  mkdirSync(join(h, ".claude", "skills", "relay"), { recursive: true });
  writeFileSync(join(h, ".claude.json"), JSON.stringify({ mcpServers: { relay: {} } }));
  mkdirSync(join(h, ".codex"), { recursive: true }); // Codexはあるが未登録
  const checks = await collectChecks(h, 1);
  const by = new Map(checks.map((c) => [c.name, c.ok]));
  expect(by.get("Claude CodeのMCP登録")).toBe(true);
  expect(by.get("Claude Codeのスキル")).toBe(true);
  expect(by.get("CodexのMCP登録")).toBe(false);
  expect(by.get("Codexのスキル")).toBe(false);
});

it("投函口は使っている人にだけ検査し、生死を実測する", async () => {
  const h = home();
  mkdirSync(join(h, ".claude"), { recursive: true });
  mkdirSync(join(h, ".config", "session-relay"), { recursive: true });
  const server = createServer((_request, response) => {
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("port不明");
  const alive = await collectChecks(h, address.port);
  expect(alive.find((c) => c.name.startsWith("投函口"))?.ok).toBe(true);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  const dead = await collectChecks(h, address.port);
  expect(dead.find((c) => c.name.startsWith("投函口"))?.ok).toBe(false);
});
