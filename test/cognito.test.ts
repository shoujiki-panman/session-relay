/** Cognitoのtokenを、署名・発行元・種類・アプリ・スコープ・本人まで確かめる。 */
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, expect, it } from "vitest";
import {
  type CognitoConfig,
  type TokenVerifier,
  authorizationServerMetadata,
  createCognitoVerifier,
  issuerOf,
  protectedResourceMetadata,
  readCognitoConfig,
} from "../src/cognito.ts";

const ENV = {
  SESSION_RELAY_COGNITO_USER_POOL_ID: "ap-northeast-1_AbC123",
  SESSION_RELAY_COGNITO_CLIENT_ID: "alexa-client",
  SESSION_RELAY_COGNITO_DOMAIN: "https://relay.auth.ap-northeast-1.amazoncognito.com",
  SESSION_RELAY_ALEXA_PUBLIC_URL: "https://alexa-relay.example.com/mcp",
  SESSION_RELAY_COGNITO_ALLOWED_SUBS: " me-sub , ",
};
const config: CognitoConfig = readCognitoConfig(ENV);

let signToken: (claims: Record<string, unknown>, issuer?: string) => Promise<string>;
let verify: TokenVerifier;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  verify = createCognitoVerifier(config, createLocalJWKSet({ keys: [jwk] }));
  signToken = (claims, issuer = issuerOf(config)) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
});

const good = { token_use: "access", client_id: "alexa-client", scope: "relay/deposit", sub: "me-sub" };

it("設定を読み、プールIDからリージョンを取り出す", () => {
  expect(config.region).toBe("ap-northeast-1");
  expect(config.scope).toBe("relay/deposit");
  expect(config.allowedSubjects).toEqual(["me-sub"]);
  expect(issuerOf(config)).toBe("https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_AbC123");
});

it.each([
  ["SESSION_RELAY_COGNITO_USER_POOL_ID", "not-a-pool"],
  ["SESSION_RELAY_COGNITO_DOMAIN", "http://relay.auth.example.com"],
  ["SESSION_RELAY_COGNITO_DOMAIN", "https://relay.auth.example.com/path"],
  ["SESSION_RELAY_ALEXA_PUBLIC_URL", "https://alexa-relay.example.com/mcp?x=1"],
  ["SESSION_RELAY_COGNITO_ALLOWED_SUBS", " , "],
])("おかしな設定では起動しない: %s=%s", (name, value) => {
  expect(() => readCognitoConfig({ ...ENV, [name]: value })).toThrow();
});

it("許可する本人を決めずに公開はできない", () => {
  const { SESSION_RELAY_COGNITO_ALLOWED_SUBS: _dropped, ...rest } = ENV;
  void _dropped;
  expect(() => readCognitoConfig(rest)).toThrow(/ALLOWED_SUBS/);
});

it("自分宛ての正しいaccess tokenを通す", async () => {
  await expect(verify(await signToken(good))).resolves.toBeUndefined();
});

it.each([
  ["id token", { ...good, token_use: "id" }],
  ["別アプリ", { ...good, client_id: "other" }],
  ["scope不足", { ...good, scope: "openid" }],
  ["他人", { ...good, sub: "stranger" }],
])("条件を満たさないtokenを拒む: %s", async (_label, claims) => {
  await expect(verify(await signToken(claims))).rejects.toThrow();
});

it("別のプールが発行したtokenを拒む", async () => {
  const token = await signToken(good, "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other");
  await expect(verify(token)).rejects.toThrow();
});

it("メタデータがCognitoの窓口とPKCE(S256)を指す", () => {
  expect(authorizationServerMetadata(config)).toMatchObject({
    issuer: "https://alexa-relay.example.com",
    authorization_endpoint: "https://relay.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize",
    token_endpoint: "https://relay.auth.ap-northeast-1.amazoncognito.com/oauth2/token",
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["relay/deposit"],
  });
  expect(protectedResourceMetadata(config)).toEqual({
    resource: "https://alexa-relay.example.com/mcp",
    authorization_servers: ["https://alexa-relay.example.com"],
    scopes_supported: ["relay/deposit"],
    bearer_methods_supported: ["header"],
  });
});
