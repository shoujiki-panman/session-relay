/** `relay mcp` の入口。stdioでMCPを話す */
import { serveOverStdio } from "./mcp.ts";

await serveOverStdio();
