import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { users } from "../../src/db/schema";
import * as schema from "../../src/db/schema";
import { chatStaffPage, chatState, saveChatSettings } from "../../src/server/community-chat";
import { ownCommunityProfile } from "../../src/server/community-profile-details";
import { dmBlock, dmDecide, dmEvidence, dmList, dmMessages, dmReport, dmReports, dmStart } from "../../src/server/community-dm";
import { createCommunity } from "../../src/server/communities";
import { listNotifications, markRead } from "../../src/server/community-notifications";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

vi.mock("server-only", () => ({}));
let fixture: Awaited<ReturnType<typeof testDatabase>>, tenant: string, club: string, solo: string, otherTenant: string;
const slug = "dm-club";
const ids = ["owner", "admin", "staff", "mod", "alice", "bob", "viewer", "plain", "outsider", "other",
  ...Array.from({ length: 12 }, (_, index) => `receiver-${index}`)];
const tables = ["community_dm_conversations", "community_dm_participants", "community_dm_messages", "community_dm_blocks"] as const;
type Result = { outcome: string; conversationId?: string; id?: string; items?: unknown[]; message?: { id: string; rev: string; body: string | null } };
async function invoke(actor: string, fn: string, args: unknown[], where = slug) {
  return withUser(fixture.db, actor, async tx => (await tx.execute<{ result: Result }>(
    sql`select ${sql.raw(`public.community_dm_${fn}`)}(${sql.join([where, ...args].map(value => sql`${sql.param(value)}`), sql`, `)}) result`)).rows[0].result);
}
function start(actor: string, other: string, body = "Synthetic private message", client = randomUUID(), where = slug) {
  return dmStart(fixture.db, actor, where, { targetUserId: other, body, client_id: client }) as Promise<Result>;
}
function send(actor: string, conversation: string, body: string) {
  return invoke(actor, "send", [conversation, body, randomUUID()]);
}
function policy(value: "members" | "channels_only") {
  return saveChatSettings(fixture.db, "owner", slug, { chatEnabled: true, dmPolicy: value });
}
async function join(community: string, workspace: string, id: string, role = "member") {
  await fixture.admin.query("insert into community_memberships(tenant_id,community_id,user_id,role,status) values($1,$2,$3,$4,'active')", [workspace, community, id, role]);
  await fixture.admin.query("insert into entitlements(tenant_id,user_id,resource_type,resource_id,source) values($1,$2,'community',$3,'admin_grant')", [workspace, id, community]);
}

beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values(ids.map(id => ({ id, name: id, email: `${id}@qa.harvest.invalid`, emailVerified: true })));
  tenant = (await createWorkspace(fixture.db, "owner", "Test ministry", "church")).tenantId;
  otherTenant = (await createWorkspace(fixture.db, "other", "Other ministry", "church")).tenantId;
  club = (await createCommunity(fixture.db, "owner", tenant, { name: "Test group", slug })).id;
  solo = (await createCommunity(fixture.db, "owner", tenant, { name: "Solo staff", slug: "dm-solo" })).id;
  const remote = (await createCommunity(fixture.db, "other", otherTenant, { name: "Other group", slug: "dm-other" })).id;
  await createCommunity(fixture.db, "other", otherTenant, { name: "Other spare", slug: "dm-spare" });
  await fixture.admin.query("update communities set status='published'");
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values ($1,'staff','admin'),($1,'viewer','viewer'),($1,'plain','member')", [tenant]);
  for (const [id, role] of [["admin", "admin"], ["mod", "moderator"], ["alice", "member"], ["bob", "member"],
    ...ids.filter(id => id.startsWith("receiver")).map(id => [id, "member"])]) await join(club, tenant, id, role);
  await join(solo, tenant, "alice");
  await join(remote, otherTenant, "outsider");
}, 90_000);
afterAll(async () => { await fixture?.close(); });
beforeEach(async () => {
  await fixture.admin.query("delete from community_reports where target_type='dm_message'; delete from community_dm_blocks; delete from community_dm_conversations; delete from community_notifications where kind in ('dm','host_queue')");
  await fixture.admin.query("update communities set chat_enabled=true,dm_policy='channels_only'; update community_memberships set dm_accept_members=true,muted_until=null");
  await fixture.admin.query("update community_memberships set role='admin',status='active' where user_id='admin'");
});

it("keeps a private partner resolvable in a conversation without any roster trace", async () => {
  await policy("members");
  await ownCommunityProfile(fixture.db, "bob", slug, "save", { version: 0, displayName: "Private bob", visibility: "private" });
  const opened = await start("alice", "bob");
  expect(opened.outcome).toBe("ok");
  const items = (await dmList(fixture.db, "alice", slug)).items as { id: string; otherId: string; otherName: string | null }[];
  const item = items.find(entry => entry.id === opened.conversationId);
  expect(item).toMatchObject({ otherId: "bob", otherName: "bob" });
  const roster = (await chatStaffPage(fixture.db, "alice", slug))!;
  expect(roster.members.some(entry => entry.userId === "bob")).toBe(false);
  // A hidden plain member leaves no trace; the header name comes from the conversation and the role defaults to member.
  expect(roster.hidden.some(entry => entry.userId === "bob")).toBe(false);
  await fixture.admin.query("delete from community_member_profiles where community_id=$1", [club]);
});

it("allows DM reads only to participants with active access even through a ministry context", async () => {
  await policy("members");
  const opened = await start("alice", "bob");
  const remote = await start("other", "outsider", "Other tenant synthetic message", randomUUID(), "dm-other");
  expect(opened.outcome).toBe("ok");
  expect(remote.outcome).toBe("ok");
  expect((await dmBlock(fixture.db, "alice", slug, { targetUserId: "bob" }, false)).outcome).toBe("ok");
  for (const id of ["owner", "admin", "staff", "mod", "viewer", "plain", "other"]) {
    for (const table of tables) {
      const direct = await withUser(fixture.db, id, tx => tx.execute(sql.raw(`select count(*)::int n from public.${table} where community_id = '${club}'`)));
      expect(direct.rows[0].n, `${id} ${table}`).toBe(0);
      if (["owner", "staff", "viewer", "plain"].includes(id)) {
        const scoped = await withTenant(fixture.db, id, tenant, "communities:read", tx =>
          tx.execute(sql.raw(`select count(*)::int n from public.${table} where community_id = '${club}'`)));
        expect(scoped.rows[0].n, `${id} withTenant ${table}`).toBe(0);
      }
    }
    const view = await dmMessages(fixture.db, id, slug, opened.conversationId!, new URLSearchParams(), null);
    expect(view.outcome).toBe("not_found");
  }
  expect((await dmList(fixture.db, "owner", slug)).items).toEqual([]);
  expect((await dmMessages(fixture.db, "alice", slug, opened.conversationId!, new URLSearchParams(), null)).events).toHaveLength(1);
  expect((await dmMessages(fixture.db, "alice", slug, remote.conversationId!, new URLSearchParams(), null)).outcome).toBe("not_found");
  for (const status of ["pending", "banned", "left", "removed"]) {
    await fixture.admin.query("update community_memberships set status=$1 where community_id=$2 and user_id='bob'", [status, club]);
    expect((await dmMessages(fixture.db, "bob", slug, opened.conversationId!, new URLSearchParams(), null)).outcome).toBe("not_found");
  }
  await fixture.admin.query("update community_memberships set status='active' where community_id=$1 and user_id='bob'", [club]);
  expect((await dmMessages(fixture.db, "bob", slug, opened.conversationId!, new URLSearchParams(), null)).events).toHaveLength(1);
});

it("keeps a single refusal outcome and honours opt-out only on new member conversations", async () => {
  const unavailable = { outcome: "not_available" };
  expect(await start("alice", "bob")).toEqual(unavailable);
  expect(await start("alice", "admin")).toEqual(unavailable);
  expect(await start("mod", "alice")).toEqual(unavailable);
  expect(await start("alice", "outsider")).toEqual(unavailable);
  await policy("members");
  await invoke("bob", "accept_save", [false]);
  expect(await start("alice", "bob")).toEqual(unavailable);
  expect((await start("owner", "bob")).outcome).toBe("ok");
  await invoke("bob", "accept_save", [true]);
  const started = await start("alice", "bob");
  await invoke("bob", "accept_save", [false]);
  expect((await send("alice", started.conversationId!, "Existing history stays open")).outcome).toBe("ok");
  expect((await send("bob", started.conversationId!, "A notice for alice")).outcome).toBe("ok");
  const noticesBefore = await listNotifications(fixture.db, "alice", slug);
  expect(noticesBefore.items.filter(item => item.kind === "dm")).toHaveLength(1);
  const aliceBefore = { list: (await dmList(fixture.db, "alice", slug)).items, token: (await chatState(fixture.db, "alice", slug)).etag };
  await dmBlock(fixture.db, "bob", slug, { targetUserId: "alice", hide: true }, false);
  // The blocked person cannot tell: same list (including canSend) and the same rail token; only sending fails, generically.
  expect((await dmList(fixture.db, "alice", slug)).items).toEqual(aliceBefore.list);
  expect((await chatState(fixture.db, "alice", slug)).etag).toBe(aliceBefore.token);
  // Her existing notice and unread count are untouched by the block.
  expect(await listNotifications(fixture.db, "alice", slug)).toEqual(noticesBefore);
  expect((await chatState(fixture.db, "alice", slug, aliceBefore.token))).toEqual({ notModified: true, etag: aliceBefore.token });
  expect(await start("alice", "bob")).toEqual(unavailable);
  expect(await send("bob", started.conversationId!, "Blocked either way")).toEqual(unavailable);
  expect((await dmList(fixture.db, "bob", slug)).items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: started.conversationId })]));
  // Blocking gives one answer whether or not the target is an active member of this community.
  for (const target of ["receiver-0", "outsider", "no-such-user"]) expect((await dmBlock(fixture.db, "alice", slug, { targetUserId: target }, false)).outcome, target).toBe("ok");
  expect((await fixture.admin.query("select count(*)::int n from community_dm_blocks where blocker_id='alice' and blocked_id in ('outsider','no-such-user')")).rows[0].n).toBe(0);
});

it("reuses a member-origin pair and rechecks current host role on every reply", async () => {
  await policy("members");
  const original = await start("alice", "admin");
  await invoke("alice", "hide", [original.conversationId, true]);
  await policy("channels_only");
  expect((await send("alice", original.conversationId!, "Cannot send yet")).outcome).toBe("not_available");
  const engaged = await start("admin", "alice", "Host is engaging");
  expect(engaged.conversationId).toBe(original.conversationId);
  expect((await dmList(fixture.db, "alice", slug)).items).toEqual(expect.arrayContaining([expect.objectContaining({ id: original.conversationId, canSend: true })]));
  expect((await fixture.admin.query("select origin, staff_engaged_by from community_dm_conversations where id=$1", [original.conversationId])).rows[0]).toEqual({ origin: "member", staff_engaged_by: "admin" });
  await fixture.admin.query("update community_memberships set muted_until=now()+interval '1 day' where community_id=$1 and user_id='alice'", [club]);
  expect((await send("alice", original.conversationId!, "Can reply under mute")).outcome).toBe("ok");
  for (const [status, role] of [["active","moderator"], ["banned","admin"], ["left","admin"], ["removed","admin"]]) {
    await fixture.admin.query("update community_memberships set status=$1,role=$2 where community_id=$3 and user_id='admin'", [status, role, club]);
    expect((await send("alice", original.conversationId!, "Staff engagement has ended")).outcome).toBe("not_available");
  }
  await fixture.admin.query("update community_memberships set status='active' where community_id=$1 and user_id='admin'", [club]);
  expect((await send("admin", original.conversationId!, "Engaged again")).outcome).toBe("ok");
  expect((await send("alice", original.conversationId!, "Reply again")).outcome).toBe("ok");
});

it("increments personal rail tokens only and returns resumable ordered deltas and tombstones", async () => {
  const initial = await chatState(fixture.db, "mod", slug);
  const before = (await fixture.admin.query("select rev from community_chat_state where community_id=$1", [club])).rows[0].rev;
  const alice = await chatState(fixture.db, "alice", slug);
  const first = await start("owner", "alice");
  const cid = first.conversationId!;
  await send("alice", cid, "Response");
  await send("owner", cid, "Another");
  expect((await fixture.admin.query("select rev from community_chat_state where community_id=$1", [club])).rows[0].rev).toBe(before);
  expect(await chatState(fixture.db, "mod", slug, initial.etag)).toEqual({ notModified: true, etag: initial.etag });
  expect((await chatState(fixture.db, "alice", slug, alice.etag)).etag).not.toBe(alice.etag);
  const partial = await dmMessages(fixture.db, "alice", slug, cid, new URLSearchParams("since=0&limit=1"), null);
  expect(partial).toMatchObject({ cursor: "1", hasMore: true, events: [{ rev: "1" }] });
  const remaining = await dmMessages(fixture.db, "alice", slug, cid, new URLSearchParams("since=1"), String(partial.etag));
  expect(remaining).toMatchObject({ cursor: "3", events: [{ rev: "2" }, { rev: "3" }] });
  expect(await dmMessages(fixture.db, "alice", slug, cid, new URLSearchParams("since=3"), String(remaining.etag))).toMatchObject({ notModified: true });
  await invoke("alice", "read", [cid, "9223372036854775807"]);
  expect((await fixture.admin.query("select last_read_seq from community_dm_participants where conversation_id=$1 and user_id='alice'", [cid])).rows[0].last_read_seq).toBe("3");
  expect((await dmList(fixture.db, "alice", slug)).items).toEqual([expect.objectContaining({ unread: 0 })]);
  const deletion = await invoke("owner", "delete_message", [first.message!.id]);
  expect(deletion.message?.body).toBeNull();
  expect((await invoke("alice", "restore_message", [first.message!.id])).outcome).toBe("not_found");
  expect((await invoke("owner", "restore_message", [first.message!.id])).message?.body).toBe("Synthetic private message");
});

it("aggregates body-free notices, respects mute and uses a stable client ID", async () => {
  const client = randomUUID();
  const first = await start("owner", "alice", "Private words", client);
  expect(await start("owner", "alice", "Private words", client)).toEqual(first);
  expect((await start("owner", "alice", "Changed", client)).outcome).toBe("client_id_conflict");
  await start("owner", "alice", "More private words");
  const notice = await listNotifications(fixture.db, "alice", slug);
  expect(notice.items.filter(item => item.kind === "dm")).toEqual([expect.objectContaining({ count: 2, detail: {} })]);
  expect(JSON.stringify(notice)).not.toContain("Private words");
  await invoke("alice", "mute", [first.conversationId, true]);
  await start("owner", "alice", "Muted message");
  expect((await listNotifications(fixture.db, "alice", slug)).items.filter(item => item.kind === "dm")).toEqual([]);
  expect((await fixture.admin.query("select actor_count from community_notifications where kind='dm'")).rows).toEqual([{ actor_count: 2 }]);
});

it("caps consecutive messages and serializes opposing find-or-create calls", async () => {
  await policy("members");
  const first = await start("alice", "bob");
  await send("alice", first.conversationId!, "Second");
  await send("alice", first.conversationId!, "Third");
  expect((await send("alice", first.conversationId!, "Fourth")).outcome).toBe("unanswered_limit");
  await send("bob", first.conversationId!, "Reply");
  expect((await send("alice", first.conversationId!, "New streak")).outcome).toBe("ok");
  const pools = [new Pool({ connectionString: fixture.appURL }), new Pool({ connectionString: fixture.appURL })];
  try {
    const opened = await Promise.all([
      dmStart(drizzle(pools[0], { schema }), "owner", slug, { targetUserId: "admin", body: "One", client_id: randomUUID() }),
      dmStart(drizzle(pools[1], { schema }), "admin", slug, { targetUserId: "owner", body: "Two", client_id: randomUUID() }),
    ]);
    expect(opened.map(item => item.outcome)).toEqual(["ok", "ok"]);
    expect(opened[0].conversationId).toBe(opened[1].conversationId);
  } finally { await Promise.all(pools.map(pool => pool.end())); }
});

it("applies the hourly, daily and message windows", async () => {
  await policy("members");
  for (let i = 0; i < 3; i++) expect((await start("alice", `receiver-${i}`)).outcome).toBe("ok");
  expect(await start("alice", "receiver-3")).toEqual({ outcome: "not_available" });
  for (let i = 0; i < 10; i++) {
    expect((await start("owner", `receiver-${i}`)).outcome).toBe("ok");
    await fixture.admin.query("update community_dm_messages set created_at=now()-interval '11 minutes' where author_id='owner'");
  }
  expect(await start("owner", "receiver-10")).toEqual({ outcome: "not_available" });
});

it("gives a quota-limited sender the same refusal for eligible, opted-out, blocked and absent recipients", async () => {
  await policy("members");
  await fixture.admin.query("update community_memberships set dm_accept_members=false where user_id='bob'");
  await dmBlock(fixture.db, "receiver-4", slug, { targetUserId: "alice" }, false);
  for (let i = 0; i < 3; i++) expect((await start("alice", `receiver-${i}`)).outcome).toBe("ok");
  for (const to of ["receiver-3", "bob", "receiver-4", "absent-user", "receiver-0"]) {
    expect(await start("alice", to)).toEqual({ outcome: "not_available" });
  }
  // This address was messageable, and a caller can still use their existing conversation.
  const id = (await fixture.admin.query(
    "select id from community_dm_conversations where pair_key = public.community_dm_pair('alice','receiver-0')")).rows[0].id;
  expect((await send("alice", id, "Continue the conversation")).outcome).toBe("ok");
  await fixture.admin.query("update community_dm_conversations set created_at=now()-interval '2 hours' where started_by='alice'");
  await fixture.admin.query("update community_dm_messages set created_at=now()-interval '11 minutes' where author_id='alice'");
  expect((await start("alice", "receiver-3")).outcome).toBe("ok");
  for (const to of ["bob", "receiver-4", "absent-user"]) expect(await start("alice", to)).toEqual({ outcome: "not_available" });
});

it("normalizes address-based burst limits while retaining the known-thread send response", async () => {
  await policy("members");
  const opened = await start("alice", "bob");
  for (let i = 0; i < 4; i++) {
    expect((await send("bob", opened.conversationId!, "Reply")).outcome).toBe("ok");
    expect((await send("alice", opened.conversationId!, "Next message")).outcome).toBe("ok");
  }
  await fixture.admin.query("update community_dm_messages set created_at=now() where author_id='alice'");
  expect(await start("alice", "receiver-3")).toEqual({ outcome: "not_available" });
  expect(await start("alice", "absent-user")).toEqual({ outcome: "not_available" });
  expect(await send("alice", opened.conversationId!, "Capped send")).toEqual({ outcome: "rate_limited", retryAfter: 10 });
});

it("keeps reused address requests from distinguishing eligible and absent targets", async () => {
  await policy("members");
  const client = randomUUID(), body = "Original submission";
  expect((await start("alice", "bob", body, client)).outcome).toBe("ok");
  for (const to of ["receiver-3", "absent-user"]) {
    expect(await start("alice", to, body, client)).toEqual({ outcome: "not_available" });
    expect(await start("alice", to, "Changed submission", client)).toEqual({ outcome: "client_id_conflict" });
  }
});

it("opens bounded immutable evidence only for a non-party owner or admin and sets decision expiry", async () => {
  const first = await start("owner", "alice", "Excluded first");
  const cid = first.conversationId!;
  for (let i = 1; i <= 6; i++) await send(i % 2 ? "alice" : "owner", cid, `Earlier ${i}`);
  const target = await send("owner", cid, "Reported body");
  const reported = await dmReport(fixture.db, "alice", slug, { messageId: target.message!.id, reason: "other", note: "Synthetic note" });
  expect(reported).toMatchObject({ outcome: "ok", needsEscalation: false });
  const id = String(reported.id);
  for (const actor of ["owner", "alice", "mod", "viewer", "other"]) {
    expect((await dmEvidence(fixture.db, actor, slug, id)).outcome).toBe("not_found");
    expect((await dmDecide(fixture.db, actor, slug, id, { decision: "keep" })).outcome).toBe("not_found");
  }
  for (const actor of ["owner", "staff", "viewer", "plain"]) await expect(withTenant(fixture.db, actor, tenant, "communities:read",
    tx => tx.execute(sql`select * from public.community_dm_report_evidence`))).rejects.toMatchObject({ cause: { code: "42501" } });
  expect((await dmReports(fixture.db, "mod", slug)).items).toEqual([expect.objectContaining({ reason: "other", note: "Synthetic note", reporterId: null })]);
  expect((await dmReports(fixture.db, "owner", slug)).items).toEqual([]);
  expect((await dmReports(fixture.db, "admin", slug)).items).toEqual([expect.objectContaining({ reporterId: "alice" })]);
  const evidence = await dmEvidence(fixture.db, "staff", slug, id);
  expect(evidence).toMatchObject({ outcome: "ok", reporterName: "alice", subjectId: "owner", reportedMessageId: target.message!.id });
  expect(evidence.messages).toHaveLength(6);
  expect(JSON.stringify(evidence)).not.toContain("Excluded first");
  await invoke("owner", "edit", [target.message!.id, "Changed"]);
  await invoke("owner", "delete_message", [target.message!.id]);
  expect(await dmEvidence(fixture.db, "staff", slug, id)).toEqual(evidence);
  expect((await dmDecide(fixture.db, "admin", slug, id, { decision: "action" })).outcome).toBe("ok");
  const state = await fixture.admin.query("select status, expires_at = decided_at + interval '180 days' as correct from community_reports join community_dm_report_evidence on report_id=id where id=$1", [id]);
  expect(state.rows[0]).toEqual({ status: "actioned", correct: true });
  expect((await fixture.admin.query("select count(*)::int n from community_moderation_actions where target_id=$1 and action='dm_evidence_view'", [id])).rows[0].n).toBe(2);
});

it("escalates without a non-party host and expires open reports after reminders", async () => {
  await fixture.admin.query("delete from workspace_members where tenant_id=$1 and user_id='staff'", [tenant]);
  try {
    const first = await start("owner", "alice", "Escalation sample", randomUUID(), "dm-solo");
    const reported = await dmReport(fixture.db, "alice", "dm-solo", { messageId: first.message!.id, reason: "spam" });
    expect(reported).toMatchObject({ outcome: "ok", needsEscalation: true });
    const id = String(reported.id);
    await fixture.admin.query("update community_reports set created_at=now()-interval '15 days' where id=$1", [id]);
    const sweep = async () => (await fixture.workerPool.query("select public.community_chat_purge_dm(25) result")).rows[0].result;
    expect(await sweep()).toMatchObject({ reminded: 1, expired: 0 });
    expect(await sweep()).toMatchObject({ reminded: 0, expired: 0 });
    await fixture.admin.query("update community_reports set created_at=now()-interval '46 days',reminded_at=now()-interval '31 days' where id=$1", [id]);
    expect(await sweep()).toMatchObject({ reminded: 1, expired: 0 });
    await fixture.admin.query("update community_reports set created_at=now()-interval '91 days' where id=$1", [id]);
    expect(await sweep()).toMatchObject({ reminded: 0, expired: 1 });
    expect((await fixture.admin.query("select status, expires_at=decided_at+interval '30 days' as correct from community_reports join community_dm_report_evidence on report_id=id where id=$1", [id])).rows[0])
      .toEqual({ status: "expired", correct: true });
    expect((await fixture.admin.query("select count(*)::int n from community_moderation_actions where target_id=$1 and action='report_expire'", [id])).rows[0].n).toBe(1);
    await fixture.admin.query("update community_dm_report_evidence set expires_at=now()-interval '1 second' where report_id=$1", [id]);
    expect(await sweep()).toMatchObject({ evidence: 1, expired: 0 });
  } finally {
    await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values ($1,'staff','admin')", [tenant]);
  }
});

it("keeps open evidence after source purge and restricts worker grants", async () => {
  const result = await start("owner", "alice");
  const report = await dmReport(fixture.db, "alice", slug, { messageId: result.message!.id, reason: "spam" });
  await invoke("owner", "delete_message", [result.message!.id]);
  await fixture.admin.query("update community_dm_messages set purge_after=now()-interval '1 second'");
  expect((await invoke("owner", "restore_message", [result.message!.id])).outcome).toBe("not_available");
  await expect(fixture.pool.query("select public.community_chat_purge_dm(25)")).rejects.toMatchObject({ code: "42501" });
  for (const table of [...tables, "community_dm_report_evidence"]) {
    await expect(fixture.workerPool.query(`select * from public.${table}`)).rejects.toMatchObject({ code: "42501" });
    const forced = await fixture.admin.query("select relforcerowsecurity from pg_class where oid=$1::regclass", [table]);
    expect(forced.rows[0].relforcerowsecurity).toBe(true);
  }
  expect((await fixture.workerPool.query("select public.community_chat_purge_dm(25) result")).rows[0].result).toMatchObject({ deleted: 1, evidence: 0 });
  expect((await dmEvidence(fixture.db, "admin", slug, String(report.id))).outcome).toBe("ok");
});

it("keeps DM updates and identifying audits out of shared ministry reads", async () => {
  const revisions = () => withTenant(fixture.db, "viewer", tenant, "communities:read", async tx =>
    (await tx.execute(sql`select user_id,chat_state_rev from community_memberships where community_id=${club}::uuid order by user_id`)).rows);
  const before = await revisions();
  const client = randomUUID();
  const sent = await start("owner", "alice", "Original submission", client);
  const mid = sent.message!.id;
  expect((await invoke("owner", "edit", [mid, "Edited submission"])).outcome).toBe("ok");
  expect((await start("owner", "alice", "Original submission", client)).message?.id).toBe(mid);
  expect((await start("owner", "alice", "Edited submission", client)).outcome).toBe("client_id_conflict");
  const report = await dmReport(fixture.db, "alice", slug, { messageId: mid, reason: "other" });
  const rid = String(report.id);
  expect((await dmEvidence(fixture.db, "staff", slug, rid)).outcome).toBe("ok");
  expect((await dmDecide(fixture.db, "staff", slug, rid, { decision: "keep" })).outcome).toBe("ok");
  expect(await revisions()).toEqual(before);
  for (const actor of ["viewer", "plain", "staff", "owner"]) {
    const visible = await withTenant(fixture.db, actor, tenant, "communities:read", tx =>
      tx.execute(sql`select action from public.audit_logs where target_id in (${mid},${rid})`));
    expect(visible.rows).toEqual([]);
  }
  expect((await fixture.admin.query("select action from audit_logs where target_id=any($1::text[])", [[mid, rid]])).rowCount).toBeGreaterThanOrEqual(4);
});

it("routes notices and audited member moderation to ministry-only staff", async () => {
  const sent = await start("staff", "alice", "Private opener");
  const response = await send("alice", sent.conversationId!, "Reported reply");
  // A participant cannot review their own report. An unrelated member reports a separate conversation.
  await policy("members");
  const betweenMembers = await start("alice", "bob", "Reported synthetic content");
  const report = await dmReport(fixture.db, "bob", slug, { messageId: betweenMembers.message!.id, reason: "other" });
  expect(response.outcome).toBe("ok");
  const notices = await listNotifications(fixture.db, "staff", slug);
  expect(notices.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "host_queue" }), expect.objectContaining({ kind: "dm" })]));
  await markRead(fixture.db, "staff", slug, { ids: null });
  expect((await listNotifications(fixture.db, "staff", slug)).unread).toBe(0);
  const rid = String(report.id);
  expect(await dmEvidence(fixture.db, "staff", slug, rid)).toMatchObject({ subjectId: "alice", reportedMessageId: betweenMembers.message!.id });
  expect((await dmDecide(fixture.db, "staff", slug, rid, { decision: "action", moderation: { action: "warn", reason: "Synthetic reviewer warning" } })).outcome).toBe("ok");
  expect((await fixture.admin.query("select issued_by from community_warnings where user_id='alice' and reason='Synthetic reviewer warning'")).rows)
    .toEqual([{ issued_by: "staff" }]);
});

it("keeps a useful poll validator after physical deletion of the newest tombstone", async () => {
  const first = await start("owner", "alice");
  const cid = first.conversationId!;
  const latest = await send("alice", cid, "To be purged");
  await invoke("alice", "delete_message", [latest.message!.id]);
  await fixture.admin.query("update community_dm_messages set purge_after=now()-interval '1 day' where id=$1", [latest.message!.id]);
  await fixture.workerPool.query("select public.community_chat_purge_dm(25)");
  const initial = await dmMessages(fixture.db, "owner", slug, cid, new URLSearchParams(), null);
  expect(initial).toMatchObject({ cursor: "1" });
  expect(await dmMessages(fixture.db, "owner", slug, cid, new URLSearchParams("since=1"), String(initial.etag)))
    .toMatchObject({ notModified: true });
});

it("keeps an older host-started thread discoverable on the next list page", async () => {
  const older = await start("owner", "alice");
  await fixture.admin.query(`with inserted as (
    insert into community_dm_conversations (tenant_id, community_id, pair_key, origin, last_message_at)
    select $1,$2,md5('pagination-fixture-' || n),'member',now()+n*interval '1 second'
    from generate_series(1,100) n returning tenant_id,community_id,id
  ) insert into community_dm_participants(tenant_id,community_id,conversation_id,user_id)
    select tenant_id,community_id,id,user_id from inserted cross join (values ('alice'),('bob')) people(user_id)`, [tenant, club]);
  const first = await dmList(fixture.db, "alice", slug);
  expect(first.items).toHaveLength(100);
  const next = first.next as { at: string; id: string };
  const second = await dmList(fixture.db, "alice", slug, new URLSearchParams({ beforeAt: next.at, beforeId: next.id }));
  expect(second.items).toEqual([expect.objectContaining({ id: older.conversationId })]);
  expect(second.next).toBeNull();
});
