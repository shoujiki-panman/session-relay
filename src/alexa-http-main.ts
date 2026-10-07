/** `relay mcp-deposit-alexa` の入口。Cognitoの設定が揃っていなければ起動しない。 */
import { alexaPort, listenForAlexa } from "./alexa-http.ts";
import { createCognitoVerifier, readCognitoConfig } from "./cognito.ts";

const port = alexaPort();
const config = readCognitoConfig();
const server = await listenForAlexa({ verifyToken: createCognitoVerifier(config), config }, port);

process.stderr.write(`relay Alexa+ MCP: http://127.0.0.1:${String(port)}/mcp\n`);
process.stderr.write(`公開URL: ${config.publicUrl}（Cloudflare Tunnelの別ホスト名。Accessは掛けない）\n`);

const shutdown = (): void => {
  server.close((error) => {
    if (error) process.stderr.write(`終了時エラー: ${error.message}\n`);
    process.exitCode = error ? 1 : 0;
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
