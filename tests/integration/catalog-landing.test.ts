import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCatalogItem, enrolInCatalogItem, setCatalogState, updateCatalogItem } from "../../src/server/free-catalog";
import { getLanding, publicLanding, saveLanding, saveReview, setReviewHidden } from "../../src/server/catalog-landing";
import { deleteMyAccount } from "../../src/server/account-deletion";
import { withUser } from "../../src/server/tenancy";

// Product and course landing page (0154): owner editing, the public read, sale rules, reviews, hiding, small-group stats and account deletion.
// Synthetic people only.
const people = ["lp-owner", "lp-admin", "lp-member", "lp-other", "lp-l1", "lp-l2", "lp-l3", "lp-l4", "lp-l5", "lp-outsider"];
const [owner, admin, member, other, l1, l2, l3, l4, l5, outsider] = people;
let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, foreign: string, courseId: string, draftId: string;
const lesson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Lesson" }] }] };
const sales = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Why this course" }] },
  { type: "paragraph", content: [{ type: "text", text: "Six weeks of prayer." }] }] };
const notFound = { status: 404 };
const day = 24 * 60 * 60 * 1000;
const landing = (version: number, extra: Record<string, unknown> = {}) => ({ version, subtitle: "Learn to pray every day", body: sales, included: ["Six lessons", "A prayer guide"],
  aboutHeading: "About the teacher", aboutBody: "Pastor of a small church.", aboutPhotoId: null, faq: [{ question: "How long?", answer: "Six weeks." }],
  ctaQuote: "Prayer changed my week.", ctaLabel: "Start now", price: null, sale: null, ...extra });

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(people.map((id) => ({ id, name: `${id.replace("lp-", "").toUpperCase()} Person`, email: `${id}@example.invalid`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, owner, "Landing Ministry", "church")).tenantId;
  foreign = (await createWorkspace(f.db, other, "Other Ministry", "church")).tenantId;
  await putMember(f.db, owner, tenant, `${admin}@example.invalid`, "admin");
  await putMember(f.db, owner, tenant, `${member}@example.invalid`, "member");
  const course = await createCatalogItem(f.db, owner, tenant, { kind: "course", slug: "pray-daily", title: "Pray daily", visibility: "listed",
    sections: [{ title: "Week one", lessons: [{ title: "One", body: lesson, published: true }, { title: "Two", body: lesson, published: true }] },
      { title: "Week two", lessons: [{ title: "Three", body: lesson, published: true }] }] });
  courseId = course.id;
  await setCatalogState(f.db, owner, tenant, courseId, { version: course.version, state: "published" });
  draftId = (await createCatalogItem(f.db, owner, tenant, { kind: "course", slug: "draft-course", title: "Draft course", visibility: "listed",
    lessons: [{ title: "One", body: lesson, published: true }] })).id;
});
afterAll(async () => { await f?.close(); });

it("lets owners and admins edit the landing, and nobody else (wrong ministry, a member, a foreign owner)", async () => {
  expect((await getLanding(f.db, owner, tenant, courseId)).landing).toMatchObject({ version: 0, subtitle: "", price: null });
  await expect(saveLanding(f.db, admin, tenant, courseId, landing(0))).resolves.toEqual({ version: 1 });
  await expect(saveLanding(f.db, owner, tenant, courseId, landing(0))).rejects.toMatchObject({ status: 409 });
  await expect(saveLanding(f.db, member, tenant, courseId, landing(1))).rejects.toMatchObject(notFound);
  await expect(getLanding(f.db, member, tenant, courseId)).rejects.toMatchObject(notFound);
  // Another ministry's owner, through their own ministry or through this one.
  await expect(saveLanding(f.db, other, foreign, courseId, landing(1))).rejects.toMatchObject(notFound);
  await expect(saveLanding(f.db, other, tenant, courseId, landing(1))).rejects.toMatchObject(notFound);
  const read = (await getLanding(f.db, owner, tenant, courseId)).landing;
  expect(read).toMatchObject({ version: 1, subtitle: "Learn to pray every day", included: ["Six lessons", "A prayer guide"], faq: [{ question: "How long?", answer: "Six weeks." }] });
  expect(read.body).toMatchObject({ type: "doc" });
  // The app role reads no landing row outside its own staff scope.
  const raw = await withUser(f.db, outsider, (tx) => tx.execute("select count(*)::int n from catalog_landings"));
  expect(raw.rows[0]).toEqual({ n: 0 });
});

it("shows the landing only while the item is published and visible", async () => {
  await saveLanding(f.db, owner, tenant, draftId, landing(0));
  expect(await publicLanding(f.db, "draft-course")).toBeNull();
  expect(await publicLanding(f.db, "no-such-course")).toBeNull();
  const page = await publicLanding(f.db, "pray-daily");
  expect(page).toMatchObject({ title: "Pray daily", host: "Landing Ministry", subtitle: "Learn to pray every day", price: null,
    stats: { people: null, modules: 2, lessons: 3, files: 0 }, rating: { average: null, count: 0 }, viewer: { signedIn: false, canReview: false, review: null } });
  expect(JSON.stringify(page)).not.toContain(tenant);
  expect(JSON.stringify(page)).not.toContain(courseId);
});

it("applies a sale only while it runs, refuses a sale that is not lower or already over, and blocks free enrolment of a priced item", async () => {
  const now = Date.now();
  const running = { cents: 1900, startsAt: new Date(now - day).toISOString(), endsAt: new Date(now + day).toISOString() };
  await expect(saveLanding(f.db, owner, tenant, courseId, landing(1, { price: { cents: 2900, currency: "USD" }, sale: { ...running, cents: 2900 } })))
    .rejects.toMatchObject({ status: 400, details: { reason: "sale_notLower" } });
  await expect(saveLanding(f.db, owner, tenant, courseId, landing(1, { sale: running }))).rejects.toMatchObject({ details: { reason: "sale_needsPrice" } });
  await expect(saveLanding(f.db, owner, tenant, courseId, landing(1, { price: { cents: 2900, currency: "USD" },
    sale: { cents: 1900, startsAt: new Date(now - 3 * day).toISOString(), endsAt: new Date(now - day).toISOString() } }))).rejects.toMatchObject({ details: { reason: "sale_ended" } });
  await saveLanding(f.db, owner, tenant, courseId, landing(1, { price: { cents: 2900, currency: "USD" }, sale: running }));
  expect((await publicLanding(f.db, "pray-daily"))?.price).toMatchObject({ currency: "USD", cents: 1900, oldCents: 2900 });
  // A sale that ended since it was saved is not applied (moved into the past directly; the server refuses to save one).
  await f.admin.query("update catalog_landings set sale_starts_at = now() - interval '3 days', sale_ends_at = now() - interval '1 day' where item_id = $1", [courseId]);
  expect((await publicLanding(f.db, "pray-daily"))?.price).toEqual({ currency: "USD", cents: 2900, oldCents: null, saleEndsAt: null });
  // A sale that has not started yet is not applied either.
  await f.admin.query("update catalog_landings set sale_starts_at = now() + interval '1 day', sale_ends_at = now() + interval '2 days' where item_id = $1", [courseId]);
  expect((await publicLanding(f.db, "pray-daily"))?.price).toMatchObject({ cents: 2900, oldCents: null });
  // Checkout is off: the free flow refuses a priced item.
  await expect(enrolInCatalogItem(f.db, outsider, "pray-daily")).rejects.toMatchObject(notFound);
  // Removing the price restores free enrolment.
  await saveLanding(f.db, owner, tenant, courseId, landing(2));
  expect((await publicLanding(f.db, "pray-daily"))?.price).toBeNull();
});

it("lets only people who have the item review it, once each and editable, and masks small groups", async () => {
  // Not enrolled (signed in, outsider) and signed in without access: refused.
  await expect(saveReview(f.db, outsider, "pray-daily", { rating: 5, body: "Great" })).rejects.toMatchObject({ status: 403 });
  expect((await publicLanding(f.db, "pray-daily", outsider))?.viewer).toEqual({ signedIn: true, canReview: false, review: null });
  for (const person of [l1, l2, l3, l4]) await enrolInCatalogItem(f.db, person, "pray-daily");
  expect((await publicLanding(f.db, "pray-daily"))?.stats.people).toBeNull();
  await enrolInCatalogItem(f.db, l5, "pray-daily");
  expect((await publicLanding(f.db, "pray-daily"))?.stats.people).toBe(5);
  await expect(saveReview(f.db, l1, "pray-daily", { rating: 0, body: "x" })).rejects.toMatchObject({ status: 400 });
  await expect(saveReview(f.db, l1, "pray-daily", { rating: 5, body: "y".repeat(1001) })).rejects.toMatchObject({ status: 400 });
  await saveReview(f.db, l1, "pray-daily", { rating: 4, body: "Helpful." });
  await saveReview(f.db, l1, "pray-daily", { rating: 5, body: "Very helpful." });
  await saveReview(f.db, l2, "pray-daily", { rating: 3, body: "Good start." });
  const page = await publicLanding(f.db, "pray-daily", l1);
  expect(page?.rating).toEqual({ average: 4, count: 2 });
  expect(page?.reviews.map((r) => [r.name, r.rating, r.body]).sort()).toEqual([["L1", 5, "Very helpful."], ["L2", 3, "Good start."]]);
  expect(page?.viewer).toEqual({ signedIn: true, canReview: true, review: { rating: 5, body: "Very helpful.", hidden: false } });
  // A review of an unpublished item is refused like a missing one.
  await expect(saveReview(f.db, l1, "draft-course", { rating: 5, body: "" })).rejects.toMatchObject(notFound);
});

it("lets owners and admins hide a review (audited); a hidden review is not public", async () => {
  await expect(setReviewHidden(f.db, member, tenant, courseId, l2, { hidden: true })).rejects.toMatchObject(notFound);
  await expect(setReviewHidden(f.db, other, foreign, courseId, l2, { hidden: true })).rejects.toMatchObject(notFound);
  await setReviewHidden(f.db, admin, tenant, courseId, l2, { hidden: true });
  const page = await publicLanding(f.db, "pray-daily", l2);
  expect(page?.reviews.map((r) => r.name)).toEqual(["L1"]);
  expect(page?.rating).toEqual({ average: 5, count: 1 });
  expect(page?.viewer.review).toEqual({ rating: 3, body: "Good start.", hidden: true });
  // Editing keeps it hidden.
  await saveReview(f.db, l2, "pray-daily", { rating: 4, body: "Edited." });
  expect((await publicLanding(f.db, "pray-daily"))?.reviews.map((r) => r.name)).toEqual(["L1"]);
  expect((await getLanding(f.db, owner, tenant, courseId)).reviews.find((r) => r.userId === l2)).toMatchObject({ hidden: true, body: "Edited." });
  const { rows } = await f.admin.query("select action, actor_id, metadata from audit_logs where action = 'catalog.review_hide' and target_id = $1", [courseId]);
  expect(rows).toEqual([{ action: "catalog.review_hide", actor_id: admin, metadata: { reviewer: l2 } }]);
  // The app role cannot change a rating or body directly, even as staff.
  await expect(f.db.transaction(async (tx) => { await tx.execute(`select set_config('app.user_id', '${owner}', true), set_config('app.tenant_id', '${tenant}', true)`);
    await tx.execute("update catalog_reviews set rating = 1"); })).rejects.toThrow();
});

it("leaves no flag behind, is not executable by the worker role, and keeps the app role away from the landing tables", async () => {
  const flags = await withUser(f.db, outsider, async (tx) => {
    await tx.execute("select public.catalog_landing('pray-daily')");
    return (await tx.execute<{ s: string; t: string; c: string }>("select current_setting('app.catalog_slug', true) s, current_setting('app.catalog_tenant', true) t, current_setting('app.community_definer_tenant', true) c")).rows[0];
  });
  expect(flags).toEqual({ s: "", t: "", c: "" });
  const { rows } = await f.admin.query(`select p.proname, has_function_privilege('harvest_worker', p.oid, 'execute') w, p.prosecdef d, p.proconfig c from pg_proc p
    where p.proname in ('catalog_landing','catalog_review_save','catalog_landing_photo') order by 1`);
  for (const row of rows) { expect(row.w).toBe(false); expect(row.d).toBe(true); expect(row.c).toEqual(["search_path=pg_catalog, pg_temp"]); }
  const { rows: tables } = await f.admin.query(`select relname, relrowsecurity r, relforcerowsecurity f from pg_class where relname in ('catalog_landings','catalog_reviews') order by 1`);
  expect(tables).toEqual([{ relname: "catalog_landings", r: true, f: true }, { relname: "catalog_reviews", r: true, f: true }]);
});

it("removes the person's reviews when they delete their account", async () => {
  expect((await publicLanding(f.db, "pray-daily"))?.reviews.map((r) => r.name)).toEqual(["L1"]);
  await deleteMyAccount(f.db, l1, new Date(), { confirm: "DELETE" }, { async deleteObject() {} }, new Date());
  const { rows } = await f.admin.query("select count(*)::int n from catalog_reviews where user_id = $1", [l1]);
  expect(rows[0].n).toBe(0);
  expect((await publicLanding(f.db, "pray-daily"))?.rating).toEqual({ average: null, count: 0 });
  // The admin who hid a review can delete their account too; the review stays hidden with no hider.
  await deleteMyAccount(f.db, admin, new Date(), { confirm: "DELETE" }, { async deleteObject() {} }, new Date());
  expect((await f.admin.query("select hidden_by, hidden_at is not null h from catalog_reviews where user_id = $1", [l2])).rows).toEqual([{ hidden_by: null, h: true }]);
});
void updateCatalogItem;
