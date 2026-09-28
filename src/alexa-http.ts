/**
 * Alexa+向けの書き込み専用Streamable HTTP MCP。
 * Claude用（deposit-http）とは別ポート・別ホスト名で動かし、Cloudflare Accessの外に置く。
 * 守りはCognitoのアクセストークン（cognito.ts）が受け持つ。
 */
import type { Server as HttpServer } from "node:http";
import express, { type RequestHandler } from "express";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import {
  type CognitoConfig,
  type TokenVerifier,
  authorizationServerMetadata,
  protectedResourceMetadata,
} from "./cognito.ts";
import {
  bodyError,
  closeOtherMethods,
  depositPostHandler,
  listenOnLoopback,
  portFrom,
  rpcError,
} from "./deposit-http.ts";
import { type DepositServerOptions } from "./deposit-mcp.ts";
import { type Inbox, createInbox } from "./inbox.ts";

export const DEFAULT_ALEXA_PORT = 8789;

interface AlexaHttpOptions {
  readonly verifyToken: TokenVerifier;
  readonly config: CognitoConfig;
  readonly inbox?: Inbox;
}

/** Alexa+は英語で話す。道具の説明も返事も英語にする */
export const ALEXA_TOOL: DepositServerOptions = {
  source: "alexa",
  description:
    "Save this conversation to the user's relay inbox so they can continue it later on their computer " +
    "(for example in Claude Code or Codex). Use only when the user explicitly asks to save, relay, or hand off " +
    "the conversation. user_messages: every message the user actually said in this conversation, in order, " +
    "verbatim; do not summarize, translate, or paraphrase. progress: up to 10 of your latest answers or " +
    "decisions. Keep source as 'alexa'.",
  confirm: () => "Saved. You can pick this up on your computer by saying 'continue from relay'.",
  failure: (reason) => `I couldn't save it: ${reason}`,
};

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Alexa+の決まり: 未認証は401、ただし `WWW-Authenticate` ヘッダーは付けない。
 * 本文はJSON-RPCのエラーにしておく（MCPクライアントが読める形）
 */
function requireBearer(verify: TokenVerifier): RequestHandler {
  return async (request, response, next) => {
    const token = BEARER.exec(request.header("authorization") ?? "")?.[1];
    if (token === undefined) {
      response.status(401).json(rpcError("Bearer token is required"));
      return;
    }
    try {
      await verify(token);
      next();
    } catch {
      response.status(401).json(rpcError("Bearer token is invalid"));
    }
  };
}

function serveMetadata(app: express.Express, config: CognitoConfig): void {
  const server = authorizationServerMetadata(config);
  const resource = protectedResourceMetadata(config);
  app.get("/.well-known/oauth-authorization-server", (_request, response) => {
    response.json(server);
  });
  // RFC 9728: /mcp 用の文書は /.well-known/oauth-protected-resource/mcp にも置く
  app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_request, response) => {
    response.json(resource);
  });
}

export function createAlexaHttpApp(options: AlexaHttpOptions): express.Express {
  const inbox = options.inbox ?? createInbox();
  const app = express();
  app.disable("x-powered-by");
  app.use(localhostHostValidation());
  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });
  serveMetadata(app, options.config);
  app.use("/mcp", requireBearer(options.verifyToken));
  app.use("/mcp", express.json({ limit: "1mb" }));
  app.post("/mcp", depositPostHandler(inbox, ALEXA_TOOL));
  closeOtherMethods(app);
  app.use(bodyError);
  return app;
}

export function alexaPort(environment: NodeJS.ProcessEnv = process.env): number {
  return portFrom(environment.SESSION_RELAY_ALEXA_PORT, DEFAULT_ALEXA_PORT, "SESSION_RELAY_ALEXA_PORT");
}

export async function listenForAlexa(options: AlexaHttpOptions, port: number = alexaPort()): Promise<HttpServer> {
  return await listenOnLoopback(createAlexaHttpApp(options), port);
}
