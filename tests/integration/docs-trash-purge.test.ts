import { afterAll, beforeAll, expect, it } from "vitest";
import { users } from "../../src/db/schema";
import { createDoc, createPage, setDocFavorite, updateDoc } from "../../src/server/docs";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const owner = "trash-owner", other = "trash-other";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, elsewhere: string;
const purge = (limit = 100) => fixture.workerPool.query<{ n: number }>("select public.docs_purge_trash($1) as n", [limit]).then(r => r.rows[0].n);
const ids = async (t: string) => (await fixture.admin.query<{ id: string }>("select id from docs where tenant_id=$1", [t])).rows.map(r => r.id).sort();
const age = (id: string, days: number) => fixture.admin.query("update docs set deleted_at=now()-make_interval(days=>$2) where id=$1", [id, days]);

beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, other].map(id => ({ id, name: id, email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, owner, "Trash ministry", "church")).tenantId;
  elsewhere = (await createWorkspace(fixture.db, other, "Elsewhere", "church")).tenantId;
}, 120_000);
afterAll(async () => { await fixture?.close(); });

const trashed = async (t: string, user: string, title: string, days: number, prepare?: (id: string) => Promise<unknown>) => {
  const doc = await createDoc(fixture.db, user, t, { title });
  await prepare?.(doc.id);
  await updateDoc(fixture.db, user, t, doc.id, { trashed: true });
  await age(doc.id, days);
  return doc.id;
};

it("purges docs trashed for more than 30 days with their pages and favourites, and keeps everything else", async () => {
  const old = await trashed(tenant, owner, "a-old", 31, async (id) => {
    await createPage(fixture.db, owner, tenant, id, { title: "Second page" });
    await setDocFavorite(fixture.db, owner, tenant, id, true);
  });
  const young = await trashed(tenant, owner, "b-young", 29);
  const live = (await createDoc(fixture.db, owner, tenant, { title: "c-live" })).id;
  const restored = await trashed(tenant, owner, "d-restored", 40);
  await updateDoc(fixture.db, owner, tenant, restored, { trashed: false });
  const oldElsewhere = await trashed(elsewhere, other, "e-old", 45);
  expect((await fixture.admin.query("select count(*)::int n from doc_pages where doc_id=$1", [old])).rows[0].n).toBe(2);

  expect(await purge()).toBe(2);
  expect(await ids(tenant)).toEqual([young, live, restored].sort());
  expect(await ids(elsewhere)).toEqual([]);
  for (const gone of [old, oldElsewhere]) {
    expect((await fixture.admin.query("select (select count(*) from doc_pages where doc_id=$1)::int p, (select count(*) from doc_favorites where doc_id=$1)::int f", [gone])).rows[0]).toEqual({ p: 0, f: 0 });
  }
  expect((await fixture.admin.query("select count(*)::int n from doc_pages where doc_id=$1", [young])).rows[0].n).toBe(1);
  expect(await purge()).toBe(0);
});

it("records only a count per ministry in the audit log, with no actor and no doc id", async () => {
  await trashed(tenant, owner, "f-old-1", 60);
  await trashed(tenant, owner, "g-old-2", 60);
  await trashed(elsewhere, other, "h-old-3", 60);
  const before = (await fixture.admin.query("select count(*)::int n from audit_logs where action='docs.trash.purge'")).rows[0].n;
  expect(await purge()).toBe(3);
  const rows = (await fixture.admin.query("select tenant_id, actor_id, target_id, metadata from audit_logs where action='docs.trash.purge' order by created_at desc, metadata->>'count' desc limit 2")).rows;
  expect(rows).toHaveLength(2);
  expect(rows).toEqual(expect.arrayContaining([
    { tenant_id: tenant, actor_id: null, target_id: null, metadata: { count: "2" } },
    { tenant_id: elsewhere, actor_id: null, target_id: null, metadata: { count: "1" } },
  ]));
  expect(await purge()).toBe(0);
  expect((await fixture.admin.query("select count(*)::int n from audit_logs where action='docs.trash.purge'")).rows[0].n).toBe(before + 2);
});

it("works in bounded batches", async () => {
  for (const n of [1, 2, 3]) await trashed(tenant, owner, `batch-${n}`, 50);
  expect(await purge(2)).toBe(2);
  expect(await purge(2)).toBe(1);
  expect(await purge(2)).toBe(0);
  await expect(purge(0)).rejects.toHaveProperty("code", "22023");
  await expect(purge(201)).rejects.toHaveProperty("code", "22023");
});

it("lets the worker role run the function only, and the application role not even that", async () => {
  await trashed(tenant, owner, "guard", 50);
  await expect(fixture.workerPool.query("select id from docs")).rejects.toHaveProperty("code", "42501");
  await expect(fixture.workerPool.query("delete from docs")).rejects.toHaveProperty("code", "42501");
  await expect(fixture.pool.query("select public.docs_purge_trash(10)")).rejects.toHaveProperty("code", "42501");
  expect(await purge()).toBe(1);
});

it("leaves a doc in the trash, and carries on, when a table it does not know still points at it", async () => {
  const blockedDoc = await trashed(tenant, owner, "blocked", 70);
  const free = await trashed(tenant, owner, "free", 70);
  // A stand-in for a later slice's table: restrictive foreign key, which the purge does not know about yet.
  await fixture.admin.query(`create table doc_future_slice(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, doc_id uuid not null,
    foreign key (tenant_id, doc_id) references docs(tenant_id, id) on delete no action)`);
  try {
    await fixture.admin.query("insert into doc_future_slice(tenant_id, doc_id) values($1,$2)", [tenant, blockedDoc]);
    expect(await purge()).toBe(1);
    expect(await ids(tenant)).toContain(blockedDoc);
    expect(await ids(tenant)).not.toContain(free);
    // Once that table's rows are gone (a later migration teaches the purge about it), the next run finishes the job.
    await fixture.admin.query("delete from doc_future_slice");
    expect(await purge()).toBe(1);
    expect(await ids(tenant)).not.toContain(blockedDoc);
  } finally { await fixture.admin.query("drop table doc_future_slice"); }
});

it("clears the Docs slice 2 rows (comments, history, shares, page shares, notifications, links) that point at a purged doc", async () => {
  const other2 = "trash-sharer";
  await fixture.db.insert(users).values({ id: other2, name: other2, email: `${other2}@example.test` });
  const q = (sql: string, values: unknown[] = []) => fixture.admin.query(sql, values);
  const doc = await trashed(tenant, owner, "slice2-old", 50, async (id) => {
    const page = (await q("select id from doc_pages where doc_id=$1 order by created_at limit 1", [id])).rows[0].id;
    const comment = (await q("insert into doc_comments(tenant_id, doc_id, page_id, author_id, body) values ($1,$2,$3,$4,'Hello') returning id", [tenant, id, page, owner])).rows[0].id;
    await q("insert into doc_comments(tenant_id, doc_id, page_id, parent_id, author_id, body) values ($1,$2,$3,$4,$5,'Reply')", [tenant, id, page, comment, owner]);
    await q("insert into doc_page_versions(tenant_id, doc_id, page_id, number, content, created_by) values ($1,$2,$3,1,'{}'::jsonb,$4)", [tenant, id, page, owner]);
    await q("insert into doc_shares(tenant_id, doc_id, owner_id, user_id, role, created_by) values ($1,$2,$3,$4,'view',$3)", [tenant, id, owner, other2]);
    await q("insert into doc_notifications(tenant_id, user_id, kind, doc_id, actor_id) values ($1,$2,'mention',$3,$4)", [tenant, other2, id, owner]);
  });
  const count = async (table: string) => Number((await q(`select count(*)::int n from ${table} where doc_id=$1`, [doc])).rows[0].n);
  expect(await count("doc_comments")).toBe(2);
  expect(await purge()).toBeGreaterThanOrEqual(1);
  for (const table of ["docs", "doc_pages", "doc_comments", "doc_page_versions", "doc_shares", "doc_page_shares", "doc_notifications", "doc_links", "doc_attachments"]) {
    expect(Number((await q(`select count(*)::int n from ${table} where ${table === "docs" ? "id" : "doc_id"}=$1`, [doc])).rows[0].n)).toBe(0);
  }
});
