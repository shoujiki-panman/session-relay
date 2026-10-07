/** Cloudflare Tunnelの後ろで動かす、書き込み専用Streamable HTTP MCP。 */
import type { Server as HttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { type AccessVerifier } from "./cloudflare-access.ts";
import { type DepositServerOptions, createDepositServer } from "./deposit-mcp.ts";
import { type Inbox, createInbox } from "./inbox.ts";

export const DEFAULT_DEPOSIT_PORT = 8788;
const LOOPBACK = "127.0.0.1";

interface DepositHttpOptions {
  readonly verifyAccess: AccessVerifier;
  readonly inbox?: Inbox;
}

export const rpcError = (message: string): object => ({
  jsonrpc: "2.0",
  error: { code: -32_000, message },
  id: null,
});

function requireAccess(verify: AccessVerifier): RequestHandler {
  return async (request, response, next) => {
    const token = request.header("cf-access-jwt-assertion");
    if (!token) {
      response.status(403).json(rpcError("Cloudflare Access JWT is required"));
      return;
    }
    try {
      await verify(token);
      next();
    } catch {
      response.status(403).json(rpcError("Cloudflare Access JWT is invalid"));
    }
  };
}

export const bodyError: ErrorRequestHandler = (error, request, response, next) => {
  void error;
  void request;
  void next;
  response.status(400).json(rpcError("Invalid JSON request"));
};

/** 1リクエストごとにMCPサーバーを作って捨てる。どの入口も同じ「預ける道具1つ」だけを出す */
export function depositPostHandler(inbox: Inbox, serverOptions: DepositServerOptions = {}): RequestHandler {
  return async (request, response) => {
    const server = createDepositServer(inbox, serverOptions);
    // sessionIdGeneratorを渡さない＝ステートレス（公式の `sessionIdGenerator: undefined` と同じ）
    const transport = new StreamableHTTPServerTransport({});
    try {
      // @ts-expect-error SDK 1.30のNode版transportは onclose 等が `| undefined` 付きで、
      // exactOptionalPropertyTypes の Transport と噛み合わない（実行時は問題ない）。
      // SDK側が直ったらこの行がエラーになるので、そのとき消す
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) response.status(500).json(rpcError("Internal MCP error"));
    } finally {
      await server.close();
    }
  };
}

/** /mcp のPOST以外は受けない。GET（SSE）とDELETE（セッション終了）はステートレスなので不要 */
export function closeOtherMethods(app: express.Express): void {
  app.get("/mcp", (_request, response) => response.status(405).json(rpcError("Method not allowed")));
  app.delete("/mcp", (_request, response) => response.status(405).json(rpcError("Method not allowed")));
}

export function createDepositHttpApp(options: DepositHttpOptions): express.Express {
  const inbox = options.inbox ?? createInbox();
  const app = express();
  app.disable("x-powered-by");
  app.use(localhostHostValidation());
  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });
  app.use("/mcp", requireAccess(options.verifyAccess));
  app.use("/mcp", express.json({ limit: "1mb" }));
  app.post("/mcp", depositPostHandler(inbox));
  closeOtherMethods(app);
  app.use(bodyError);
  return app;
}

/** 環境変数のポート指定を厳密に読む。無ければfallback */
export function portFrom(raw: string | undefined, fallback: number, name: string): number {
  const given = raw?.trim();
  if (!given) return fallback;
  if (!/^\d+$/.test(given)) throw new Error(`${name}は整数にしてください`);
  const port = Number(given);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("ポートは1〜65535です");
  return port;
}

export function depositPort(environment: NodeJS.ProcessEnv = process.env): number {
  return portFrom(environment.SESSION_RELAY_DEPOSIT_PORT, DEFAULT_DEPOSIT_PORT, "SESSION_RELAY_DEPOSIT_PORT");
}

/** 127.0.0.1だけで待つ。外からはTunnel経由でしか届かない */
export async function listenOnLoopback(app: express.Express, port: number): Promise<HttpServer> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(port, LOOPBACK);
    server.once("error", reject);
    server.once("listening", () => {
      resolve(server);
    });
  });
}

export async function listenForDeposits(
  options: DepositHttpOptions,
  port: number = depositPort(),
): Promise<HttpServer> {
  return await listenOnLoopback(createDepositHttpApp(options), port);
}
