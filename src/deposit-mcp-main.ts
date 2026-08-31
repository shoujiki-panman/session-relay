/** `relay mcp-deposit` の入口。外向きにする予定の書き込み専用MCP */
import { serveDepositOverStdio } from "./deposit-mcp.ts";

await serveDepositOverStdio();
