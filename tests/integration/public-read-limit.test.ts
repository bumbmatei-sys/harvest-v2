import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { workerSettings } from "../../src/server/worker-settings";
import { signUnsubscribe } from "../../src/lib/community-email-token";
import { chargePublicRead, publicReadLimits, PUBLIC_READ_WINDOW_MS, publicVisitorKey } from "../../src/server/public-read-limit";

// C23 follow-up F1: anonymous public reads (Discover listing, search and page; the public community page and its beacon; unsubscribe) are
// throttled per hashed visitor in the existing rate_limits store, answering the neutral 429 with Retry-After.
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => f.db }));
let pageHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => pageHeaders, cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => Object.assign((key: string) => key, { rich: (key: string) => key }) }));
vi.mock("../../src/server/page-session", () => ({ optionalSession: async () => null }));

let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, club: string;
const secret = "t".repeat(40), site = "http://localhost:3000";
const from = (ip: string, extra: Record<string, string> = {}) => ({ "x-forwarded-for": ip, ...extra });
// Server components (PublicFrame) are async, so the tree is inspected instead of rendered: every string and role in the element props.
function markup(node: unknown, seen = new Set<unknown>()): string {
  if (typeof node === "string" || typeof node === "number") return `${node} `;
  if (!node || typeof node !== "object" || seen.has(node)) return "";
  seen.add(node);
  if (Array.isArray(node)) return node.map((n) => markup(n, seen)).join("");
  const element = node as { props?: Record<string, unknown> };
  const values = element.props ? Object.entries(element.props).map(([k, v]) => k === "role" ? `role="${v}" ` : typeof v === "boolean" ? `${k}=${v} ` : markup(v, seen)) : Object.values(node).map((v) => markup(v, seen));
  return values.join("");
}
const resetCounters = () => f.admin.query("delete from rate_limits where key like 'public-read:%'");

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubEnv("BETTER_AUTH_URL", site);
  f = await testDatabase();
  await f.db.insert(users).values(["pr-owner", "pr-member"].map((id) => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, "pr-owner", "Grace Church", "church")).tenantId;
  club = (await createCommunity(f.db, "pr-owner", tenant, { name: "Throttle club", slug: "throttle-club" })).id;
  await f.admin.query("update communities set status = 'published', visibility = 'listed', allow_open = true where id = $1", [club]);
  await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status, joined_at) values ($1, $2, 'pr-member', 'member', 'active', now())", [tenant, club]);
}, 180_000);
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });
beforeEach(resetCounters);

async function expectLimited(response: Response) {
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: "rate_limited" });
  const retry = Number(response.headers.get("retry-after"));
  expect(retry).toBeGreaterThanOrEqual(1);
  expect(retry).toBeLessThanOrEqual(60);
}

describe("the limiter", () => {
  it("counts per visitor and scope in a one-minute window, then resets", async () => {
    const now = Date.now(), max = publicReadLimits["community-page"];
    for (let i = 0; i < max; i++) expect(await chargePublicRead(f.db, "community-page", "a".repeat(64), now, false)).toEqual({ limited: false });
    expect(await chargePublicRead(f.db, "community-page", "a".repeat(64), now + 10_000, false)).toEqual({ limited: true, retryAfter: 50 });
    // Another visitor, and another scope for the same visitor, are untouched.
    expect(await chargePublicRead(f.db, "community-page", "b".repeat(64), now, false)).toEqual({ limited: false });
    expect(await chargePublicRead(f.db, "discover", "a".repeat(64), now, false)).toEqual({ limited: false });
    // The count stops growing over the limit, and the next window starts fresh.
    expect((await f.admin.query("select count from rate_limits where key = $1", [`public-read:community-page:${"a".repeat(64)}`])).rows[0].count).toBe(max + 1);
    expect(await chargePublicRead(f.db, "community-page", "a".repeat(64), now + PUBLIC_READ_WINDOW_MS, false)).toEqual({ limited: false });
  });

  it("sweeps expired counters and stores no raw address", async () => {
    const now = Date.now();
    await chargePublicRead(f.db, "discover", "c".repeat(64), now - 2 * PUBLIC_READ_WINDOW_MS, false);
    await chargePublicRead(f.db, "discover", "d".repeat(64), now, true);
    const keys = (await f.admin.query("select key from rate_limits where key like 'public-read:%'")).rows.map((r) => r.key);
    expect(keys).toEqual([`public-read:discover:${"d".repeat(64)}`]);
    const key = publicVisitorKey(new Headers(from("203.0.113.9")));
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.9");
    expect(publicVisitorKey(new Headers())).toBeNull();
    // On Workers the request scope's secret and cf-connecting-ip are used; a client-sent x-forwarded-for is ignored there.
    const onWorkers = (headers: Record<string, string>) => workerSettings.run({ authSecret: secret } as never, () => publicVisitorKey(new Headers(headers)));
    expect(onWorkers({ "cf-connecting-ip": "203.0.113.9" })).toMatch(/^[a-f0-9]{64}$/);
    expect(onWorkers({ "x-forwarded-for": "203.0.113.9" })).toBeNull();
  });
});

describe("Discover", () => {
  it("shares one budget across the listing API, the search API and the page, per visitor", async () => {
    const listing = await import("../../src/app/api/discover/route");
    const search = await import("../../src/app/api/discover/listings/route");
    const page = await import("../../src/app/discover/page");
    const max = publicReadLimits.discover;
    for (let i = 0; i < max / 2; i++) expect((await listing.GET(new Request(`${site}/api/discover`, { headers: from("198.51.100.1") }))).status).toBe(200);
    for (let i = 0; i < max / 2 - 1; i++) expect((await search.GET(new Request(`${site}/api/discover/listings?q=throttle`, { headers: from("198.51.100.1") }))).status).toBe(200);
    pageHeaders = new Headers(from("198.51.100.1"));
    const lastAllowed = markup(await page.default({ searchParams: Promise.resolve({}) }));
    // Unified Discover lists approved listings only, so the page is checked by whether it searched (failed=false) or not.
    expect(lastAllowed).toContain("failed=false");
    await expectLimited(await listing.GET(new Request(`${site}/api/discover`, { headers: from("198.51.100.1") })));
    await expectLimited(await search.GET(new Request(`${site}/api/discover/listings`, { headers: from("198.51.100.1") })));
    expect(markup(await page.default({ searchParams: Promise.resolve({}) }))).toContain("failed=true");
    // Another visitor is unaffected.
    expect((await listing.GET(new Request(`${site}/api/discover`, { headers: from("198.51.100.2") }))).status).toBe(200);
    expect((await search.GET(new Request(`${site}/api/discover/listings`, { headers: from("198.51.100.2") }))).status).toBe(200);
  });

  it("does not count requests without a usable address", async () => {
    const listing = await import("../../src/app/api/discover/route");
    for (let i = 0; i <= publicReadLimits.discover; i++) expect((await listing.GET(new Request(`${site}/api/discover`))).status).toBe(200);
    expect((await f.admin.query("select count(*)::int n from rate_limits where key like 'public-read:%'")).rows[0].n).toBe(0);
  });
});

describe("the public community page", () => {
  const props = { params: Promise.resolve({ slug: "throttle-club" }), searchParams: Promise.resolve({}) };
  it("renders until the limit, then shows a neutral notice without reading the community, per visitor", async () => {
    const page = await import("../../src/app/communities/[slug]/page");
    pageHeaders = new Headers(from("192.0.2.10"));
    // Metadata and page share one charge per request in Next (React cache); outside a request each call charges.
    for (let i = 0; i < publicReadLimits["community-page"]; i++) expect(markup(await page.default(props))).toContain("Throttle club");
    const limited = markup(await page.default(props));
    expect(limited).toContain('role="status"');
    expect(limited).toContain("busy");
    expect(limited).not.toContain("Throttle club");
    expect(await page.generateMetadata(props)).toEqual({ robots: { index: false, follow: false } });
    pageHeaders = new Headers(from("192.0.2.11"));
    expect(markup(await page.default(props))).toContain("Throttle club");
  });

  it("throttles the anonymous visit beacon before looking at the slug", async () => {
    const count = await import("../../src/app/api/communities/[slug]/count/route");
    const beacon = (slug: string, ip: string) => count.POST(new Request(`${site}/api/communities/${slug}/count`, { method: "POST", headers: { ...from(ip), "content-type": "application/json" }, body: JSON.stringify({ kind: "visit" }) }), { params: Promise.resolve({ slug }) });
    for (let i = 0; i < publicReadLimits["community-beacon"]; i++) expect((await beacon(i % 2 ? "throttle-club" : "no-such-club", "192.0.2.20")).status).toBe(204);
    await expectLimited(await beacon("throttle-club", "192.0.2.20"));
    await expectLimited(await beacon("no-such-club", "192.0.2.20"));
    expect((await beacon("throttle-club", "192.0.2.21")).status).toBe(204);
  });
});

describe("unsubscribe", () => {
  it("answers the same body for every token kind under the limit and the same 429 over it, per visitor", async () => {
    const route = await import("../../src/app/api/communities/unsubscribe/route");
    const valid = signUnsubscribe(secret, { tenantId: tenant, communityId: club, userId: "pr-member" });
    const forged = `${valid.slice(0, -3)}AAA`;
    const expired = signUnsubscribe(secret, { tenantId: tenant, communityId: club, userId: "pr-member" }, Date.now() - 400 * 24 * 3600 * 1000);
    const query = (token: string | null, ip: string) => route.POST(new Request(`${site}/api/communities/unsubscribe${token === null ? "" : `?token=${encodeURIComponent(token)}`}`, { method: "POST", headers: from(ip) }));
    const body = (token: string, ip: string) => route.POST(new Request(`${site}/api/communities/unsubscribe`, { method: "POST", headers: { ...from(ip), "content-type": "application/json", "content-length": String(JSON.stringify({ token }).length) }, body: JSON.stringify({ token }) }));
    const snapshot = async (response: Response) => ({ status: response.status, body: await response.text(), retry: response.headers.get("retry-after"), cache: response.headers.get("cache-control") });

    const kinds = [() => query(forged, "203.0.113.30"), () => query("garbage", "203.0.113.30"), () => query(null, "203.0.113.30"), () => query(expired, "203.0.113.30"), () => body("garbage", "203.0.113.30"), () => query(valid, "203.0.113.30")];
    const under = [];
    for (const send of kinds) under.push(await snapshot(await send()));
    expect(new Set(under.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(under[0]).toEqual({ status: 200, body: JSON.stringify({ ok: true }), retry: null, cache: "no-store" });
    expect((await f.admin.query("select email_frequency from community_memberships where user_id = 'pr-member'")).rows[0].email_frequency).toBe("off");

    for (let i = kinds.length; i < publicReadLimits["community-unsubscribe"]; i++) expect((await query("garbage", "203.0.113.30")).status).toBe(200);
    await f.admin.query("update community_memberships set email_frequency = 'important' where user_id = 'pr-member'");
    const over = [];
    for (const send of [() => query(valid, "203.0.113.30"), () => query(forged, "203.0.113.30"), () => query(null, "203.0.113.30"), () => body(valid, "203.0.113.30")]) {
      const response = await send();
      await expectLimited(response.clone());
      const { retry, ...rest } = await snapshot(response);
      over.push({ ...rest, retry: retry !== null });
    }
    expect(new Set(over.map((s) => JSON.stringify(s))).size).toBe(1);
    // Over the limit nothing is processed, valid token or not.
    expect((await f.admin.query("select email_frequency from community_memberships where user_id = 'pr-member'")).rows[0].email_frequency).toBe("important");
    // Another visitor is unaffected.
    expect(await snapshot(await query(valid, "203.0.113.31"))).toEqual(under[0]);
  });
});
