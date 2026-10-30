/** Alexa+の入口: 道具は預ける1つだけ、未認証は401でWWW-Authenticateを付けない、預けた出典はalexa。 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { alexaPort, listenForAlexa } from "../src/alexa-http.ts";
import { readCognitoConfig } from "../src/cognito.ts";
import { createInbox } from "../src/inbox.ts";

const TOKEN = "valid-cognito-token";
const root = mkdtempSync(join(tmpdir(), "session-relay-alexa-http-"));
const inbox = createInbox(join(root, "inbox"));
const client = new Client({ name: "alexa-http-test", version: "0" });
const config = readCognitoConfig({
  SESSION_RELAY_COGNITO_USER_POOL_ID: "ap-northeast-1_AbC123",
  SESSION_RELAY_COGNITO_CLIENT_ID: "alexa-client",
  SESSION_RELAY_COGNITO_DOMAIN: "https://relay.auth.ap-northeast-1.amazoncognito.com",
  SESSION_RELAY_ALEXA_PUBLIC_URL: "https://alexa-relay.example.com/mcp",
  SESSION_RELAY_COGNITO_ALLOWED_SUBS: "me-sub",
});
const verifyToken = (token: string): Promise<void> =>
  token === TOKEN ? Promise.resolve() : Promise.reject(new Error("invalid token"));

let base = new URL("http://127.0.0.1/");
let server: Awaited<ReturnType<typeof listenForAlexa>>;

beforeAll(async () => {
  server = await listenForAlexa({ verifyToken, config, inbox }, 0);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("HTTPポートを取得できません");
  base = new URL(`http://127.0.0.1:${String(address.port)}/`);
  await client.connect(
    // @ts-expect-error SDK 1.30のclient transportは sessionId が `string | undefined` で、
    // exactOptionalPropertyTypes の Transport と噛み合わない（実行時は問題ない）
    new StreamableHTTPClientTransport(new URL("/mcp", base), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
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

const initialize = (headers: Record<string, string>): Promise<Response> =>
  fetch(new URL("/mcp", base), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });

it("Alexa+にも預ける道具しか見せない", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toEqual(["deposit_conversation"]);
  expect(tools[0]?.description).toMatch(/verbatim/);
});

it("Alexaから預けた会話は出典alexaで、英語の返事を返す", async () => {
  const result = await client.callTool({
    name: "deposit_conversation",
    arguments: { user_messages: ["Plan dinners for next week", "No fish on Monday"], progress: ["Drafted 5 dinners"] },
  });
  expect(JSON.stringify(result.content)).toMatch(/Saved\./);
  const saved = inbox.get();
  expect(saved?.source).toBe("alexa");
  expect(saved?.userMessages).toEqual(["Plan dinners for next week", "No fish on Monday"]);
});

it.each([
  ["tokenなし", {}],
  ["Bearerでない", { Authorization: "Basic abc" }],
  ["不正なtoken", { Authorization: "Bearer wrong" }],
])("未認証は401で、WWW-Authenticateを付けない: %s", async (_label, headers) => {
  const response = await initialize(headers);
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBeNull();
});

it("OAuthのメタデータを認証なしで読ませる", async () => {
  const server = await fetch(new URL("/.well-known/oauth-authorization-server", base));
  expect(server.status).toBe(200);
  expect(await server.json()).toMatchObject({ code_challenge_methods_supported: ["S256"] });
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const resource = await fetch(new URL(path, base));
    expect(await resource.json()).toMatchObject({ resource: "https://alexa-relay.example.com/mcp" });
  }
});

it("GETやDELETEの/mcpは受けない", async () => {
  const response = await fetch(new URL("/mcp", base), { headers: { Authorization: `Bearer ${TOKEN}` } });
  expect(response.status).toBe(405);
});

it("Claude用とぶつからない既定ポートを使う", () => {
  expect(alexaPort({})).toBe(8789);
  expect(alexaPort({ SESSION_RELAY_ALEXA_PORT: "9001" })).toBe(9001);
  expect(() => alexaPort({ SESSION_RELAY_ALEXA_PORT: "x" })).toThrow(/整数/);
});
