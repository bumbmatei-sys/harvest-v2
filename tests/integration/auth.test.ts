import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/db/schema";
import { testDatabase } from "../database";
import { makeAuth } from "../../src/server/auth";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.send }; } }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let auth: ReturnType<typeof makeAuth>;
const baseURL = "http://localhost:3000";
const email = "auth@example.test";
const secret = randomBytes(48).toString("base64url");
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
  auth = makeAuth(fixture.db, { secret, baseURL });
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
    const key = hkdfSync("sha256", secret, "Harvest", "sign-in-email-otp:v1", 32);
    expect(record.value).toBe(`${createHmac("sha256", key).update(JSON.stringify([email, code])).digest("hex")}:0`);
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
    expect((await fixture.admin.query("select * from verifications")).rowCount).toBe(0);
    mocks.send.mockResolvedValue({ data: { id: "mock" }, error: null });
    const code = await sendCode();
    expect((await fixture.admin.query("select cardinality(issued_at) as count from otp_cooldowns")).rows[0].count).toBe(1);
    expect((await auth.api.signInEmailOTP({ body: { email, otp: code } })).user.email).toBe(email);
  });
  it("does not let a delayed delivery failure clear a newer cooldown or code", async () => {
    let failDelivery!: (result: { error: { message: string } }) => void;
    mocks.send.mockImplementationOnce(() => new Promise((resolve) => { failDelivery = resolve; }));
    const delayed = auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await fixture.admin.query("update otp_cooldowns set sent_at = now() - interval '61 seconds'");
    const code = await sendCode();
    failDelivery({ error: { message: "private provider detail" } });
    expect(await delayed).toBeInstanceOf(Error);
    await expect(sendCode()).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    expect((await auth.api.signInEmailOTP({ body: { email, otp: code } })).user.email).toBe(email);
  });
  it("does not accept a code hash copied to another email", async () => {
    const code = await sendCode();
    const other = "other@example.test";
    await sendCode(other);
    await fixture.admin.query("update verifications set value = (select value from verifications where identifier = $1) where identifier = $2", [`sign-in-otp-${email}`, `sign-in-otp-${other}`]);
    await expect(auth.api.signInEmailOTP({ body: { email: other, otp: code } })).rejects.toThrow();
    expect((await auth.api.signInEmailOTP({ body: { email: email.toUpperCase(), otp: code } })).user.email).toBe(email);
  });
  it("atomically caps parallel per-email issuance at five per rolling hour", async () => {
    for (let i = 0; i < 4; i++) {
      await sendCode();
      await fixture.admin.query("update otp_cooldowns set sent_at = now() - interval '61 seconds'");
    }
    const pool = new Pool({ connectionString: fixture.appURL, max: 10 });
    const concurrentAuth = makeAuth(drizzle(pool, { schema }), { secret, baseURL });
    try {
      const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) =>
        concurrentAuth.api.sendVerificationOTP({ body: { email: i % 2 ? email.toUpperCase() : email, type: "sign-in" } })));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      for (const result of results) if (result.status === "rejected") expect(result.reason).toMatchObject({ status: "TOO_MANY_REQUESTS" });
    } finally { await pool.end(); }
    expect(mocks.send).toHaveBeenCalledTimes(5);
    await fixture.admin.query("update otp_cooldowns set sent_at = now() - interval '61 seconds'");
    await expect(sendCode()).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    await fixture.admin.query("update otp_cooldowns set issued_at = array(select t - interval '61 minutes' from unnest(issued_at) t)");
    await sendCode();
    expect(mocks.send).toHaveBeenCalledTimes(6);
  });
  it("caps per-email issuance at twenty per rolling day even after hourly windows expire", async () => {
    for (let hour = 0; hour < 4; hour++) {
      for (let i = 0; i < 5; i++) {
        await sendCode();
        await fixture.admin.query("update otp_cooldowns set sent_at = now() - interval '61 seconds'");
      }
      await fixture.admin.query("update otp_cooldowns set issued_at = array(select t - interval '2 hours' from unnest(issued_at) t)");
    }
    await expect(sendCode(email.toUpperCase())).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    expect(mocks.send).toHaveBeenCalledTimes(20);
    await fixture.admin.query("update otp_cooldowns set issued_at = array(select t - interval '25 hours' from unnest(issued_at) t)");
    await sendCode();
    expect((await fixture.admin.query("select cardinality(issued_at) as count from otp_cooldowns")).rows[0].count).toBe(1);
  });
  it("bounds guesses across resends by the issuance cap", async () => {
    for (let send = 0; send < 5; send++) {
      const code = await sendCode();
      const wrong = code === "000000" ? "111111" : "000000";
      for (let guess = 0; guess < 5; guess++) await expect(auth.api.signInEmailOTP({ body: { email, otp: wrong } })).rejects.toThrow();
      await expect(auth.api.signInEmailOTP({ body: { email, otp: code } })).rejects.toThrow();
      await fixture.admin.query("update otp_cooldowns set sent_at = now() - interval '61 seconds'");
    }
    await expect(sendCode()).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    expect(mocks.send).toHaveBeenCalledTimes(5);
    expect((await fixture.admin.query("select * from verifications")).rowCount).toBe(0);
  });
  it("counts at most five attempts for ten parallel wrong guesses on separate connections", async () => {
    // Observe every committed increment, including records later consumed/deleted.
    await fixture.admin.query(`
      create table otp_attempt_observations (attempt integer not null);
      grant insert on otp_attempt_observations to harvest_app;
      create function observe_otp_attempt() returns trigger language plpgsql as $$
        begin insert into otp_attempt_observations values (split_part(new.value, ':', 2)::integer); return new; end;
      $$;
      create trigger observe_otp_attempt after insert on verifications for each row execute function observe_otp_attempt();
    `);
    const pool = new Pool({ connectionString: fixture.appURL, max: 10 });
    const concurrentAuth = makeAuth(drizzle(pool, { schema }), { secret, baseURL });
    try {
      const code = await sendCode();
      const wrong = code === "000000" ? "111111" : "000000";
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => concurrentAuth.api.signInEmailOTP({ body: { email, otp: wrong } })));
      expect(results.every((result) => result.status === "rejected")).toBe(true);
      const { rows: observations } = await fixture.admin.query("select attempt from otp_attempt_observations where attempt > 0 order by attempt");
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.length).toBeLessThanOrEqual(5);
      expect(observations.map((row) => row.attempt)).toEqual(Array.from({ length: observations.length }, (_, i) => i + 1));
      const { rows } = await fixture.admin.query("select value from verifications");
      if (rows.length) {
        const attempts = Number(rows[0].value.split(":").at(-1));
        expect(attempts).toBeGreaterThan(0);
        expect(attempts).toBeLessThanOrEqual(5);
        for (let i = attempts; i < 5; i++) await expect(concurrentAuth.api.signInEmailOTP({ body: { email, otp: wrong } })).rejects.toThrow();
      }
      await expect(concurrentAuth.api.signInEmailOTP({ body: { email, otp: code } })).rejects.toThrow();
      expect((await fixture.admin.query("select max(attempt) as max, count(*)::integer as count from otp_attempt_observations where attempt > 0")).rows[0]).toEqual({ max: 5, count: 5 });
    } finally {
      await pool.end();
      await fixture.admin.query("drop trigger observe_otp_attempt on verifications; drop function observe_otp_attempt(); drop table otp_attempt_observations");
    }
  });
  it("rejects missing or untrusted forwarded IPs before creating any shared bucket", async () => {
    for (const value of ["", "198.51.100.1, 192.0.2.10", "invalid"]) {
      for (let i = 0; i < 4; i++) {
        expect((await request("/email-otp/send-verification-otp", { email: `missing${i}@example.test`, type: "sign-in" }, { "x-forwarded-for": value })).status).toBe(503);
      }
    }
    const missing = new Request(`${baseURL}/api/auth/sign-in/email-otp`, { method: "POST", headers: { "content-type": "application/json", origin: baseURL }, body: JSON.stringify({ email, otp: "000000" }) });
    expect((await auth.handler(missing)).status).toBe(503);
    expect((await fixture.admin.query("select * from rate_limits")).rowCount).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
    expect((await request("/email-otp/send-verification-otp", { email, type: "sign-in" })).status).toBe(200);
  });
  it("resolves configured multi-hop proxy chains into independent client limits", async () => {
    const proxyAuth = makeAuth(fixture.db, { secret, baseURL, ipAddressHeaders: ["x-ingress-client-ip"], trustedProxies: ["192.0.2.10/32", "192.0.2.11"] });
    for (let client = 1; client <= 2; client++) {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const response = await proxyAuth.handler(new Request(`${baseURL}/api/auth/email-otp/send-verification-otp`, {
          method: "POST", headers: { "content-type": "application/json", origin: baseURL,
            "x-forwarded-for": "203.0.113.9", "x-ingress-client-ip": `203.0.113.${i + 10}, 198.51.100.${client}, 192.0.2.10, 192.0.2.11` },
          body: JSON.stringify({ email: `client${client}-${i}@example.test`, type: "sign-in" }),
        }));
        statuses.push(response.status);
      }
      expect(statuses).toEqual([200, 200, 200, 429]);
    }
    const { rows } = await fixture.admin.query("select key from rate_limits");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.key.split("|")[0]).sort()).toEqual(["198.51.100.1", "198.51.100.2"]);
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
