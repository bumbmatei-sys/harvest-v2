import { expect, it, vi } from "vitest";
import type { createPool } from "../../src/db/pool";
import { runChatPurgeWorker } from "../../src/server/community-chat-purge-worker";

const enabled = { NODE_ENV: "test", HARVEST_CHAT_PURGE_WORKER_ENABLED: "1", WORKER_DATABASE_URL: "worker-url", DATABASE_URL: "app-url" };
const response = (row: Record<string, unknown> = {}) => ({ rows: [row] });

function worker(deleted: number | Error = 0) {
  const query = vi.fn().mockResolvedValueOnce(response({ name: "harvest_worker", rolsuper: false, rolbypassrls: false }))
    .mockResolvedValue(response());
  const sweep = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ available: false }))
    .mockImplementation(async (statement: string) => {
      if (statement.includes("purge_channels")) {
        if (deleted instanceof Error) throw deleted;
        return response({ result: { deleted } });
      }
      return response();
    });
  const release = vi.fn();
  const end = vi.fn().mockResolvedValue(undefined);
  const openPool = vi.fn().mockReturnValue({ on: vi.fn(), query, connect: async () => ({ query: sweep, release }), end });
  const output = { log: vi.fn(), error: vi.fn() };
  return { openPool, query, sweep, end, output, run: (env: Record<string, string | undefined> = enabled) => runChatPurgeWorker("run", env, openPool as typeof createPool, output) };
}

it.each([{ ...enabled, NODE_ENV: "production" }, { ...enabled, VERCEL_ENV: "production" }, { ...enabled, NODE_ENV: undefined }, {}])(
  "exits before opening a pool when disabled or in production",
  async (env) => {
    const fake = worker();
    expect(await fake.run(env)).toBe(0);
    expect(fake.openPool).not.toHaveBeenCalled();
  },
);

it("runs as the worker over its dedicated connection and closes it", async () => {
  const fake = worker();
  expect(await fake.run()).toBe(0);
  expect(fake.openPool).toHaveBeenCalledWith("worker-url");
  expect(fake.sweep).toHaveBeenLastCalledWith("commit");
  expect(fake.output.error).not.toHaveBeenCalled();
  expect(fake.end).toHaveBeenCalledOnce();
});

it("records backlog in the journal after committing the completed batches", async () => {
  const fake = worker(200);
  expect(await fake.run()).toBe(1);
  expect(fake.sweep).toHaveBeenLastCalledWith("commit");
  expect(fake.output.error).toHaveBeenCalledExactlyOnceWith('{"event":"community_chat_purge_alert","reason":"backlog","channels":true,"dm":false}');
});

it("rolls back failed batches and records a sanitized alert", async () => {
  const fake = worker(new Error("internal details"));
  expect(await fake.run()).toBe(1);
  expect(fake.sweep).toHaveBeenLastCalledWith("rollback");
  expect(fake.query).toHaveBeenLastCalledWith("select public.community_chat_purge_record_failure($1)", ["sweep_failed"]);
  expect(fake.output.error).toHaveBeenCalledExactlyOnceWith('{"event":"community_chat_purge_alert","reason":"failed"}');
});
