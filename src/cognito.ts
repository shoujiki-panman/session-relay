/**
 * Alexa+向け入口の認証。Amazon Cognitoが発行したアクセストークンを、
 * 発行元・署名・種類・アプリ・スコープ・本人まで検証する。
 *
 * Cloudflare Accessを使わない理由: Alexa+は動的クライアント登録（DCR）に対応しておらず、
 * さらに未認証の401に `WWW-Authenticate` を付けてはいけない。Accessはこれを自動で付ける。
 */
import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";

/** 例: ap-northeast-1_AbCdEf123 。先頭がリージョン */
const POOL_ID = /^([a-z]{2}(?:-[a-z]+)+-\d)_[A-Za-z0-9]+$/;
export const DEFAULT_SCOPE = "relay/deposit";

export interface CognitoConfig {
  readonly region: string;
  readonly userPoolId: string;
  readonly clientId: string;
  /** Cognitoのログイン画面のorigin（https://<prefix>.auth.<region>.amazoncognito.com） */
  readonly domain: string;
  /** Alexa+から見えるMCPのURL（https://…/mcp） */
  readonly publicUrl: string;
  readonly scope: string;
  /** 預けてよい本人のCognito `sub`。自分以外はトークンが正しくても拒む */
  readonly allowedSubjects: readonly string[];
}

export type TokenVerifier = (token: string) => Promise<void>;

const required = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`公開前に${name}を設定してください`);
  return value;
};

function parseHttps(given: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    throw new Error(`${name}がURLではありません`);
  }
  if (url.protocol !== "https:" || url.search !== "" || url.hash !== "") {
    throw new Error(`${name}は https:// で、?や#を含まない形にしてください`);
  }
  return url;
}

function httpsOrigin(given: string, name: string): string {
  const url = parseHttps(given, name);
  if (url.pathname !== "/") throw new Error(`${name}にパスは付けないでください`);
  return url.origin;
}

function regionOf(userPoolId: string): string {
  const match = POOL_ID.exec(userPoolId);
  const region = match?.[1];
  if (region === undefined) throw new Error("SESSION_RELAY_COGNITO_USER_POOL_IDの形が違います（例: ap-northeast-1_AbC123）");
  return region;
}

export function readCognitoConfig(environment: NodeJS.ProcessEnv = process.env): CognitoConfig {
  const userPoolId = required(environment, "SESSION_RELAY_COGNITO_USER_POOL_ID");
  const allowedSubjects = required(environment, "SESSION_RELAY_COGNITO_ALLOWED_SUBS")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (allowedSubjects.length === 0) throw new Error("SESSION_RELAY_COGNITO_ALLOWED_SUBSに自分のsubを入れてください");
  return {
    region: regionOf(userPoolId),
    userPoolId,
    clientId: required(environment, "SESSION_RELAY_COGNITO_CLIENT_ID"),
    domain: httpsOrigin(required(environment, "SESSION_RELAY_COGNITO_DOMAIN"), "SESSION_RELAY_COGNITO_DOMAIN"),
    publicUrl: parseHttps(required(environment, "SESSION_RELAY_ALEXA_PUBLIC_URL"), "SESSION_RELAY_ALEXA_PUBLIC_URL").href,
    scope: environment.SESSION_RELAY_COGNITO_SCOPE?.trim() || DEFAULT_SCOPE,
    allowedSubjects,
  };
}

export const issuerOf = (config: CognitoConfig): string =>
  `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;

function checkClaims(config: CognitoConfig, payload: Record<string, unknown>): void {
  if (payload.token_use !== "access") throw new Error("access tokenではありません");
  if (payload.client_id !== config.clientId) throw new Error("別のアプリ向けのtokenです");
  const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
  if (!scopes.includes(config.scope)) throw new Error("scopeが足りません");
  if (typeof payload.sub !== "string" || !config.allowedSubjects.includes(payload.sub)) {
    throw new Error("許可されていない利用者です");
  }
}

export function createCognitoVerifier(config: CognitoConfig, keys?: JWTVerifyGetKey): TokenVerifier {
  const issuer = issuerOf(config);
  const getKey = keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, getKey, { issuer, algorithms: ["RS256"] });
    checkClaims(config, payload);
  };
}

/** RFC 8414。Alexa+はここからCognitoのログイン画面とtoken窓口を知る */
export function authorizationServerMetadata(config: CognitoConfig): Record<string, unknown> {
  return {
    issuer: new URL(config.publicUrl).origin,
    authorization_endpoint: `${config.domain}/oauth2/authorize`,
    token_endpoint: `${config.domain}/oauth2/token`,
    revocation_endpoint: `${config.domain}/oauth2/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    scopes_supported: [config.scope],
  };
}

/** RFC 9728。このMCPがどの認可サーバーのtokenを受け付けるかを示す */
export function protectedResourceMetadata(config: CognitoConfig): Record<string, unknown> {
  return {
    resource: config.publicUrl,
    authorization_servers: [new URL(config.publicUrl).origin],
    scopes_supported: [config.scope],
    bearer_methods_supported: ["header"],
  };
}
