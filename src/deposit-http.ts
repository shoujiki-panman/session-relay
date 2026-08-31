/** Cloudflare Tunnelの後ろで動かす、書き込み専用Streamable HTTP MCP。 */
import type { Server as HttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { type AccessVerifier } from "./cloudflare-access.ts";
import { createDepositServer } from "./deposit-mcp.ts";
import { type Inbox, createInbox } from "./inbox.ts";

export const DEFAULT_DEPOSIT_PORT = 8788;
const LOOPBACK = "127.0.0.1";

interface DepositHttpOptions {
  readonly verifyAccess: AccessVerifier;
  readonly inbox?: Inbox;
}

const rpcError = (message: string): object => ({
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

const bodyError: ErrorRequestHandler = (error, request, response, next) => {
  void error;
  void request;
  void next;
  response.status(400).json(rpcError("Invalid JSON request"));
};

export function createDepositHttpApp(options: DepositHttpOptions): express.Express {
  const inbox = options.inbox ?? createInbox();
  const app = express();
  app.disable("x-powered-by");
  app.use(localhostHostValidation());
  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, tools: ["deposit_conversation"] });
  });
  app.use("/mcp", requireAccess(options.verifyAccess));
  app.use("/mcp", express.json({ limit: "1mb" }));
  app.post("/mcp", async (request, response) => {
    const server = createDepositServer(inbox);
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
  });
  app.get("/mcp", (_request, response) => response.status(405).json(rpcError("Method not allowed")));
  app.delete("/mcp", (_request, response) => response.status(405).json(rpcError("Method not allowed")));
  app.use(bodyError);
  return app;
}

export function depositPort(environment: NodeJS.ProcessEnv = process.env): number {
  const raw = environment.SESSION_RELAY_DEPOSIT_PORT?.trim();
  if (!raw) return DEFAULT_DEPOSIT_PORT;
  if (!/^\d+$/.test(raw)) throw new Error("SESSION_RELAY_DEPOSIT_PORTは整数にしてください");
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("ポートは1〜65535です");
  return port;
}

export async function listenForDeposits(
  options: DepositHttpOptions,
  port: number = depositPort(),
): Promise<HttpServer> {
  const app = createDepositHttpApp(options);
  return await new Promise((resolve, reject) => {
    const server = app.listen(port, LOOPBACK);
    server.once("error", reject);
    server.once("listening", () => {
      resolve(server);
    });
  });
}
