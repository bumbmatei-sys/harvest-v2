import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  acceptsLegacyCallback, appLink, appOrigin, bioLink, blogImageLink, blogLink, blogRssLink, campaignInvitationLink,
  communityInviteLink, communityLink, communityPostLink, communityUnsubscribeLinks, connectClaimLink, connectExportLink, connectLinks, eventCalendarLink,
  giveCoverLink, giveLink, legacyRedirect, marketingOrigin, newsletterFileLink, newsletterSignupLink,
  newsletterUnavailableLink, newsletterUnsubscribeLink, readSiteAddresses, signInLink,
} from "../../src/lib/site-address";

const app = "https://app.example.invalid";
const legacy = "https://old.example.invalid";
beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", app);
  vi.stubEnv("MARKETING_ORIGIN", undefined);
  vi.stubEnv("LEGACY_ORIGINS", undefined);
  vi.stubEnv("HARVEST_NEWSLETTER_ORIGIN", undefined);
});
afterEach(() => vi.unstubAllEnvs());

it("configures marketing and keeps authentication on the app origin", () => {
  expect(appOrigin()).toBe(app);
  expect(readSiteAddresses({ BETTER_AUTH_URL: app, BETTER_AUTH_TRUSTED_ORIGINS: ` ${app}, ${app} , ` }).trustedOrigins).toEqual([app]);
  expect(marketingOrigin()).toBe(app);
  const settings = readSiteAddresses({ BETTER_AUTH_URL: app, MARKETING_ORIGIN: "https://www.example.invalid" });
  expect(settings).toMatchObject({ marketing: "https://www.example.invalid", trustedOrigins: [app], cookieDomain: undefined });
  expect(readSiteAddresses({ BETTER_AUTH_URL: app, AUTH_COOKIE_DOMAIN: ".example.invalid" }).cookieDomain).toBe("example.invalid");
  expect(() => readSiteAddresses({ BETTER_AUTH_URL: app, AUTH_COOKIE_DOMAIN: "elsewhere.invalid" })).toThrow();
  expect(() => readSiteAddresses({ BETTER_AUTH_URL: app, LEGACY_ORIGINS: app })).toThrow();
  expect(() => appLink("//elsewhere.invalid/path")).toThrow();
  expect(() => readSiteAddresses({ BETTER_AUTH_URL: app, BETTER_AUTH_TRUSTED_ORIGINS: "https://marketing.example.invalid" })).toThrow();
});

it.each<[() => string, string]>([
  [() => signInLink("/account"), "/sign-in?next=%2Faccount"],
  [() => campaignInvitationLink("synthetic"), "/campaign-invitations/synthetic"],
  [() => connectClaimLink("synthetic"), "/connect/claim#token=synthetic"],
  [() => connectLinks({ publicCode: "CODE", shortCode: "ABCD1234" }).qr, "/c/CODE"],
  [() => blogLink("news"), "/blog/news"],
  [() => blogLink("news", "first"), "/blog/news/first"],
  [() => blogRssLink("news"), "/blog/news/rss.xml"],
  [() => blogImageLink("news", "image"), "/blog/news/images/image"],
  [() => bioLink("hello"), "/l/hello"],
  [() => giveLink("fund"), "/give/fund"],
  [() => giveCoverLink("fund"), "/give/fund/cover"],
  [() => communityLink("members"), "/communities/members"],
  [() => communityPostLink("members", "example"), "/communities/members/posts/example"],
  [() => communityInviteLink("members", "synthetic"), "/communities/members?invite=synthetic"],
  [() => communityUnsubscribeLinks("synthetic").form, "/communities/unsubscribe#token=synthetic"],
  [() => communityUnsubscribeLinks("synthetic").oneClick, "/api/communities/unsubscribe?token=synthetic"],
  [() => newsletterUnavailableLink(), "/newsletter/link"],
  [() => newsletterSignupLink("signup"), "/subscribe/signup"],
  [() => newsletterUnsubscribeLink("synthetic").href, "/api/newsletter/unsubscribe?token=synthetic"],
  [() => newsletterFileLink("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"), "/api/files/public/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002"],
  [() => eventCalendarLink("tenant", "event"), "/api/workspaces/tenant/events/event/calendar"],
  [() => connectExportLink("tenant", "campaign", "link", "pdf"), "/api/workspaces/tenant/campaigns/campaign/connect/links/link/export?format=pdf"],
])("generates %s on the app address", (build, path) => {
  expect(build()).toBe(app + path);
});

it("keeps synthetic newsletter rendering on HTTPS when the app runs on HTTP loopback", () => {
  vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:3000");
  expect(newsletterUnsubscribeLink("synthetic").href).toBe("https://newsletter.example.test/api/newsletter/unsubscribe?token=synthetic");
  expect(newsletterUnavailableLink()).toBe("http://127.0.0.1:3000/newsletter/link");
});

it("redirects a configured old origin with path and query intact", () => {
  const request = new Request(`${legacy}/c/code?a=%2F&b=2&a=3`, { headers: { host: "spoof.example.invalid" } });
  expect(legacyRedirect(request)).toBeUndefined();
  vi.stubEnv("LEGACY_ORIGINS", legacy);
  const redirect = legacyRedirect(request);
  expect(redirect?.status).toBe(301);
  expect(redirect?.headers.get("location")).toBe(`${app}/c/code?a=%2F&b=2&a=3`);
  expect(legacyRedirect(new Request(`${app}/c/code`, { headers: { host: new URL(legacy).host } }))).toBeUndefined();
});

it.each(["/api/auth/callback/example", "/api/integrations/webhook/example", "/api/newsletter/callback", "/api/files/transfer"])(
  "preserves the registered origin at %s", path => {
    const settings = readSiteAddresses({ BETTER_AUTH_URL: app, LEGACY_ORIGINS: legacy });
    const request = new Request(legacy + path);
    expect(legacyRedirect(request, settings)).toBeUndefined();
    expect(acceptsLegacyCallback(request, settings)).toBe(true);
  },
);
it("preserves one-click POST and does not redirect other writes", () => {
  const settings = readSiteAddresses({ BETTER_AUTH_URL: app, LEGACY_ORIGINS: legacy });
  const request = new Request(legacy + "/api/newsletter/unsubscribe", { method: "POST" });
  expect(legacyRedirect(request, settings)).toBeUndefined();
  expect(acceptsLegacyCallback(request, settings)).toBe(true);
  expect(legacyRedirect(new Request(legacy + "/sign-in", { method: "POST" }), settings)).toBeUndefined();
});

it("keeps origin configuration and public link bases out of the callers", async () => {
  const violations: string[] = [];
  for (const root of ["src", "scripts"]) {
    for (const file of await readdir(root, { recursive: true })) {
      const path = join(root, file);
      if (path === "src/lib/site-address.ts" || !/\.[cm]?[jt]sx?$/.test(path)) continue;
      const code = await readFile(path, "utf8");
      const configName = /\b(?:BETTER_AUTH_URL|BETTER_AUTH_TRUSTED_ORIGINS|MARKETING_ORIGIN|LEGACY_ORIGINS|AUTH_COOKIE_DOMAIN|HARVEST_PRODUCTION_ORIGIN|HARVEST_NEWSLETTER_ORIGIN)\b/;
      const readsConfig = configName.test(root === "src" ? code : code.replace(/\b[A-Z_]+:\s*|["'][A-Z_]+["'](?=,)/g, ""));
      const usesRequestHost = /(?:\b(?:window\.)?location\.origin|\.headers\.get\(\s*["'](?:x-forwarded-)?host["']|new URL\([^,\n]+,\s*request\.url\))/i.test(code);
      if (readsConfig || usesRequestHost) violations.push(path);
    }
  }
  expect(violations).toEqual([]);
});
