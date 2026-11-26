import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { qaPreviewTokenBinding, qaSeedDatabases, qaSeedTarget, qaShortcutNodeAccess, qaSyntheticEmail } from "../../src/server/qa-preview-gate";
import { qaShortcutAccess, qaShortcutCode, qaShortcutDeliver, qaShortcutScope } from "../../src/server/qa-shortcut-scope";
import { workerSettings } from "../../src/server/worker-settings";
import { qaShortcutSignIn } from "../../src/server/qa-shortcut";
import { inspectQaBoundary } from "../../scripts/source-guards";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const token = "t".repeat(40);
const local = "postgresql://harvest_app:pw@127.0.0.1:5432/harvest_test_abc";
const allowed = [{ stage: "staging" as const, host: "ep-fixture.example.test", database: "harvest", note: "fixture" }];
const remote = "postgresql://harvest_app:pw@ep-fixture.example.test/harvest?sslmode=require";

it("QA-1 seed: refuses production, unknown stages, wrong hosts, databases and roles", () => {
  expect(qaSeedTarget({ HARVEST_ENV: "test", DATABASE_URL: local }).stage).toBe("test");
  expect(qaSeedTarget({ HARVEST_ENV: "staging", DATABASE_URL: remote }, allowed).stage).toBe("staging");
  for (const env of [{}, { HARVEST_ENV: "production" }, { HARVEST_ENV: "" }, { HARVEST_ENV: "Staging" }, { HARVEST_ENV: "local" },
    { HARVEST_ENV: "staging", NODE_ENV: "production" }, { HARVEST_ENV: "staging", VERCEL_ENV: "production" }, { HARVEST_ENV: "test", VERCEL_TARGET_ENV: "production" }]) {
    expect(() => qaSeedTarget({ DATABASE_URL: remote, ...env }, allowed), JSON.stringify(env)).toThrow("QA_SEED_ENV_REFUSED");
  }
  for (const [stage, url] of [
    ["staging", "postgresql://harvest_app:pw@ep-other.example.test/harvest"], // host not on the list
    ["staging", "postgresql://harvest_app:pw@ep-fixture.example.test.evil.test/harvest"],
    ["staging", "postgresql://harvest_app:pw@ep-fixture.example.test/neondb"], // other database
    ["staging", "postgresql://harvest_owner:pw@ep-fixture.example.test/harvest"], // owner login bypasses the app role
    ["staging", "postgresql://harvest_app:pw@ep-fixture.example.test:6543/harvest"],
    ["staging", "postgresql://harvest_app:pw@ep-fixture.example.test/harvest?options=endpoint%3Dother"],
    ["preview", remote], // listed for another stage only
    ["staging", local], ["test", remote], ["test", "postgresql://harvest_app:pw@127.0.0.1/harvest"], ["test", "https://127.0.0.1/harvest_test"],
    ["staging", undefined], ["staging", "not a url"],
  ] as const) {
    expect(() => qaSeedTarget({ HARVEST_ENV: stage, DATABASE_URL: url }, allowed), `${stage} ${url}`).toThrow("QA_SEED_TARGET_REFUSED");
  }
  // The committed list names no production, staging or dev Neon endpoint recorded in the repository.
  for (const forbidden of ["ep-still-cell-baeb9pie"]) expect(qaSeedDatabases.some((item) => item.host.startsWith(forbidden))).toBe(false);
});

it("QA-2 binding: only a preview or local Worker accepts the token, and only a strong distinct one", () => {
  expect(qaPreviewTokenBinding("production", {}, [])).toBeNull();
  expect(qaPreviewTokenBinding("preview", { QA_PREVIEW_TOKEN: token }, ["other"])).toBe(token);
  expect(qaPreviewTokenBinding("local", { QA_PREVIEW_TOKEN: token }, [])).toBe(token);
  for (const [stage, value, others] of [["production", token, []], ["staging", token, []], ["unknown", token, []], ["preview", "short", []],
    ["preview", " ".repeat(40), []], ["preview", token, [token]]] as const) {
    expect(() => qaPreviewTokenBinding(stage, { QA_PREVIEW_TOKEN: value }, others), stage).toThrow("QA_PREVIEW_TOKEN_REFUSED");
  }
});

it("QA-2 Node gate: HARVEST_ENV=test, loopback origin, local test database and a token, nothing else", () => {
  const env = { HARVEST_ENV: "test", NODE_ENV: "development", DATABASE_URL: local, QA_PREVIEW_TOKEN: token, BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "s".repeat(40) };
  expect(qaShortcutNodeAccess(env)).toEqual({ token, origin: "http://localhost:3000" });
  for (const patch of [{ HARVEST_ENV: "production" }, { HARVEST_ENV: "preview" }, { HARVEST_ENV: "staging" }, { HARVEST_ENV: undefined }, { NODE_ENV: "production" },
    { VERCEL_ENV: "preview" }, { VERCEL_TARGET_ENV: "preview" }, { QA_PREVIEW_TOKEN: undefined }, { QA_PREVIEW_TOKEN: "short" },
    { QA_PREVIEW_TOKEN: "s".repeat(40) }, { DATABASE_URL: "postgresql://harvest_app@prod.example.test/harvest_test_a" },
    { DATABASE_URL: "postgresql://harvest_app@127.0.0.1/harvest" }, { BETTER_AUTH_URL: "https://harvest.example.test" }, { BETTER_AUTH_URL: undefined },
    { HARVEST_QA_SIGN_IN: "local" }]) {
    expect(qaShortcutNodeAccess({ ...env, ...patch }), JSON.stringify(patch)).toBeNull();
  }
});

it("QA-2 Worker gate: the stage and binding decide; staging and production never open, whatever process.env says", () => {
  vi.stubEnv("HARVEST_ENV", "test");
  vi.stubEnv("QA_PREVIEW_TOKEN", token);
  const settings = (stage: string, qaPreviewToken: string | null) => ({ stage, qaPreviewToken, origin: "https://preview.example.invalid" }) as never;
  expect(workerSettings.run(settings("preview", token), qaShortcutAccess)).toEqual({ token, origin: "https://preview.example.invalid" });
  for (const [stage, value] of [["production", token], ["staging", token], ["preview", null]] as const) {
    expect(workerSettings.run(settings(stage, value), qaShortcutAccess)).toBeNull();
  }
});

it("QA-2 hooks: ordinary requests send normally; inside the scope nothing is sent and a closed gate refuses", async () => {
  const send = vi.fn(async () => undefined);
  const input = { email: "fixture@example.invalid", type: "sign-in" };
  expect(qaShortcutCode(input)).toBeUndefined();
  await qaShortcutDeliver(input, send);
  expect(send).toHaveBeenCalledTimes(1);
  // Gate closed (no test environment): the scope generates nothing and delivery refuses instead of sending.
  await qaShortcutScope.run({ email: input.email }, async () => {
    expect(qaShortcutCode(input)).toBeUndefined();
    await expect(qaShortcutDeliver(input, send)).rejects.toThrow("QA_SHORTCUT_UNAVAILABLE");
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it("QA-2 route: hidden on a production Worker and without the gate", async () => {
  const request = () => new Request("https://production.example.invalid/api/qa/sign-in", { method: "POST", headers: { "x-qa-preview-token": token }, body: "{}" });
  const db = vi.fn();
  expect((await qaShortcutSignIn(request(), db)).status).toBe(404);
  const production = { stage: "production", qaPreviewToken: token, origin: "https://production.example.invalid" } as never;
  const response = await workerSettings.run(production, () => qaShortcutSignIn(request(), db));
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(db).not.toHaveBeenCalled();
});

it("accepts only reserved synthetic addresses", () => {
  expect(qaSyntheticEmail("8c1d2c49-1d6b-5f1e-8a0b-1f7a1f0d1e2a@example.invalid")).toBe(true);
  for (const email of ["someone@gmail.com", "a@example.invalid.com", "a@example.test", "a@qa.harvest.invalid", "A@example.invalid", "@example.invalid", "a@sub.example.invalid"]) {
    expect(qaSyntheticEmail(email), email).toBe(false);
  }
});

it("source guard keeps the token, scope and route inside their boundary and out of CI and Worker config", () => {
  expect(inspectQaBoundary("src/server/qa-preview-gate.ts", "env.QA_PREVIEW_TOKEN")).toEqual([]);
  expect(inspectQaBoundary("src/server/worker-settings.ts", "QA_PREVIEW_TOKEN?: string")).toEqual([]);
  expect(inspectQaBoundary("src/server/other.ts", "process.env.QA_PREVIEW_TOKEN")).toHaveLength(1);
  expect(inspectQaBoundary("src/app/page.tsx", "fetch('/api/qa/sign-in')")).toHaveLength(1);
  expect(inspectQaBoundary("src/server/other.ts", "import { qaShortcutScope } from './qa-shortcut-scope'")).toHaveLength(1);
  expect(inspectQaBoundary("src/server/auth-otp-hooks.ts", "from './qa-shortcut-scope'")).toEqual([]);
  for (const file of [".github/workflows/ci.yml", ".env.example", "cloudflare/staging.json", "cloudflare/production.json"]) {
    expect(inspectQaBoundary(file, "QA_PREVIEW_TOKEN: x"), file).toHaveLength(1);
  }
  expect(inspectQaBoundary("tests/e2e/qa.spec.ts", "QA_PREVIEW_TOKEN /api/qa/sign-in")).toEqual([]);
});
