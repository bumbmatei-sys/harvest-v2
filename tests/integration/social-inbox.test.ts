import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { GET as sidebarRoute } from "../../src/app/api/workspaces/[tenantId]/social/inbox/sidebar/route";
import { POST as inboxRoute } from "../../src/app/api/workspaces/[tenantId]/social/inbox/route";
import { fileKey } from "../../src/lib/files";
import { inboxCapabilities, socialPlatforms } from "../../src/lib/social/platforms";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { drainJobs } from "../../src/server/jobs/service";
import { enqueueJob } from "../../src/server/jobs/outbox";
import { FakeProvider } from "../../src/server/social/fake-provider";
import type { InboxEntry, InboxListQuery } from "../../src/server/social/inbox-contract";
import { bulkInboxItems, createInboxFollowUp, getInboxHours, listSavedInboxReplies, mutateInboxItem, mutateInboxLabel, mutateInboxNote,
  mutateSavedInboxReply, saveInboxHours } from "../../src/server/social/inbox-metadata";
import { inboxSidebar, listInbox, listInboxNotes, readInboxConversation, searchInboxMetadata } from "../../src/server/social/inbox-read";
import { checkInboxReply, getInboxReply, submitInboxReply } from "../../src/server/social/inbox-reply";
import { runSocialInboxReplies } from "../../src/server/social/inbox-reply-worker";
import { createReplyHandoff } from "../../src/server/social/inbox-reply-handoff";
import { SocialProviderError } from "../../src/server/social/port";
import { linkConnection } from "../../src/server/social/service";
import { receiveSocialWebhook } from "../../src/server/social/webhook";
import { withTenant } from "../../src/server/tenancy";
import { testDatabase } from "../database";
import { CANARY, depsFor, event, noNetwork, seedPeople, signedRequest, useTestKeys } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
const providerBody = "distinct-private-provider-body";
const replyBody = "distinct-private-outbound-reply";
const webhookBody = "distinct-private-webhook-body";
const ind = new Date("2026-11-19T09:00:00Z");
const provider = new FakeProvider({ validSecret: CANARY, accounts: [
  ...socialPlatforms.map(platform => ({ accountRef: platform, platform, displayName: platform })),
  { accountRef: "facebook-other", platform: "facebook", displayName: "Other Page" },
  { accountRef: "facebook-revoke", platform: "facebook", displayName: "Revocation fixture" },
] });
let f: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let network: ReturnType<typeof noNetwork>;
let now = Date.now();
const deps = depsFor(provider, () => new Date(now));
const handoff = createReplyHandoff();
const replyDeps = { enabled: true, social: deps, handoff };
const ids = new Map<string, string>();
const accounts = (account: string) => ids.get(account)!;
const entry = (accountRef: string, kind: InboxEntry["kind"], ref: string, index = 0): InboxEntry => ({
  accountRef, kind, ref, title: "Live title", preview: providerBody,
  activityAt: new Date(ind.getTime() + index * 60_000),
});
const list = (query: unknown = {}, user?: string) => listInbox(f.db, user ?? people.owner, people.tenant, query, deps);
const side = (user?: string) => inboxSidebar(f.db, user ?? people.owner, people.tenant, deps);
const patch = (id: string, version: number, change: unknown, user?: string) =>
  mutateInboxItem(f.db, user ?? people.owner, people.tenant, id, { version, change }, deps);
const open = async (account = "facebook", kind = "dm") => (await list({ account: accounts(account), kind })).items[0];
const send = (item: string, body: Record<string, unknown>, user?: string) =>
  submitInboxReply(f.db, user ?? people.owner, people.tenant, item, body, replyDeps);
const run = (options: Partial<Parameters<typeof runSocialInboxReplies>[1]> = {}) =>
  runSocialInboxReplies(f.workerPool, { fake: provider, handoff, now: deps.now, ...options });
const status = async (id: string, item: string) => (await getInboxReply(f.db, people.owner, people.tenant, item, id, deps)).reply;
const jobs = (item: string, user: string, payload: unknown) => withTenant(f.db, user, people.tenant, "jobs:operate",
  (tx, tenant) => enqueueJob(tx, tenant, { kind: "social.webhook", idempotencyKey: item, payload: payload as Record<string, string> }));
const providerEvent = (id: string) => event(id, "message.received", { accountRef: "facebook", platform: "facebook", subjectRef: "shared", text: webhookBody });

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  people = await seedPeople(f, "sin");
  useTestKeys();
  network = noNetwork();
  for (const account of provider.accounts) {
    // Use all 25 platform keys, including accounts without inbox support.
    const other = account.accountRef.endsWith("-other");
    const linked = await linkConnection(f.db, other ? people.outsider : people.owner, other ? people.other : people.tenant,
      { provider: "fake", credential: CANARY, accountRef: account.accountRef }, deps);
    ids.set(account.accountRef, linked.connection.id);
  }
  provider.inboxEntries = [
    entry("facebook", "dm", "shared", 10), entry("facebook", "comment", "shared"), entry("instagram", "dm", "shared"),
    entry("instagram", "story", "story"), entry("instagram", "mention", "mention"), entry("facebook-other", "dm", "shared"),
    entry("facebook-revoke", "dm", "revocation"),
  ];
  for (const [accountRef, kind, ref] of [["facebook", "dm", "shared"], ["facebook", "comment", "shared"]] as const) {
    provider.inboxMessages.set(JSON.stringify([accountRef, kind, ref]), [{
      ref: "target-1", direction: "incoming", text: providerBody, at: new Date(now - 1000), attachments: [], canReply: true, canPrivateReply: true,
    }]);
  }
});
afterEach(() => expect(network).not.toHaveBeenCalled());
afterAll(async () => { network?.mockRestore(); useKeyProvider(null); await f?.close(); });

it("reports the Publish inventory, isolates account and kind identity, and keeps unverified connections explicit", async () => {
  const first = await list({ account: accounts("facebook") });
  expect(first.items.map(item => item.kind).sort()).toEqual(["comment", "dm"]);
  expect(new Set(first.items.map(item => item.id)).size).toBe(2);
  const instagram = await list({ account: accounts("instagram") });
  expect(instagram.items.map(item => item.kind).sort()).toEqual(["dm", "mention", "story"]);
  expect(instagram.items.find(item => item.kind === "dm")!.id).not.toBe(first.items.find(item => item.kind === "dm")!.id);
  expect(first.channels.map(channel => channel.platform).sort()).toEqual([...socialPlatforms, "facebook"].sort());
  expect(first.channels.find(channel => channel.platform === "snapchat")).toMatchObject({ state: "unavailable" });
  expect(first.channels.find(channel => channel.platform === "instagram")?.capabilities).toEqual(inboxCapabilities("instagram"));
  await expect(list({ account: accounts("facebook-other") })).rejects.toMatchObject({ status: 404 });
  await expect(list({}, people.viewer)).rejects.toMatchObject({ status: 404 });
  await expect(list({}, people.member)).rejects.toMatchObject({ status: 404 });
  await expect(readInboxConversation(f.db, people.outsider, people.other, first.items[0].id, {}, deps)).rejects.toMatchObject({ status: 404 });
});

it("paginates independent accounts, keeps a slow account, and deduplicates across pages", async () => {
  const call = provider.listInbox.bind(provider);
  const extra = Array.from({ length: 11 }, (_, index) => entry("facebook", "dm", `page-${index}`, index));
  provider.inboxEntries.push(...extra, extra[0]);
  let shouldDelay = true;
  let active = 0, peak = 0;
  const listing = vi.spyOn(provider, "listInbox").mockImplementation(async (cred, query: InboxListQuery) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await Promise.resolve();
      if (query.accountRef === "instagram" && shouldDelay) throw new SocialProviderError("RATE_LIMITED", 11_000);
      return await call(cred, query);
    } finally { active--; }
  });
  try {
    const first = await list({ kind: "dm" });
    const opaque = first.nextCursor!;
    expect(opaque).toEqual(expect.any(String));
    expect(opaque).not.toContain("facebook");
    await expect(list({ kind: "dm", cursor: opaque + "x" })).rejects.toMatchObject({ details: { code: "INBOX_CURSOR_INVALID" } });
    await expect(list({ kind: "dm", cursor: opaque }, people.admin)).rejects.toMatchObject({ details: { code: "INBOX_CURSOR_STALE" } });
    const all = [...first.items];
    let page = first;
    let lastDelay: number | undefined;
    for (let i = 0; i < 7 && page.nextCursor; i++) {
      const delay = page.partial.find(result => result.accountId === accounts("instagram"));
      if (delay?.retryAt) lastDelay = delay.retryAt;
      if (lastDelay && page.retryAfter) { shouldDelay = false; now = lastDelay + 1; }
      page = await list({ kind: "dm", cursor: page.nextCursor });
      all.push(...page.items);
    }
    expect(lastDelay).toBeDefined();
    expect(page.nextCursor).toBeNull();
    expect(all.filter(item => item.connectionId === accounts("facebook"))).toHaveLength(12);
    expect(all.filter(item => item.connectionId === accounts("instagram"))).toHaveLength(1);
    expect(new Set(all.map(item => item.id)).size).toBe(all.length);
    expect(peak).toBeLessThanOrEqual(4);
  } finally {
    listing.mockRestore();
    provider.inboxEntries = provider.inboxEntries.filter(item => !item.ref.startsWith("page-"));
  }
});

it("marks read per reader, applies local metadata and returns ordered bulk partial results", async () => {
  const item = await open();
  const comment = await open("facebook", "comment");
  const { label } = await mutateInboxLabel(f.db, people.owner, people.tenant, { action: "create", name: "Prayer" }, deps);
  const read = await patch(item.id, item.version, { action: "read", value: true });
  const owner = await readInboxConversation(f.db, people.owner, people.tenant, item.id, {}, deps);
  const admin = await readInboxConversation(f.db, people.admin, people.tenant, item.id, {}, deps);
  expect(owner).toMatchObject({ state: "available", item: { readInHarvest: true }, messages: [{ text: providerBody }] });
  expect(admin).toMatchObject({ item: { readInHarvest: false } });
  const assigned = await patch(item.id, read.version, { action: "assign", assigneeId: people.admin });
  const labelled = await patch(item.id, assigned.version, { action: "label", labelId: label.id, value: true });
  const snoozed = await patch(item.id, labelled.version, { action: "snooze", until: new Date(now + 100_000).toISOString() });
  const note = await mutateInboxNote(f.db, people.owner, people.tenant, item.id, { action: "create", itemVersion: snoozed.version, note: "Call next week" }, deps);
  expect((await listInboxNotes(f.db, people.admin, people.tenant, item.id, deps)).notes[0].note).toBe("Call next week");
  await expect(mutateInboxNote(f.db, people.admin, people.tenant, item.id,
    { action: "delete", id: note.id, version: note.version, itemVersion: note.itemVersion }, deps)).rejects.toMatchObject({ status: 404 });
  const unknown = randomUUID();
  const bulk = await bulkInboxItems(f.db, people.owner, people.tenant, { change: { action: "star", value: true },
    items: [{ id: comment.id, version: comment.version + 1 }, { id: unknown, version: 1 }, { id: item.id, version: note.itemVersion }] }, deps);
  expect(bulk.results).toEqual([{ id: comment.id, status: "stale" }, { id: unknown, status: "unavailable" },
    { id: item.id, version: note.itemVersion + 1, status: "updated" }]);
  const found = await searchInboxMetadata(f.db, people.owner, people.tenant, {
    label: label.id, assignee: people.admin, folder: "starred", note: "next week", snoozed: true, status: "open", platform: "facebook",
  }, deps);
  expect(found.items.map(row => row.id)).toEqual([item.id]);
  expect((await searchInboxMetadata(f.db, people.owner, people.tenant, { note: providerBody }, deps)).items).toEqual([]);
  expect((await side(people.admin)).folders.assigned).toBe(1);
  expect((await side()).folders.assigned).toBe(0);
});

it("enforces FORCE RLS and worker/app grants under the restricted migration owner", async () => {
  const tables = ["items", "reads", "labels", "item_labels", "notes", "saved_replies", "hours", "replies", "scan_items"];
  for (const table of tables) {
    expect((await f.admin.query("select relforcerowsecurity from pg_class where relname=$1", ["social_inbox_" + table])).rows[0].relforcerowsecurity).toBe(true);
    await expect(f.workerPool.query(`select * from social_inbox_${table}`)).rejects.toMatchObject({ code: "42501" });
  }
  await expect(f.pool.query("select public.social_inbox_claim('{}', 1)")).rejects.toMatchObject({ code: "42501" });
  const client = await f.pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true), set_config('app.social_inbox_worker','on',true)",
      [people.tenant, people.member]);
    expect((await client.query("select * from social_inbox_items")).rows).toEqual([]);
    await client.query("select set_config('app.user_id',$1,true)", [people.outsider]);
    expect((await client.query("select * from social_inbox_items")).rows).toEqual([]);
    await client.query("select set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)", [people.owner, people.other]);
    expect((await client.query("select * from social_inbox_items")).rows).toEqual([]);
  } finally { await client.query("rollback"); client.release(); }
});

it("manages account hours and renders saved replies using explicit variables", async () => {
  const settings = { version: 0, timezone: "Europe/Berlin", hours: [{ day: 5, start: "09:00", end: "16:00" }], awayTemplate: "Back Monday" };
  await saveInboxHours(f.db, people.owner, people.tenant, accounts("facebook"), settings, deps);
  await expect(saveInboxHours(f.db, people.admin, people.tenant, accounts("facebook"), settings, deps)).rejects.toMatchObject({ status: 409 });
  expect((await getInboxHours(f.db, people.admin, people.tenant, accounts("facebook"), deps)).settings).toMatchObject({ ...settings, version: 1 });
  const saved = (await mutateSavedInboxReply(f.db, people.owner, people.tenant,
    { action: "create", name: "Welcome", template: "Hello {{ name }} and {{name}}" }, deps)).reply;
  expect(saved.variables).toEqual(["name"]);
  expect((await listSavedInboxReplies(f.db, people.outsider, people.other, deps)).replies).toEqual([]);
  const item = await open();
  const id = randomUUID();
  const request = { id, mode: "message", saved: { id: saved.id, version: saved.version, variables: {} } };
  await expect(send(item.id, request)).rejects.toMatchObject({ details: { code: "INBOX_TEMPLATE_VARIABLES" } });
  const call = vi.spyOn(provider, "dispatchInboxReply");
  try {
    await send(item.id, { ...request, saved: { ...request.saved, variables: { name: "Sam" } } });
    expect(await run()).toMatchObject({ confirmed: 1 });
    expect(call.mock.calls[0][1].text).toBe("Hello Sam and Sam");
  } finally { call.mockRestore(); }
});

it("links a real same-ministry contact explicitly and creates a CRM task under existing permissions", async () => {
  const item = await open();
  const contact = randomUUID(), foreign = randomUUID();
  await f.admin.query("insert into contacts (id, tenant_id, name) values ($1,$2,'Local'),($3,$4,'Foreign')", [contact, people.tenant, foreign, people.other]);
  await expect(patch(item.id, item.version, { action: "linkContact", contactId: foreign })).rejects.toMatchObject({ status: 404 });
  const link = await patch(item.id, item.version, { action: "linkContact", contactId: contact });
  const request = { version: link.version, task: { title: "Follow up", body: "Harvest-authored action" } };
  await expect(createInboxFollowUp(f.db, people.member, people.tenant, item.id, request, deps)).rejects.toMatchObject({ status: 404 });
  const { task } = await createInboxFollowUp(f.db, people.admin, people.tenant, item.id, request, deps);
  expect((await f.admin.query("select tenant_id,contact_id,title from crm_tasks where id=$1", [task.id])).rows[0])
    .toEqual({ tenant_id: people.tenant, contact_id: contact, title: "Follow up" });
  await expect(createInboxFollowUp(f.db, people.admin, people.tenant, item.id, request, deps)).rejects.toMatchObject({ status: 409 });
  expect((await f.admin.query("select count(*)::int from contact_consents")).rows[0].count).toBe(0);
});

it("rechecks the reply window and refuses revoked connections or demoted senders before dispatch", async () => {
  const item = await open();
  const k = JSON.stringify(["facebook", "dm", "shared"]);
  const request = { id: randomUUID(), mode: "message", text: replyBody };
  provider.replyEligibility.set(k, { allowed: true, media: true, quote: false, expiresAt: new Date(now - 1) });
  expect(await checkInboxReply(f.db, people.owner, people.tenant, item.id, { mode: "message" }, deps)).toMatchObject({ eligibility: { reason: "expired_window" } });
  await send(item.id, request);
  expect(await run()).toMatchObject({ cancelled: 1 });
  provider.replyEligibility.delete(k);
  const nextId = randomUUID();
  await send(item.id, { ...request, id: nextId }, people.admin);
  await f.admin.query("update workspace_members set role_id='member' where tenant_id=$1 and user_id=$2", [people.tenant, people.admin]);
  try { expect(await run()).toMatchObject({ cancelled: 1 }); }
  finally { await f.admin.query("update workspace_members set role_id='admin' where tenant_id=$1 and user_id=$2", [people.tenant, people.admin]); }
  const revocation = await open("facebook-revoke");
  const revoked = randomUUID();
  await send(revocation.id, { ...request, id: revoked });
  const response = await receiveSocialWebhook(f.db, signedRequest(event("revoke", "account.disconnected",
    { accountRef: "facebook-revoke", platform: "facebook" })), "fake", deps);
  expect(response.status).toBe(202);
  await drainJobs(f.db, people.owner, people.tenant, "social-inbox-webhook");
  expect(await status(revoked, revocation.id)).toMatchObject({ state: "cancelled", firstAttemptAt: null });
  expect(await readInboxConversation(f.db, people.owner, people.tenant, revocation.id, {}, deps)).toMatchObject({ state: "revoked" });
  await expect(send(revocation.id, { ...request, id: randomUUID() })).rejects.toMatchObject({ details: { code: "INBOX_ACCOUNT_UNAVAILABLE" } });
});

it("preserves the first attempt and idempotency through retries and reconciles ambiguous delivery", async () => {
  const item = await open();
  const request = { id: randomUUID(), mode: "message", text: replyBody };
  const queued = await send(item.id, request);
  expect(queued).toMatchObject({ bodyAvailable: true, reply: { state: "queued" } });
  await expect(send(item.id, { ...request, text: "Different" })).rejects.toMatchObject({ details: { code: "INBOX_REPLY_IDEMPOTENCY_CONFLICT" } });
  await expect(send(item.id, request, people.admin)).rejects.toMatchObject({ status: 404 });
  provider.fail("dispatchInboxReply", "RATE_LIMITED", 1, 45_000);
  expect(await run()).toMatchObject({ queued: 1 });
  const first = await status(request.id, item.id);
  expect(first.retryAt!.getTime() - first.firstAttemptAt!.getTime()).toBeGreaterThanOrEqual(44_000);
  expect(await run()).toEqual({ leased: 0 });
  // Move due time while preserving the migration's version and transition guards.
  await f.admin.query("alter table social_inbox_replies disable trigger social_inbox_reply_guard");
  try { await f.admin.query("update social_inbox_replies set next_at = now() where id=$1", [request.id]); }
  finally { await f.admin.query("alter table social_inbox_replies enable trigger social_inbox_reply_guard"); }
  provider.ambiguousNextReply = true;
  expect(await run()).toMatchObject({ unknown: 1 });
  const unknown = await status(request.id, item.id);
  expect(unknown.firstAttemptAt).toEqual(first.firstAttemptAt);
  expect(unknown.state).toBe("unknown");
  await expect(f.admin.query("update social_inbox_replies set first_attempt_at=now(), version=version+1 where id=$1", [request.id]))
    .rejects.toThrow(/invalid inbox reply transition/);
  await f.admin.query("update social_inbox_replies set next_at = now(), version = version + 1 where id=$1", [request.id]);
  expect(await run()).toMatchObject({ confirmed: 1 });
  expect((await status(request.id, item.id)).state).toBe("confirmed");
  const calls = provider.calls.filter(call => call.key?.endsWith(request.id));
  expect(calls.map(call => call.method)).toEqual(["dispatchInboxReply", "dispatchInboxReply", "reconcileInboxReply"]);
  expect(new Set(calls.map(call => call.key)).size).toBe(1);
  expect(provider.sent.filter(call => call.key.endsWith(request.id))).toHaveLength(1);
});

it("dispatches comment and private replies and only releases scanned tenant media", async () => {
  const item = await open("facebook", "comment");
  const file = randomUUID();
  const secondary = randomUUID();
  await f.admin.query(`insert into files (id,tenant_id,owner_id,key,name,mime,size,checksum,status,social_upload,media_metadata)
    values ($1,$2,$3,$4,'photo.jpg','image/jpeg',1024,$5,'ready',true,'{"width":1080,"height":1080}'),
    ($6,$2,$3,$7,'pending.jpg','image/jpeg',1024,$5,'pending',true,null)`,
  [file, people.tenant, people.owner, fileKey(people.tenant, file), "a".repeat(64), secondary, fileKey(people.tenant, secondary)]);
  await expect(send(item.id, { id: randomUUID(), mode: "comment", targetRef: "target-1", text: replyBody, fileId: secondary })).rejects.toMatchObject({ status: 404 });
  await send(item.id, { id: randomUUID(), mode: "comment", targetRef: "target-1", text: replyBody, fileId: file });
  await send(item.id, { id: randomUUID(), mode: "private", targetRef: "target-1", text: replyBody });
  const releaseMedia = vi.fn(async () => ({ url: "https://fixture.invalid/attachment", expiresAt: new Date(now + 60_000) }));
  expect(await run({ releaseMedia })).toMatchObject({ confirmed: 2 });
  expect(releaseMedia).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: file, size: 1024 }));
});

it("authenticates, deduplicates and applies metadata-only webhook refreshes", async () => {
  const item = await open();
  const initial = await side();
  const delivery = providerEvent("inbox-signed");
  const forged = new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify(delivery),
    headers: { "content-type": "application/json", "x-fake-signature": "f".repeat(64) } });
  expect((await receiveSocialWebhook(f.db, forged, "fake", deps)).status).toBe(404);
  expect((await side()).etag).toBe(initial.etag);
  const accepted = () => receiveSocialWebhook(f.db, signedRequest(delivery), "fake", deps);
  expect((await accepted()).status).toBe(202);
  expect((await accepted()).status).toBe(202);
  const { rows: [stored] } = await f.admin.query("select id from social_webhook_events where provider_event_id='inbox-signed'");
  const { rows: outbox } = await f.admin.query("select payload from outbox_events where idempotency_key=$1", [`social-webhook:${stored.id}`]);
  expect(outbox).toEqual([{ payload: { eventId: stored.id, connectionId: accounts("facebook"), reference: "shared" } }]);
  await jobs("forged-refresh", people.owner, { eventId: stored.id, reference: "shared" });
  const summary = await drainJobs(f.db, people.owner, people.tenant, "social-inbox-webhook");
  expect(summary.results.map(result => result.status)).toEqual(expect.arrayContaining(["succeeded", "queued"]));
  const refreshed = await open();
  expect(refreshed.id).toBe(item.id);
  expect(refreshed.activityAt!.getTime()).toBeGreaterThan(item.activityAt!.getTime());
  expect((await side()).etag).not.toBe(initial.etag);
  for (const table of ["social_inbox_items", "social_inbox_scan_items", "social_inbox_reads", "social_inbox_replies", "social_webhook_events", "jobs", "outbox_events", "audit_logs"]) {
    const { rows } = await f.admin.query(`select * from ${table}`);
    expect(JSON.stringify(rows)).not.toContain(providerBody);
    expect(JSON.stringify(rows)).not.toContain(replyBody);
    expect(JSON.stringify(rows)).not.toContain(webhookBody);
    expect(JSON.stringify(rows)).not.toContain(CANARY);
  }
});

it("keeps live reads disabled in normal HTTP entry points with private no-store responses", async () => {
  const request = new Request("https://fixture.invalid", { method: "POST", body: "{}" });
  const context = { params: Promise.resolve({ tenantId: people.tenant }) };
  for (const response of [await sidebarRoute(request, context), await inboxRoute(request, context)]) {
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  const result = await withTenant(f.db, people.owner, people.tenant, "social:inbox",
    tx => tx.execute(sql`select public.social_inbox_can(${people.tenant}::uuid, 'social:assign') as allowed`));
  expect(result.rows[0].allowed).toBe(true);
});
