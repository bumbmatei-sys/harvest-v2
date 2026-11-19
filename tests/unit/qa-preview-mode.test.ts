import { afterEach, expect, it, vi } from "vitest";
import { qaOtpResponse } from "../../src/server/auth-otp-hooks-preview";
import { qaSignInMode } from "../../src/server/qa-sign-in-gate";

vi.mock("../../src/server/qa-database-allowlist", async (load) => {
  const actual = await load<typeof import("../../src/server/qa-database-allowlist")>();
  const allowlist = [{ branch: "vercel-preview" as const, branchId: "br-shy-hall-baslhh18",
    directHost: "qa.example.test", pooledHost: "qa-pooler.example.test", database: "harvest" }];
  return { ...actual, qaDatabaseAllowed: (...[url, mode]: Parameters<typeof actual.qaDatabaseAllowed>) =>
    actual.qaDatabaseAllowed(url, mode, allowlist) };
});

it("requires the exact preview environment and pinned preview database even in a production build", () => {
  const base = { HARVEST_QA_SIGN_IN: "preview", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview",
    NODE_ENV: "production", DATABASE_URL: "postgres://qa-pooler.example.test/harvest" };
  expect(qaSignInMode(base)).toBe("preview");
  for (const override of [{ VERCEL_TARGET_ENV: "staging" }, { VERCEL_TARGET_ENV: undefined },
    { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, { VERCEL_ENV: undefined },
    { HARVEST_QA_SIGN_IN: "local" }, { DATABASE_URL: "postgres://qa.example.test/harvest_test" },
    { DATABASE_URL: "postgres://staging.example.test/harvest" }]) {
    expect(qaSignInMode({ ...base, ...override })).toBeNull();
  }
});

afterEach(() => vi.unstubAllEnvs());

it("requires the helper key and exact Preview gate before acknowledging readiness", async () => {
  const env = { HARVEST_QA_SIGN_IN: "preview", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview",
    NODE_ENV: "production", DATABASE_URL: "postgres://qa.example.test/harvest",
    QA_SIGN_IN_SECRET: "synthetic-signing-key", QA_SIGN_IN_HELPER_SECRET: "synthetic-helper-key",
    BETTER_AUTH_SECRET: "synthetic-auth-key" };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const db = vi.fn();
  const request = (key: string) => new Request("https://preview.example.test/api/qa/otp?ready=1",
    { headers: { "x-qa-secret": key, "x-forwarded-host": "preview.example.test" } });
  expect((await qaOtpResponse(request("wrong"), db)).status).toBe(404);
  expect((await qaOtpResponse(request(env.QA_SIGN_IN_HELPER_SECRET), db)).status).toBe(204);
  vi.stubEnv("VERCEL_TARGET_ENV", "staging");
  expect((await qaOtpResponse(request(env.QA_SIGN_IN_HELPER_SECRET), db)).status).toBe(404);
  expect(db).not.toHaveBeenCalled();
});
