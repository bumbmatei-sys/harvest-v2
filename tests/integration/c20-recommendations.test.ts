import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";
import { createCatalogItem, setCatalogState } from "../../src/server/free-catalog";
import { enterCommunity, getPublicCommunity } from "../../src/server/community-joining";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { getLanding, landingJoinCounts, resolvePublishedLanding, writeLanding } from "../../src/server/connect-landing";
import { changeListing } from "../../src/server/discover/owner";
import { recommendDiscover } from "../../src/server/discover/public";
import { decideReview, setMinistryStanding } from "../../src/server/discover/platform";
import { defaultDiscoverDeps, type DiscoverDeps } from "../../src/server/discover/registry";
import { withUser } from "../../src/server/tenancy";
import type { LandingDefinition } from "../../src/lib/connect-landing";

// C20: Discover recommendations and the Harvest Connect "Recommended community" link. Synthetic data only.
const deps: DiscoverDeps = { enabled: true, now: () => new Date() };
const people = ["r-owner", "r-admin", "r-member", "r-other", "r-guest", "r-guest2", "r-fresh", "r-mod", "r-platform"];
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, campaign: string;
const q = (query: string, values?: unknown[]) => f.admin.query(query, values);
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Lesson" }] }] };
const control = async (type: string, id: string) => (await q("select * from discover_controls where resource_type=$1 and resource_id=$2", [type, id])).rows[0];
const approve = async (type: "community" | "course" | "product", id: string, tenant: string, decision: Record<string, unknown> = { decision: "approve" }) =>
  decideReview(f.workerPool, { tenantId: tenant, type, id, version: (await control(type, id)).version, reviewer: "r-platform" }, decision);
const meta = async (tenant: string, user: string, type: "community" | "course", id: string, data: Record<string, unknown>) =>
  changeListing(f.db, user, tenant, type, id, { version: (await control(type, id))?.version ?? 0, ...data }, deps);

async function community(owner: string, tenant: string, slug: string, name: string, opts: { visibility?: "listed" | "unlisted" | "hidden"; publish?: boolean; optIn?: boolean } = {}) {
  const id = (await createCommunity(f.db, owner, tenant, { name, slug, tagline: `${name} tagline` })).id;
  const v = (await getCommunity(f.db, owner, tenant, id)).version;
  await updateCommunity(f.db, owner, tenant, id, { version: v, allowOpen: true, visibility: opts.visibility ?? "listed", rulesList: ["Be kind."], description: "Weekly study.", discoverOptIn: opts.optIn ?? true });
  if (opts.publish !== false) await publishCommunity(f.db, owner, tenant, id, { version: (await getCommunity(f.db, owner, tenant, id)).version, published: true });
  return id;
}
async function course(owner: string, tenant: string, slug: string, title: string) {
  const draft = await createCatalogItem(f.db, owner, tenant, { kind: "course", slug, title, summary: "Learn together", visibility: "listed", lessons: [{ title: "One", body, published: true }] });
  await setCatalogState(f.db, owner, tenant, draft.id, { version: draft.version, state: "published" });
  return draft.id;
}
async function join(user: string, slug: string, extra: Record<string, unknown> = {}) {
  const c = (await getPublicCommunity(f.db, slug))!;
  return enterCommunity(f.db, user, slug, { rulesVersion: c.rulesVersion, questionsVersion: c.questionsVersion, answers: {}, adult: true, ...extra });
}
const names = async (user: string | null, type?: "community" | "course" | "product", limit = 12) => (await recommendDiscover(f.db, user, type, deps, limit)).items.map(i => i.name);

let prayer: string, study: string, worship: string, hiddenC: string, unlistedC: string, otherMinistry: string, prayerCourse: string;
beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(people.map(id => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  a = (await createWorkspace(f.db, "r-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "r-other", "Hope Mission", "evangelist_missionary")).tenantId;
  await putMember(f.db, "r-owner", a, "r-admin@example.invalid", "admin");
  await putMember(f.db, "r-owner", a, "r-member@example.invalid", "member");
  campaign = (await createCampaign(f.db, "r-owner", a, { name: "Synthetic outreach", type: "conference" }, "c20-outreach")).id;
  // Approved, listed: prayer (category prayer), study and worship (other categories); a prayer course in another ministry.
  prayer = await community("r-owner", a, "c20-prayer", "Prayer circle");
  study = await community("r-owner", a, "c20-study", "Bible study");
  worship = await community("r-other", b, "c20-worship", "Worship night");
  otherMinistry = await community("r-other", b, "c20-hope", "Hope prayer");
  prayerCourse = await course("r-other", b, "c20-prayer-course", "Prayer basics");
  hiddenC = await community("r-owner", a, "c20-hidden", "Hidden group", { visibility: "hidden", optIn: false });
  unlistedC = await community("r-owner", a, "c20-unlisted", "Unlisted group", { visibility: "unlisted", optIn: false });
  for (const [tenant, user, id, category] of [[a, "r-owner", prayer, "prayer"], [a, "r-owner", study, "bible_study"], [b, "r-other", worship, "worship"], [b, "r-other", otherMinistry, "prayer"]] as const)
    await meta(tenant, user, "community", id, { category, language: "en" });
  await meta(b, "r-other", "course", prayerCourse, { optIn: true, category: "prayer", language: "en" });
  for (const [type, id, tenant] of [["community", prayer, a], ["community", study, a], ["community", worship, b], ["community", otherMinistry, b], ["course", prayerCourse, b]] as const)
    expect(await approve(type, id, tenant)).toBe("approved");
}, 120_000);
afterAll(async () => { await f?.close(); });

it("is hard-off with the Discover switch and never shows hidden, unlisted, unapproved, suspended or draft items", async () => {
  await expect(recommendDiscover(f.db, null, undefined, defaultDiscoverDeps())).rejects.toMatchObject({ status: 404 });
  const draft = await community("r-owner", a, "c20-draft", "Draft group", { publish: false });
  const pending = await community("r-owner", a, "c20-pending", "Pending group");
  const all = await names(null);
  expect(all.sort()).toEqual(["Bible study", "Hope prayer", "Prayer basics", "Prayer circle", "Worship night"]);
  for (const hidden of ["Hidden group", "Unlisted group", "Draft group", "Pending group"]) expect(all).not.toContain(hidden);
  // A seed that is hidden contributes nothing and is never echoed back.
  const hiddenSeed = (await f.db.transaction(tx => tx.execute<{ v: { name: string }[] }>(sql`select public.discover_recommend(null, ${`{${hiddenC},${unlistedC},${draft},${pending}}`}::uuid[], 12) as v`))).rows[0].v;
  expect(hiddenSeed.map(i => i.name).sort()).toEqual([...all].sort());
  // Suspension by Harvest (listing, then ministry standing) removes items at once.
  expect(await approve("community", worship, b, { decision: "suspend", reason: "Synthetic check" })).toBe("suspended");
  expect(await names(null)).not.toContain("Worship night");
  expect(await approve("community", worship, b, { decision: "reinstate" })).toBe("approved");
  await setMinistryStanding(f.workerPool, b, true, "r-platform", "Synthetic check");
  expect((await names(null)).sort()).toEqual(["Bible study", "Prayer circle"]);
  await setMinistryStanding(f.workerPool, b, false, "r-platform");
  // Item shape: the public listing fields only, no tenant or member data.
  const item = (await recommendDiscover(f.db, null, "community", deps)).items[0];
  expect(Object.keys(item).sort()).toEqual(["admission", "audience", "category", "free", "hostName", "id", "language", "name", "pricing", "slug", "summary", "type", "updatedAt"]);
  expect(JSON.stringify(await recommendDiscover(f.db, null, undefined, deps, 12))).not.toContain(a);
});

it("ranks by the viewer's own joins (public category), then recency; signed-out and other people's joins carry no personal signal", async () => {
  const anon = await names(null);
  // Non-personal order: the most recent public change first.
  const order = (await q("select name from discover_listings where resource_id = any($1::uuid[]) order by updated_at desc, resource_id desc", [[prayer, study, worship, otherMinistry, prayerCourse]])).rows.map(r => r.name);
  expect(anon).toEqual(order);
  // A signed-in person who joined nothing sees exactly the signed-out list.
  expect(await recommendDiscover(f.db, "r-fresh", undefined, deps, 12)).toEqual({ items: (await recommendDiscover(f.db, null, undefined, deps, 12)).items, personal: false });
  // r-guest joins the prayer circle: other prayer items rise to the top and the joined community is left out.
  await join("r-guest", "c20-prayer");
  const mine = await names("r-guest");
  expect(mine).not.toContain("Prayer circle");
  expect(mine.slice(0, 2).sort()).toEqual(["Hope prayer", "Prayer basics"]);
  expect((await recommendDiscover(f.db, "r-guest", undefined, deps)).personal).toBe(true);
  // Another person's join changes neither the signed-out list nor a third person's list.
  expect(await names(null)).toEqual(anon);
  expect(await names("r-fresh")).toEqual(anon);
  // Recommending joins, enrols and charges nobody.
  const before = (await q("select (select count(*) from community_memberships)::int m, (select count(*) from entitlements)::int e")).rows[0];
  await recommendDiscover(f.db, "r-fresh", undefined, deps); await recommendDiscover(f.db, null, "course", deps);
  expect((await q("select (select count(*) from community_memberships)::int m, (select count(*) from entitlements)::int e")).rows[0]).toEqual(before);
  // Type filter.
  expect(await names("r-guest", "course")).toEqual(["Prayer basics"]);
});

const baseDefinition: LandingDefinition = { heading: "Welcome", message: "Free resources first.", cards: [{ kind: "resource", resourceId: "first-reading" }] };
async function link() {
  const l = await createConnectLink(f.db, "r-owner", a, campaign, {});
  await transitionConnectLink(f.db, "r-owner", a, campaign, l.id, { action: "publish" });
  return l;
}
async function saveAndPublish(l: { id: string; publicCode: string }, definition: LandingDefinition) {
  const current = await getLanding(f.db, "r-owner", a, campaign, l.id);
  const saved = await writeLanding(f.db, "r-member", a, campaign, l.id, { definition, expectedRevision: current.revision, expectedCode: l.publicCode });
  return writeLanding(f.db, "r-owner", a, campaign, l.id, { expectedRevision: saved.revision, expectedCode: l.publicCode }, true);
}

it("offers only the ministry's own published, listed communities and keeps the choice in the immutable snapshot", async () => {
  const l = await link();
  const editable = await getLanding(f.db, "r-member", a, campaign, l.id);
  expect(editable.communities.map(c => c.name)).toEqual(["Bible study", "Pending group", "Prayer circle"]);
  // Another ministry's community, a hidden one and a malformed id are refused at save.
  for (const communityId of [worship, hiddenC, unlistedC]) await expect(writeLanding(f.db, "r-member", a, campaign, l.id, { definition: { ...baseDefinition, communityId }, expectedRevision: 0, expectedCode: l.publicCode })).rejects.toMatchObject({ status: 400 });
  await expect(writeLanding(f.db, "r-member", a, campaign, l.id, { definition: { ...baseDefinition, communityId: "not-a-uuid" }, expectedRevision: 0, expectedCode: l.publicCode })).rejects.toThrow();
  expect(await q("select public.valid_connect_landing($1::jsonb) as ok", [JSON.stringify({ ...baseDefinition, communityId: 7 })])).toMatchObject({ rows: [{ ok: false }] });
  expect(await q("select public.valid_connect_landing($1::jsonb) as ok", [JSON.stringify({ ...baseDefinition, communityId: prayer.toUpperCase() })])).toMatchObject({ rows: [{ ok: false }] });
  expect(await q("select public.valid_connect_landing($1::jsonb) as ok", [JSON.stringify(baseDefinition)])).toMatchObject({ rows: [{ ok: true }] });
  await saveAndPublish(l, { ...baseDefinition, communityId: prayer });
  for (const [kind, code] of [["qr", l.publicCode], ["short", l.shortCode]] as const) {
    const guest = await resolvePublishedLanding(f.db, kind, code);
    expect(guest?.community).toEqual({ slug: "c20-prayer", name: "Prayer circle", tagline: "Prayer circle tagline" });
    // The stored id never reaches the guest.
    expect(JSON.stringify(guest)).not.toContain(prayer);
    expect(guest?.definition).toEqual(baseDefinition);
  }
  // A private draft change does not touch the published page until it is published.
  const current = await getLanding(f.db, "r-owner", a, campaign, l.id);
  await writeLanding(f.db, "r-member", a, campaign, l.id, { definition: { ...baseDefinition, communityId: study }, expectedRevision: current.revision, expectedCode: l.publicCode });
  expect((await resolvePublishedLanding(f.db, "qr", l.publicCode))?.community?.slug).toBe("c20-prayer");
  await writeLanding(f.db, "r-owner", a, campaign, l.id, { expectedRevision: current.revision + 1, expectedCode: l.publicCode }, true);
  expect((await resolvePublishedLanding(f.db, "qr", l.publicCode))?.community?.slug).toBe("c20-study");
  expect((await q("select count(*)::int n from connect_landing_versions where link_id=$1 and definition ? 'communityId'", [l.id])).rows[0].n).toBe(2);
  // Removing the choice removes the card.
  await saveAndPublish(l, baseDefinition);
  expect((await resolvePublishedLanding(f.db, "qr", l.publicCode))?.community).toBeUndefined();
});

it("removes the card when the community is hidden, unlisted, unpublished or suspended by Harvest, and when the QR stops being public", async () => {
  const l = await link();
  const id = await community("r-owner", a, "c20-card", "Card group");
  await saveAndPublish(l, { ...baseDefinition, communityId: id });
  const card = async () => (await resolvePublishedLanding(f.db, "qr", l.publicCode))?.community?.slug;
  expect(await card()).toBe("c20-card");
  const set = async (patch: Record<string, unknown>) => updateCommunity(f.db, "r-owner", a, id, { version: (await getCommunity(f.db, "r-owner", a, id)).version, ...patch });
  await set({ visibility: "unlisted" }); expect(await card()).toBeUndefined();
  await set({ visibility: "hidden" }); expect(await card()).toBeUndefined();
  await set({ visibility: "listed" }); expect(await card()).toBe("c20-card");
  await publishCommunity(f.db, "r-owner", a, id, { version: (await getCommunity(f.db, "r-owner", a, id)).version, published: false });
  expect(await card()).toBeUndefined();
  expect((await resolvePublishedLanding(f.db, "qr", l.publicCode))?.definition).toEqual(baseDefinition);
  await publishCommunity(f.db, "r-owner", a, id, { version: (await getCommunity(f.db, "r-owner", a, id)).version, published: true });
  expect(await card()).toBe("c20-card");
  // Card does not need Discover approval, but a Harvest suspension (listing or ministry) hides it.
  await meta(a, "r-owner", "community", id, { category: "other" });
  expect(await approve("community", id, a)).toBe("approved");
  expect(await approve("community", id, a, { decision: "suspend", reason: "Synthetic check" })).toBe("suspended");
  expect(await card()).toBeUndefined();
  expect(await approve("community", id, a, { decision: "reinstate" })).toBe("approved");
  await setMinistryStanding(f.workerPool, a, true, "r-platform", "Synthetic check");
  expect(await card()).toBeUndefined();
  await setMinistryStanding(f.workerPool, a, false, "r-platform");
  expect(await card()).toBe("c20-card");
  await transitionConnectLink(f.db, "r-owner", a, campaign, l.id, { action: "disable" });
  expect(await card()).toBeUndefined();
  expect((await f.db.execute(sql`select * from public.resolve_connect_landing_community('qr', ${l.publicCode})`)).rows).toEqual([]);
  // The definer clears every setting it used.
  const settings = await f.db.transaction(async tx => {
    await tx.execute(sql`select * from public.resolve_connect_landing_community('qr', ${l.publicCode})`);
    return (await tx.execute<{ v: string | null }>(sql`select string_agg(coalesce(current_setting(n, true), ''), '') as v from unnest(array['app.connect_resolve_code','app.connect_resolve_tenant','app.connect_landing_link','app.community_resolve_ids','app.discover_read','app.community_definer_tenant']) n`)).rows[0].v;
  });
  expect(settings ?? "").toBe("");
});

it("counts a join from the QR page with no person link, only once, only for the recommended community, and never blocks the join", async () => {
  const l = await link();
  const id = await community("r-owner", a, "c20-count", "Count group");
  const other = await community("r-owner", a, "c20-other", "Other group");
  await saveAndPublish(l, { ...baseDefinition, communityId: id });
  const joins = async () => (await q("select coalesce(sum(joins),0)::int n from connect_community_join_counts where link_id=$1", [l.id])).rows[0].n;
  // A different community, a bad code, and a join without a code add nothing; joining still works.
  expect(await join("r-guest", "c20-other", { qr: l.publicCode })).toEqual({ outcome: "joined" });
  expect(await join("r-guest2", "c20-count")).toEqual({ outcome: "joined" });
  await expect(join("r-fresh", "c20-count", { qr: "../../etc" })).rejects.toThrow();
  expect(await joins()).toBe(0);
  // A join from the page adds one; joining again (already a member) does not.
  expect(await join("r-fresh", "c20-count", { qr: l.publicCode })).toEqual({ outcome: "joined" });
  expect(await join("r-fresh", "c20-count", { qr: l.publicCode })).toEqual({ outcome: "already_member" });
  expect(await joins()).toBe(1);
  // The short code counts too.
  expect(await join("r-mod", "c20-count", { qr: l.shortCode })).toEqual({ outcome: "joined" });
  expect(await joins()).toBe(2);
  // The count row has no person, membership, response or time column.
  expect((await q("select column_name from information_schema.columns where table_name='connect_community_join_counts' order by ordinal_position")).rows.map(r => r.column_name)).toEqual(["tenant_id", "link_id", "community_id", "joins"]);
  // Calling the counter directly without a membership created in the same transaction adds nothing; nor does a second call in one transaction.
  expect(await withUser(f.db, "r-guest", async tx => (await tx.execute<{ ok: boolean }>(sql`select public.connect_count_community_join(${l.publicCode}, 'c20-count') as ok`)).rows[0].ok)).toBe(false);
  expect(await withUser(f.db, "r-guest2", async tx => (await tx.execute<{ ok: boolean }>(sql`select public.connect_count_community_join(${l.publicCode}, 'c20-count') as ok`)).rows[0].ok)).toBe(false);
  expect(await joins()).toBe(2);
  // The application role cannot write the table directly.
  expect((await q("select has_table_privilege('harvest_app','connect_community_join_counts','INSERT,UPDATE,DELETE,TRUNCATE') w")).rows[0].w).toBe(false);
  void other;
});

it("shows staff a suppressed count and gives community moderators no campaign, response or count data", async () => {
  const l = await link();
  const id = await community("r-owner", a, "c20-stats", "Stats group");
  await saveAndPublish(l, { ...baseDefinition, communityId: id });
  const extra = ["r-s1", "r-s2", "r-s3", "r-s4", "r-s5"];
  await f.db.insert(users).values(extra.map(u => ({ id: u, name: u, email: `${u}@example.invalid`, emailVerified: true })));
  for (const u of extra.slice(0, 4)) await join(u, "c20-stats", { qr: l.publicCode });
  expect((await landingJoinCounts(f.db, "r-owner", a, campaign))[l.id]).toBeNull();
  await join("r-s5", "c20-stats", { qr: l.publicCode });
  expect((await landingJoinCounts(f.db, "r-member", a, campaign))[l.id]).toBe(5);
  // Viewers, other ministries and a community moderator who is not ministry staff are refused.
  await expect(landingJoinCounts(f.db, "r-other", a, campaign)).rejects.toMatchObject({ status: 403 });
  await q("update community_memberships set role='moderator' where community_id=$1 and user_id='r-s1'", [id]);
  await expect(landingJoinCounts(f.db, "r-s1", a, campaign)).rejects.toMatchObject({ status: 403 });
  await expect(getLanding(f.db, "r-s1", a, campaign, l.id)).rejects.toMatchObject({ status: 403 });
  // On the member path the moderator reads no response, landing, link or count rows (even with the tenant setting forced).
  const seen = await withUser(f.db, "r-s1", async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${a}, true)`);
    const count = async (table: string) => (await tx.execute<{ n: number }>(sql.raw(`select count(*)::int n from public.${table}`))).rows[0].n;
    return { responses: await count("campaign_responses"), states: await count("connect_landing_states"), versions: await count("connect_landing_versions"),
      links: await count("campaign_response_links"), counts: await count("connect_community_join_counts") };
  });
  expect(seen).toEqual({ responses: 0, states: 0, versions: 0, links: 0, counts: 0 });
  // The community's own member list carries no campaign or QR field.
  const columns = (await q("select column_name from information_schema.columns where table_name='community_memberships'")).rows.map(r => r.column_name).join(",");
  expect(columns).not.toMatch(/campaign|qr|link|response|connect/);
});

it("forces row security on the new table and gives the worker role nothing", async () => {
  expect((await q("select relrowsecurity, relforcerowsecurity from pg_class where relname='connect_community_join_counts'")).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  for (const fn of ["public.resolve_connect_landing_community(text,text)", "public.connect_count_community_join(text,text)", "public.discover_recommend(text,uuid[],integer)"]) {
    expect((await q("select has_function_privilege('harvest_worker', $1, 'execute') ok", [fn])).rows[0].ok, fn).toBe(false);
    expect((await q("select has_function_privilege('harvest_app', $1, 'execute') ok", [fn])).rows[0].ok, fn).toBe(true);
    expect((await q("select prosecdef, proconfig from pg_proc where oid = $1::regprocedure", [fn])).rows[0]).toEqual({ prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"] });
  }
  expect((await q("select has_table_privilege('harvest_worker','connect_community_join_counts','SELECT') ok")).rows[0].ok).toBe(false);
});

it("leaves out a course whose owner withdrew the opt-in or whose catalogue item is no longer public (same rule as search, 0144)", async () => {
  expect(await names(null, "course")).toContain("Prayer basics");
  await q("update discover_controls set owner_opt_in = false where resource_type = 'course' and resource_id = $1", [prayerCourse]);
  try { expect(await names(null, "course")).not.toContain("Prayer basics"); }
  finally { await q("update discover_controls set owner_opt_in = true where resource_type = 'course' and resource_id = $1", [prayerCourse]); }
  for (const change of ["visibility = 'community'", "visibility = 'hidden'", "state = 'draft'"]) {
    const before = (await q("select state, visibility from catalog_items where id = $1", [prayerCourse])).rows[0];
    await q(`update catalog_items set ${change} where id = $1`, [prayerCourse]);
    try { expect(await names(null, "course")).not.toContain("Prayer basics"); }
    finally { await q("update catalog_items set state = $2, visibility = $3 where id = $1", [prayerCourse, before.state, before.visibility]); }
  }
  expect(await names(null, "course")).toContain("Prayer basics");
});
