import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const deliver = vi.hoisted(() => vi.fn());
vi.mock("../../src/server/email", () => ({ sendSignInCode: deliver }));
// The app's Better Auth instance on the fixture database (the dev server builds the same one from DATABASE_URL).
const holder = vi.hoisted(() => ({ auth: undefined as unknown }));
vi.mock("../../src/server/auth-instance", () => ({ getAuth: () => holder.auth }));
import { testDatabase } from "../database";
import { makeAuth } from "../../src/server/auth";
import { qaShortcutSignIn } from "../../src/server/qa-shortcut";

// QA-2: the test sign-in shortcut through the real Better Auth instance, OTP tables, limiter and audit, on the embedded test database.
const baseURL = "http://localhost:3000";
const token = "qa-preview-token-for-integration-only-0123456789";
const seeded = "0f1e2d3c-4b5a-5969-8786-a5b4c3d2e1f0@example.invalid";
let f: Awaited<ReturnType<typeof testDatabase>>;
const db = () => f.db;
const shortcut = (body: unknown, headers: Record<string, string> = { "x-qa-preview-token": token }, origin = baseURL) =>
  qaShortcutSignIn(new Request(`${origin}/api/qa/sign-in`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.9", ...headers },
    body: JSON.stringify(body) }), db as never);

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  holder.auth = makeAuth(f.db, { baseURL, secret: "integration-better-auth-secret-0123456789" });
  await f.admin.query("insert into users(id,name,email,email_verified) values ('qa-seeded','Avery Sample 01',$1,true),('real','Real looking','someone@gmail.com',true)", [seeded]);
}, 120_000);
beforeEach(async () => {
  vi.stubEnv("HARVEST_ENV", "test");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("VERCEL_TARGET_ENV", undefined);
  vi.stubEnv("HARVEST_QA_SIGN_IN", undefined);
  vi.stubEnv("DATABASE_URL", f.appURL);
  vi.stubEnv("BETTER_AUTH_URL", baseURL);
  vi.stubEnv("BETTER_AUTH_SECRET", "integration-better-auth-secret-0123456789");
  vi.stubEnv("QA_PREVIEW_TOKEN", token);
  deliver.mockClear();
  await f.admin.query("delete from sessions; delete from verifications; delete from otp_cooldowns; delete from rate_limits");
});
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });

it("signs a seeded synthetic account in without email, with a session and a marked audit row", async () => {
  const response = await shortcut({ email: seeded.toUpperCase() });
  expect(response.status).toBe(204);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
  expect(response.headers.getSetCookie().join(";")).toMatch(/session_token=/);
  expect(deliver).not.toHaveBeenCalled();
  expect((await f.admin.query("select count(*)::int as n from sessions where user_id='qa-seeded'")).rows[0].n).toBe(1);
  const audit = await f.admin.query("select metadata from audit_logs where action='auth.sign_in' and actor_id='qa-seeded'");
  expect(audit.rows).toEqual([{ metadata: { qa_test_sign_in: "shortcut" } }]);
  // The code was single use and stored hashed only.
  expect((await f.admin.query("select count(*)::int as n from verifications")).rows[0].n).toBe(0);
});

it("is rate-limited by the normal OTP cooldown", async () => {
  expect((await shortcut({ email: seeded })).status).toBe(204);
  expect((await shortcut({ email: seeded })).status).toBe(429);
  expect(deliver).not.toHaveBeenCalled();
});

it("refuses real-looking and unknown accounts and never creates one", async () => {
  for (const email of ["someone@gmail.com", "nobody@example.invalid", "x@example.test", "not-an-email"]) {
    expect((await shortcut({ email })).status, email).toBe(422);
  }
  expect((await shortcut({ email: seeded, extra: true })).status).toBe(422);
  expect((await f.admin.query("select count(*)::int as n from users")).rows[0].n).toBe(2);
  expect((await f.admin.query("select count(*)::int as n from sessions")).rows[0].n).toBe(0);
  expect(deliver).not.toHaveBeenCalled();
});

it("is hidden without the token, with a wrong token, another origin, or any production-like setting", async () => {
  expect((await shortcut({ email: seeded }, {})).status).toBe(404);
  expect((await shortcut({ email: seeded }, { "x-qa-preview-token": `${token}x` })).status).toBe(404);
  expect((await shortcut({ email: seeded }, undefined, "http://localhost:3001")).status).toBe(404);
  expect((await shortcut({ email: seeded }, undefined, "https://harvest.example.test")).status).toBe(404);
  for (const [name, value] of [["HARVEST_ENV", "production"], ["HARVEST_ENV", "staging"], ["HARVEST_ENV", undefined], ["NODE_ENV", "production"],
    ["VERCEL_ENV", "production"], ["QA_PREVIEW_TOKEN", undefined], ["HARVEST_QA_SIGN_IN", "local"], ["BETTER_AUTH_URL", "https://harvest.example.test"],
    ["DATABASE_URL", "postgresql://harvest_app@db.example.test/harvest"]] as const) {
    vi.stubEnv(name, value);
    expect((await shortcut({ email: seeded })).status, `${name}=${value}`).toBe(404);
    vi.unstubAllEnvs();
    vi.stubEnv("HARVEST_ENV", "test"); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", f.appURL); vi.stubEnv("BETTER_AUTH_URL", baseURL);
    vi.stubEnv("BETTER_AUTH_SECRET", "integration-better-auth-secret-0123456789"); vi.stubEnv("QA_PREVIEW_TOKEN", token);
    vi.stubEnv("VERCEL_ENV", undefined); vi.stubEnv("VERCEL_TARGET_ENV", undefined); vi.stubEnv("HARVEST_QA_SIGN_IN", undefined);
  }
  expect((await f.admin.query("select count(*)::int as n from sessions")).rows[0].n).toBe(0);
});

it("leaves ordinary OTP sign-in unchanged: a normal request still sends the code", async () => {
  const auth = makeAuth(f.db, { baseURL, secret: "integration-better-auth-secret-0123456789" });
  const response = await auth.handler(new Request(`${baseURL}/api/auth/email-otp/send-verification-otp`, { method: "POST",
    headers: { origin: baseURL, "content-type": "application/json", "x-forwarded-for": "127.0.0.10" }, body: JSON.stringify({ email: seeded, type: "sign-in" }) }));
  expect(response.status).toBe(200);
  expect(deliver).toHaveBeenCalledTimes(1);
});
