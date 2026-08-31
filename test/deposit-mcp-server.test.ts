/** 書き込み専用MCPに、本物のMCPクライアントから預けて確かめる。 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createInbox } from "../src/inbox.ts";

const root = mkdtempSync(join(tmpdir(), "session-relay-deposit-mcp-"));
const inboxDir = join(root, "inbox");
const client = new Client({ name: "deposit-test", version: "0" });
const reader = new Client({ name: "reader-test", version: "0" });
const childEnvironment = { ...getDefaultEnvironment(), SESSION_RELAY_INBOX_DIR: inboxDir };

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["bin/relay.js", "mcp-deposit"],
      cwd: process.cwd(),
      env: childEnvironment,
    }),
  );
  await reader.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-strip-types", "src/mcp-main.ts"],
      cwd: process.cwd(),
      env: childEnvironment,
    }),
  );
}, 20_000);

afterAll(async () => {
  await client.close();
  await reader.close();
  rmSync(root, { recursive: true, force: true });
});

it("外向きMCPには預ける道具しか見えない", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toEqual(["deposit_conversation"]);
});

it("MCP越しに預けた本人の原文をMac側で読める", async () => {
  const result = await client.callTool({
    name: "deposit_conversation",
    arguments: {
      title: "スマホで考えた記事",
      source: "claude-mobile",
      user_messages: ["これを記事にしたい", "数字は載せない"],
      progress: ["構成を三段にした"],
    },
  });

  expect(result.isError).not.toBe(true);
  const saved = createInbox(inboxDir).get();
  expect(saved?.userMessages).toEqual(["これを記事にしたい", "数字は載せない"]);
  expect(saved?.progress).toEqual(["構成を三段にした"]);

  const received = await reader.callTool({ name: "get_deposit", arguments: {} });
  const parsed = z
    .object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) })
    .safeParse(received);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("get_depositの返答がテキストではありません");
  const text = parsed.data.content[0]?.text;
  expect(text).toContain("1. これを記事にしたい");
  expect(text).toContain("2. 数字は載せない");
  expect(text).toContain("1. 構成を三段にした");
});
