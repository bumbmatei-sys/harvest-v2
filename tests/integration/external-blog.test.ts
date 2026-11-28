import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { socialConnections, users } from "../../src/db/schema";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { changeMemberAccess } from "../../src/server/access";
import { changeBlogPostState, createBlogPost, deleteBlogPost, getBlog, latestBlogPosts, publicBlogFeed, publicBlogImage, publicBlogIndex, publicBlogPost, saveBlogPost } from "../../src/server/blog";
import { sweepBlogSchedule } from "../../src/server/blog-publish-worker";
import { connectExternalBlog, externalBlogOptions, externalBlogPlanner, listExternalBlogs, queueExternalBlog, refreshExternalBlogs } from "../../src/server/external-blog";
import { runExternalBlogWorker } from "../../src/server/external-blog-worker";
import { credentialBinding, sealCredential } from "../../src/server/social/credential-envelope";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { linkConnection, setConnectionEnabled } from "../../src/server/social/service";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { testDatabase } from "../database";
import { CANARY, depsFor, noNetwork, useTestKeys } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
const owner = "external-owner", admin = "external-admin", member = "external-member", viewer = "external-viewer", outsider = "external-outsider", editor = "external-editor";
const provider = new FakeProvider({ validSecret: CANARY, accounts: [
  { accountRef: "wp-test", platform: "wordpress", displayName: "Church blog" },
  { accountRef: "wf-test", platform: "webflow", displayName: "Events blog" },
] });
const deps = depsFor(provider);
const origin = "https://harvest.example.invalid";
let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, other: string, wp: string, wf: string, wpConnection: string, picture: string, handle: string;
let fetchSpy: ReturnType<typeof noNetwork>;
const body = (text: string, fileId = picture) => ({ type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text }] }, { type: "blogImage", attrs: { fileId } },
] });
const drain = () => runExternalBlogWorker(f.workerPool, deps);
const getDelivery = async (postId: string, destinationId = wp) =>
  (await externalBlogOptions(f.db, owner, tenant, postId, deps)).destinations.find((d) => d.id === destinationId)?.delivery;
const queue = (post: { id: string; version: number }, data: Record<string, unknown>) =>
  queueExternalBlog(f.db, owner, tenant, post.id, { version: post.version, destinationId: wp, ...data }, deps, origin);

async function write(title: string, harvestPage = true, fileId = picture) {
  const post = await createBlogPost(f.db, owner, tenant);
  return saveBlogPost(f.db, owner, tenant, post.id, { version: post.version, title, harvestPage, body: body(title, fileId), coverFileId: fileId });
}
async function addPicture() {
  const id = randomUUID();
  await f.admin.query(`insert into files(id,tenant_id,owner_id,key,name,mime,size,checksum,status)
    values($1,$2,$3,$4,'picture.png','image/png',5,repeat('a',64),'ready')`, [id, tenant, owner, `workspaces/${tenant}/files/${id}`]);
  return id;
}
const served = async (assetId: string) => (await f.pool.query("select mime from public.blog_external_asset($1)", [assetId])).rows;
async function addConnection(accountRef: string, platform: "wordpress" | "webflow") {
  const id = randomUUID();
  const envelope = sealCredential({ secret: CANARY }, credentialBinding(tenant, id));
  await withTenant(f.db, owner, tenant, "social:connect", (tx) => tx.insert(socialConnections).values({
    id, tenantId: tenant, externalAccountRef: accountRef, platform, displayName: accountRef, provider: "fake",
    credentialEnvelope: { ...envelope }, createdBy: owner,
  }));
  return id;
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  fetchSpy = noNetwork();
  useTestKeys();
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values([owner, admin, member, viewer, outsider, editor].map((id) => ({
    id, name: id, email: `${id}@example.invalid`, emailVerified: true,
  })));
  tenant = (await createWorkspace(f.db, owner, "External ministry")).tenantId;
  other = (await createWorkspace(f.db, outsider, "Other ministry")).tenantId;
  for (const [user, role] of [[admin, "admin"], [member, "member"], [viewer, "viewer"], [editor, "viewer"]] as const) {
    await putMember(f.db, owner, tenant, `${user}@example.invalid`, role);
  }
  await changeMemberAccess(f.db, owner, tenant, { userId: editor, role: "collaborator", grants: { website: "manage" } });
  handle = (await getBlog(f.db, owner, tenant)).settings.handle;
  picture = randomUUID();
  await f.admin.query(`insert into files(id,tenant_id,owner_id,key,name,mime,size,checksum,status)
    values($1,$2,$3,$4,'picture.png','image/png',5,repeat('a',64),'ready')`, [picture, tenant, owner, `workspaces/${tenant}/files/${picture}`]);
  provider.blogs.set("wp-test", [{ id: "1", title: "Church blog" }]);
  provider.blogs.set("wf-test", [{ id: "webflow-main", title: "Events blog" }]);
  wpConnection = await addConnection("wp-test", "wordpress");
  await refreshExternalBlogs(f.db, admin, tenant, wpConnection, deps);
  await refreshExternalBlogs(f.db, owner, tenant, await addConnection("wf-test", "webflow"), deps);
  const blogs = await listExternalBlogs(f.db, owner, tenant, deps);
  wp = blogs.destinations.find((d) => d.platform === "wordpress")!.id;
  wf = blogs.destinations.find((d) => d.platform === "webflow")!.id;
}, 240_000);
afterAll(async () => {
  fetchSpy?.mockRestore();
  useKeyProvider(null);
  vi.unstubAllEnvs();
  await f?.close();
});

it("confines the destination catalog and job controls to their intended roles", async () => {
  await expect(listExternalBlogs(f.db, owner, tenant, deps)).resolves.toMatchObject({
    accounts: expect.arrayContaining([expect.objectContaining({ id: wpConnection, authorization: "authorized" })]),
  });
  const post = await write("Access");
  for (const user of [member, viewer, outsider]) {
    await expect(externalBlogOptions(f.db, user, tenant, post.id, deps)).rejects.toMatchObject({ status: 404 });
  }
  await expect(externalBlogOptions(f.db, editor, tenant, post.id, deps)).resolves.toMatchObject({ destinations: expect.arrayContaining([
    expect.objectContaining({ id: wp, canonical: "unsupported", authorization: "authorized" }),
  ]) });
  await expect(refreshExternalBlogs(f.db, editor, tenant, wpConnection, deps)).rejects.toMatchObject({ status: 404 });
  await expect(linkConnection(f.db, owner, tenant, { provider: "fake", credential: CANARY, accountRef: "wp-test" }, deps)).rejects.toMatchObject({ status: 400 });
  const rows = await withTenant(f.db, outsider, other, "blog:manage", async (tx) => (await tx.execute(sql`select id from blog_external_destinations`)).rows);
  expect(rows).toEqual([]);
  await expect(queueExternalBlog(f.db, outsider, other, post.id, { version: post.version, destinationId: wp, operation: "push" }, deps)).rejects.toMatchObject({ status: 404 });
  await expect(f.pool.query("select public.blog_external_claim()")).rejects.toMatchObject({ code: "42501" });
  await expect(f.workerPool.query("select id from blog_external_jobs")).rejects.toMatchObject({ code: "42501" });
  await expect(f.pool.query("select id from blog_external_scope_tokens")).rejects.toMatchObject({ code: "42501" });
  const tables = (await f.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where relkind = 'r' and relname like 'blog_external_%'")).rows;
  expect(tables).toEqual(Array.from({ length: 5 }, () => ({ relrowsecurity: true, relforcerowsecurity: true })));
});

it("maps a database refresh refusal to the neutral 404", async () => {
  const signature = "public.blog_external_refresh(uuid,uuid,integer,text,jsonb)";
  await f.admin.query(`revoke execute on function ${signature} from harvest_app`);
  try {
    await expect(refreshExternalBlogs(f.db, owner, tenant, wpConnection, deps)).rejects.toMatchObject({ status: 404 });
  } finally {
    await f.admin.query(`grant execute on function ${signature} to harvest_app`);
  }
});

it("links through a server-owned sign-in attempt and refuses impersonation, pasted secrets and replay", async () => {
  const connectDeps = { ...deps, blogConnect: { providerId: "fake" as const, credential: { secret: CANARY } } };
  const start = { action: "start", platform: "wix" };
  await expect(connectExternalBlog(f.db, editor, tenant, start, connectDeps, origin)).rejects.toMatchObject({ status: 404 });
  await expect(connectExternalBlog(f.db, owner, tenant, { ...start, credential: CANARY }, connectDeps, origin)).rejects.toMatchObject({ name: "ZodError" });
  const attempt = await connectExternalBlog(f.db, admin, tenant, start, connectDeps, origin);
  if (!("attempt" in attempt)) throw new Error("Expected sign-in attempt");
  const input = { action: "finish", attempt: attempt.attempt };
  await expect(connectExternalBlog(f.db, owner, tenant, input, connectDeps, origin)).rejects.toMatchObject({ status: 404 });
  await expect(connectExternalBlog(f.db, admin, tenant, input, connectDeps, origin)).resolves.toEqual({ status: "pending" });
  const profile = new URL(attempt.url!).pathname.slice(1);
  provider.blogConnectProfiles.set(profile, { accountRef: "wix-sign-in", platform: "wix", displayName: "Wix test" });
  await expect(connectExternalBlog(f.db, admin, tenant, input, connectDeps, origin)).resolves.toMatchObject({ status: "authorized" });
  await expect(connectExternalBlog(f.db, admin, tenant, input, connectDeps, origin)).rejects.toMatchObject({ status: 409 });
});

it("posts a private Harvest article externally and keeps native public surfaces private after the native worker moves it", async () => {
  const post = await write("External only", false);
  const at = new Date(Date.now() + 3_600_000).toISOString();
  const scheduled = await changeBlogPostState(f.db, owner, tenant, post.id, { action: "schedule", version: post.version, at });
  const result = await queue(scheduled, { operation: "push", timing: { mode: "same_time" } });
  expect(result).toMatchObject({ canonical: "not_requested", delivery: { mode: "same_time", status: "queued" } });
  expect(await drain()).toBe(1);
  expect(await getDelivery(post.id)).toMatchObject({ status: "scheduled_on_blog" });
  const remote = [...provider.blogArticles.values()].find((a) => a.title === post.title)!;
  expect(remote.scheduledAt).toBe(at);
  const image = new URL(remote.image!.url);
  expect(image.origin).toBe(origin);
  expect(remote.bodyHtml).toContain(remote.image!.url);
  expect(remote.bodyHtml).not.toContain(picture);
  expect((await f.pool.query("select mime from public.blog_external_asset($1)", [image.pathname.split("/").at(-1)])).rows).toEqual([{ mime: "image/png" }]);
  const range = { from: new Date(Date.now() - 20_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() };
  expect(await externalBlogPlanner(f.db, owner, tenant, range)).toContainEqual(expect.objectContaining({ postId: post.id, status: "scheduled_on_blog" }));
  await f.admin.query("alter table blog_posts disable trigger blog_posts_guard");
  await f.admin.query("update blog_posts set publish_at = now() - interval '1 second' where id = $1", [post.id]);
  await f.admin.query("alter table blog_posts enable trigger blog_posts_guard");
  expect(await sweepBlogSchedule(f.workerPool)).toEqual({ published: 1 });
  expect(await publicBlogPost(f.db, handle, post.slug)).toBeNull();
  expect(await publicBlogImage(f.db, handle, picture)).toBeNull();
  expect((await publicBlogIndex(f.db, handle))?.posts).toEqual([]);
  expect((await publicBlogFeed(f.db, handle))?.items).toEqual([]);
  expect(await latestBlogPosts(f.db, tenant)).toEqual([]);
});

it("reconciles a timed-out create, detects a remote edit, and changes the remote only on explicit update", async () => {
  const post = await write("Draft to copy"), originalCount = provider.blogArticles.size;
  provider.blogCreateTimeout = true;
  const result = await queue(post, { operation: "push", timing: { mode: "draft" } });
  await drain();
  expect(provider.blogArticles.size).toBe(originalCount + 1);
  await f.admin.query("update blog_external_jobs set next_at = now() where id = $1", [result.jobId]);
  await drain();
  expect(provider.blogArticles.size).toBe(originalCount + 1);
  expect(provider.calls.filter((c) => c.method === "createBlogArticle" && c.key === result.jobId)).toHaveLength(1);
  expect(await getDelivery(post.id)).toMatchObject({ status: "draft_on_blog" });
  const remote = [...provider.blogArticles.values()].find((a) => a.title === post.title)!;
  const next = await saveBlogPost(f.db, owner, tenant, post.id, { version: post.version, title: "Edited in Harvest" });
  expect(await drain()).toBe(0);
  expect(remote.title).toBe("Draft to copy");
  remote.bodyHtml = "<p>External change marker</p>";
  await queue(next, { operation: "check" });
  await drain();
  expect(await getDelivery(post.id)).toMatchObject({ status: "changed_on_blog" });
  expect(JSON.stringify((await f.admin.query("select payload from blog_external_jobs")).rows)).not.toContain("External change marker");
  const live = await changeBlogPostState(f.db, owner, tenant, post.id, { action: "publish", version: next.version });
  await queue(live, { operation: "update", timing: { mode: "same_time" } });
  await drain();
  expect(await getDelivery(post.id)).toMatchObject({ status: "published", remoteUrl: expect.stringMatching(/^https:/), pushedVersion: live.version });
  await deleteBlogPost(f.db, owner, tenant, post.id, live.version);
  expect(await drain()).toBe(0);
  expect([...provider.blogArticles.values()].some((a) => a.title === "Edited in Harvest")).toBe(true);
});

it("uses an independent native schedule, refuses a future Webflow time and offers a same-time update after unscheduling", async () => {
  const post = await write("Time options");
  const at = new Date(Date.now() + 7_200_000).toISOString();
  await expect(queue(post, { destinationId: wf, operation: "push", timing: { mode: "own_time", at } })).rejects.toMatchObject({ status: 400 });
  await queue(post, { operation: "push", timing: { mode: "own_time", at } });
  await drain();
  expect(await getDelivery(post.id)).toMatchObject({ mode: "own_time", status: "scheduled_on_blog", requestedAt: new Date(at) });
  const scheduled = await changeBlogPostState(f.db, owner, tenant, post.id, { version: post.version, action: "schedule", at });
  await queue(scheduled, { operation: "update", timing: { mode: "same_time" } });
  await drain();
  const unscheduled = await changeBlogPostState(f.db, owner, tenant, post.id, { version: scheduled.version, action: "unschedule" });
  expect(await drain()).toBe(0);
  expect(await getDelivery(post.id)).toMatchObject({ status: "scheduled_on_blog", scheduleUpdateAvailable: true });
  await queue(unscheduled, { operation: "update", timing: { mode: "draft" } });
  await drain();
  expect(await getDelivery(post.id)).toMatchObject({ status: "draft_on_blog" });
});

it("reconciles an old attempted create without resending after the key window", async () => {
  const post = await write("Old disputed create");
  const job = await queue(post, { operation: "push", timing: { mode: "draft" } });
  await f.admin.query("update blog_external_deliveries set updated_at = now() - interval '24 hours' where post_id = $1", [post.id]);
  await f.admin.query("update blog_external_jobs set attempts = 1 where id = $1", [job.jobId]);
  const before = provider.blogArticles.size;
  await drain();
  expect(provider.blogArticles.size).toBe(before);
  expect(await getDelivery(post.id)).toMatchObject({ status: "failed", reason: "outcome_unknown" });
  await expect(queue(post, { operation: "push", timing: { mode: "draft" } })).rejects.toMatchObject({ status: 409 });
});

it("serves a remote image only while an article with a delivery still uses it", async () => {
  const removed = await addPicture(), deleted = await addPicture();
  const kept = await write("Image removed", true, removed);
  await queue(kept, { operation: "push", timing: { mode: "draft" } });
  const assetFor = async (fileId: string) => (await f.admin.query("select id from blog_external_assets where file_id = $1", [fileId])).rows[0].id as string;
  const removedAsset = await assetFor(removed);
  expect(await served(removedAsset)).toEqual([{ mime: "image/png" }]);
  await drain();
  expect(await getDelivery(kept.id)).toMatchObject({ status: "draft_on_blog" });
  expect(await served(removedAsset)).toEqual([{ mime: "image/png" }]);
  await saveBlogPost(f.db, owner, tenant, kept.id, { version: kept.version, title: kept.title, coverFileId: null,
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "No picture" }] }] } });
  expect(await served(removedAsset)).toEqual([]);

  const gone = await write("Article deleted", true, deleted);
  await queue(gone, { operation: "push", timing: { mode: "draft" } });
  await drain();
  const deletedAsset = await assetFor(deleted);
  expect(await served(deletedAsset)).toEqual([{ mime: "image/png" }]);
  await deleteBlogPost(f.db, owner, tenant, gone.id, gone.version);
  expect(await served(deletedAsset)).toEqual([]);
  expect(await served(randomUUID())).toEqual([]);
});

it("keeps the destination catalog read-only for the app and refresh owner/admin-only", async () => {
  const deny = (user: string, statement: ReturnType<typeof sql>) =>
    expect(withTenant(f.db, user, tenant, "blog:manage", (tx) => tx.execute(statement))).rejects.toMatchObject({ cause: { code: "42501" } });
  for (const user of [editor, owner]) {
    await deny(user, sql`update blog_external_destinations set health = 'healthy', "authorization" = 'authorized'`);
    await deny(user, sql`insert into blog_external_destinations (tenant_id, connection_id, blog_ref, title, platform, health, "authorization")
      values (${tenant}::uuid, ${wpConnection}::uuid, 'forged', 'Forged', 'wordpress', 'healthy', 'authorized')`);
    await deny(user, sql`delete from blog_external_destinations`);
  }
  const { rows: [connection] } = await f.admin.query("select version from social_connections where id = $1", [wpConnection]);
  await deny(editor, sql`select public.blog_external_refresh(${tenant}::uuid, ${wpConnection}::uuid, ${connection.version}::integer, 'healthy', '[]'::jsonb)`);
  await expect(withTenant(f.db, owner, tenant, "blog:manage", (tx) => tx.execute(sql`select public.blog_external_refresh(
    ${other}::uuid, ${wpConnection}::uuid, ${connection.version}::integer, 'healthy', '[]'::jsonb)`))).rejects.toMatchObject({ cause: { code: "42501" } });
  await expect(refreshExternalBlogs(f.db, admin, tenant, wpConnection, deps)).resolves.toMatchObject({ authorization: "authorized", count: 1 });
  expect((await listExternalBlogs(f.db, editor, tenant, deps)).destinations).toContainEqual(expect.objectContaining({ id: wp, authorization: "authorized" }));
});

it("fences expired leases, bounds retries, and cancels queued work on disconnect", async () => {
  const retry = await write("Lease test");
  const job = await queue(retry, { operation: "push", timing: { mode: "draft" } });
  const first = (await f.workerPool.query("select public.blog_external_claim() as job")).rows[0].job;
  expect(first.id).toBe(job.jobId);
  expect((await f.workerPool.query("select public.blog_external_claim() as job")).rows[0].job).toBeNull();
  await f.admin.query("update blog_external_jobs set lease_until = now() - interval '1 second', attempts = 4 where id = $1", [job.jobId]);
  await drain();
  expect(await getDelivery(retry.id)).toMatchObject({ status: "failed", reason: "outcome_unknown" });
  expect((await f.workerPool.query("select public.blog_external_finish($1,$2,$3,'draft_on_blog',null,null,null,null,null) as ok", [tenant, first.id, first.lease])).rows[0].ok).toBe(false);
  const queued = await write("Disconnect test");
  await queue(queued, { operation: "push", timing: { mode: "draft" } });
  await setConnectionEnabled(f.db, owner, tenant, wpConnection, false, deps);
  expect(await drain()).toBe(0);
  expect(await getDelivery(queued.id)).toMatchObject({ status: "failed", reason: "disconnected" });
  expect(fetchSpy).not.toHaveBeenCalled();
});
