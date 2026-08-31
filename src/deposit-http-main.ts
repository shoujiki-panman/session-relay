/** `relay mcp-deposit-http` の入口。Cloudflare Access JWTが無ければ起動しない。 */
import { createCloudflareAccessVerifier, readCloudflareAccessConfig } from "./cloudflare-access.ts";
import { depositPort, listenForDeposits } from "./deposit-http.ts";

const port = depositPort();
const verifyAccess = createCloudflareAccessVerifier(readCloudflareAccessConfig());
const server = await listenForDeposits({ verifyAccess }, port);

process.stderr.write(`relay deposit MCP: http://127.0.0.1:${String(port)}/mcp\n`);
process.stderr.write("Cloudflare Tunnel + Access Managed OAuthの後ろでだけ公開してください。\n");

const shutdown = (): void => {
  server.close((error) => {
    if (error) process.stderr.write(`終了時エラー: ${error.message}\n`);
    process.exitCode = error ? 1 : 0;
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
