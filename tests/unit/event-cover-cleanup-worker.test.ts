import { expect, it, vi } from "vitest";
import type { createPool } from "../../src/db/pool";
import { runEventCoverCleanupWorker } from "../../src/server/event-cover-cleanup-worker";

const enabled = { NODE_ENV: "test", HARVEST_EVENT_COVER_CLEANUP_ENABLED: "1", WORKER_DATABASE_URL: "postgresql://local.invalid/test" };
const output = () => ({ log: vi.fn(), error: vi.fn() });

it("is hard-disabled in production and requires explicit non-production opt-in", async () => {
  const open = vi.fn<typeof createPool>();
  const storage = vi.fn();
  const log = output();
  for (const env of [{ ...enabled, NODE_ENV: "production" }, { ...enabled, VERCEL_ENV: "production" },
    { ...enabled, HARVEST_EVENT_COVER_CLEANUP_ENABLED: "0" }, { ...enabled, NODE_ENV: "unknown" }]) {
    await expect(runEventCoverCleanupWorker("run", env, open, storage, log)).resolves.toBe(0);
  }
  expect(open).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
  expect(log.error).not.toHaveBeenCalled();
});

it("reports failure for an application login before opening storage", async () => {
  const pool = { query: vi.fn().mockResolvedValue({ rows: [{ name: "harvest_app", rolsuper: false, rolbypassrls: false }] }),
    on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
  const open = vi.fn(() => pool as unknown as ReturnType<typeof createPool>);
  const storage = vi.fn();
  const log = output();
  await expect(runEventCoverCleanupWorker("run", enabled, open, storage, log)).resolves.toBe(1);
  expect(open).toHaveBeenCalledExactlyOnceWith(enabled.WORKER_DATABASE_URL);
  expect(pool.query).toHaveBeenCalledTimes(1);
  expect(pool.end).toHaveBeenCalledOnce();
  expect(storage).not.toHaveBeenCalled();
  expect(log.error).toHaveBeenCalledExactlyOnceWith('{"event":"event_cover_cleanup_alert","reason":"failed"}');
});

it("reports due backlog in check mode without opening storage", async () => {
  const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ name: "harvest_worker", rolsuper: false, rolbypassrls: false }] })
    .mockResolvedValueOnce({ rows: [{ pending: true }] }), on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
  const open = vi.fn(() => pool as unknown as ReturnType<typeof createPool>);
  const storage = vi.fn();
  const log = output();
  await expect(runEventCoverCleanupWorker("check", enabled, open, storage, log)).resolves.toBe(1);
  expect(storage).not.toHaveBeenCalled();
  expect(log.error).toHaveBeenCalledExactlyOnceWith('{"event":"event_cover_cleanup_alert","reason":"backlog"}');
});
