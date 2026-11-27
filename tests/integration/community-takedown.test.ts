import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => f.db }));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, getCommunity, listCategories, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity, getPublicCommunity, listDiscover } from "../../src/server/community-joining";
import { forumContext, getPost, listPosts, moderate, saveComment, savePost } from "../../src/server/community-forum";
import { communityTakedownFor, harvestPaused, respondToCommunityHarvestReport, staffCommunityOpenCount, staffCommunityReports, staffCommunityTakedown,
  staffResolveCommunityReport, submitContentHarvestReport } from "../../src/server/community-takedown";
import { withUser } from "../../src/server/tenancy";

// Harvest staff takedown for communities, posts and replies (0137): reports, rate limits, staff roles, the public 404, Discover, hidden posts,
// restore, audit and ministry isolation. The migrations run as a non-bypass owner, so every owner policy is exercised as in production.
let f: Awaited<ReturnType<typeof testDatabase>>;
let a: string, b: string, clubA: string, clubB: string, generalA: string, generalB: string;
const origin = "http://localhost:3000";
const people = ["t-owner", "t-host", "t-one", "t-two", "t-outsider", "t-bowner", "t-bone", "t-staff", "t-reviewer"];
const status = (promise: Promise<unknown>) => promise.then(() => 200, (e: { status?: number; name?: string }) => e.status ?? (e.name === "ZodError" ? 400 : 500));
const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const visitorReport = (slug: string, data: unknown, ip = "203.0.113.40", extra: Record<string, string> = {}) => respondToCommunityHarvestReport(new Request(`${origin}/api/communities/${slug}/harvest-report`,
  { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": ip, ...extra }, body: JSON.stringify(data) }), { params: Promise.resolve({ slug }) });
const audit = async (action: string) => (await f.admin.query("select actor_id, target_type, target_id, tenant_id from platform_staff_audit where action = $1 order by created_at", [action])).rows;
const legacyDiscover = async () => (await listDiscover(f.db, {})).items.map((i) => i.slug);
const approvedDiscover = async () => (await listDiscover(f.db, {}, { requireApproval: true })).items.map((i) => i.slug);
const search = async () => ((await f.db.transaction((tx) => tx.execute<{ r: { items: { slug: string }[] } }>(sql`select public.discover_search('', null, null, null, null, null, 'newest', 0, 24) as r`))).rows[0].r.items).map((i) => i.slug);

async function community(owner: string, tenant: string, name: string, slug: string) {
  const id = (await createCommunity(f.db, owner, tenant, { name, slug })).id;
  const { version } = await getCommunity(f.db, owner, tenant, id);
  const updated = await updateCommunity(f.db, owner, tenant, id, { version, visibility: "listed", allowOpen: true });
  await publishCommunity(f.db, owner, tenant, id, { version: updated.version, published: true });
  // A Discover listing, approved by staff, as the projection and the review would leave it.
  await f.admin.query(`insert into discover_listings (resource_type, resource_id, tenant_id, slug, name, host_name, pricing, admission, search_text, content_hash)
    values ('community', $1, $2, $3, $4, 'Host', 'free', '{open}', $3, 'h1') on conflict (resource_type, resource_id) do update set content_hash = 'h1'`, [id, tenant, slug, name]);
  await f.admin.query(`insert into discover_controls (tenant_id, resource_type, resource_id, owner_opt_in, category, language, review_state, reviewed_by, reviewed_at, reviewed_hash, current_hash)
    values ($1, 'community', $2, true, 'prayer', 'en', 'approved', 't-staff', now(), 'h1', 'h1')
    on conflict (tenant_id, resource_type, resource_id) do update set review_state = 'approved', reviewed_by = 't-staff', reviewed_hash = 'h1', current_hash = 'h1'`, [tenant, id]);
  return id;
}

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("BETTER_AUTH_SECRET", "t".repeat(40));
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  a = (await createWorkspace(f.db, "t-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "t-bowner", "Hope Mission", "church")).tenantId;
  clubA = await community("t-owner", a, "Grace prayer", "grace-prayer");
  clubB = await community("t-bowner", b, "Hope circle", "hope-circle");
  for (const user of ["t-host", "t-one", "t-two"]) await enterCommunity(f.db, user, "grace-prayer", { rulesVersion: 0, adult: true });
  await enterCommunity(f.db, "t-bone", "hope-circle", { rulesVersion: 0, adult: true });
  await f.admin.query("update community_memberships set role = 'moderator' where user_id = 't-host' and community_id = $1", [clubA]);
  generalA = (await listCategories(f.db, "t-owner", a, clubA))[0].id;
  generalB = (await listCategories(f.db, "t-bowner", b, clubB))[0].id;
  await f.admin.query("select public.platform_staff_grant('t-staff', 'admin', 'ops@harvest')");
  await f.admin.query("select public.platform_staff_grant('t-reviewer', 'reviewer', 'ops@harvest')");
}, 240_000);
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });

describe("reports to Harvest", () => {
  it("accepts a visitor's report of a public community, keeps no address and answers the same for anything not public", async () => {
    const ok = await visitorReport("grace-prayer", { reason: "scam", note: "  Asks for money  " });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ accepted: true });
    const [row] = (await f.admin.query("select * from community_harvest_reports where target_type = 'community'")).rows;
    expect(row).toMatchObject({ tenant_id: a, community_id: clubA, target_id: clubA, reason: "scam", note: "Asks for money", status: "open" });
    expect(Object.keys(row).sort()).toEqual(["community_id", "created_at", "id", "note", "reason", "resolved_at", "resolved_by", "status", "target_id", "target_type", "tenant_id"]);
    // Only a keyed hash is kept, in a minute counter: never the address itself.
    const scopes = (await f.admin.query("select scope from community_harvest_report_quotas")).rows.map((r) => r.scope as string);
    expect(scopes.join(" ")).not.toContain("203.0.113.40");
    // A draft and an unknown slug get exactly the same answer.
    const draft = (await createCommunity(f.db, "t-owner", a, { name: "Draft", slug: "grace-draft" })).id;
    const answers = await Promise.all(["grace-draft", "no-such-community", "Bad Slug!"].map(async (slug) => { const r = await visitorReport(slug, { reason: "spam" }, "203.0.113.41"); return [r.status, await r.text()]; }));
    expect(new Set(answers.map((x) => JSON.stringify(x))).size).toBe(1);
    expect(answers[0][0]).toBe(404);
    expect(draft).toBeTruthy();
    // Validation, the honeypot and the origin.
    expect((await visitorReport("grace-prayer", { reason: "nope" })).status).toBe(400);
    expect((await visitorReport("grace-prayer", { reason: "spam", note: "x".repeat(501) })).status).toBe(400);
    expect((await visitorReport("grace-prayer", { reason: "spam", website: "bot" })).status).toBe(200);
    expect((await visitorReport("grace-prayer", { reason: "spam" }, "203.0.113.42", { origin: "https://evil.example" })).status).toBe(404);
    expect(Number((await f.admin.query("select count(*) from community_harvest_reports")).rows[0].count)).toBe(1);
  });

  it("rate-limits three reports a minute per visitor and community, then answers 429", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await visitorReport("hope-circle", { reason: "spam" }, "198.51.100.7")).status);
    expect(results).toEqual([200, 200, 200, 429]);
    expect((await visitorReport("hope-circle", { reason: "spam" }, "198.51.100.8")).status).toBe(200);
    // Thirty a minute per community, whoever sends them.
    const many = [];
    for (let i = 0; i < 30; i++) many.push((await visitorReport("hope-circle", { reason: "other" }, `198.51.100.${20 + i}`)).status);
    expect(many.filter((s) => s === 429).length).toBeGreaterThan(0);
    await f.admin.query("delete from community_harvest_reports where community_id = $1", [clubB]);
    await f.admin.query("delete from community_harvest_report_quotas");
  });

  it("lets members report posts and replies they can read, never their own, and closes the tables to the app", async () => {
    const post = await savePost(f.db, "t-one", "grace-prayer", { categoryId: generalA, title: "Buy now", body: body("Cheap pills") });
    const reply = await saveComment(f.db, "t-one", "grace-prayer", post.id!, { body: "Spam reply" });
    expect(await submitContentHarvestReport(f.db, "t-two", "grace-prayer", { targetType: "post", targetId: post.id, reason: "spam" })).toBe("ok");
    expect(await submitContentHarvestReport(f.db, "t-two", "grace-prayer", { targetType: "comment", targetId: reply.id, reason: "harassment", note: "Rude" })).toBe("ok");
    // Own content, a non-member, the wrong community and an unknown id get the same answer.
    expect(await submitContentHarvestReport(f.db, "t-one", "grace-prayer", { targetType: "post", targetId: post.id, reason: "spam" })).toBe("not_found");
    expect(await submitContentHarvestReport(f.db, "t-outsider", "grace-prayer", { targetType: "post", targetId: post.id, reason: "spam" })).toBe("not_found");
    expect(await submitContentHarvestReport(f.db, "t-bone", "hope-circle", { targetType: "post", targetId: post.id, reason: "spam" })).toBe("not_found");
    expect(await submitContentHarvestReport(f.db, "t-two", "grace-prayer", { targetType: "post", targetId: "00000000-0000-4000-8000-000000000000", reason: "spam" })).toBe("not_found");
    expect(await submitContentHarvestReport(f.db, "t-two", "grace-prayer", { targetType: "member", targetId: post.id, reason: "spam" })).toBe("invalid");
    for (const table of ["community_harvest_reports", "community_harvest_report_quotas"]) {
      await expect(withUser(f.db, "t-two", (tx) => tx.execute(sql.raw(`select * from ${table}`)))).rejects.toThrow();
    }
    await expect(withUser(f.db, "t-two", (tx) => tx.execute(sql`select public.community_harvest_report_record(${a}::uuid, ${clubA}::uuid, 'post', ${post.id}::uuid, 'spam', null, ${"a".repeat(64)})`))).rejects.toThrow();
  });
});

describe("Harvest staff", () => {
  it("lists and resolves reports for staff only, with the open-report badge count", async () => {
    expect(await status(staffCommunityReports(f.db, "t-owner", "open"))).toBe(404);
    expect(await status(staffCommunityOpenCount(f.db, "t-one"))).toBe(404);
    const { reports, openCount } = await staffCommunityReports(f.db, "t-reviewer", "open");
    expect(openCount).toBe(3);
    expect(reports.map((r) => r.targetType).sort()).toEqual(["comment", "community", "post"]);
    expect(reports.find((r) => r.targetType === "post")).toMatchObject({ ministry: "Grace Church", community: "Grace prayer", slug: "grace-prayer", excerpt: "Buy now · Cheap pills", hidden: false, removed: false });
    expect(reports.find((r) => r.targetType === "comment")).toMatchObject({ excerpt: "Spam reply", note: "Rude" });
    const community = reports.find((r) => r.targetType === "community")!;
    expect(await staffResolveCommunityReport(f.db, "t-reviewer", community.id, { status: "reviewed" })).toEqual({ resolved: true });
    expect(await status(staffResolveCommunityReport(f.db, "t-reviewer", community.id, { status: "dismissed" }))).toBe(404);
    expect(await status(staffResolveCommunityReport(f.db, "t-owner", reports[0].id, { status: "dismissed" }))).toBe(404);
    expect(await staffCommunityOpenCount(f.db, "t-staff")).toBe(2);
    expect((await staffCommunityReports(f.db, "t-staff", "reviewed")).reports.map((r) => r.id)).toEqual([community.id]);
    expect(await audit("community.report.reviewed")).toEqual([{ actor_id: "t-reviewer", target_type: "community_harvest_report", target_id: community.id, tenant_id: a }]);
    expect((await audit("community.reports")).map((r) => r.actor_id)).toEqual(["t-reviewer", "t-staff"]);
  });

  it("lets only staff admins hide or restore, in the server and in the database", async () => {
    expect(await status(staffCommunityTakedown(f.db, "t-reviewer", { targetType: "community", targetId: clubA, hidden: true, reason: "x" }))).toBe(404);
    await expect(withUser(f.db, "t-reviewer", (tx) => tx.execute(sql`select public.platform_community_takedown('community', ${clubA}::uuid, true, 'x')`))).rejects.toMatchObject({ cause: { message: "not staff" } });
    expect(await status(staffCommunityTakedown(f.db, "t-owner", { targetType: "community", targetId: clubA, hidden: true, reason: "x" }))).toBe(404);
    expect(await status(staffCommunityTakedown(f.db, "t-staff", { targetType: "community", targetId: clubA, hidden: true }))).toBe(400);
    // Only what someone reported: the other ministry's community has no report.
    expect(await status(staffCommunityTakedown(f.db, "t-staff", { targetType: "community", targetId: clubB, hidden: true, reason: "x" }))).toBe(404);
    // The app cannot write the takedown table itself.
    await expect(withUser(f.db, "t-owner", (tx) => tx.execute(sql`insert into community_takedowns (target_type, target_id, tenant_id, community_id, hidden, changed_by) values ('community', ${clubA}::uuid, ${a}::uuid, ${clubA}::uuid, false, 't-owner')`))).rejects.toThrow();
  });
});

describe("hiding and restoring a community", () => {
  it("404s the public page and Discover, shows members a paused notice and the owner the reason, and restores everything", async () => {
    expect(await getPublicCommunity(f.db, "grace-prayer")).not.toBeNull();
    expect(await legacyDiscover()).toEqual(expect.arrayContaining(["grace-prayer", "hope-circle"]));
    expect(await approvedDiscover()).toEqual(expect.arrayContaining(["grace-prayer", "hope-circle"]));
    expect(await search()).toEqual(expect.arrayContaining(["grace-prayer", "hope-circle"]));
    expect(await staffCommunityTakedown(f.db, "t-staff", { targetType: "community", targetId: clubA, hidden: true, reason: "Fundraising scam" })).toEqual({ hidden: true });

    expect(await getPublicCommunity(f.db, "grace-prayer")).toBeNull();
    for (const list of [await legacyDiscover(), await approvedDiscover(), await search()]) { expect(list).not.toContain("grace-prayer"); expect(list).toContain("hope-circle"); }
    expect((await visitorReport("grace-prayer", { reason: "spam" }, "203.0.113.90")).status).toBe(404);
    // Members (hosts included) read nothing and see a pause notice; only owners and admins get the reason. Non-members learn nothing.
    expect(await forumContext(f.db, "t-one", "grace-prayer")).toBeNull();
    expect(await forumContext(f.db, "t-owner", "grace-prayer")).toBeNull();
    expect(await harvestPaused(f.db, "t-one", "grace-prayer")).toEqual({ slug: "grace-prayer", name: "Grace prayer", manager: false, reason: null });
    expect(await harvestPaused(f.db, "t-owner", "grace-prayer")).toEqual({ slug: "grace-prayer", name: "Grace prayer", manager: true, reason: "Fundraising scam" });
    expect(await harvestPaused(f.db, "t-outsider", "grace-prayer")).toBeNull();
    expect(await harvestPaused(f.db, "t-bone", "hope-circle")).toBeNull();
    expect(await communityTakedownFor(f.db, "t-owner", a, clubA)).toEqual({ hidden: true, reason: "Fundraising scam" });
    // The other ministry is untouched and cannot see the first ministry's standing.
    expect(await forumContext(f.db, "t-bone", "hope-circle")).not.toBeNull();
    expect(await communityTakedownFor(f.db, "t-bowner", b, clubB)).toEqual({ hidden: false, reason: null });
    expect(await withUser(f.db, "t-bowner", (tx) => tx.execute(sql`select * from community_takedowns`)).then((r) => r.rows)).toEqual([]);
    expect((await staffCommunityReports(f.db, "t-staff", "reviewed")).reports[0]).toMatchObject({ targetId: clubA, hidden: true });

    expect(await staffCommunityTakedown(f.db, "t-staff", { targetType: "community", targetId: clubA, hidden: false })).toEqual({ hidden: false });
    expect(await getPublicCommunity(f.db, "grace-prayer")).not.toBeNull();
    expect(await search()).toContain("grace-prayer");
    expect(await approvedDiscover()).toContain("grace-prayer");
    expect(await forumContext(f.db, "t-one", "grace-prayer")).not.toBeNull();
    expect(await harvestPaused(f.db, "t-one", "grace-prayer")).toBeNull();
    expect(await communityTakedownFor(f.db, "t-owner", a, clubA)).toEqual({ hidden: false, reason: null });
    expect((await audit("community.takedown.hide")).map((r) => [r.actor_id, r.target_type, r.target_id, r.tenant_id])).toEqual([["t-staff", "community", clubA, a]]);
    expect((await audit("community.takedown.restore")).map((r) => [r.actor_id, r.target_id])).toEqual([["t-staff", clubA]]);
  });
});

describe("hiding and restoring a post or reply", () => {
  it("hides a post from members but not from its author and the community's staff, who see the marker; restore brings it back", async () => {
    const { reports } = await staffCommunityReports(f.db, "t-staff", "open");
    const post = reports.find((r) => r.targetType === "post")!, reply = reports.find((r) => r.targetType === "comment")!;
    const other = await savePost(f.db, "t-two", "grace-prayer", { categoryId: generalA, title: "Fine", body: body("Hello") });
    const bPost = await savePost(f.db, "t-bone", "hope-circle", { categoryId: generalB, title: "Hope post", body: body("Hi") });
    expect(await staffCommunityTakedown(f.db, "t-staff", { targetType: "post", targetId: post.targetId, hidden: true, reason: "Spam" })).toEqual({ hidden: true });
    expect(await staffCommunityTakedown(f.db, "t-staff", { targetType: "comment", targetId: reply.targetId, hidden: true, reason: "Abuse" })).toEqual({ hidden: true });

    const ids = async (user: string) => (await listPosts(f.db, user, "grace-prayer")).posts.map((p) => p.id);
    expect(await ids("t-two")).not.toContain(post.targetId);
    expect(await ids("t-two")).toContain(other.id);
    await expect(getPost(f.db, "t-two", "grace-prayer", post.targetId)).rejects.toMatchObject({ status: 404 });
    expect((await f.admin.query("select count(*)::int n from community_posts where id = $1", [post.targetId])).rows[0].n).toBe(1);
    // A member with a direct read sees nothing either (row security, not only the service).
    expect((await withUser(f.db, "t-two", (tx) => tx.execute(sql`select id from community_posts where id = ${post.targetId}::uuid`))).rows).toEqual([]);
    for (const user of ["t-one", "t-host", "t-owner"]) {
      const listed = (await listPosts(f.db, user, "grace-prayer")).posts.find((p) => p.id === post.targetId);
      expect(listed, user).toMatchObject({ harvestHidden: true });
      expect((await getPost(f.db, user, "grace-prayer", post.targetId)).post.harvestHidden, user).toBe(true);
    }
    // The hidden reply: invisible to another member on a visible post, shown with the marker to its author and hosts.
    await staffCommunityTakedown(f.db, "t-staff", { targetType: "post", targetId: post.targetId, hidden: false });
    expect((await getPost(f.db, "t-two", "grace-prayer", post.targetId)).comments.map((c) => c.id)).not.toContain(reply.targetId);
    expect((await getPost(f.db, "t-host", "grace-prayer", post.targetId)).comments.find((c) => c.id === reply.targetId)).toMatchObject({ harvestHidden: true });
    expect((await getPost(f.db, "t-one", "grace-prayer", post.targetId)).comments.find((c) => c.id === reply.targetId)).toMatchObject({ harvestHidden: true });
    // Restore: everyone sees the post and the reply again, without a marker.
    await staffCommunityTakedown(f.db, "t-staff", { targetType: "comment", targetId: reply.targetId, hidden: false });
    expect(await ids("t-two")).toContain(post.targetId);
    expect((await getPost(f.db, "t-two", "grace-prayer", post.targetId)).comments.find((c) => c.id === reply.targetId)).toMatchObject({ harvestHidden: false });
    // The other ministry's forum is never affected.
    expect((await listPosts(f.db, "t-bone", "hope-circle")).posts.map((p) => p.id)).toEqual([bPost.id]);
    expect((await audit("community.takedown.hide")).map((r) => r.target_type)).toEqual(["community", "post", "comment"]);
    expect((await audit("community.takedown.restore")).map((r) => r.target_type)).toEqual(["community", "post", "comment"]);
    // Host moderation still works on the restored post.
    await moderate(f.db, "t-owner", "grace-prayer", { action: "pin", targetId: post.targetId });
  });

  it("leaves settings the app pre-sets unable to open the takedown tables", async () => {
    const rows = await withUser(f.db, "t-two", async (tx) => {
      await tx.execute(sql`select set_config('app.community_takedown', 'on', true)`);
      return (await tx.execute(sql`select count(*)::int n from community_takedowns`)).rows[0];
    });
    expect(rows).toEqual({ n: 0 });
    // community_definer_reset (run on entry by every community definer) blanks the flag too.
    expect((await f.admin.query("select prosrc from pg_proc where proname = 'community_definer_reset'")).rows[0].prosrc).toContain("'app.community_takedown'");
  });
});
