import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../src/db/request";
import { sessions, users, workspaceMembers, workspaces } from "../../src/db/schema";
import { makeAuth } from "../../src/server/auth";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";

type Auth = ReturnType<typeof makeAuth>;
type ScopeOptions = { signal?: AbortSignal; timeoutMs?: number };
export type IsolationRuntime = {
  app<T>(work: (db: Database) => Promise<T>, options?: ScopeOptions): Promise<T>;
  worker<T>(work: (db: Database) => Promise<T>): Promise<T>;
  session(headers: Headers): ReturnType<Auth["api"]["getSession"]>;
  authSecret: string;
};
export type IsolationFixture = { a: string; b: string; ids: { a: string; b: string; member: string } };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sqlState = (error: unknown, code: string): boolean =>
  error instanceof Error && (("code" in error && error.code === code) || sqlState(error.cause, code));

export async function seedIsolation(runtime: IsolationRuntime): Promise<IsolationFixture> {
  const ids = { a: randomUUID(), b: randomUUID(), member: randomUUID() };
  return runtime.app(async (db) => {
    await db.insert(users).values(Object.values(ids).map((id) => ({ id, name: "CF-02 fixture", email: `${id}@example.test` })));
    const a = (await createWorkspace(db, ids.a, "CF-02 A")).tenantId;
    const b = (await createWorkspace(db, ids.b, "CF-02 B")).tenantId;
    await withTenant(db, ids.a, a, "members:write", (tx) => tx.insert(workspaceMembers)
      .values({ userId: ids.member, tenantId: a, roleId: "member" }));
    return { ids, a, b };
  });
}

export async function databases(runtime: IsolationRuntime) {
  const name = async (db: Database) => (await db.execute<{ name: string }>(sql`select current_database() as name`)).rows[0].name;
  return Promise.all([runtime.app(name), runtime.worker(name)]);
}

async function unscoped(db: Database) {
  const { rows: [state] } = await db.execute<{ pid: number; actor: string | null; tenant: string | null }>(sql`
    select pg_backend_pid() as pid, nullif(current_setting('app.user_id', true), '') as actor,
      nullif(current_setting('app.tenant_id', true), '') as tenant`);
  assert.equal(state.actor, null);
  assert.equal(state.tenant, null);
  assert.deepEqual(await db.select().from(workspaces), []);
  return state.pid;
}

const timeout = (error: unknown) => error instanceof Error && error.name === "TimeoutError";
const abort = (error: unknown) => error instanceof Error && error.name === "AbortError";
const read = (db: Database, id: string, tenant: string) => withTenant(db, id, tenant, "workspace:read", (tx) =>
  tx.select({ id: workspaces.tenantId, name: workspaces.name }).from(workspaces));

export const isolationCases = {
  async concurrent(runtime: IsolationRuntime, f: IsolationFixture) {
    await Promise.all(Array.from({ length: 12 }, (_, i) => {
      const key = i % 2 ? "a" : "b";
      return runtime.app(async (db) => {
        const other = key === "a" ? "b" : "a";
        // Parallel transactions from one request must not interleave on its connection.
        const results = await Promise.all([
          read(db, f.ids[key], f[key]),
          read(db, f.ids[other], f[other]),
        ]);
        assert.deepEqual(results.map((rows) => rows.map((row) => row.id)), [[f[key]], [f[other]]]);
        await unscoped(db);
      });
    }));
  },

  async crossTenant(runtime: IsolationRuntime, f: IsolationFixture) {
    await assert.rejects(runtime.app((db) => read(db, f.ids.a, f.b)), { status: 403 });
    await runtime.app((db) => withTenant(db, f.ids.a, f.a, "workspace:read", async (tx) => {
      assert.deepEqual(await tx.select().from(workspaces).where(eq(workspaces.tenantId, f.b)), []);
      assert.deepEqual(await tx.update(workspaces).set({ name: "Forbidden" }).where(eq(workspaces.tenantId, f.b)).returning(), []);
    }));
    await assert.rejects(runtime.app((db) => withTenant(db, f.ids.a, f.a, "workspace:read",
      (tx) => tx.insert(workspaceMembers).values({ tenantId: f.b, userId: f.ids.a, roleId: "owner" }))),
    (error) => sqlState(error, "42501"));
  },

  async revoked(runtime: IsolationRuntime, f: IsolationFixture) {
    // Hold an uncommitted deletion. The member's first MVCC read still sees the
    // row, but the subsequent FOR SHARE must wait and then reject the member.
    const deletion = Promise.withResolvers<void>();
    const commit = Promise.withResolvers<void>();
    const remove = runtime.app((db) => withTenant(db, f.ids.a, f.a, "members:write", async (tx) => {
      await tx.delete(workspaceMembers).where(and(eq(workspaceMembers.tenantId, f.a), eq(workspaceMembers.userId, f.ids.member)));
      deletion.resolve();
      await commit.promise;
    }));
    try {
      await Promise.race([deletion.promise, remove]);
      const denied = assert.rejects(runtime.app((db) => read(db, f.ids.member, f.a)), { status: 403 });
      // Attach an observer while waiting for PostgreSQL to report the row lock.
      void denied.catch(() => {});
      try {
        await runtime.app(async (db) => {
          for (let attempt = 0; attempt < 100; attempt++) {
            const { rows } = await db.execute<{ waiting: boolean }>(sql`
              select exists (select 1 from pg_catalog.pg_stat_activity
                where usename = current_user and wait_event_type = 'Lock'
                  and query ilike '%workspace_members%for share%') as waiting`);
            if (rows[0].waiting) return;
            await sleep(20);
          }
          throw new Error("Membership read did not reach its row lock");
        });
      } finally {
        commit.resolve();
        await remove;
        await denied;
      }
    } finally {
      commit.resolve();
      await remove;
    }
  },

  async rollback(runtime: IsolationRuntime, f: IsolationFixture) {
    const marker = randomUUID();
    await runtime.app(async (db) => {
      await assert.rejects(withTenant(db, f.ids.a, f.a, "settings:write", async (tx) => {
        await tx.update(workspaces).set({ name: marker }).where(eq(workspaces.tenantId, f.a));
        throw new Error("intentional rollback");
      }), /intentional rollback/);
      await unscoped(db);
    });
    await runtime.app(async (db) => assert.notEqual((await read(db, f.ids.a, f.a))[0].name, marker));
  },

  async readAfterWrite(runtime: IsolationRuntime, f: IsolationFixture) {
    const marker = randomUUID();
    await runtime.app((db) => withTenant(db, f.ids.a, f.a, "settings:write",
      (tx) => tx.update(workspaces).set({ name: marker }).where(eq(workspaces.tenantId, f.a))));
    await runtime.app(async (db) => {
      await unscoped(db);
      assert.equal((await read(db, f.ids.a, f.a))[0].name, marker);
    });
  },

  async roles(runtime: IsolationRuntime) {
    await assert.rejects(runtime.app((db) => db.execute(sql`select public.social_publish_claim(1, 300)`)),
      (error) => sqlState(error, "42501"));
    await assert.rejects(runtime.worker((db) => db.select().from(workspaces)), (error) => sqlState(error, "42501"));
    // Can call a worker-only no-op with synthetic IDs without consuming work.
    await runtime.worker(async (db) => {
      const { rows: [row] } = await db.execute<{ status: string }>(sql`
        select public.social_publish_complete(${randomUUID()}, ${randomUUID()}, ${randomUUID()}, 'failed', null, 'PROVIDER_REJECTED', 0) as status`);
      assert.equal(row.status, "stale");
    });
  },

  async timeoutAbort(runtime: IsolationRuntime, f: IsolationFixture) {
    const controller = new AbortController();
    await assert.rejects(runtime.app((db) => withTenant(db, f.ids.a, f.a, "settings:write", async (tx) => {
      await tx.update(workspaces).set({ name: "Abort canary" }).where(eq(workspaces.tenantId, f.a));
      const abortTimer = setTimeout(() => controller.abort(), 50);
      try { return await tx.execute(sql`select pg_sleep(1)`); }
      finally { clearTimeout(abortTimer); }
    }), { signal: controller.signal }), abort);
    await assert.rejects(runtime.app((db) => db.execute(sql`select pg_sleep(3)`), { timeoutMs: 1_000 }), timeout);
    await runtime.app(async (db) => {
      await unscoped(db);
      assert.notEqual((await read(db, f.ids.a, f.a))[0].name, "Abort canary");
    });
  },

  async authExpiry(runtime: IsolationRuntime, f: IsolationFixture) {
    const token = randomUUID();
    const id = randomUUID();
    await runtime.app((db) => db.insert(sessions).values({ id, token, userId: f.ids.a, expiresAt: new Date(Date.now() + 60_000) }));
    const signature = createHmac("sha256", runtime.authSecret).update(token).digest("base64");
    const headers = new Headers({ cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}` });
    assert.equal((await runtime.session(headers))?.user.id, f.ids.a);
    await runtime.app((db) => db.update(sessions).set({ expiresAt: new Date(0) }).where(eq(sessions.id, id)));
    assert.equal(await runtime.session(headers), null);
  },
};
export type IsolationCase = keyof typeof isolationCases;
