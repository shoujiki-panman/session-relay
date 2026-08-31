/** 公開用HTTPにも書き込み道具1つしか無く、Access JWT必須であることを確かめる。 */
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { depositPort, listenForDeposits } from "../src/deposit-http.ts";
import { createInbox } from "../src/inbox.ts";

const TOKEN = "signed-by-access";
const root = mkdtempSync(join(tmpdir(), "session-relay-deposit-http-"));
const inbox = createInbox(join(root, "inbox"));
const client = new Client({ name: "deposit-http-test", version: "0" });
const verifyAccess = (token: string): Promise<void> =>
  token === TOKEN ? Promise.resolve() : Promise.reject(new Error("invalid token"));

let endpoint = new URL("http://127.0.0.1/");
let server: Awaited<ReturnType<typeof listenForDeposits>>;

beforeAll(async () => {
  server = await listenForDeposits({ verifyAccess, inbox }, 0);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("HTTPポートを取得できません");
  endpoint = new URL(`http://127.0.0.1:${String(address.port)}/mcp`);
  await client.connect(
    // @ts-expect-error SDK 1.30のclient transportは sessionId が `string | undefined` で、
    // exactOptionalPropertyTypes の Transport と噛み合わない（実行時は問題ない）
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { "Cf-Access-Jwt-Assertion": TOKEN } },
    }),
  );
});

afterAll(async () => {
  await client.close();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  rmSync(root, { recursive: true, force: true });
});

/** Hostヘッダーだけを差し替えてPOSTし、状態コードを返す。 */
function postWithHost(host: string): Promise<number> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: Number(endpoint.port),
        path: "/mcp",
        method: "POST",
        headers: {
          Host: host,
          "Cf-Access-Jwt-Assertion": TOKEN,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": String(Buffer.byteLength(body)),
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          resolve(response.statusCode ?? 0);
        });
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

it("HTTP投函口には預ける道具しか見えない", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toEqual(["deposit_conversation"]);
});

it("HTTP越しに本人の原文を預ける", async () => {
  await client.callTool({
    name: "deposit_conversation",
    arguments: { source: "claude-mobile", user_messages: ["続きはMacでやる", "これは消さないで"], progress: [] },
  });
  expect(inbox.get()?.userMessages).toEqual(["続きはMacでやる", "これは消さないで"]);
});

it("Access JWTが無い要求をMCPより手前で拒む", async () => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  expect(response.status).toBe(403);
});

it("不正なHostヘッダーを拒みDNS rebindingを防ぐ", async () => {
  // fetch では Host を偽装できない（禁止ヘッダー）ので、生のHTTPで送る
  const status = await postWithHost("evil.example");
  expect(status).toBe(403);
});

it("正しいHostなら素通しする（上のテストが常に403になっていないことの裏取り）", async () => {
  const status = await postWithHost("127.0.0.1");
  expect(status).not.toBe(403);
});

it("利用者が指定するポートを厳密に検査する", () => {
  expect(depositPort({})).toBe(8788);
  expect(depositPort({ SESSION_RELAY_DEPOSIT_PORT: "31415" })).toBe(31_415);
  expect(() => depositPort({ SESSION_RELAY_DEPOSIT_PORT: "0" })).toThrow(/1〜65535/);
  expect(() => depositPort({ SESSION_RELAY_DEPOSIT_PORT: "12x" })).toThrow(/整数/);
});
