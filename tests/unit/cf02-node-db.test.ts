import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import WebSocket from "ws";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../../src/db/pool", { spy: true });

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it.each([
  { fixture: "the PWA placeholder", url: "postgresql://unused:unused@127.0.0.1:1/harvest_test_unused", Pool: PgPool },
  { fixture: "a pooled Neon URL with options", url: "postgresql://harvest_app:unused@fixture-pooler.neon.tech/harvest?options=endpoint%3Dfixture", Pool: NeonPool },
  { fixture: "a differently named app login", url: "postgresql://preview_app:unused@127.0.0.1:1/harvest", Pool: PgPool },
  { fixture: "a URL with no database path", url: "postgresql://harvest_app:unused@127.0.0.1:1", Pool: PgPool },
])("constructs the legacy Node DB and anonymous auth with $fixture", async ({ url, Pool }) => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("BETTER_AUTH_SECRET", "cf02-local-test-secret-DO-NOT-USE-6ad87b10");
  const connect = vi.spyOn(Pool.prototype, "connect").mockImplementation(() => { throw new Error("Unexpected database checkout"); });
  const query = vi.spyOn(Pool.prototype, "query").mockImplementation(() => { throw new Error("Unexpected database query"); });

  const { createPool } = await import("../../src/db/pool");
  const { getDb } = await import("../../src/db/client");
  const { getAuth } = await import("../../src/server/auth-instance");
  const { optionalSession } = await import("../../src/server/page-session");
  expect(neonConfig.webSocketConstructor).toBe(WebSocket);
  expect(createPool).not.toHaveBeenCalled();

  const auth = getAuth();
  expect(getAuth()).toBe(auth);
  const db = getDb();
  expect(getDb()).toBe(db);
  expect(createPool).toHaveBeenCalledExactlyOnceWith(url);
  const pool = vi.mocked(createPool).mock.results[0].value;
  expect(pool).toBeInstanceOf(Pool);
  expect(pool.options).toMatchObject({ connectionString: url, max: 5, connectionTimeoutMillis: 15_000 });
  expect(pool.listenerCount("error")).toBe(1);
  await expect(optionalSession()).resolves.toBeNull();
  expect(connect).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
  expect(pool.totalCount).toBe(0);
});
