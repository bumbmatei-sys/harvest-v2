import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { CANARY, depsFor, linkFixtureAccount, noNetwork, seedPeople, useTestKeys } from "./social-layer-fixture";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { socialPlatforms } from "../../src/lib/social/platforms";
import { schedulePost } from "../../src/server/social/service";
import { changeDraft, saveDraft } from "../../src/server/social/drafts";
import { runSocialPublisher } from "../../src/server/social/publisher";
import { changeApprovalSettings, decideApproval, listApprovalNotices, listApprovals, markApprovalNoticeRead, readApprovalSettings, requestApproval } from "../../src/server/social/approvals";
import { readPublishingStatus } from "../../src/server/social/publishing-status";
import { withTenant } from "../../src/server/tenancy";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";

const fake = new FakeProvider({ validSecret: CANARY, accounts: socialPlatforms.map(platform => ({ platform, accountRef: platform, displayName: platform })) });
let f: Awaited<ReturnType<typeof testDatabase>>, p: Awaited<ReturnType<typeof seedPeople>>, admin2: string;
const deps = depsFor(fake), ids = new Map<string, string>();
let spy: ReturnType<typeof noNetwork>;
const account = (platform: string) => ids.get(platform)!;
const q = (query: string, values?: unknown[]) => f.admin.query(query, values);
const doc = (platforms = ["facebook"], content = "Sunday gathering") => ({ type: "post", content, connectionIds: platforms.map(account) });
const when = () => ({ kind: "time", scheduledFor: new Date(Date.now() + 3_600_000).toISOString(), timezone: "UTC" });
const run = () => runSocialPublisher(f.workerPool, () => fake);
const due = () => q("update social_posts set scheduled_for = now() - interval '2 minutes', next_attempt_at = now() - interval '2 minutes', version = version + 1 where status = 'scheduled'");
const status = (query: Record<string, string> = {}, user = p.owner) => readPublishingStatus(f.db, user, p.tenant, query, deps);
const setMode = async (mode: "off" | "required", selfApproval: "never" | "owner_only" | "always" = "owner_only") => {
  const { settings } = await readApprovalSettings(f.db, p.owner, p.tenant, deps);
  return changeApprovalSettings(f.db, p.owner, p.tenant, { mode, selfApproval, version: settings.version }, deps);
};
async function scheduled(platforms = ["facebook"], user = p.owner) {
  const { draft } = await saveDraft(f.db, user, p.tenant, doc(platforms), deps);
  const out = await changeDraft(f.db, user, p.tenant, draft.id, { action: "schedule", version: draft.version, target: when() }, deps);
  return out.draft;
}
const request = (draftId: string, user = p.owner) => requestApproval(f.db, user, p.tenant, { draftId }, deps);
const dbMessage = async (promise: Promise<unknown>) => { try { await promise; return ""; } catch (e) { const c = e as { message?: string; cause?: { message?: string } }; return `${c.cause?.message ?? ""} ${c.message ?? ""}`; } };
const decide = (id: string, version: number, body: Record<string, unknown>, user = p.admin) => decideApproval(f.db, user, p.tenant, id, { version, ...body }, deps);

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true }); p = await seedPeople(f, "ap");
  admin2 = "ap-admin2";
  await f.db.insert(users).values({ id: admin2, name: admin2, email: `${admin2}@example.test`, emailVerified: true });
  await putMember(f.db, p.owner, p.tenant, `${admin2}@example.test`, "admin");
  useTestKeys(); spy = noNetwork();
  for (const account of fake.accounts) ids.set(account.platform, await linkFixtureAccount(f.db, p.owner, p.tenant, account, fake));
}, 60_000);
beforeEach(async () => {
  await q("truncate social_approval_notices, social_approvals, social_approval_settings");
  await q("update social_posts set status='cancelled', version = version + 1 where status in ('scheduled','draft')");
});
afterEach(() => expect(spy).not.toHaveBeenCalled());
afterAll(async () => { spy?.mockRestore(); useKeyProvider(null); await f?.close(); });

it("forces row security on the approval tables, keeps them to owners and admins and lets only an owner change the setting", async () => {
  const rls = await q("select relrowsecurity, relforcerowsecurity from pg_class where relname in ('social_approvals','social_approval_settings','social_approval_notices')");
  expect(rls.rows).toHaveLength(3); expect(rls.rows.every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  for (const user of [p.member, p.viewer, p.outsider]) {
    await expect(listApprovals(f.db, user, p.tenant, {}, deps)).rejects.toMatchObject({ status: 404 });
    await expect(readApprovalSettings(f.db, user, p.tenant, deps)).rejects.toMatchObject({ status: 404 });
    await expect(status({}, user)).rejects.toMatchObject({ status: 404 });
  }
  await expect(changeApprovalSettings(f.db, p.admin, p.tenant, { mode: "required", selfApproval: "owner_only", version: 0 }, deps)).rejects.toMatchObject({ status: 404 });
  const set = await changeApprovalSettings(f.db, p.owner, p.tenant, { mode: "required", selfApproval: "never", version: 0 }, deps);
  expect(set.settings).toEqual({ mode: "required", selfApproval: "never", version: 1 });
  await expect(changeApprovalSettings(f.db, p.owner, p.tenant, { mode: "off", selfApproval: "never", version: 0 }, deps)).rejects.toMatchObject({ status: 409 });
  await expect(changeApprovalSettings(f.db, p.owner, p.tenant, { mode: "maybe", selfApproval: "never", version: 1 }, deps)).rejects.toMatchObject({ status: 422 });
  expect((await readApprovalSettings(f.db, p.admin, p.tenant, deps)).settings.mode).toBe("required");
  await expect(withTenant(f.db, p.admin, p.tenant, "social:approvals", async tx => { await tx.execute(sql`update social_approval_settings set mode='off'`); })).resolves.toBeUndefined();
  expect((await q("select mode from social_approval_settings")).rows[0].mode).toBe("required");
  await expect(withTenant(f.db, p.owner, p.tenant, "social:approvals", async tx => { await tx.execute(sql`delete from social_approvals`); })).rejects.toThrow();
  expect((await q("select count(*)::int n from audit_logs where action='social.approval_settings_required' and tenant_id=$1", [p.tenant])).rows[0].n).toBe(1);
});

it("changes nothing while approval is off: scheduled posts publish with the platform URL recorded", async () => {
  const draft = await scheduled();
  expect((await status({ draftId: draft.id })).items[0]).toMatchObject({ state: "queued", approval: { required: false, state: "not_required" } });
  await due();
  const ran = await run(); expect(ran).toMatchObject({ claimed: 1, published: 1, errored: 0 });
  const item = (await status({ draftId: draft.id })).items[0];
  expect(item).toMatchObject({ state: "published", bucket: "sent" });
  expect(item.destinations[0].url).toMatch(/^https:\/\/example\.test\/p\/fake-post-/);
});

it("holds scheduled posts until a valid approval, refuses publish now, notifies approvers and then publishes once approved", async () => {
  await setMode("required");
  const draft = await scheduled(["facebook", "threads"]);
  const before = fake.posts.size;
  expect((await status({ draftId: draft.id })).items[0]).toMatchObject({ state: "awaiting_approval", approval: { required: true, state: "none" } });
  await due();
  expect(await run()).toMatchObject({ claimed: 0 });
  expect(fake.posts.size).toBe(before);
  // A direct database move to publishing is refused too (defence in depth).
  await expect(q("update social_posts set status='publishing', version = version + 1 where draft_id=$1", [draft.id])).rejects.toThrow(/approval required/);
  const { draft: other } = await saveDraft(f.db, p.owner, p.tenant, doc(), deps);
  const review = await changeDraft(f.db, p.owner, p.tenant, other.id, { action: "review", version: other.version }, deps);
  await expect(changeDraft(f.db, p.owner, p.tenant, other.id, { action: "publishNow", version: review.draft.version, reviewToken: review.review!.token, timezone: "UTC" }, deps)).rejects.toMatchObject({ details: { code: "APPROVAL_REQUIRED" } });

  const { approval } = await request(draft.id);
  expect(approval.status).toBe("pending");
  expect((await listApprovalNotices(f.db, p.admin, p.tenant, deps)).unread).toBe(1);
  expect((await listApprovalNotices(f.db, admin2, p.tenant, deps)).unread).toBe(1);
  expect((await listApprovalNotices(f.db, p.owner, p.tenant, deps)).notices).toEqual([]);
  expect((await status({ draftId: draft.id })).items[0].approval.state).toBe("pending");
  expect(await run()).toMatchObject({ claimed: 0 });
  await expect(decide(approval.id, approval.version + 3, { decision: "approve" })).rejects.toMatchObject({ status: 409 });
  const approved = await decide(approval.id, approval.version, { decision: "approve" });
  expect(approved.approval).toMatchObject({ status: "approved", decidedBy: p.admin });
  await expect(decide(approval.id, approved.approval.version, { decision: "approve" }, admin2)).rejects.toMatchObject({ details: { code: "APPROVAL_NOT_PENDING" } });
  const notice = (await listApprovalNotices(f.db, p.owner, p.tenant, deps)).notices[0];
  expect(notice).toMatchObject({ kind: "approved", read: false });
  await markApprovalNoticeRead(f.db, p.owner, p.tenant, notice.id, deps);
  await expect(markApprovalNoticeRead(f.db, p.admin, p.tenant, notice.id, deps)).rejects.toMatchObject({ status: 404 });
  expect((await listApprovalNotices(f.db, p.owner, p.tenant, deps)).unread).toBe(0);
  expect(await run()).toMatchObject({ claimed: 2 });
  const item = (await status({ draftId: draft.id })).items[0];
  expect(item).toMatchObject({ state: "published", approval: { state: "approved" } });
  expect(item.destinations.every(d => d.state === "published" && d.url)).toBe(true);
  const audits = (await q("select action, metadata from audit_logs where tenant_id=$1 and action like 'social.approval_%'", [p.tenant])).rows;
  expect(audits.map(a => a.action)).toEqual(expect.arrayContaining(["social.approval_request", "social.approval_approve"]));
  expect(JSON.stringify(audits)).not.toContain("Sunday gathering");
});

it("applies the self-approval rule in code and in the database", async () => {
  await setMode("required", "owner_only");
  const draft = await scheduled();
  const own = await request(draft.id, p.admin);
  await expect(decide(own.approval.id, own.approval.version, { decision: "approve" }, p.admin)).rejects.toMatchObject({ details: { code: "SELF_APPROVAL_NOT_ALLOWED" } });
  // Even a direct database update is refused.
  expect(await dbMessage(withTenant(f.db, p.admin, p.tenant, "social:approvals", async tx => { await tx.execute(sql`update social_approvals set status='approved', decided_by=${p.admin}, decided_at=now() where id=${own.approval.id}`); }))).toMatch(/self approval/);
  const ownerOwn = await request(draft.id, p.owner);
  expect((await decide(ownerOwn.approval.id, ownerOwn.approval.version, { decision: "approve" }, p.owner)).approval.status).toBe("approved");
  await setMode("required", "never");
  const draft2 = await scheduled();
  const r2 = await request(draft2.id, p.owner);
  await expect(decide(r2.approval.id, r2.approval.version, { decision: "approve" }, p.owner)).rejects.toMatchObject({ details: { code: "SELF_APPROVAL_NOT_ALLOWED" } });
  await setMode("required", "always");
  expect((await decide(r2.approval.id, r2.approval.version, { decision: "approve" }, p.owner)).approval.status).toBe("approved");
  // A decision cannot be filed in someone else's name.
  const draft3 = await scheduled();
  const r3 = await request(draft3.id, p.owner);
  expect(await dbMessage(withTenant(f.db, p.admin, p.tenant, "social:approvals", async tx => { await tx.execute(sql`update social_approvals set status='approved', decided_by=${p.owner}, decided_at=now() where id=${r3.approval.id}`); }))).toMatch(/decision is filed/);
});

it("invalidates an approval when the content changes", async () => {
  await setMode("required");
  const { draft } = await saveDraft(f.db, p.owner, p.tenant, doc(), deps);
  const { approval } = await request(draft.id);
  const ok = await decide(approval.id, approval.version, { decision: "approve" });
  expect((await status({ draftId: draft.id })).items[0].approval.state).toBe("approved");
  // Editing the draft supersedes the approval.
  await changeDraft(f.db, p.owner, p.tenant, draft.id, { action: "save", version: draft.version, document: doc(["facebook"], "Changed text") }, deps);
  expect((await q("select status from social_approvals where id=$1", [approval.id])).rows[0].status).toBe("superseded");
  expect((await status({ draftId: draft.id })).items[0].approval.state).toBe("stale");
  void ok;
  // A draft whose document is altered behind the application's back no longer matches its approval and its posts cannot publish.
  // (A submitted draft's document cannot be altered at all: the draft guard in the database refuses it.)
  const { draft: second } = await saveDraft(f.db, p.owner, p.tenant, doc(), deps);
  const r = await request(second.id);
  await decide(r.approval.id, r.approval.version, { decision: "approve" });
  await q("update social_drafts set document = jsonb_set(document, '{content}', '\"tampered\"'), version = version + 1 where id=$1", [second.id]);
  const tampered = (await status({ draftId: second.id })).items[0];
  expect(tampered.approval.state).toBe("stale");
  const out = await changeDraft(f.db, p.owner, p.tenant, second.id, { action: "schedule", version: tampered.version, target: when() }, deps);
  expect((await status({ draftId: out.draft.id })).items[0]).toMatchObject({ state: "awaiting_approval", approval: { state: "stale" } });
  await due();
  expect(await run()).toMatchObject({ claimed: 0 });
  await expect(q("update social_drafts set document = jsonb_set(document, '{content}', '\"x\"'), version = version + 1 where id=$1", [second.id])).rejects.toThrow(/invalid draft transition/);
  // Approving content that changed after the request is refused.
  const { draft: third } = await saveDraft(f.db, p.owner, p.tenant, doc(), deps);
  const r3 = await request(third.id);
  await q("update social_drafts set document = jsonb_set(document, '{content}', '\"later\"'), version = version + 1 where id=$1", [third.id]);
  await expect(decide(r3.approval.id, r3.approval.version, { decision: "approve" })).rejects.toMatchObject({ details: { code: "CONTENT_CHANGED" } });
  expect((await q("select status from social_approvals where id=$1", [r3.approval.id])).rows[0].status).toBe("superseded");
});

it("rejects with a reason, supersedes a pending request on resubmission and lets the requester withdraw", async () => {
  await setMode("required");
  const draft = await scheduled();
  const first = await request(draft.id);
  await expect(decide(first.approval.id, first.approval.version, { decision: "reject" })).rejects.toMatchObject({ status: 422 });
  const second = await request(draft.id);
  expect((await q("select status from social_approvals where id=$1", [first.approval.id])).rows[0].status).toBe("superseded");
  const rejected = await decide(second.approval.id, second.approval.version, { decision: "reject", note: "Please fix the link" });
  expect(rejected.approval).toMatchObject({ status: "rejected", note: "Please fix the link" });
  expect((await listApprovalNotices(f.db, p.owner, p.tenant, deps)).notices[0]).toMatchObject({ kind: "rejected" });
  expect((await status({ draftId: draft.id })).items[0].approval.state).toBe("rejected");
  const third = await request(draft.id);
  await expect(decide(third.approval.id, third.approval.version, { decision: "withdraw" }, p.admin)).rejects.toMatchObject({ details: { code: "NOT_YOUR_REQUEST" } });
  expect((await decide(third.approval.id, third.approval.version, { decision: "withdraw" }, p.owner)).approval.status).toBe("withdrawn");
  expect((await listApprovals(f.db, p.owner, p.tenant, { status: "withdrawn" }, deps)).approvals).toHaveLength(1);
  await expect(listApprovals(f.db, p.owner, p.tenant, { status: "nope" }, deps)).rejects.toMatchObject({ status: 422 });
});

it("gates a draft-less post on an approval of its own content", async () => {
  await setMode("required");
  const { post } = await schedulePost(f.db, p.owner, p.tenant, { connectionId: account("facebook"), content: "direct post canary", scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }, deps);
  await due();
  expect(await run()).toMatchObject({ claimed: 0 });
  const item = (await status()).items.find(i => i.id === post.id)!;
  expect(item).toMatchObject({ kind: "post", state: "awaiting_approval" });
  const { approval } = await requestApproval(f.db, p.owner, p.tenant, { postId: post.id }, deps);
  await decide(approval.id, approval.version, { decision: "approve" });
  expect((await status()).items.find(i => i.id === post.id)).toMatchObject({ state: "queued", approval: { state: "approved" } });
  expect(await run()).toMatchObject({ claimed: 1 });
  expect((await status()).items.find(i => i.id === post.id)).toMatchObject({ state: "published" });
});

it("reports per-account results: partial, failed with a reason, retry with the original key and no double post", async () => {
  const draft = await scheduled(["facebook", "threads"]);
  await due();
  fake.fail("publishPost", "AUTH", 1);
  expect(await run()).toMatchObject({ claimed: 2 });
  let item = (await status({ draftId: draft.id })).items[0];
  expect(item.state).toBe("partial");
  const failed = item.destinations.find(d => d.state === "failed")!;
  expect(failed).toMatchObject({ errorCode: "PROVIDER_AUTH", url: null, retryable: true });
  expect(item.destinations.find(d => d.state === "published")!.retryable).toBe(false);
  const keyBefore = (await q("select idempotency_key, attempts from social_posts where id=$1", [failed.postId])).rows[0];
  const published = fake.posts.size;
  const { draft: current } = { draft: (await changeDraft(f.db, p.owner, p.tenant, draft.id, { action: "cancel", version: 99 }, deps).catch(() => ({ draft: null }))).draft };
  void current;
  const read = (await status({ draftId: draft.id })).items[0];
  await changeDraft(f.db, p.owner, p.tenant, draft.id, { action: "retry", version: read.version, deliveries: [{ id: failed.postId, version: failed.version! }] }, deps);
  expect((await q("select idempotency_key from social_posts where id=$1", [failed.postId])).rows[0].idempotency_key).toBe(keyBefore.idempotency_key);
  expect(await run()).toMatchObject({ claimed: 1 });
  item = (await status({ draftId: draft.id })).items[0];
  expect(item.state).toBe("published");
  expect(fake.posts.size).toBe(published + 1);
  // A published account is never resent, and an accepted one is reconciled, not republished.
  expect(await run()).toMatchObject({ claimed: 0 });
  expect(fake.posts.size).toBe(published + 1);
});

it("shows an ambiguous outcome as unknown and keeps retry closed to it", async () => {
  const draft = await scheduled();
  await due();
  fake.fail("publishPost", "UNAVAILABLE", 1);
  await run();
  const item = (await status({ draftId: draft.id })).items[0];
  expect(item).toMatchObject({ state: "unknown", bucket: "sent" });
  expect(item.destinations[0]).toMatchObject({ state: "unknown", retryable: false });
});

it("buckets the queue and bounds the response", async () => {
  await scheduled(); await saveDraft(f.db, p.owner, p.tenant, doc(), deps);
  const all = await status({ limit: "50" });
  expect(new Set(all.items.map(i => i.bucket))).toEqual(new Set(["drafts", "scheduled", "sent"].filter(b => all.items.some(i => i.bucket === b))));
  expect((await status({ bucket: "drafts" })).items.every(i => i.bucket === "drafts")).toBe(true);
  expect((await status({ limit: "1" })).items.length).toBe(1);
  await expect(status({ limit: "500" })).rejects.toMatchObject({ status: 422 });
  await expect(status({ bucket: "x" })).rejects.toMatchObject({ status: 422 });
  const text = JSON.stringify(all);
  expect(text).not.toContain("Sunday gathering");
});

it("keeps one ministry's approvals invisible to another", async () => {
  await setMode("required");
  const draft = await scheduled();
  await request(draft.id);
  const other = (await createWorkspace(f.db, p.outsider, "approvals other")).tenantId;
  expect((await listApprovals(f.db, p.outsider, other, {}, deps)).approvals).toEqual([]);
  await expect(requestApproval(f.db, p.outsider, other, { draftId: draft.id }, deps)).rejects.toMatchObject({ status: 404 });
  expect((await status({}, p.outsider).catch(() => ({ items: [] }))).items).toEqual([]);
});
