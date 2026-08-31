import { expect, it } from "vitest";
import { readCloudflareAccessConfig } from "../src/cloudflare-access.ts";

it("Cloudflare Accessの設定を正規化する", () => {
  expect(
    readCloudflareAccessConfig({
      SESSION_RELAY_ACCESS_TEAM_DOMAIN: " https://tanuma.cloudflareaccess.com ",
      SESSION_RELAY_ACCESS_AUD: " aud-123 ",
    }),
  ).toEqual({ teamDomain: "https://tanuma.cloudflareaccess.com", audience: "aud-123" });
});

it.each([
  "http://tanuma.cloudflareaccess.com",
  "https://example.com",
  "https://tanuma.cloudflareaccess.com/path",
  "not-a-url",
])("Cloudflare以外や余計なパスのTEAM_DOMAINを拒む: %s", (teamDomain) => {
  expect(() =>
    readCloudflareAccessConfig({
      SESSION_RELAY_ACCESS_TEAM_DOMAIN: teamDomain,
      SESSION_RELAY_ACCESS_AUD: "aud-123",
    }),
  ).toThrow();
});

it("Access設定が無い状態では公開サーバーを構成できない", () => {
  expect(() => readCloudflareAccessConfig({})).toThrow(/公開前/);
});
