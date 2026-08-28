/**
 * 本物のMCPクライアントで `relay mcp` に繋いで確かめる。
 *
 * 中身の入った呼び出し（list_projects など）はここでは叩かない——記録を数千本
 * 走査するので、テストが数秒に膨らむ。ここで守りたいのは「起動して、MCPとして
 * 話して、道具が見えること」。データの中身は実データで手を動かして確かめる。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, expect, it } from "vitest";

const client = new Client({ name: "test", version: "0" });

beforeAll(async () => {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-strip-types", "src/mcp-main.ts"],
      cwd: process.cwd(),
    }),
  );
}, 20_000);

afterAll(async () => {
  await client.close();
});

it("stdioで繋がって、3つの道具が見える", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "get_context",
    "list_conversations",
    "list_projects",
  ]);
});

it("get_context は引数なしで呼べる（「続きから」がそのまま通るため）", async () => {
  const { tools } = await client.listTools();
  const context = tools.find((tool) => tool.name === "get_context");
  expect(context?.inputSchema.required ?? []).toEqual([]);
});

it("「続きから」がプロンプトとしても出ている", async () => {
  const { prompts } = await client.listPrompts();
  expect(prompts.map((prompt) => prompt.name)).toContain("resume");
});
