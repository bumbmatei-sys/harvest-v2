import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { changeBlogPostState, createBlogPost, deleteBlogPost, getBlog, getBlogPost, latestBlogPosts, plannerArticles, publicBlogFeed, publicBlogImage, publicBlogIndex,
  publicBlogPost, saveBlogPost, saveBlogSettings } from "../../src/server/blog";
import { sweepBlogSchedule } from "../../src/server/blog-publish-worker";
import { changeMemberAccess } from "../../src/server/access";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { getBioPage } from "../../src/server/link-in-bio";
import { chargePublicRead, publicReadLimits } from "../../src/server/public-read-limit";
import { withTenant } from "../../src/server/tenancy";
import { noNetwork, seedPeople } from "./social-layer-fixture";

// Native blog (0133): row security across two ministries, drafts hidden from visitors, members and viewers, the address lock, the scheduled-publish job,
// the published-only definers and the link-in-bio interface. Restricted (non-superuser, non-BYPASSRLS) migration owner.
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => f.db }));
let f: Awaited<ReturnType<typeof testDatabase>>;
let p: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number; name?: string }) => error.status ?? (error.name === "ZodError" ? 400 : 500));
const body = (text: string, extra: unknown[] = []) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...extra] });
let picture: string, otherPicture: string, pdf: string;
const file = async (tenant: string, owner: string, mime = "image/png", state = "ready") => (await f.admin.query(`insert into files(id,tenant_id,owner_id,key,name,mime,size,checksum,status)
  select g,$1::uuid,$2,'workspaces/'||$1||'/files/'||g,'picture.png',$3,5,repeat('a',64),$4 from (select gen_random_uuid() g) x returning id`, [tenant, owner, mime, state])).rows[0].id as string;

async function write(user: string, tenant: string, title: string, extra: Record<string, unknown> = {}) {
  const draft = await createBlogPost(f.db, user, tenant);
  return saveBlogPost(f.db, user, tenant, draft.id, { version: draft.version, title, slug: extra.slug ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), body: body(`${title} text for the blog.`), ...extra });
}
async function publish(user: string, tenant: string, title: string, extra: Record<string, unknown> = {}) {
  const post = await write(user, tenant, title, extra);
  return changeBlogPostState(f.db, user, tenant, post.id, { action: "publish", version: post.version });
}

beforeAll(async () => {
  fetchSpy = noNetwork();
  f = await testDatabase({ migrationOwner: true });
  vi.stubEnv("NODE_ENV", "test");
  p = await seedPeople(f, "blog");
  await f.db.insert(users).values([{ id: "blog-collab", name: "blog-collab", email: "blog-collab@example.invalid", emailVerified: true },
    { id: "blog-social", name: "blog-social", email: "blog-social@example.invalid", emailVerified: true }]);
  await putMember(f.db, p.owner, p.tenant, "blog-collab@example.invalid", "viewer");
  await putMember(f.db, p.owner, p.tenant, "blog-social@example.invalid", "viewer");
  await changeMemberAccess(f.db, p.owner, p.tenant, { userId: "blog-collab", role: "collaborator", grants: { website: "manage" } });
  await changeMemberAccess(f.db, p.owner, p.tenant, { userId: "blog-social", role: "collaborator", grants: { social: "manage" } });
  picture = await file(p.tenant, p.owner);
  otherPicture = await file(p.other, p.outsider);
  pdf = await file(p.tenant, p.owner, "application/pdf");
}, 240_000);
afterAll(async () => { fetchSpy?.mockRestore(); vi.unstubAllEnvs(); await f?.close(); });

describe("owner access", () => {
  it("creates the blog on first open with an address from the ministry name; owners, admins and a Website collaborator manage it", async () => {
    const blog = await getBlog(f.db, p.owner, p.tenant);
    expect(blog.settings).toMatchObject({ handle: "blog-ministry", title: "blog ministry", version: 1, handleLocked: false, timeZone: "UTC" });
    for (const user of [p.admin, "blog-collab"]) expect((await getBlog(f.db, user, p.tenant)).settings.handle).toBe("blog-ministry");
    for (const user of [p.member, p.viewer, "blog-social", p.outsider]) expect(await status(getBlog(f.db, user, p.tenant))).toBe(403);
  });

  it("never shows a draft to members, viewers or other ministries, even reading the table directly", async () => {
    const draft = await write(p.owner, p.tenant, "Secret draft");
    for (const user of [p.member, p.viewer, "blog-social"]) {
      const rows = await withTenant(f.db, user, p.tenant, "workspace:read", async (tx) => (await tx.execute(sql`select id from blog_posts`)).rows);
      expect(rows).toEqual([]);
      await expect(withTenant(f.db, user, p.tenant, "workspace:read", (tx) => tx.execute(sql`insert into blog_posts (tenant_id, slug, body, created_by) values (${p.tenant}::uuid, 'x', '{"type":"doc"}', ${user})`))).rejects.toThrow();
    }
    // Another ministry's owner sees nothing of this one, and cannot write into it.
    await getBlog(f.db, p.outsider, p.other);
    const theirs = await withTenant(f.db, p.outsider, p.other, "blog:manage", async (tx) => (await tx.execute(sql`select tenant_id from blog_posts`)).rows);
    expect(theirs.every((r) => r.tenant_id === p.other)).toBe(true);
    expect(await status(getBlogPost(f.db, p.outsider, p.other, draft.id))).toBe(404);
    expect(await status(saveBlogPost(f.db, p.outsider, p.other, draft.id, { title: "Taken" }))).toBe(404);
    expect(await publicBlogPost(f.db, "blog-ministry", draft.slug)).toBeNull();
  });

  it("keeps the app role away from the definer helpers and the worker job", async () => {
    for (const fn of ["public.blog_scope_clear()", "public.blog_publish_due(integer)", "public.blog_scoped(text)"]) {
      expect((await f.admin.query("select has_function_privilege('harvest_app', $1, 'execute') as ok", [fn])).rows[0].ok, fn).toBe(false);
    }
    await expect(f.pool.query("select public.blog_publish_due(10)")).rejects.toMatchObject({ code: "42501" });
    const { rows } = await f.admin.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('blog_settings', 'blog_posts') order by 1`);
    expect(rows).toEqual([{ relname: "blog_posts", relrowsecurity: true, relforcerowsecurity: true }, { relname: "blog_settings", relrowsecurity: true, relforcerowsecurity: true }]);
  });
});

describe("articles", () => {
  it("saves text and settings, checks pictures, and refuses a picture of another ministry or a non-image", async () => {
    const post = await write(p.owner, p.tenant, "Advent hope", { excerpt: "  Waiting with hope.  ", seoTitle: "Advent hope at our church", coverFileId: picture });
    expect(post).toMatchObject({ title: "Advent hope", slug: "advent-hope", excerpt: "Waiting with hope.", coverFileId: picture, status: "draft", slugLocked: false });
    const withImage = await saveBlogPost(f.db, p.owner, p.tenant, post.id, { version: post.version, title: "Advent hope", body: body("Look.", [{ type: "blogImage", attrs: { fileId: picture, alt: "Candles" } }]) });
    expect(withImage.body.content?.[1]).toEqual({ type: "blogImage", attrs: { fileId: picture, alt: "Candles" } });
    expect(await status(saveBlogPost(f.db, p.owner, p.tenant, post.id, { version: withImage.version, title: "x", coverFileId: otherPicture }))).toBe(400);
    expect(await status(saveBlogPost(f.db, p.owner, p.tenant, post.id, { version: withImage.version, title: "x", shareFileId: pdf }))).toBe(400);
    expect(await status(saveBlogPost(f.db, p.owner, p.tenant, post.id, { version: withImage.version, title: "x", body: body("x", [{ type: "blogImage", attrs: { fileId: otherPicture } }]) }))).toBe(400);
    expect(await status(saveBlogPost(f.db, p.owner, p.tenant, post.id, { version: withImage.version, title: "x", body: { type: "doc", content: [{ type: "script" }] } }))).toBe(400);
    // A stale version is refused.
    expect(await status(saveBlogPost(f.db, p.owner, p.tenant, post.id, { version: post.version, title: "Old" }))).toBe(409);
    // Two articles of one ministry cannot share an address; another ministry can use it.
    const second = await createBlogPost(f.db, p.owner, p.tenant);
    expect(await status(saveBlogPost(f.db, p.owner, p.tenant, second.id, { version: second.version, title: "Copy", slug: "advent-hope" }))).toBe(409);
    const theirs = await createBlogPost(f.db, p.outsider, p.other);
    expect((await saveBlogPost(f.db, p.outsider, p.other, theirs.id, { version: theirs.version, title: "Theirs", slug: "advent-hope" })).slug).toBe("advent-hope");
  });

  it("locks the article address after the first publish, even after unpublishing, and the blog address once anything is published", async () => {
    const live = await publish(p.owner, p.tenant, "Locked address");
    expect(live).toMatchObject({ status: "published", slugLocked: true });
    expect(await status(saveBlogPost(f.db, p.owner, p.tenant, live.id, { version: live.version, title: "Locked address", slug: "new-address" }))).toBe(409);
    const draft = await changeBlogPostState(f.db, p.owner, p.tenant, live.id, { action: "unpublish", version: live.version });
    expect(draft).toMatchObject({ status: "draft", slugLocked: true, publishedAt: null });
    expect(await status(saveBlogPost(f.db, p.owner, p.tenant, live.id, { version: draft.version, title: "Locked address", slug: "new-address" }))).toBe(409);
    // Directly in the database too (the trigger, not only the server).
    await expect(withTenant(f.db, p.owner, p.tenant, "blog:manage", (tx) => tx.execute(sql`update blog_posts set slug = 'sneaky', version = version + 1 where id = ${live.id}::uuid`))).rejects.toThrow();
    await expect(withTenant(f.db, p.owner, p.tenant, "blog:manage", (tx) => tx.execute(sql`update blog_posts set first_published_at = null, version = version + 1 where id = ${live.id}::uuid`))).rejects.toThrow();
    const { settings } = await getBlog(f.db, p.owner, p.tenant);
    expect(settings.handleLocked).toBe(true);
    expect(await status(saveBlogSettings(f.db, p.owner, p.tenant, { version: settings.version, handle: "renamed-blog", title: "Our blog" }))).toBe(409);
    expect((await saveBlogSettings(f.db, p.owner, p.tenant, { version: settings.version, handle: settings.handle, title: "Our blog", intro: "News and teaching." })).title).toBe("Our blog");
  });

  it("refuses to publish an empty article and deletes with the current version only", async () => {
    const empty = await createBlogPost(f.db, p.owner, p.tenant);
    expect(await status(changeBlogPostState(f.db, p.owner, p.tenant, empty.id, { action: "publish", version: empty.version }))).toBe(400);
    expect(await status(deleteBlogPost(f.db, p.owner, p.tenant, empty.id, empty.version + 5))).toBe(409);
    expect(await deleteBlogPost(f.db, p.owner, p.tenant, empty.id, empty.version)).toEqual({ deleted: true });
    expect(await status(deleteBlogPost(f.db, p.viewer, p.tenant, empty.id, 1))).toBe(403);
  });
});

describe("scheduling", () => {
  it("schedules within the coming year, shows in the planner and is published by the worker job only once due", async () => {
    const post = await write(p.owner, p.tenant, "Christmas Eve service");
    const at = new Date(Date.now() + 2 * 3_600_000).toISOString();
    expect(await status(changeBlogPostState(f.db, p.owner, p.tenant, post.id, { action: "schedule", version: post.version, at: new Date(Date.now() - 60_000).toISOString() }))).toBe(400);
    expect(await status(changeBlogPostState(f.db, p.owner, p.tenant, post.id, { action: "schedule", version: post.version, at: new Date(Date.now() + 400 * 86_400_000).toISOString() }))).toBe(400);
    const scheduled = await changeBlogPostState(f.db, p.owner, p.tenant, post.id, { action: "schedule", version: post.version, at });
    expect(scheduled).toMatchObject({ status: "scheduled", publishAt: at });
    const range = { from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() };
    expect((await plannerArticles(f.db, p.owner, p.tenant, range)).find((a) => a.id === post.id)).toMatchObject({ status: "scheduled", at, handle: "blog-ministry" });
    expect(await status(plannerArticles(f.db, p.viewer, p.tenant, range))).toBe(403);
    // Not visible to visitors before it is published.
    expect(await publicBlogPost(f.db, "blog-ministry", "christmas-eve-service")).toBeNull();
    // Not due yet: the job publishes nothing.
    expect(await sweepBlogSchedule(f.workerPool)).toEqual({ published: 0 });
    // The app role cannot move the time into the past to skip the job.
    await expect(withTenant(f.db, p.owner, p.tenant, "blog:manage", (tx) => tx.execute(sql`update blog_posts set publish_at = now() - interval '1 minute', version = version + 1 where id = ${post.id}::uuid`))).rejects.toThrow();
    // Time passes (the test moves the schedule back as the owner role).
    await f.admin.query("alter table blog_posts disable trigger blog_posts_guard");
    await f.admin.query("update blog_posts set publish_at = now() - interval '1 minute' where id = $1", [post.id]);
    await f.admin.query("alter table blog_posts enable trigger blog_posts_guard");
    expect(await sweepBlogSchedule(f.workerPool)).toEqual({ published: 1 });
    expect(await sweepBlogSchedule(f.workerPool)).toEqual({ published: 0 });
    const { post: done } = await getBlogPost(f.db, p.owner, p.tenant, post.id);
    expect(done).toMatchObject({ status: "published", publishAt: null, slugLocked: true });
    expect(await publicBlogPost(f.db, "blog-ministry", "christmas-eve-service")).toMatchObject({ title: "Christmas Eve service" });
    // The worker cannot publish a draft or touch a published article.
    const other = await write(p.owner, p.tenant, "Worker cannot touch");
    await expect(f.workerPool.query("update blog_posts set status = 'published' where id = $1", [other.id])).rejects.toMatchObject({ code: "42501" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("takes a schedule back to a draft", async () => {
    const post = await write(p.owner, p.tenant, "Undo schedule");
    const scheduled = await changeBlogPostState(f.db, p.owner, p.tenant, post.id, { action: "schedule", version: post.version, at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(await changeBlogPostState(f.db, p.owner, p.tenant, post.id, { action: "unschedule", version: scheduled.version })).toMatchObject({ status: "draft", publishAt: null });
  });
});

describe("public reads", () => {
  it("lists only published articles with pagination, serves one article with more, and answers null for anything else", async () => {
    for (let i = 1; i <= 13; i++) await publish(p.admin, p.tenant, `Page test ${i}`);
    const first = await publicBlogIndex(f.db, "blog-ministry", 1);
    expect(first).toMatchObject({ title: "Our blog", intro: "News and teaching.", page: 1 });
    expect(first!.posts).toHaveLength(12);
    expect(first!.pages).toBe(Math.ceil(first!.total / 12));
    expect(first!.posts.map((c) => c.title)).not.toContain("Secret draft");
    expect(Object.keys(first!.posts[0]).sort()).toEqual(["coverId", "excerpt", "hasCover", "publishedAt", "readingMinutes", "slug", "title"]);
    expect(await publicBlogIndex(f.db, "blog-ministry", 99)).toBeNull();
    expect(await publicBlogIndex(f.db, "no-such-blog", 1)).toBeNull();
    const view = await publicBlogPost(f.db, "blog-ministry", "page-test-3");
    expect(view).toMatchObject({ title: "Page test 3", blog: { handle: "blog-ministry", title: "Our blog" } });
    expect(view!.more).toHaveLength(3);
    expect(view!.more.map((m) => m.slug)).not.toContain("page-test-3");
    // The answer never carries the internal id, author or the ministry id.
    expect(JSON.stringify(view)).not.toMatch(new RegExp(`${p.tenant}|${p.admin}`));
  });

  it("serves a published article's pictures only", async () => {
    const live = await publish(p.owner, p.tenant, "With pictures", { coverFileId: picture });
    expect(live.coverFileId).toBe(picture);
    expect(await publicBlogImage(f.db, "blog-ministry", picture)).toMatchObject({ key: `workspaces/${p.tenant}/files/${picture}`, mime: "image/png" });
    expect(await publicBlogImage(f.db, "blog-ministry", pdf)).toBeNull();
    expect(await publicBlogImage(f.db, "blog-ministry", otherPicture)).toBeNull();
    expect(await publicBlogImage(f.db, "no-such-blog", picture)).toBeNull();
    await changeBlogPostState(f.db, p.owner, p.tenant, live.id, { action: "unpublish", version: live.version });
    // Another published article (Advent hope is a draft) still carries no reference to it.
    expect(await publicBlogImage(f.db, "blog-ministry", picture)).toBeNull();
  });

  it("feeds the newest published articles with bodies", async () => {
    const feed = await publicBlogFeed(f.db, "blog-ministry");
    expect(feed!.items.length).toBeGreaterThan(10);
    expect(feed!.items.length).toBeLessThanOrEqual(20);
    expect(feed!.items[0].body.type).toBe("doc");
    expect(feed!.items.map((i) => i.title)).not.toContain("Secret draft");
  });

  it("gives the link-in-bio block the newest or chosen published articles only", async () => {
    const latest = await latestBlogPosts(f.db, p.tenant, { limit: 2 });
    expect(latest).toHaveLength(2);
    expect(latest[0]).toMatchObject({ handle: "blog-ministry", path: `/blog/blog-ministry/${latest[0].slug}` });
    const chosen = await latestBlogPosts(f.db, p.tenant, { slugs: ["page-test-2", "secret-draft", "page-test-1"] });
    expect(chosen.map((c) => c.slug)).toEqual(["page-test-2", "page-test-1"]);
    expect(await latestBlogPosts(f.db, "00000000-0000-4000-8000-000000000000")).toEqual([]);
  });

  it("ignores a blog flag the caller set beforehand and puts the caller's own settings back afterwards", async () => {
    await f.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${p.tenant}, true), set_config('app.blog_public_tenant', ${p.other}, true)`);
      const { rows: [read] } = await tx.execute<{ v: { handle: string; posts: { slug: string }[] } }>(sql`select public.blog_public_index('blog-ministry', 1, 50) as v`);
      expect(read.v.handle).toBe("blog-ministry");
      // The other ministry's article "advent-hope" is a draft there; nothing of that ministry leaks through the preset flag.
      const { rows: [row] } = await tx.execute<{ t: string; b: string }>(sql`select current_setting('app.tenant_id', true) t, current_setting('app.blog_public_tenant', true) b`);
      expect(row).toEqual({ t: p.tenant, b: p.other });
      // The app role reads nothing directly with that flag (the definer policies are for the function owner only).
      expect((await tx.execute(sql`select 1 from blog_posts where tenant_id = ${p.other}::uuid`)).rows).toEqual([]);
    });
  });

  it("clears every app.* flag any owner-role policy reads", async () => {
    const { rows: [fn] } = await f.admin.query("select prosrc from pg_proc where proname = 'blog_scope_clear'");
    const flags = (await f.admin.query(`select distinct m[1] as flag from pg_policies p, regexp_matches(coalesce(qual,'')||coalesce(with_check,''), '(app\\.[a-z0-9_]+)', 'g') m
      where not ('harvest_app' = any(p.roles))`)).rows.map((r) => r.flag as string);
    expect(flags.length).toBeGreaterThan(30);
    expect(flags.filter((flag) => !fn.prosrc.includes(`'${flag}'`)).sort()).toEqual([]);
    expect(fn.prosrc).not.toContain("pg_settings");
  });

  it("limits public reads per visitor with the shared limiter", async () => {
    const visitor = "blog-visitor-key", now = Date.now();
    for (let i = 0; i < publicReadLimits.blog; i++) expect(await chargePublicRead(f.db, "blog", visitor, now, false)).toEqual({ limited: false });
    expect(await chargePublicRead(f.db, "blog", visitor, now, false)).toMatchObject({ limited: true });
    expect(await chargePublicRead(f.db, "blog", "another-visitor", now, false)).toEqual({ limited: false });
  });
});

describe("review fixes (#315)", () => {
  it("never lets the owner-role file policy show a draft's picture or a non-image, even with both flags set by hand", async () => {
    const draftPicture = await file(p.tenant, p.owner);
    const draft = await write(p.owner, p.tenant, "Draft with a picture", { coverFileId: draftPicture });
    expect(draft.coverFileId).toBe(draftPicture);
    const client = await f.admin.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${f.migrationOwner}`);
      const visible = async (id: string) => {
        await client.query("select set_config('app.blog_public_tenant', $1, true), set_config('app.blog_public_file', $2, true)", [p.tenant, id]);
        return (await client.query("select id from public.files where id = $1", [id])).rows.length;
      };
      expect(await visible(draftPicture)).toBe(0);
      expect(await visible(pdf)).toBe(0);
      expect(await visible(otherPicture)).toBe(0);
      // A picture of a published article is visible (it is public anyway).
      const live = await publish(p.owner, p.tenant, "Published with a picture", { coverFileId: picture });
      expect(live.coverFileId).toBe(picture);
      expect(await visible(picture)).toBe(1);
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("keeps the blog address fixed after every article is deleted", async () => {
    await f.db.insert(users).values({ id: "blog-lock-owner", name: "blog-lock-owner", email: "blog-lock-owner@example.invalid", emailVerified: true });
    const tenant = (await createWorkspace(f.db, "blog-lock-owner", "Lock test ministry")).tenantId;
    const before = (await getBlog(f.db, "blog-lock-owner", tenant)).settings;
    expect(before.handleLocked).toBe(false);
    const live = await publish("blog-lock-owner", tenant, "Only article");
    await deleteBlogPost(f.db, "blog-lock-owner", tenant, live.id, live.version);
    const after = (await getBlog(f.db, "blog-lock-owner", tenant)).settings;
    // Marking the blog does not move its version, so the owner's open settings stay current.
    expect(after).toMatchObject({ handleLocked: true, version: before.version });
    expect(await status(saveBlogSettings(f.db, "blog-lock-owner", tenant, { version: after.version, handle: "lock-test-renamed", title: "Lock" }))).toBe(409);
    // The marker cannot be cleared or moved by the app.
    await expect(withTenant(f.db, "blog-lock-owner", tenant, "blog:manage", (tx) => tx.execute(sql`update blog_settings set first_published_at = null where tenant_id = ${tenant}::uuid`))).rejects.toThrow();
  });

  it("stamps a manual publish with the database clock, whatever the caller sends", async () => {
    const post = await write(p.owner, p.tenant, "Clock check");
    await withTenant(f.db, p.owner, p.tenant, "blog:manage", (tx) => tx.execute(sql`update blog_posts set status = 'published', published_at = '2001-01-01T00:00:00Z', version = version + 1 where id = ${post.id}::uuid`));
    const { post: done } = await getBlogPost(f.db, p.owner, p.tenant, post.id);
    expect(Math.abs(new Date(done.publishedAt!).getTime() - Date.now())).toBeLessThan(5 * 60_000);
  });

  it("marks the blog when the worker publishes its first article", async () => {
    await f.db.insert(users).values({ id: "blog-worker-owner", name: "blog-worker-owner", email: "blog-worker-owner@example.invalid", emailVerified: true });
    const tenant = (await createWorkspace(f.db, "blog-worker-owner", "Worker mark ministry")).tenantId;
    const post = await write("blog-worker-owner", tenant, "Scheduled first");
    await changeBlogPostState(f.db, "blog-worker-owner", tenant, post.id, { action: "schedule", version: post.version, at: new Date(Date.now() + 3_600_000).toISOString() });
    await f.admin.query("alter table blog_posts disable trigger blog_posts_guard");
    await f.admin.query("update blog_posts set publish_at = now() - interval '1 minute' where id = $1", [post.id]);
    await f.admin.query("alter table blog_posts enable trigger blog_posts_guard");
    expect(await sweepBlogSchedule(f.workerPool)).toEqual({ published: 1 });
    expect((await getBlog(f.db, "blog-worker-owner", tenant)).settings.handleLocked).toBe(true);
  });

  it("uses the ministry's link-in-bio handle as the blog address when there is one", async () => {
    await f.db.insert(users).values({ id: "blog-bio-owner", name: "blog-bio-owner", email: "blog-bio-owner@example.invalid", emailVerified: true });
    const tenant = (await createWorkspace(f.db, "blog-bio-owner", "Hope Chapel Lisbon")).tenantId;
    const bio = await getBioPage(f.db, "blog-bio-owner", tenant);
    expect((await getBlog(f.db, "blog-bio-owner", tenant)).settings.handle).toBe(bio.handle);
  });
});
