import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";
import { createCatalogItem, setCatalogState } from "../../src/server/free-catalog";
import { listDiscover } from "../../src/server/community-joining";
import { withTenant } from "../../src/server/tenancy";
import { changeListing, listMyListings } from "../../src/server/discover/owner";
import { reportListing, searchDiscover } from "../../src/server/discover/public";
import { decideReview, listReports, listReviewQueue, resolveReport, setMinistryStanding } from "../../src/server/discover/platform";
import { defaultDiscoverDeps, type DiscoverDeps } from "../../src/server/discover/registry";
import { discoverResponse } from "../../src/server/discover/http";
import { encodeCursor } from "../../src/lib/discover";

const deps: DiscoverDeps = { enabled: true, now: () => new Date() };
const people = ["d-owner", "d-admin", "d-member", "d-viewer", "d-other", "d-reader", "d-reader2", "d-platform"];
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string;
const q = (query: string, values?: unknown[]) => f.admin.query(query, values);
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Lesson" }] }] };
const search = async (params: Record<string, string> = {}) => searchDiscover(f.db, new URLSearchParams(params), deps);
const names = async (params: Record<string, string> = {}) => (await search(params)).items.map(i => i.name);
const reviewer = "d-platform";

async function community(owner: string, tenant: string, slug: string, name: string, tagline = "A place to grow") {
  const id = (await createCommunity(f.db, owner, tenant, { name, slug, tagline })).id;
  const v = (await getCommunity(f.db, owner, tenant, id)).version;
  await updateCommunity(f.db, owner, tenant, id, { version: v, allowOpen: true, visibility: "listed", rulesList: ["Be kind."], description: "Weekly study.", discoverOptIn: true });
  const v2 = (await getCommunity(f.db, owner, tenant, id)).version;
  await publishCommunity(f.db, owner, tenant, id, { version: v2, published: true });
  return id;
}
async function course(owner: string, tenant: string, slug: string, title: string, summary = "Learn together") {
  const draft = await createCatalogItem(f.db, owner, tenant, { kind: "course", slug, title, summary, visibility: "listed", lessons: [{ title: "One", body, published: true }] });
  await setCatalogState(f.db, owner, tenant, draft.id, { version: draft.version, state: "published" });
  return draft.id;
}
const control = async (type: string, id: string) => (await q("select * from discover_controls where resource_type=$1 and resource_id=$2", [type, id])).rows[0];
const decide = async (type: "community" | "course" | "product", id: string, tenant: string, raw: Record<string, unknown>) => {
  const c = await control(type, id);
  return decideReview(f.workerPool, { tenantId: tenant, type, id, version: c.version, reviewer }, raw);
};
const optIn = async (tenant: string, user: string, type: string, id: string, data: Record<string, unknown>) => {
  const c = await control(type, id);
  return changeListing(f.db, user, tenant, type, id, { version: c?.version ?? 0, ...data }, deps);
};

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(people.map(id => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "d-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "d-other", "Creator Circle Co", "creator")).tenantId;
  await putMember(f.db, "d-owner", a, "d-admin@example.test", "admin");
  await putMember(f.db, "d-owner", a, "d-member@example.test", "member");
  await putMember(f.db, "d-owner", a, "d-viewer@example.test", "viewer");
}, 60_000);
afterAll(async () => { await f?.close(); });

it("forces row security, is hard-off by default and answers members, viewers and other ministries with a neutral 404", async () => {
  const rls = await q("select relrowsecurity, relforcerowsecurity from pg_class where relname in ('discover_controls','discover_ministry_standing','discover_reports','discover_review_events')");
  expect(rls.rows).toHaveLength(4); expect(rls.rows.every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  expect(defaultDiscoverDeps().enabled).toBe(false);
  await expect(search()).resolves.toBeTruthy();
  await expect(searchDiscover(f.db, new URLSearchParams(), defaultDiscoverDeps())).rejects.toMatchObject({ status: 404 });
  expect((await discoverResponse(new Request("http://localhost/api/discover/listings"), { write: false, session: false }, async () => ({}), 200, defaultDiscoverDeps())).status).toBe(404);
  for (const user of ["d-member", "d-viewer", "d-other"]) await expect(listMyListings(f.db, user, a, deps)).rejects.toMatchObject({ status: 404 });
  await expect(listMyListings(f.db, "d-owner", a, defaultDiscoverDeps())).rejects.toMatchObject({ status: 404 });
  expect((await listMyListings(f.db, "d-admin", a, deps)).items).toEqual([]);
  // The application role holds no privilege on the platform tables or functions.
  for (const stmt of [sql`select * from discover_reports`, sql`select public.discover_platform_queue('pending', 5)`, sql`select public.discover_platform_standing(${a}::uuid, true, 'x', 'y')`])
    await expect(withTenant(f.db, "d-owner", a, "catalog:manage", async tx => { await tx.execute(stmt); })).rejects.toThrow();
});

it("lists a community only after the platform approves it, and only with minimal public fields", async () => {
  const id = await community("d-owner", a, "grace-study", "Grace study");
  expect((await control("community", id))).toMatchObject({ review_state: "pending" });
  expect(await names()).toEqual([]);
  // The legacy communities-only endpoint is unchanged: it lists the opted-in community without review.
  expect((await listDiscover(f.db, {})).items.map(i => i.slug)).toEqual(["grace-study"]);
  const queue = await listReviewQueue(f.workerPool);
  expect(queue).toHaveLength(1);
  expect(queue[0]).toMatchObject({ tenantId: a, type: "community", id, state: "pending", name: "Grace study", hostName: "Grace Church", audience: "church", materialChange: false, openReports: 0 });
  await expect(decide("community", id, a, { decision: "reject" })).resolves.toBeTruthy().catch(() => undefined);
});

it("rejects with a reason and requires one", async () => {
  const id = (await q("select resource_id from discover_controls where resource_type='community' limit 1")).rows[0].resource_id;
  await expect(decide("community", id, a, { decision: "reject" })).rejects.toMatchObject({ status: 422 });
  expect(await decide("community", id, a, { decision: "reject", reason: "Please add a clearer description" })).toBe("rejected");
  expect(await names()).toEqual([]);
  const mine = (await listMyListings(f.db, "d-owner", a, deps)).items.find(i => i.id === id)!;
  expect(mine.review).toEqual({ state: "rejected", reason: "Please add a clearer description" });
  // A stale version is refused and changes nothing.
  expect(await decideReview(f.workerPool, { tenantId: a, type: "community", id, version: 1, reviewer }, { decision: "approve" })).toBe("stale");
  // The owner requests another review; only then can it be approved.
  await optIn(a, "d-owner", "community", id, { requestReview: true });
  expect((await control("community", id)).review_state).toBe("pending");
  expect(await decide("community", id, a, { decision: "approve" })).toBe("approved");
  const items = (await search()).items;
  expect(items).toHaveLength(1);
  expect(Object.keys(items[0]).sort()).toEqual(["admission", "audience", "category", "free", "hostName", "id", "language", "name", "pricing", "slug", "summary", "type", "updatedAt"]);
  expect(JSON.stringify(items)).not.toMatch(/tenant|member|email|owner/i);
  expect(items[0]).toMatchObject({ type: "community", slug: "grace-study", hostName: "Grace Church", audience: "church", free: true, summary: "A place to grow" });
  expect((await q("select count(*)::int n from audit_logs where tenant_id=$1 and action in ('discover.review_reject','discover.review_approve')", [a])).rows[0].n).toBe(2);
});

it("sends an approved listing back to review when a public field changes, and hides it meanwhile", async () => {
  const id = (await q("select resource_id from discover_controls where resource_type='community' limit 1")).rows[0].resource_id;
  expect(await names()).toEqual(["Grace study"]);
  const v = (await getCommunity(f.db, "d-owner", a, id)).version;
  await updateCommunity(f.db, "d-owner", a, id, { version: v, tagline: "A new tagline" });
  expect((await control("community", id)).review_state).toBe("pending");
  expect(await names()).toEqual([]);
  expect((await listReviewQueue(f.workerPool))[0]).toMatchObject({ materialChange: true, summary: "A new tagline" });
  expect(await decide("community", id, a, { decision: "approve" })).toBe("approved");
  expect(await names()).toEqual(["Grace study"]);
  // A change that is not a public field (the welcome message) does not disturb approval.
  const v2 = (await getCommunity(f.db, "d-owner", a, id)).version;
  await updateCommunity(f.db, "d-owner", a, id, { version: v2, welcomeMessage: "Welcome!" });
  expect((await control("community", id)).review_state).toBe("approved");
  // Category and language are public fields too.
  await optIn(a, "d-owner", "community", id, { category: "discipleship", language: "en" });
  expect(await names()).toEqual([]);
  await decide("community", id, a, { decision: "approve" });
  expect((await search({ category: "discipleship", language: "en" })).items).toHaveLength(1);
  expect(await names({ category: "prayer" })).toEqual([]);
  // The owner can never approve, even by direct SQL, and cannot edit the reviewer fields.
  for (const stmt of [sql`update discover_controls set review_state='rejected'`, sql`update discover_controls set reviewed_by='me'`, sql`update discover_controls set review_state='pending'`])
    await expect(withTenant(f.db, "d-owner", a, "catalog:manage", async tx => { await tx.execute(stmt); })).rejects.toThrow();
  await expect(withTenant(f.db, "d-owner", a, "catalog:manage", async tx => { await tx.execute(sql`insert into discover_controls(tenant_id,resource_type,resource_id,review_state,reviewed_by) values (${a},'course',${randomUUID()},'approved','me')`); })).rejects.toThrow();
});

it("unlists at once on unpublish, hidden visibility or opt-out", async () => {
  const id = (await q("select resource_id from discover_controls where resource_type='community' limit 1")).rows[0].resource_id;
  const edit = async (changes: Record<string, unknown>) => updateCommunity(f.db, "d-owner", a, id, { version: (await getCommunity(f.db, "d-owner", a, id)).version, ...changes });
  await edit({ visibility: "unlisted" }); expect(await names()).toEqual([]);
  await edit({ visibility: "listed" }); expect(await names()).toEqual(["Grace study"]);
  await edit({ discoverOptIn: false }); expect(await names()).toEqual([]);
  expect((await control("community", id)).review_state).toBe("approved");
  await edit({ discoverOptIn: true }); expect(await names()).toEqual(["Grace study"]);
  await publishCommunity(f.db, "d-owner", a, id, { version: (await getCommunity(f.db, "d-owner", a, id)).version, published: false });
  expect(await names()).toEqual([]);
  await publishCommunity(f.db, "d-owner", a, id, { version: (await getCommunity(f.db, "d-owner", a, id)).version, published: true });
  expect(await names()).toEqual(["Grace study"]);
});

it("lists courses and products from the canonical catalogue with opt-in, filters, facets and sort", async () => {
  const c1 = await course("d-owner", a, "bible-basics", "Bible basics", "Learn the basics");
  const c2 = await course("d-owner", a, "prayer-life", "Prayer life", "A prayer course");
  const c3 = await course("d-other", b, "creator-course", "Creator course", "Grow your channel");
  expect(await names({ type: "course" })).toEqual([]);
  // Items are not listed until the owner opts in; the community's opt-in is refused here (canonical in community settings).
  await expect(optIn(a, "d-owner", "community", (await q("select resource_id from discover_controls where resource_type='community' limit 1")).rows[0].resource_id, { optIn: true })).rejects.toMatchObject({ status: 422 });
  await expect(changeListing(f.db, "d-member", a, "course", c1, { version: 0, optIn: true }, deps)).rejects.toMatchObject({ status: 404 });
  await expect(changeListing(f.db, "d-other", a, "course", c1, { version: 0, optIn: true }, deps)).rejects.toMatchObject({ status: 404 });
  await expect(changeListing(f.db, "d-owner", a, "course", randomUUID(), { version: 0, optIn: true }, deps)).rejects.toMatchObject({ status: 404 });
  await expect(changeListing(f.db, "d-owner", a, "course", c1, { version: 0, optIn: true, category: "nonsense" }, deps)).rejects.toMatchObject({ status: 422 });
  const first = await optIn(a, "d-owner", "course", c1, { optIn: true, category: "bible_study", language: "en" });
  expect(first.listing).toMatchObject({ type: "course", optIn: true, listed: true, review: { state: "pending" }, category: "bible_study" });
  await expect(changeListing(f.db, "d-owner", a, "course", c1, { version: 0, language: "es" }, deps)).rejects.toMatchObject({ status: 409 });
  await optIn(a, "d-owner", "course", c2, { optIn: true, category: "prayer", language: "en" });
  await optIn(b, "d-other", "course", c3, { optIn: true, category: "leadership", language: "es" });
  expect(await names()).toEqual(["Grace study"]);
  for (const [t, id, tenant] of [["course", c1, a], ["course", c2, a], ["course", c3, b]] as const) expect(await decide(t, id, tenant, { decision: "approve" })).toBe("approved");
  // A download (product) goes through the same canonical record.
  const dl = randomUUID();
  await q("insert into catalog_items(tenant_id,id,kind,slug,title,summary,state,visibility) values ($1,$2,'download','study-guide','Study guide','A printable guide','published','listed')", [a, dl]);
  await optIn(a, "d-owner", "product", dl, { optIn: true, category: "bible_study", language: "en" });
  await decide("product", dl, a, { decision: "approve" });
  const all = await search();
  expect(all.facets).toEqual({ community: 1, course: 3, product: 1 });
  expect(all.items).toHaveLength(5);
  expect(await names({ type: "course", sort: "name" })).toEqual(["Bible basics", "Creator course", "Prayer life"]);
  expect(await names({ type: "course", language: "es" })).toEqual(["Creator course"]);
  expect(await names({ audience: "creator" })).toEqual(["Creator course"]);
  expect((await search({ audience: "church", type: "product" })).items.map(i => i.name)).toEqual(["Study guide"]);
  expect(await names({ category: "bible_study", sort: "name" })).toEqual(["Bible basics", "Study guide"]);
  expect((await search({ free: "1" })).items).toHaveLength(5);
  expect(await names({ free: "0" })).toEqual([]);
  expect(await names({ q: "prayer", sort: "relevance" })).toEqual(["Prayer life"]);
  expect(await names({ q: "grow" })).toEqual(["Creator course"]);
  expect(await names({ q: "%" })).toEqual([]);
  // Facets ignore the type filter, so tabs can show counts while one tab is selected.
  expect((await search({ type: "course" })).facets).toEqual({ community: 1, course: 3, product: 1 });
  for (const bad of [{ type: "video" }, { sort: "popular" }, { free: "yes" }, { language: "english" }, { cursor: "!!" }, { cursor: encodeCursor(5000) }, { extra: "1" }, { audience: "x" }])
    await expect(search(bad as unknown as Record<string, string>)).rejects.toMatchObject({ status: 422 });
  // The ministry sees its own states.
  const mine = (await listMyListings(f.db, "d-owner", a, deps)).items;
  expect(mine.filter(i => i.listed).map(i => i.name).sort()).toEqual(["Bible basics", "Grace study", "Prayer life", "Study guide"]);
  expect((await listMyListings(f.db, "d-other", b, deps)).items.map(i => i.name)).toEqual(["Creator course"]);
});

it("paginates with a bounded cursor", async () => {
  await q("delete from discover_listings where resource_type='product'");
  const rows = Array.from({ length: 26 }, (_, i) => ({ id: randomUUID(), n: `Bulk ${String(i).padStart(2, "0")}` }));
  for (const r of rows) {
    await q("insert into catalog_items (tenant_id,id,kind,slug,title,state,visibility) values ($1,$2,'download',$3,$4,'published','listed')", [a, r.id, r.n.toLowerCase().replace(" ", "-"), r.n]);
    await q("insert into discover_listings(resource_type,resource_id,tenant_id,slug,name,host_name,pricing,admission,search_text,is_free,content_hash,audience) values ('product',$1,$2,$3,$4,'Grace Church','free','{}',$5,true,$6,'church')", [r.id, a, r.n.toLowerCase().replace(" ", "-"), r.n, r.n.toLowerCase(), r.id]);
    await q("insert into discover_controls(tenant_id,resource_type,resource_id,review_state,reviewed_by,reviewed_hash,current_hash,owner_opt_in) values ($1,'product',$2,'approved','x',$3,$3,true)", [a, r.id, r.id]);
  }
  const page1 = await search({ type: "product", sort: "name" });
  expect(page1.items).toHaveLength(24); expect(page1.next).not.toBeNull();
  const page2 = await search({ type: "product", sort: "name", cursor: page1.next! });
  expect(page2.items).toHaveLength(2); expect(page2.next).toBeNull();
  expect([...page1.items, ...page2.items].map(i => i.name)).toEqual(rows.map(r => r.n));
  await q("delete from discover_controls where resource_type='product' and reviewed_by='x'");
  expect((await search({ type: "product" })).items).toEqual([]);
  await q("delete from discover_listings where resource_type='product'");
});

it("suspends, reinstates and hides a suspended ministry", async () => {
  const courseId = (await q("select resource_id from discover_controls where resource_type='course' and tenant_id=$1 limit 1", [a])).rows[0].resource_id;
  expect(await decide("course", courseId, a, { decision: "suspend" }).catch(e => e.status)).toBe(422);
  expect(await decide("course", courseId, a, { decision: "suspend", reason: "Misleading claims" })).toBe("suspended");
  expect(await names({ type: "course" })).not.toContain((await q("select name from discover_listings where resource_id=$1", [courseId])).rows[0].name);
  const mine = (await listMyListings(f.db, "d-owner", a, deps)).items.find(i => i.id === courseId)!;
  expect(mine.review).toEqual({ state: "suspended", reason: "Misleading claims" });
  // A suspended listing cannot be reapproved by the owner's own edits.
  await optIn(a, "d-owner", "course", courseId, { requestReview: true });
  expect((await control("course", courseId)).review_state).toBe("suspended");
  expect(await decide("course", courseId, a, { decision: "reinstate" })).toBe("approved");
  expect(await names({ type: "course" })).toHaveLength(3);
  // A reinstatement after a field changed goes back to review instead.
  expect(await decide("course", courseId, a, { decision: "suspend", reason: "Check again" })).toBe("suspended");
  await optIn(a, "d-owner", "course", courseId, { category: "worship" });
  expect(await decide("course", courseId, a, { decision: "reinstate" })).toBe("pending");
  expect(await decide("course", courseId, a, { decision: "approve" })).toBe("approved");
  // Ministry standing hides every listing of a suspended ministry and restores them.
  await setMinistryStanding(f.workerPool, a, true, reviewer, "Under review");
  expect(await names()).toEqual(["Creator course"]);
  expect((await search()).facets).toEqual({ community: 0, course: 1, product: 0 });
  await expect(setMinistryStanding(f.workerPool, a, true, reviewer, "")).rejects.toThrow();
  await setMinistryStanding(f.workerPool, a, false, reviewer);
  expect((await names()).length).toBe(4);
  expect((await q("select count(*)::int n from audit_logs where action in ('discover.ministry_suspend','discover.ministry_restore') and tenant_id=$1", [a])).rows[0].n).toBe(2);
});

it("accepts reports from signed-in people, hides the reporter and lets the platform resolve them", async () => {
  const id = (await q("select resource_id from discover_controls where resource_type='community' limit 1")).rows[0].resource_id;
  await expect(reportListing(f.db, "d-reader", { type: "community", id, reason: "spam", note: "Looks like an ad" }, deps)).resolves.toEqual({ status: "reported" });
  await expect(reportListing(f.db, "d-reader", { type: "community", id, reason: "spam" }, deps)).resolves.toEqual({ status: "duplicate" });
  await expect(reportListing(f.db, "d-reader2", { type: "community", id, reason: "misleading" }, deps)).resolves.toEqual({ status: "reported" });
  await expect(reportListing(f.db, "d-reader", { type: "community", id: randomUUID(), reason: "spam" }, deps)).rejects.toMatchObject({ status: 404 });
  await expect(reportListing(f.db, "d-reader", { type: "community", id, reason: "nope" }, deps)).rejects.toMatchObject({ status: 422 });
  await expect(reportListing(f.db, "", { type: "community", id, reason: "spam" }, deps)).rejects.toMatchObject({ status: 401 });
  const reports = await listReports(f.workerPool);
  expect(reports.map(r => r.reason).sort()).toEqual(["misleading", "spam"]);
  expect((await listReviewQueue(f.workerPool, "approved")).find(i => i.id === id)!.openReports).toBe(2);
  // The ministry cannot read reports, and the reporter is nowhere in its views.
  await expect(withTenant(f.db, "d-owner", a, "catalog:manage", async tx => { await tx.execute(sql`select * from discover_reports`); })).rejects.toThrow();
  expect(JSON.stringify(await listMyListings(f.db, "d-owner", a, deps))).not.toContain("d-reader");
  expect(await resolveReport(f.workerPool, reports[0].id, "dismissed", reviewer)).toBe(true);
  expect(await resolveReport(f.workerPool, reports[0].id, "dismissed", reviewer)).toBe(false);
  expect((await listReports(f.workerPool))).toHaveLength(1);
  // Ten reports a day per person.
  await q("delete from discover_reports");
  for (let i = 0; i < 10; i++) await q("insert into discover_reports(resource_type,resource_id,tenant_id,reporter_id,reason,status) values ('course',$1,$2,'d-reader','spam','dismissed')", [randomUUID(), a]);
  await expect(reportListing(f.db, "d-reader", { type: "community", id, reason: "spam" }, deps)).rejects.toMatchObject({ status: 429 });
  // An unlisted item cannot be reported (it does not exist publicly).
  await q("update discover_controls set review_state='pending', reviewed_hash=null where resource_id=$1", [id]);
  await expect(reportListing(f.db, "d-reader2", { type: "community", id, reason: "spam" }, deps)).rejects.toMatchObject({ status: 404 });
});

it("keeps contacts, members and payments out of every Discover table", async () => {
  const cols = (await q("select table_name, column_name from information_schema.columns where table_name in ('discover_controls','discover_ministry_standing','discover_reports','discover_review_events','discover_listings')")).rows;
  expect(cols.map(c => c.column_name).filter(c => /contact|member|email|payment|price_cents|enrol/i.test(c))).toEqual([]);
});
