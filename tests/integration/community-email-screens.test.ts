import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>;
vi.mock("@/db/client", () => ({ getDb: () => f.db }));
// The member's identity comes from a test header here; origin checks and error mapping are the real ones.
vi.mock("@/server/http", async (actual) => ({ ...(await actual<typeof import("../../src/server/http")>()),
  verifiedUser: async (request: Request) => { const id = request.headers.get("x-test-user"); if (!id) throw new (await import("../../src/server/permissions")).AccessError(401, "signed out"); return id; } }));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, updateCommunity } from "../../src/server/communities";
import { forumContext } from "../../src/server/community-forum";
import { signUnsubscribe, UNSUBSCRIBE_TTL_MS } from "../../src/lib/community-email-token";
import { PUT as saveEmail } from "../../src/app/api/communities/[slug]/notifications/email/route";
import { POST as unsubscribe } from "../../src/app/api/communities/unsubscribe/route";

// C15c: the two screens' routes as the browser calls them. Frequency: validation, membership and role; unsubscribe: one answer for every token.
const secret = "screens-test-secret-long-enough", origin = "http://127.0.0.1:3100";
const people = ["e-owner", "e-member", "e-moderator", "e-pending", "e-banned", "e-outsider"];
let a: string, club: string;
const frequency = async (user: string) => (await f.admin.query("select email_frequency from community_memberships where community_id = $1 and user_id = $2", [club, user])).rows[0]?.email_frequency;
const put = (user: string | null, body: unknown, slug = "email-club", from = origin) => saveEmail(new Request(`${origin}/api/communities/${slug}/notifications/email`, {
  method: "PUT", headers: { origin: from, "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ slug }) });
const post = (token: string | null, mode: "body" | "query" = "body") => {
  const body = mode === "body" && token !== null ? JSON.stringify({ token }) : undefined;
  return unsubscribe(new Request(`${origin}/api/communities/unsubscribe${mode === "query" && token ? `?token=${encodeURIComponent(token)}` : ""}`, { method: "POST",
    headers: body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } : {}, body }));
};
const answer = async (response: Response) => ({ status: response.status, body: await response.text(), cache: response.headers.get("cache-control") });

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", secret); vi.stubEnv("BETTER_AUTH_URL", origin);
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: `Name ${id}`, email: `${id}@example.invalid`, emailVerified: true })));
  a = (await createWorkspace(f.db, "e-owner", "Grace Church", "church")).tenantId;
  club = (await createCommunity(f.db, "e-owner", a, { name: "Email club", slug: "email-club" })).id;
  await f.admin.query("update communities set status = 'published' where id = $1", [club]);
  for (const [user, role, status] of [["e-member", "member", "active"], ["e-moderator", "moderator", "active"], ["e-pending", "member", "pending"], ["e-banned", "member", "banned"]]) {
    await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status, joined_at) values ($1, $2, $3, $4, $5, now() - interval '1 hour')", [a, club, user, role, status]);
    await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, $2, 'community', $3, 'admin_grant')", [a, user, club]);
  }
});
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });
beforeEach(async () => { await f.admin.query("update community_memberships set email_frequency = 'important', email_digest_cursor = null"); });

it("saves each frequency for an active member and shows it in their settings", async () => {
  for (const value of ["off", "daily", "weekly", "important"] as const) {
    expect((await put("e-member", { frequency: value })).status).toBe(200);
    expect(await frequency("e-member")).toBe(value);
    expect((await forumContext(f.db, "e-member", "email-club"))!.prefs.email).toBe(value);
  }
  expect((await put("e-moderator", { frequency: "weekly" })).status).toBe(200);
  expect(await frequency("e-moderator")).toBe("weekly");
});

it("refuses bad input, other origins, signed-out callers and anyone who is not an active member", async () => {
  for (const body of [{ frequency: "hourly" }, { frequency: "daily", extra: true }, {}, { frequency: null }]) expect((await put("e-member", body)).status).toBe(400);
  expect((await put("e-member", { frequency: "off" }, "email-club", "https://elsewhere.example.invalid")).status).toBe(403);
  expect((await put(null, { frequency: "off" })).status).toBe(401);
  for (const user of ["e-outsider", "e-pending", "e-banned"]) expect((await put(user, { frequency: "off" })).status).toBe(404);
  expect((await put("e-member", { frequency: "off" }, "no-such-club")).status).toBe(404);
  expect(await frequency("e-member")).toBe("important");
  expect(await frequency("e-pending")).toBe("important");
});

it("answers a valid, invalid, expired, missing or malformed token identically, and only a valid one switches email off", async () => {
  const target = { tenantId: a, communityId: club, userId: "e-member" };
  const valid = signUnsubscribe(secret, target), expired = signUnsubscribe(secret, target, Date.now() - UNSUBSCRIBE_TTL_MS - 1000);
  const forged = signUnsubscribe("another-secret-long-enough", target), tampered = `${valid.slice(0, -3)}AAA`;
  const answers = [];
  for (const token of [expired, forged, tampered, "garbage", "", null]) answers.push(await answer(await post(token)));
  answers.push(await answer(await post(expired, "query")));
  expect(await frequency("e-member")).toBe("important");
  answers.push(await answer(await post(valid)));
  expect(await frequency("e-member")).toBe("off");
  answers.push(await answer(await post(valid)));
  await f.admin.query("update community_memberships set email_frequency = 'daily' where user_id = 'e-member'");
  answers.push(await answer(await post(valid, "query")));
  expect(await frequency("e-member")).toBe("off");
  for (const each of answers) expect(each).toEqual({ status: 200, body: JSON.stringify({ ok: true }), cache: "no-store" });
  expect(await frequency("e-moderator")).toBe("important");
});

it("keeps the confirmation page's path out of reach of new and renamed communities", async () => {
  await expect(createCommunity(f.db, "e-owner", a, { name: "Clash", slug: "unsubscribe" })).rejects.toThrow();
  const draft = await createCommunity(f.db, "e-owner", a, { name: "Draft", slug: "draft-club" });
  await expect(updateCommunity(f.db, "e-owner", a, draft.id, { version: draft.version, slug: "unsubscribe" })).rejects.toThrow();
});
