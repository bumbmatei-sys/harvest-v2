import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
import { chatPurgeHealth, runChatPurgeJob } from "../../src/server/community-chat-retention";

const run = promisify(execFile);
let db: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { db = await testDatabase({ migrationOwner: true }); });
afterAll(async () => { await db?.close(); });

it("records healthy empty batches and reports a failed run", async () => {
  expect(await chatPurgeHealth(db.workerPool)).toMatchObject({ healthy: false, overdue: true });
  const hasDm = (await db.admin.query("select to_regprocedure('public.community_chat_purge_dm(integer)') is not null as present")).rows[0].present;
  const result = await runChatPurgeJob(db.workerPool);
  expect(result).toMatchObject({ ok: true, channels: { counts: { deleted: 0 }, batches: 1 } });
  if (result.ok) expect(Boolean(result.dm)).toBe(hasDm);
  expect(await chatPurgeHealth(db.workerPool)).toMatchObject({ healthy: true });
  await db.workerPool.query("select public.community_chat_purge_record_failure('sweep_failed')");
  expect(await chatPurgeHealth(db.workerPool)).toMatchObject({ healthy: false, failedSinceSuccess: true });
});

it("the command requires the worker-only URL and refuses an application login", async () => {
  const env = { ...process.env, NODE_ENV: "test", HARVEST_CHAT_PURGE_WORKER_ENABLED: "1", DATABASE_URL: db.workerURL, WORKER_DATABASE_URL: "" };
  const script = ["--import", "tsx", "scripts/community-chat-purge.ts"];
  await expect(run(process.execPath, script, { env })).rejects.toMatchObject({ stderr: '{"event":"community_chat_purge_alert","reason":"failed"}\n'  });
  await expect(run(process.execPath, script, { env: { ...env, WORKER_DATABASE_URL: db.appURL } })).rejects.toMatchObject({ stderr: '{"event":"community_chat_purge_alert","reason":"failed"}\n'  });
  await expect(run(process.execPath, script, { env: { ...env, NODE_ENV: "production", WORKER_DATABASE_URL: "invalid" } }))
    .resolves.toEqual({ stdout: "", stderr: "" });
  const worker = { ...env, DATABASE_URL: "unused", WORKER_DATABASE_URL: db.workerURL };
  expect(JSON.parse((await run(process.execPath, script, { env: worker })).stdout)).toMatchObject({ ok: true });
  expect(JSON.parse((await run(process.execPath, [...script, "check"], { env: worker })).stdout)).toMatchObject({ healthy: true });
});

it("does not publish the channel success while another installed lane is failing", async () => {
  const count = async () => (await db.admin.query(
    "select count(*)::int n from public.community_chat_purge_runs where status='ok'")).rows[0].n;
  const before = await count();
  const faulted = {
    query: db.workerPool.query.bind(db.workerPool),
    async connect() {
      const connection = await db.workerPool.connect();
      return {
        release: connection.release.bind(connection),
        async query(statement: string, values?: number[] | string[]) {
          if (statement.startsWith("select to_regprocedure")) return { rows: [{ available: true }] };
          if (statement.startsWith("select public.community_chat_purge_dm")) throw new Error("synthetic interrupted DM lane");
          return connection.query(statement, values);
        },
      };
    },
  };
  expect(await runChatPurgeJob(faulted)).toEqual({ ok: false });
  expect(await count()).toBe(before);
  expect(await chatPurgeHealth(db.workerPool)).toMatchObject({ healthy: false });
});
