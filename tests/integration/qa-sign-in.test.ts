import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { testDatabase } from "../database";
import { makeAuth } from "../../src/server/auth";
import { qaOtpResponse } from "../../src/server/auth-otp-hooks-preview";

const deliver = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth-otp-hooks", () => import("../../src/server/auth-otp-hooks-preview"));
vi.mock("../../src/server/email", () => ({ sendSignInCode: deliver }));

const baseURL = "http://localhost:3000";
const secret = "test-better-auth-secret-only-for-integration";
const helper = "test-helper-secret-only-for-integration";
const email = "person-01@qa.harvest.invalid";
const realPathAddress = "test@example.test";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let auth: ReturnType<typeof makeAuth>;
beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  auth = makeAuth(fixture.db, { baseURL, secret });
});
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("HARVEST_QA_SIGN_IN", "local");
  vi.stubEnv("DATABASE_URL", fixture.appURL);
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubEnv("QA_SIGN_IN_SECRET", "derived-hardcoded-test-key-stand-in");
  vi.stubEnv("QA_SIGN_IN_HELPER_SECRET", helper);
  deliver.mockClear();
  await fixture.admin.query("delete from verifications; delete from otp_cooldowns; delete from rate_limits");
});
afterAll(async () => { vi.unstubAllEnvs(); await fixture?.close(); });

function post(path: string, body: unknown) {
  return auth.handler(new Request(`${baseURL}/api/auth${path}`, { method: "POST",
    headers: { origin: baseURL, "content-type": "application/json", "x-forwarded-for": "127.0.0.1" }, body: JSON.stringify(body) }));
}
function send(target: string) {
  return post("/email-otp/send-verification-otp", { email: target, type: "sign-in" });
}
function read(target = email, key = helper) {
  return qaOtpResponse(new Request(`${baseURL}/api/qa/otp?email=${encodeURIComponent(target)}`, {
    headers: { "x-qa-secret": key },
  }), () => fixture.db);
}

it("uses the persisted issuance bucket, normal OTP verification and audit without sending", async () => {
  expect((await read()).status).toBe(404);
  expect((await send(email)).status).toBe(200);
  expect((await read(email, "wrong")).status).toBe(404);
  const response = await read();
  expect(response.status).toBe(200);
  const { code } = await response.json();
  expect(code).toMatch(/^\d{6}$/);
  const verified = await post("/sign-in/email-otp", { email, otp: code });
  expect(verified.status).toBe(200);
  const { user } = await verified.json();
  expect((await fixture.admin.query("select metadata from audit_logs where action='auth.sign_in' and actor_id=$1", [user.id])).rows)
    .toContainEqual({ metadata: { qa_test_sign_in: "true" } });
  expect((await read()).status).toBe(404);
  expect(deliver).not.toHaveBeenCalled();
});

it("checks reservation expiry and preserves the normal mail path for other addresses", async () => {
  expect((await send(email)).status).toBe(200);
  await fixture.admin.query("update otp_cooldowns set sent_at=now() - interval '601 seconds' where email=$1", [email]);
  expect((await read()).status).toBe(404);
  expect((await send(realPathAddress)).status).toBe(200);
  expect(deliver).toHaveBeenCalledExactlyOnceWith(realPathAddress, expect.stringMatching(/^\d{6}$/), expect.any(String));
  expect((await read(realPathAddress)).status).toBe(404);
  vi.stubEnv("HARVEST_QA_SIGN_IN", undefined);
  expect((await read()).status).toBe(404);
});
