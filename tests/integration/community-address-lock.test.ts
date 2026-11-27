import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";

// 0128: a community's address is locked for good from its first publish. The marker survives an unpublish, the app refuses a change (409)
// and the database refuses it too, for the app role and everyone else. A never-published draft keeps its free address; other ministries are untouched.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, live: string, draft: string, other: string;
const ready = { allowOpen: true, visibility: "unlisted", tagline: "Weekly study", description: "We read together.", rulesList: ["Be kind"] };
const marker = async (id: string) => (await f.admin.query("select first_published_at from communities where id = $1", [id])).rows[0].first_published_at as Date | null;
const dbError = (promise: Promise<unknown>) => promise.then(() => null, (e: { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string }) =>
  ({ code: e.cause?.code ?? e.code, constraint: e.cause?.constraint ?? e.constraint }));

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(["lock-a", "lock-b"].map((id) => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  a = (await createWorkspace(f.db, "lock-a", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "lock-b", "Hope Mission", "church")).tenantId;
  live = (await createCommunity(f.db, "lock-a", a, { name: "Bible study", slug: "lock-bible-study" })).id;
  draft = (await createCommunity(f.db, "lock-a", a, { name: "Draft circle", slug: "lock-draft-circle" })).id;
  other = (await createCommunity(f.db, "lock-b", b, { name: "Other ministry", slug: "lock-other-ministry" })).id;
});
afterAll(async () => { await f?.close(); });

it("sets the marker on the first publish, keeps it on unpublish and republish, and refuses an address change after it", async () => {
  expect(await marker(live)).toBeNull();
  // Before the first publish the address can still change.
  const renamed = await updateCommunity(f.db, "lock-a", a, live, { version: 1, slug: "lock-bible-group", ...ready });
  expect(renamed.slug).toBe("lock-bible-group");
  const published = await publishCommunity(f.db, "lock-a", a, live, { version: renamed.version, published: true });
  const first = await marker(live);
  expect(first).toBeInstanceOf(Date);
  expect(published.firstPublishedAt).toEqual(first);
  await expect(updateCommunity(f.db, "lock-a", a, live, { version: published.version, slug: "lock-new-address" })).rejects.toMatchObject({ status: 409 });
  // Unpublished: still locked, same marker.
  const unpublished = await publishCommunity(f.db, "lock-a", a, live, { version: published.version, published: false });
  expect(unpublished.status).toBe("draft");
  expect(await marker(live)).toEqual(first);
  await expect(updateCommunity(f.db, "lock-a", a, live, { version: unpublished.version, slug: "lock-new-address" })).rejects.toMatchObject({ status: 409 });
  // Other edits still work, and the same slug is not a change.
  const edited = await updateCommunity(f.db, "lock-a", a, live, { version: unpublished.version, name: "Renamed study", slug: "lock-bible-group" });
  expect(edited).toMatchObject({ name: "Renamed study", slug: "lock-bible-group" });
  // Republishing keeps the first date.
  await publishCommunity(f.db, "lock-a", a, live, { version: edited.version, published: true });
  expect(await marker(live)).toEqual(first);
  expect((await getCommunity(f.db, "lock-a", a, live)).slug).toBe("lock-bible-group");
});

it("refuses a direct slug change or a marker change in the database, as harvest_app and as the superuser", async () => {
  const asApp = (statement: ReturnType<typeof sql>) => dbError(withTenant(f.db, "lock-a", a, "communities:manage", (tx) => tx.execute(statement)));
  await publishCommunity(f.db, "lock-a", a, live, { version: (await getCommunity(f.db, "lock-a", a, live)).version, published: false });
  expect(await asApp(sql`update communities set slug = 'lock-sneaky', version = version + 1 where id = ${live}::uuid`)).toEqual({ code: "23514", constraint: "community_address_locked" });
  expect(await asApp(sql`update communities set first_published_at = null where id = ${live}::uuid`)).toEqual({ code: "23514", constraint: "community_first_published" });
  expect(await dbError(f.admin.query("update communities set slug = 'lock-sneaky' where id = $1", [live]))).toEqual({ code: "23514", constraint: "community_address_locked" });
  expect(await dbError(f.admin.query("update communities set first_published_at = now() - interval '1 day' where id = $1", [live]))).toMatchObject({ code: "23514" });
  expect((await f.admin.query("select slug from communities where id = $1", [live])).rows[0].slug).toBe("lock-bible-group");
});

it("lets a never-published draft change its address, in the app and the database, and leaves other ministries untouched", async () => {
  const changed = await updateCommunity(f.db, "lock-a", a, draft, { version: 1, slug: "lock-draft-two" });
  expect(changed.slug).toBe("lock-draft-two");
  const viaDb = await withTenant(f.db, "lock-a", a, "communities:manage", (tx) => tx.execute(sql`update communities set slug = 'lock-draft-three' where id = ${draft}::uuid returning slug`));
  expect(viaDb.rows).toEqual([{ slug: "lock-draft-three" }]);
  expect(await marker(draft)).toBeNull();
  // The other ministry's draft has no marker and can still change its address.
  expect(await marker(other)).toBeNull();
  expect((await updateCommunity(f.db, "lock-b", b, other, { version: 1, slug: "lock-other-two" })).slug).toBe("lock-other-two");
  // ...and nobody in ministry B can reach ministry A's community (or set its marker).
  await expect(updateCommunity(f.db, "lock-b", b, live, { version: 1, slug: "lock-steal" })).rejects.toMatchObject({ status: 404 });
  const reached = await withTenant(f.db, "lock-b", b, "communities:manage", (tx) => tx.execute(sql`update communities set slug = 'lock-steal' where id = ${draft}::uuid returning id`));
  expect(reached.rows).toEqual([]);
});

it("stamps a community inserted as published, and refuses an app-side marker write through the update schema", async () => {
  await f.admin.query("insert into communities (tenant_id, slug, name, status) values ($1, 'lock-inserted-live', 'Inserted', 'published')", [b]);
  expect((await f.admin.query("select first_published_at is not null as set from communities where slug = 'lock-inserted-live'")).rows[0].set).toBe(true);
  await expect(updateCommunity(f.db, "lock-b", b, other, { version: 2, firstPublishedAt: null })).rejects.toThrow();
});

it("reserves the address 'unsubscribe' in the app and the database", async () => {
  await expect(createCommunity(f.db, "lock-a", a, { name: "Unsubscribe", slug: "unsubscribe" })).rejects.toThrow();
  expect(await dbError(f.admin.query("insert into communities (tenant_id, slug, name) values ($1, 'unsubscribe', 'X')", [a]))).toEqual({ code: "23514", constraint: "community_slug" });
  expect(await dbError(f.admin.query("update communities set slug = 'unsubscribe' where id = $1", [draft]))).toEqual({ code: "23514", constraint: "community_slug" });
});
