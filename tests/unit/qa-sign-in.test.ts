import { afterEach, expect, it, vi } from "vitest";
import { qaDatabaseAllowed, qaPreviewDatabases, qaSeedDatabaseUrl } from "../../src/server/qa-database-allowlist";
import { assertQaSignInSafe, qaSignInMode } from "../../src/server/qa-sign-in-gate";
import { checkQaBoundary, inspectQaBoundary } from "../../scripts/source-guards";
import { qaOtpResponse } from "../../src/server/auth-otp-hooks-preview";
import { qaOtpResponse as productionResponse } from "../../src/server/auth-otp-hooks";

const local = { HARVEST_QA_SIGN_IN: "local", DATABASE_URL: "postgres://localhost/harvest_test_a", NODE_ENV: "development" };

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("accepts only the named preview endpoint and database and treats localhost as local only", () => {
  const allowed = [{ branch: "vercel-preview" as const, branchId: "br-shy-hall-baslhh18",
    directHost: "qa.example.test", pooledHost: "qa-pooler.example.test", database: "harvest" }];
  expect(qaDatabaseAllowed("postgres://qa.example.test/harvest", "preview", allowed)).toBe(true);
  expect(qaDatabaseAllowed("postgresql://qa-pooler.example.test/harvest?sslmode=require", "preview", allowed)).toBe(true);
  for (const url of ["postgres://qa.example.test.unsafe.test/harvest", "postgres://qa.example.test/staging",
    "postgres://qa.example.test/harvest?options=endpoint%3Dother", "https://qa.example.test/harvest",
    "postgres://qa.example.test:7777/harvest"]) expect(qaDatabaseAllowed(url, "preview", allowed)).toBe(false);
  expect(qaDatabaseAllowed("postgres://qa.example.test/harvest", "preview", [{ ...allowed[0], branchId: "br-other" }])).toBe(false);
});

it("keeps the local mode off under Vercel, production, custom staging or a non-test database", () => {
  expect(qaSignInMode(local)).toBe("local");
  for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "" }, { VERCEL_ENV: "development" },
    { DATABASE_URL: "postgres://localhost/harvest_prod" }, { DATABASE_URL: "postgres://prod.example.test/harvest_test_a" },
    { HARVEST_QA_SIGN_IN: "unknown" }, { HARVEST_QA_SIGN_IN: "" }, { HARVEST_QA_SIGN_IN: undefined }]) {
    expect(qaSignInMode({ ...local, ...env })).toBeNull();
  }
  const preview = { ...local, HARVEST_QA_SIGN_IN: "preview", VERCEL_ENV: "preview", NODE_ENV: "production" };
  expect(qaSignInMode({ ...preview, VERCEL_TARGET_ENV: "staging" })).toBeNull();
  expect(qaSignInMode({ ...preview, VERCEL_TARGET_ENV: "preview" })).toBeNull();
});

it("enables Preview with the verified direct endpoint and rejects an unverified pooled hostname", () => {
  const [target] = qaPreviewDatabases;
  const direct = `postgresql://${target.directHost}/${target.database}?sslmode=require`;
  const pooled = direct.replace(".", "-pooler.");
  const env = { NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview", HARVEST_QA_SIGN_IN: "preview" };
  expect(qaSignInMode({ ...env, DATABASE_URL: direct })).toBe("preview");
  expect(qaSignInMode({ ...env, DATABASE_URL: pooled })).toBeNull();
});

it("alarms and fails closed for any set production flag", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(() => assertQaSignInSafe({ ...local, VERCEL_ENV: "production", HARVEST_QA_SIGN_IN: "" })).toThrow("QA_SIGN_IN_MISCONFIGURED");
  expect(() => assertQaSignInSafe({ ...local, NODE_ENV: "production" })).toThrow("QA_SIGN_IN_MISCONFIGURED");
  expect(log).toHaveBeenCalledExactlyOnceWith("qa_sign_in_misconfigured");
  expect(() => assertQaSignInSafe({ NODE_ENV: "production" })).not.toThrow();
  expect(() => assertQaSignInSafe({ ...local, NODE_ENV: "production", VERCEL_ENV: "preview" })).not.toThrow();
});

it("ignores spoofed environment headers and returns a noindex, no-store 404 with no DB access", async () => {
  vi.stubEnv("HARVEST_QA_SIGN_IN", undefined);
  const db = vi.fn();
  const request = new Request("https://preview.example.test/api/qa/otp?email=test@qa.harvest.invalid", { headers: {
    Host: "localhost", "X-Forwarded-Host": "localhost", Origin: "http://localhost",
    "x-vercel-env": "preview", "x-qa-secret": "test-helper",
  } });
  const response = await qaOtpResponse(request, db);
  expect(response.status).toBe(404);
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await productionResponse(request, db)).status).toBe(404);
  expect(db).not.toHaveBeenCalled();
});

it("keeps environment reads, flag assignment and preview OTP imports inside their boundaries", () => {
  expect(checkQaBoundary()).toEqual([]);
  expect(inspectQaBoundary("src/server/rogue.ts", "process.env.HARVEST_QA_SIGN_IN")).toHaveLength(1);
  expect(inspectQaBoundary("src/server/rogue.ts", 'import {authOtpHooks} from "./auth-otp-hooks-preview"')).toHaveLength(1);
  expect(inspectQaBoundary("src/server/rogue.ts", "process.env.QA_SIGN_IN_HELPER_SECRET")).toHaveLength(1);
  expect(inspectQaBoundary(".github/workflows/qa.yaml", 'env: { HARVEST_QA_SIGN_IN: "preview" }')).toHaveLength(1);
  expect(inspectQaBoundary(".env.example", "HARVEST_QA_SIGN_IN=preview")).toHaveLength(1);
});

it("refuses production when selecting a database for the seed reset", () => {
  const { directHost, database } = qaPreviewDatabases[0];
  const DATABASE_URL = `postgres://${directHost}/${database}`;
  expect(qaSeedDatabaseUrl({ DATABASE_URL, VERCEL_ENV: "preview" })).toBe(DATABASE_URL);
  expect(() => qaSeedDatabaseUrl({ DATABASE_URL, NODE_ENV: "production" })).toThrow("QA_SEED_INVALID_TARGET");
  expect(() => qaSeedDatabaseUrl({ DATABASE_URL, VERCEL_ENV: "production" })).toThrow("QA_SEED_INVALID_TARGET");
});
