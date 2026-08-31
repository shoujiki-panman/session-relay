/** Cloudflare Accessが付けるJWTを、公開鍵・issuer・audienceまで検証する。 */
import { createRemoteJWKSet, jwtVerify } from "jose";

const TEAM_SUFFIX = ".cloudflareaccess.com";

export interface CloudflareAccessConfig {
  readonly teamDomain: string;
  readonly audience: string;
}

export type AccessVerifier = (token: string) => Promise<void>;

function normalizeTeamDomain(given: string): string {
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    throw new Error("SESSION_RELAY_ACCESS_TEAM_DOMAINがURLではありません");
  }
  const isTeam = url.hostname.endsWith(TEAM_SUFFIX) && url.hostname !== TEAM_SUFFIX.slice(1);
  if (url.protocol !== "https:" || !isTeam || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error("TEAM_DOMAINは https://<team>.cloudflareaccess.com の形にしてください");
  }
  return url.origin;
}

export function readCloudflareAccessConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CloudflareAccessConfig {
  const domain = environment.SESSION_RELAY_ACCESS_TEAM_DOMAIN?.trim();
  const audience = environment.SESSION_RELAY_ACCESS_AUD?.trim();
  if (!domain || !audience) {
    throw new Error("公開前にSESSION_RELAY_ACCESS_TEAM_DOMAINとSESSION_RELAY_ACCESS_AUDを設定してください");
  }
  return { teamDomain: normalizeTeamDomain(domain), audience };
}

export function createCloudflareAccessVerifier(config: CloudflareAccessConfig): AccessVerifier {
  const keys = createRemoteJWKSet(new URL(`${config.teamDomain}/cdn-cgi/access/certs`));
  return async (token) => {
    await jwtVerify(token, keys, {
      issuer: config.teamDomain,
      audience: config.audience,
      algorithms: ["RS256"],
    });
  };
}
