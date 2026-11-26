import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../database";

// 0114: the runtime logins have a per-database statement_timeout so an aborted request cannot keep an origin connection busy.
// Each testDatabase() re-passwords the shared harvest_app login, so the two databases are used one after the other: each
// describe sets up its database when it starts and closes it before the next one begins.
describe("with a migrating role that can alter the logins", () => {
  let fixture: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => { fixture = await testDatabase(); }, 240_000);
  afterAll(async () => { await fixture?.close(); });

  it("bounds app statements at 20 s and worker statements at 60 s", async () => {
    expect((await fixture.pool.query<{ value: string }>("select current_setting('statement_timeout') as value")).rows[0].value).toBe("20s");
    expect((await fixture.workerPool.query<{ value: string }>("select current_setting('statement_timeout') as value")).rows[0].value).toBe("1min");
    const { rows } = await fixture.admin.query<{ value: string }>("select current_setting('statement_timeout') as value");
    expect(rows[0].value).toBe("0");
  });

  it("cancels an app statement that runs past the limit", async () => {
    const client = await fixture.pool.connect();
    try {
      await client.query("set statement_timeout = '200ms'");
      await expect(client.query("select pg_sleep(2)")).rejects.toMatchObject({ code: "57014" });
    } finally { await client.query("reset statement_timeout"); client.release(); }
    expect((await fixture.pool.query<{ value: string }>("select current_setting('statement_timeout') as value")).rows[0].value).toBe("20s");
  });
});

describe("with an unprivileged migration owner", () => {
  let owned: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => { owned = await testDatabase({ migrationOwner: true }); }, 240_000);
  afterAll(async () => { await owned?.close(); });

  it("leaves the setting unchanged, with a notice, where the migrating role cannot alter the logins", async () => {
    const { rows } = await owned.admin.query<{ count: number }>(`select count(*)::int as count from pg_db_role_setting s
      join pg_database d on d.oid = s.setdatabase where d.datname = current_database()`);
    expect(rows[0].count).toBe(0);
  });
});
