import { expect, it, vi } from "vitest";
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
