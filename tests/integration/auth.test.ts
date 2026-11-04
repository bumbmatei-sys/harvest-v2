import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../database";
import { makeAuth } from "../../src/server/auth";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.send }; } }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let auth: ReturnType<typeof makeAuth>;
const baseURL = "http://localhost:3000";
const email = "auth@example.test";
async function sendCode(target = email) {
  await auth.api.sendVerificationOTP({ body: { email: target, type: "sign-in" } });
  const message = mocks.send.mock.calls.at(-1)?.[0] as { text: string };
  const code = message.text.match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error("Expected a six-digit test code in mocked email");
  return code;
}
function request(path: string, body?: unknown, headers?: Record<string, string>) {
  return auth.handler(new Request(`${baseURL}/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: baseURL, "x-forwarded-for": "127.0.0.1", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
beforeAll(async () => {
  process.env.RESEND_API_KEY = "re_test_mock_only";
  process.env.EMAIL_FROM = "Harvest <test@example.test>";
  fixture = await testDatabase();
  auth = makeAuth(fixture.db, { secret: randomBytes(48).toString("base64url"), baseURL });
});
beforeEach(async () => {
  await fixture.admin.query("delete from verifications; delete from otp_cooldowns; delete from rate_limits");
  mocks.send.mockReset(); mocks.send.mockResolvedValue({ data: { id: "mock" }, error: null });
});
afterAll(async () => { delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; await fixture?.close(); });
describe("Better Auth email code against PostgreSQL; Resend is always mocked", () => {
  it("stores only a keyed hash with ten-minute expiry and never a password", async () => {
    const code = await sendCode();
    expect(code).toMatch(/^\d{6}$/);
    const { rows: [record] } = await fixture.admin.query("select value, expires_at from verifications");
    expect(record.value).toMatch(/^[a-f0-9]{64}:0$/); expect(record.value).not.toBe(`${code}:0`);
    expect(record.expires_at.getTime() - Date.now()).toBeGreaterThan(590_000);
    expect(record.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(600_000);
  });
  it("signs in, persists and verifies the cookie session, audits sign-in and consumes the OTP", async () => {
    const code = await sendCode();
    const response = await request("/sign-in/email-otp", { email, otp: code });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toContain("session_token=");
    const session = await request("/get-session", undefined, { cookie: cookie! });
    const body = await session.json();
    expect(body.user.email).toBe(email); expect(body.user.emailVerified).toBe(true);
    expect((await fixture.admin.query("select action from audit_logs where actor_id = $1", [body.user.id])).rows).toContainEqual({ action: "auth.sign_in" });
    expect((await fixture.admin.query("select * from accounts where password is not null")).rows).toEqual([]);
    expect((await request("/sign-in/email-otp", { email, otp: code })).status).not.toBe(200);
    expect((await request("/sign-out", {}, { cookie: cookie! })).status).toBe(200);
    expect(await (await request("/get-session", undefined, { cookie: cookie! })).json()).toBeNull();
  });
  it("rejects expired codes", async () => {
    const code = await sendCode();
    await fixture.admin.query("update verifications set expires_at = now() - interval '1 second'");
    await expect(auth.api.signInEmailOTP({ body: { email, otp: code } })).rejects.toThrow();
  });
  it("invalidates the code after five wrong attempts", async () => {
    const code = await sendCode(); const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await expect(auth.api.signInEmailOTP({ body: { email, otp: wrong } })).rejects.toThrow();
    await expect(auth.api.signInEmailOTP({ body: { email, otp: code } })).rejects.toThrow();
  });
  it("enforces a shared, case-insensitive cooldown without replacing the previous code", async () => {
    const code = await sendCode();
    await expect(auth.api.sendVerificationOTP({ body: { email: email.toUpperCase(), type: "sign-in" } })).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect((await auth.api.signInEmailOTP({ body: { email, otp: code } })).user.email).toBe(email);
  });
  it("rotates codes after the cooldown and invalidates the old code", async () => {
    const oldCode = await sendCode();
    await fixture.admin.query("update otp_cooldowns set sent_at = now() - interval '61 seconds'");
    const code = await sendCode();
    expect((await fixture.admin.query("select * from verifications")).rowCount).toBe(1);
    if (code !== oldCode) await expect(auth.api.signInEmailOTP({ body: { email, otp: oldCode } })).rejects.toThrow();
    expect((await auth.api.signInEmailOTP({ body: { email, otp: code } })).user.email).toBe(email);
  });
  it("does not enable passwords or OAuth and rejects non-sign-in OTP requests", async () => {
    expect((await request("/sign-in/email", { email, password: "unused" })).status).not.toBe(200);
    expect((await request("/sign-in/social", { provider: "google" })).status).not.toBe(200);
    await expect(auth.api.sendVerificationOTP({ body: { email, type: "forget-password" } })).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("surfaces Resend failures without exposing provider details", async () => {
    mocks.send.mockResolvedValue({ error: { message: "private provider detail" } });
    await expect(sendCode()).rejects.toThrow("Email delivery failed");
  });
  it("persists HTTP rate limits across auth instances", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await request("/email-otp/send-verification-otp", { email: `rate${i}@example.test`, type: "sign-in" })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    const secondAuth = makeAuth(fixture.db, { secret: randomBytes(48).toString("base64url"), baseURL });
    const response = await secondAuth.handler(new Request(`${baseURL}/api/auth/email-otp/send-verification-otp`, { method: "POST", headers: { "content-type": "application/json", origin: baseURL, "x-forwarded-for": "127.0.0.1" }, body: JSON.stringify({ email: "rate-new@example.test", type: "sign-in" }) }));
    expect(response.status).toBe(429);
  });
});
