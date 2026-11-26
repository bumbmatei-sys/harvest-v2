import { createHash, randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { getFileStorage, getStorage } from "../../src/server/storage";
import { R2FileStorage, type FileBucket } from "../../src/server/storage/r2";
import { readWorkerSettings, type WorkerBindings } from "../../src/server/worker-settings";
import { checkForLeaks } from "../cf03/leak-scan";

vi.mock("server-only", () => ({}));

const fakeBucket: FileBucket = {
  get: async () => {
    const bytes = new TextEncoder().encode("fake storage");
    return { body: new Response(bytes).body!, size: bytes.length, httpMetadata: { contentType: "text/plain" } };
  },
  put: async () => { throw new Error("Unexpected test write"); },
};

const secret = () => randomBytes(40).toString("hex");
const fixture = (): WorkerBindings => ({
  HARVEST_ENV: "production", HARVEST_PRODUCTION_ORIGIN: "https://production.example.invalid", BETTER_AUTH_URL: "https://production.example.invalid",
  APP_DATABASE_NAME: "production_fixture", APP_HYPERDRIVE: { connectionString: "postgres://harvest_app@127.0.0.1/production_fixture" },
  BETTER_AUTH_SECRET: secret(), FILE_GRANT_SECRET: secret(), RESEND_API_KEY: secret(),
  EMAIL_FROM: "fixture@example.invalid", FILES: fakeBucket,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("checks every required production binding and rejects QA settings and another Harvest login", () => {
  const env = fixture();
  expect(readWorkerSettings(env).requirePrivateScan).toBe(true);
  for (const key of Object.keys(env) as (keyof WorkerBindings)[]) {
    expect(() => readWorkerSettings({ ...env, [key]: undefined }), key).toThrow("WORKER_CONFIGURATION_INVALID");
  }
  for (const patch of [
    { HARVEST_ENV: "test" }, { HARVEST_ENV: "preview" }, { HARVEST_QA_SIGN_IN: "preview" }, { QA_SIGN_IN_SECRET: "" }, { QA_SIGN_IN_HELPER_SECRET: "" },
    // QA-2: the test sign-in token makes a production Worker refuse to start, as do the other QA settings.
    { QA_PREVIEW_TOKEN: secret() }, { QA_PREVIEW_TOKEN: "" },
    { BETTER_AUTH_URL: "http://production.example.invalid" },
    { APP_HYPERDRIVE: { connectionString: "postgres://harvest_worker@127.0.0.1/production_fixture" } },
    { FILE_GRANT_SECRET: env.BETTER_AUTH_SECRET },
  ]) {
    expect(() => readWorkerSettings({ ...env, ...patch })).toThrow("WORKER_CONFIGURATION_INVALID");
  }
  expect(readWorkerSettings({ ...env, HARVEST_ENV: "preview", BETTER_AUTH_URL: "https://preview.example.invalid" }).requirePrivateScan).toBe(false);
  const token = secret();
  expect(readWorkerSettings({ ...env, HARVEST_ENV: "preview", BETTER_AUTH_URL: "https://preview.example.invalid", QA_PREVIEW_TOKEN: token }).qaPreviewToken === token).toBe(true);
  expect(readWorkerSettings(env).qaPreviewToken).toBeNull();
  for (const patch of [{ HARVEST_ENV: "staging" }, { HARVEST_ENV: "preview", QA_PREVIEW_TOKEN: "short" }, { HARVEST_ENV: "preview", QA_PREVIEW_TOKEN: env.BETTER_AUTH_SECRET }]) {
    expect(() => readWorkerSettings({ ...env, BETTER_AUTH_URL: "https://preview.example.invalid", QA_PREVIEW_TOKEN: token, ...patch })).toThrow("WORKER_CONFIGURATION_INVALID");
  }
  // A deployed binding names a generated login and database; withDb checks the database name on each connection instead.
  const deployed = readWorkerSettings({ ...env, APP_HYPERDRIVE: { connectionString: "postgresql://cd6b1073dbd0@0a1b2c.hyperdrive.local:5432/5a08?sslmode=disable" } });
  expect(deployed.databaseName).toBe("production_fixture");
});

it("reads distinct runtimes from their bindings and ignores equivalent process variables", () => {
  const env = fixture();
  vi.stubEnv("BETTER_AUTH_SECRET", secret());
  vi.stubEnv("RESEND_API_KEY", secret());
  expect(readWorkerSettings(env).authSecret === env.BETTER_AUTH_SECRET).toBe(true);
  expect(readWorkerSettings(env).mailKey === env.RESEND_API_KEY).toBe(true);
  const rotated = secret();
  expect(readWorkerSettings({ ...env, BETTER_AUTH_SECRET: rotated }).authSecret === rotated).toBe(true);
  expect(() => readWorkerSettings({ ...env, BETTER_AUTH_SECRET: undefined })).toThrow("WORKER_CONFIGURATION_INVALID");
});

it("uses the same Node S3 singleton on the ordinary file routes", async () => {
  vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:1");
  vi.stubEnv("S3_BUCKET", "node-fixture");
  vi.stubEnv("S3_ACCESS_KEY_ID", secret());
  vi.stubEnv("S3_SECRET_ACCESS_KEY", secret());
  vi.stubEnv("S3_REGION", "auto");
  expect(getFileStorage("uploader")).toBe(getStorage());
  expect(getFileStorage(null)).toBe(getStorage());
  const url = new URL(await getStorage().presignDownload("workspace/file", "fixture.txt"));
  expect(url.origin).toBe("http://127.0.0.1:1");
  expect(url.pathname).toBe("/node-fixture/workspace/file");
  expect(url.searchParams.get("response-cache-control")).toBe("private, no-store");
});

it("rejects expired or wrong-method grants and reads bytes through the fake", async () => {
  vi.useFakeTimers();
  const origin = "https://preview.example.invalid";
  const storage = new R2FileStorage(fakeBucket, origin, secret(), "owner");
  const url = await storage.presignDownload("workspaces/test/files/test", "fixture.txt");
  expect((await storage.transfer(new Request(url), async () => "owner")).status).toBe(200);
  expect((await storage.transfer(new Request(url), async () => "peer")).status).toBe(404);
  expect((await storage.transfer(new Request(url, { method: "PUT" }), async () => "owner")).status).toBe(404);
  vi.advanceTimersByTime(60_000);
  expect((await storage.transfer(new Request(url), async () => "owner")).status).toBe(404);
  await expect(storage.inspect("key", { mime: "text/plain", size: 12, name: "fixture.txt" })).resolves.toEqual({
    mime: "text/plain", size: 12, checksum: createHash("sha256").update("fake storage").digest("hex"),
  });
  await expect(storage.inspect("key", { mime: "application/pdf", size: 12, name: "fixture.pdf" })).rejects.toThrow();
});

it("fails a leak scan without disclosing its canary", () => {
  const canary = secret();
  expect(() => checkForLeaks("fixture", "innocuous", [canary])).not.toThrow();
  expect(() => checkForLeaks("fixture", canary, [canary])).toThrow(/^Unexpected private material in fixture$/);
});
