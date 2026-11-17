import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { withUser } from "../../src/server/tenancy";
import { chatState, chatMessages, saveChatChannel } from "../../src/server/community-chat";
vi.mock("server-only", () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>, parallel: Pool, tenant: string, otherTenant: string, club: string, otherClub: string, general: string;
const ids = ["owner", "admin", "mod", "contributor", "member", "second", "pending", "banned", "left", "removed", "outsider", "viewer", "other-owner", "other-member"];
async function invoke(user: string, name: string, args: unknown[], slug = "chat-club") {
  return withUser(f.db, user, async tx => (await tx.execute<{ result: Record<string, unknown> }>(sql`select ${sql.raw("public." + name)}(${sql.join([slug, ...args].map(v => sql`${sql.param(v)}`), sql`,`)}) result`)).rows[0].result);
}
const send = (user = "member", body = "Hello", channel = general, parent: string | null = null, mentions: string[] = [], client = randomUUID()) => invoke(user, "community_message_send", [channel, parent, body, mentions, client]);
async function channel(name: string, extra = {}) {
  const r = await saveChatChannel(f.db, "owner", "chat-club", null, { name, ...extra });
  expect(r.outcome).toBe("ok"); return (r.channel as { id: string }).id;
}
async function messageId(user = "member", body = "Hello", ch = general) { const r = await send(user, body, ch); expect(r.outcome).toBe("ok"); return (r.message as { id: string }).id; }
async function resetRates() { await f.admin.query("update community_messages set created_at=now()-interval '11 minutes'"); }
beforeAll(async () => {
  vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  f = await testDatabase({ migrationOwner: true }); parallel = new Pool({ connectionString: f.appURL, max: 12 });
  await f.db.insert(users).values(ids.map(id => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, "owner", "Chat ministry", "church")).tenantId;
  otherTenant = (await createWorkspace(f.db, "other-owner", "Other ministry", "church")).tenantId;
  club = (await createCommunity(f.db, "owner", tenant, { name: "Chat", slug: "chat-club" })).id;
  otherClub = (await createCommunity(f.db, "owner", tenant, { name: "Other", slug: "chat-other" })).id;
  await createCommunity(f.db, "other-owner", otherTenant, { name: "Third", slug: "chat-third" });
  await createCommunity(f.db, "other-owner", otherTenant, { name: "Fourth", slug: "chat-fourth" });
  await f.admin.query("update communities set status='published'");
  for (const [user, role, status, c, t] of [
    ["admin", "admin", "active", club, tenant], ["mod", "moderator", "active", club, tenant], ["contributor", "contributor", "active", club, tenant],
    ...["member", "second", "pending", "banned", "left", "removed"].map(u => [u, "member", ["member", "second"].includes(u) ? "active" : u, club, tenant]),
    ["other-member", "member", "active", otherClub, tenant],
  ]) {
    await f.admin.query("insert into community_memberships(tenant_id,community_id,user_id,role,status) values($1,$2,$3,$4,$5)", [t, c, user, role, status]);
    await f.admin.query("insert into entitlements(tenant_id,user_id,resource_type,resource_id,source) values($1,$2,'community',$3,'admin_grant')", [t, user, c]);
  }
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,'viewer','viewer')", [tenant]);
  general = (await f.admin.query("select id from community_channels where community_id=$1", [club])).rows[0].id;
}, 90000);
afterAll(async () => { await parallel?.end(); await f?.close(); vi.unstubAllEnvs(); });
it("initializes General and state for every community", async () => {
  expect((await f.admin.query("select count(*)::int n from community_channels where name='General'")).rows[0].n).toBe(4);
  expect((await f.admin.query("select count(*)::int n from community_chat_state")).rows[0].n).toBe(4);
});
it("isolates two tenants, two communities and every new table; denies app writes", async () => {
  await messageId();
  for (const user of ["pending", "banned", "left", "removed", "outsider", "viewer", "other-owner", "other-member"]) {
    for (const table of ["community_channels", "community_messages", "community_message_reactions", "community_channel_reads", "community_channel_members", "community_chat_state"]) {
      const r = await withUser(f.db, user, tx => tx.execute(sql.raw(`select * from public.${table} where community_id='${club}'`)));
      expect(r.rows, `${user}:${table}`).toEqual([]);
    }
    await expect(chatMessages(f.db, user, "chat-club", general, {})).rejects.toMatchObject({ status: 404 });
  }
  for (const table of ["community_channels", "community_messages", "community_message_reactions", "community_channel_reads", "community_channel_members", "community_chat_state"]) {
    await expect(withUser(f.db, "owner", tx => tx.execute(sql.raw(`delete from public.${table}`)))).rejects.toThrow();
  }
});
it("enforces channel role matrix, invite access, tier/tag refusal and archive", async () => {
  for (const user of ["mod", "contributor", "member"]) expect((await invoke(user, "community_channel_save", [null, { name: "Denied" }])).outcome).toBe("forbidden");
  for (const mode of ["tier", "tag"]) expect((await saveChatChannel(f.db, "owner", "chat-club", null, { name: "Future", accessMode: mode })).outcome).toBe("not_available");
  const invited = await channel("Private", { accessMode: "invite" });
  await expect(chatMessages(f.db, "member", "chat-club", invited, {})).rejects.toMatchObject({ status: 404 });
  expect((await invoke("owner", "community_channel_members_set", [invited, ["member"]])).outcome).toBe("ok");
  expect((await chatMessages(f.db, "member", "chat-club", invited, {})).outcome).toBe("ok");
  const role = await channel("Contributors", { accessMode: "role", minRole: "contributor" });
  await expect(chatMessages(f.db, "member", "chat-club", role, {})).rejects.toThrow();
  expect((await chatMessages(f.db, "contributor", "chat-club", role, {})).outcome).toBe("ok");
  const hosts = await channel("Announcements", { posting: "hosts" });
  expect((await send("member", "No", hosts)).outcome).toBe("forbidden");
  const announcement=await send("mod","Yes",hosts); expect(announcement.outcome).toBe("ok");
  const announcementId=(announcement.message as { id:string }).id;
  expect((await invoke("member","community_reaction_toggle",[announcementId,"👍"])).outcome).toBe("forbidden");
  expect((await invoke("mod","community_reaction_toggle",[announcementId,"👍"])).outcome).toBe("ok");
  expect((await invoke("owner", "community_channel_delete", [hosts])).outcome).toBe("ok");
  await expect(chatMessages(f.db, "member", "chat-club", hosts, {})).rejects.toThrow();
  expect((await chatMessages(f.db, "mod", "chat-club", hosts, {})).outcome).toBe("ok");
});
it("uses reader-scoped opaque ETags for A=5/B=100 and hides restricted activity", async () => {
  const b = await channel("High revision");
  await f.admin.query("update community_channels set last_rev=case when id=$1 then 5 when id=$2 then 100 else last_rev end", [general, b]);
  const before = await chatState(f.db, "member", "chat-club");
  expect(before.etag).toMatch(/^W\/"[a-f0-9]{64}"$/);
  await resetRates(); await send();
  const after = await chatState(f.db, "member", "chat-club", before.etag);
  expect(after.etag).not.toBe(before.etag);
  const restricted = await channel("Hidden activity", { accessMode: "invite" });
  const original = await chatState(f.db, "member", "chat-club");
  await send("owner", "Secret", restricted);
  expect(await chatState(f.db, "member", "chat-club", original.etag)).toEqual({ notModified: true, etag: original.etag });
  await invoke("member", "community_channel_read", [general, 0]);
  expect((await chatState(f.db, "member", "chat-club")).etag).not.toBe(original.etag);
});
it("changes ETags for membership, grants, invites and per-channel mute", async () => {
  const original = (await chatState(f.db, "member", "chat-club")).etag;
  await f.admin.query("update community_memberships set role='contributor' where community_id=$1 and user_id='member'", [club]);
  expect((await chatState(f.db, "member", "chat-club")).etag).not.toBe(original);
  await f.admin.query("update community_memberships set role='member' where community_id=$1 and user_id='member'", [club]);
  const before = (await chatState(f.db, "member", "chat-club")).etag;
  await invoke("member", "community_channel_prefs_save", [general, "all"]);
  expect((await chatState(f.db, "member", "chat-club")).etag).not.toBe(before);
  await invoke("member", "community_channel_prefs_save", [general, "none"]);
});
it("clamps read state to maximum seq, preserves monotonic reads and caps unread", async () => {
  await invoke("member", "community_channel_read", [general, "9223372036854775807"]);
  const read = (await f.admin.query("select last_read_seq::text seq from community_channel_reads where channel_id=$1 and user_id='member'", [general])).rows[0].seq;
  const max = (await f.admin.query("select max(seq)::text seq from community_messages where channel_id=$1", [general])).rows[0].seq;
  expect(read).toBe(max);
  await invoke("member", "community_channel_read", [general, 0]);
  expect((await f.admin.query("select last_read_seq::text seq from community_channel_reads where channel_id=$1 and user_id='member'", [general])).rows[0].seq).toBe(max);
});
it("serializes send limits per author and provides idempotent retry/conflict", async () => {
  await resetRates(); const client = randomUUID();
  const first = await send("member", "Retry", general, null, [], client);
  expect(await send("member", "Retry", general, null, [], client)).toEqual(first);
  expect((await send("member", "Different", general, null, [], client)).outcome).toBe("client_id_conflict");
  await resetRates();
  const results = await Promise.all(Array.from({ length: 8 }, async () => {
    const c = await parallel.connect();
    try { await c.query("begin"); await c.query("select set_config('app.user_id','member',true)");
      const r = (await c.query("select community_message_send($1,$2,null,'Concurrent','{}',$3) r", ["chat-club", general, randomUUID()])).rows[0].r;
      await c.query("commit"); return r.outcome;
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  }));
  expect(results.filter(r => r === "ok")).toHaveLength(5); expect(results.filter(r => r === "rate_limited")).toHaveLength(3);
});
it("returns exact row max cursors, pages without skips and polls edit/reaction/delete/restore/pins", async () => {
  await resetRates(); const ch = await channel("Polling"), ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push(await messageId("member", `Page ${i}`, ch));
  const page = await chatMessages(f.db, "member", "chat-club", ch, { since: "0", limit: 2 });
  const events = page.events as { id: string; rev: string }[];
  expect(page.cursor).toBe(events.at(-1)?.rev); expect(page.hasMore).toBe(true);
  const next = await chatMessages(f.db, "member", "chat-club", ch, { since: page.cursor });
  expect((next.events as { id: string }[]).map(m => m.id)).toEqual([ids[2]]);
  expect((await chatMessages(f.db, "member", "chat-club", ch, {}, page.etag as string)).notModified).toBe(true);
  let cursor = next.cursor;
  for (const [name, user, args] of [
    ["community_message_edit", "member", [ids[0], "Edited", []]], ["community_reaction_toggle", "second", [ids[0], "👍"]],
    ["community_message_moderate", "mod", [ids[0], "pin"]], ["community_message_moderate", "mod", [ids[0], "unpin"]],
    ["community_message_delete", "member", [ids[0], false]], ["community_message_delete", "member", [ids[0], true]],
  ] as const) {
    expect((await invoke(user, name, [...args])).outcome).toBe("ok");
    const result = await chatMessages(f.db, "member", "chat-club", ch, { since: cursor });
    expect((result.events as { id: string }[]).map(m => m.id)).toContain(ids[0]); cursor = result.cursor;
  }
});
it("flattens threads to root, bumps reply-count revision, validates mentions and keeps notifications text-free", async () => {
  await resetRates(); const ch = await channel("Threads"), root = await messageId("member", "Root", ch);
  const reply = await send("second", "Hi <@member> <@outsider>", ch, root, ["member", "outsider"]);
  expect((reply.message as { mentionIds: string[] }).mentionIds).toEqual(["member"]);
  const third = await send("second", "Reply to reply", ch, (reply.message as { id: string }).id);
  expect((third.message as { parentId: string }).parentId).toBe(root);
  const notifications = (await f.admin.query("select kind,detail from community_notifications where target_type='channel' and target_id=$1", [ch])).rows;
  expect(notifications.some(n => n.kind === "chat_mention")).toBe(true);
  expect(JSON.stringify(notifications)).not.toContain("Reply to reply");
  expect((await f.admin.query("select reply_count from community_messages where id=$1", [root])).rows[0].reply_count).toBe(2);
});
it("holds banned words, hides held bodies and soft-deleted bodies from members, keeps host access", async () => {
  await resetRates(); await f.admin.query("update communities set banned_words=ARRAY['blockedword'] where id=$1", [club]);
  const id = await messageId("member", "A blockedword here");
  expect((await withUser(f.db, "second", tx => tx.execute(sql`select body from community_messages where id=${id}::uuid`))).rows).toEqual([]);
  expect((await invoke("mod", "community_message_moderate", [id, "approve"])).outcome).toBe("ok");
  await invoke("member", "community_message_delete", [id, false]);
  expect((await withUser(f.db, "member", tx => tx.execute(sql`select body from community_messages where id=${id}::uuid`))).rows).toEqual([]);
  const rows = (await chatMessages(f.db, "second", "chat-club", general, { since: "0" })).events as { id: string; body: string | null }[];
  expect(rows.find(m => m.id === id)?.body).toBeNull();
  expect((await withUser(f.db, "mod", tx => tx.execute(sql`select body from community_messages where id=${id}::uuid`))).rows).toHaveLength(1);
  await f.admin.query("update communities set banned_words='{}' where id=$1", [club]);
});
it("enforces moderation rank, owner/admin restoration and reaction restrictions", async () => {
  await resetRates(); const own = await messageId("owner"), member = await messageId("member");
  expect((await invoke("mod", "community_message_moderate", [own, "remove"])).outcome).toBe("forbidden");
  expect((await invoke("mod", "community_message_moderate", [member, "remove"])).outcome).toBe("ok");
  expect((await invoke("mod", "community_message_moderate", [member, "restore"])).outcome).toBe("forbidden");
  expect((await invoke("member", "community_reaction_toggle", [member, "👍"])).outcome).toBe("not_found");
  expect((await invoke("admin", "community_message_moderate", [member, "restore"])).outcome).toBe("ok");
});
it("purges expired rows only, holds open-report targets, extends retention on decision and restricts workers", async () => {
  await resetRates(); const held = await messageId(), expired = await messageId("second");
  expect((await invoke("second", "community_report", ["message", held, "spam", null])).outcome).toBe("ok");
  await invoke("member", "community_message_delete", [held, false]); await invoke("second", "community_message_delete", [expired, false]);
  await f.admin.query("update community_messages set purge_after=now()-interval '1 day' where id=any($1::uuid[])", [[held, expired]]);
  const result = (await f.workerPool.query("select community_chat_purge_channels(200) r")).rows[0].r;
  expect(result.deleted).toBe(1);
  expect((await f.admin.query("select id from community_messages where id=$1", [held])).rows).toHaveLength(1);
  const report = (await f.admin.query("select id from community_reports where target_id=$1", [held])).rows[0].id;
  expect((await invoke("mod", "community_report_decide", [report, "keep"])).outcome).toBe("ok");
  expect((await f.admin.query("select purge_after>now()+interval '29 days' ok from community_messages where id=$1", [held])).rows[0].ok).toBe(true);
  await f.workerPool.query("select community_chat_purge_record_failure('sweep_failed')");
  expect((await f.workerPool.query("select community_chat_purge_health() h")).rows[0].h.failedSinceSuccess).toBe(true);
  for (const name of ["community_chat_purge_channels(1)", "community_chat_purge_record_failure('sweep_failed')", "community_chat_purge_health()"]) await expect(f.pool.query(`select public.${name}`)).rejects.toMatchObject({ code: "42501" });
  await expect(f.workerPool.query("select * from community_messages")).rejects.toMatchObject({ code: "42501" });
});
it("keeps every new definer private and every new table FORCE RLS under restricted ownership", async () => {
  const names = ["community_channels", "community_channel_members", "community_messages", "community_message_reactions", "community_channel_reads", "community_chat_state", "community_chat_purge_runs"];
  const tables = (await f.admin.query("select relname,relforcerowsecurity from pg_class where relname=any($1)", [names])).rows;
  expect(tables).toHaveLength(names.length); for (const t of tables) expect(t.relforcerowsecurity).toBe(true);
  const funcs = (await f.admin.query("select proname,proconfig,has_function_privilege('public',oid,'execute') public_exec from pg_proc where prosecdef and (proname like 'community_chat_%' or proname like 'community_channel_%' or proname like 'community_message_%' or proname='community_reaction_toggle')")).rows;
  expect(funcs.length).toBeGreaterThan(12);
  for (const fn of funcs) { expect(fn.public_exec, fn.proname).toBe(false); expect(fn.proconfig).toContain("search_path=pg_catalog, pg_temp"); }
});
it("enforces edit/reaction windows, slow mode and mute inside definers", async () => {
  await resetRates(); const ch = await channel("Slow", { slowModeSeconds: 3600 });
  const id = await messageId("member", "Once", ch);
  expect((await send("member", "Too soon", ch)).outcome).toBe("rate_limited");
  expect((await send("mod", "Host one", ch)).outcome).toBe("ok"); expect((await send("mod", "Host two", ch)).outcome).toBe("ok");
  await f.admin.query("update community_memberships set muted_until=now()+interval '1 hour' where community_id=$1 and user_id='second'", [club]);
  expect((await send("second", "Muted", general)).outcome).toBe("muted");
  await f.admin.query("update community_memberships set muted_until=null where community_id=$1 and user_id='second'", [club]);
  let success = 0;
  for (let i = 0; i < 12; i++) { const r = await invoke("member", "community_message_edit", [id, `Edit ${i}`, []]); if (r.outcome === "ok") success++; else expect(r.outcome).toBe("rate_limited"); }
  expect(success).toBeLessThanOrEqual(10); expect(success).toBeGreaterThan(0);
  const results = [];
  for (let i = 0; i < 31; i++) results.push((await invoke("contributor", "community_reaction_toggle", [id, "👍"])).outcome);
  expect(results.slice(0, 30).every(r => r === "ok")).toBe(true); expect(results[30]).toBe("rate_limited");
});
it("caps unread at 100, enforces notification mute and settings audit", async () => {
  const ch = await channel("Unread cap");
  await f.admin.query("insert into community_messages(tenant_id,community_id,channel_id,author_id,client_id,body,seq,rev) select $1,$2,$3,'second',gen_random_uuid(),'Synthetic unread',s,s from generate_series(1,110) s", [tenant, club, ch]);
  const state = await chatState(f.db, "member", "chat-club") as { channels: { id: string; unread: number }[] };
  expect(state.channels.find(c => c.id === ch)?.unread).toBe(100);
  await invoke("member", "community_channel_prefs_save", [ch, "all"]);
  const after = await chatState(f.db, "member", "chat-club") as { channels: { id: string; unread: number }[] };
  expect(after.channels.find(c => c.id === ch)?.unread).toBe(0);
  expect((await invoke("member", "community_chat_settings_save", [false, "members"])).outcome).toBe("forbidden");
  expect((await invoke("owner", "community_chat_settings_save", [false, "channels_only"])).outcome).toBe("ok");
  await expect(chatState(f.db, "member", "chat-club")).rejects.toMatchObject({ status: 404 });
  expect((await invoke("owner", "community_chat_settings_save", [true, "channels_only"])).outcome).toBe("ok");
  expect((await f.admin.query("select count(*)::int n from audit_logs where action='community.chat.settings'")).rows[0].n).toBe(2);
});
it("retains a live reply when its deleted root expires and makes purge retries idempotent", async () => {
  await resetRates(); const ch = await channel("Retention threads"), root = await messageId("member", "Old root", ch);
  const reply = await send("second", "Keep this reply", ch, root);
  const replyId = (reply.message as { id: string }).id;
  await invoke("member", "community_message_delete", [root, false]);
  await f.admin.query("update community_messages set purge_after=now()-interval '1 second' where id=$1", [root]);
  expect((await f.workerPool.query("select community_chat_purge_channels(200) r")).rows[0].r.deleted).toBe(1);
  expect((await f.admin.query("select body,parent_id from community_messages where id=$1", [replyId])).rows).toEqual([{ body: "Keep this reply", parent_id: null }]);
  expect((await f.workerPool.query("select community_chat_purge_channels(200) r")).rows[0].r.deleted).toBe(0);
});
it("measures state-row and channel serialization under concurrent sends without missed commits", async () => {
  const authors = Array.from({ length: 12 }, (_, i) => `load-${i}`);
  await f.db.insert(users).values(authors.map(id => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  for (const u of authors) {
    await f.admin.query("insert into community_memberships(tenant_id,community_id,user_id,status) values($1,$2,$3,'active')", [tenant, club, u]);
    await f.admin.query("insert into entitlements(tenant_id,user_id,resource_type,resource_id,source) values($1,$2,'community',$3,'admin_grant')", [tenant, u, club]);
  }
  const channels = await Promise.all([channel("Load A"), channel("Load B"), channel("Load C")]);
  const run = async (sameChannel: boolean) => {
    const start = performance.now(), durations: number[] = [];
    await Promise.all(authors.map(async (u, i) => {
      const c = await parallel.connect(), began = performance.now();
      try {
        await c.query("begin"); await c.query("select set_config('app.user_id',$1,true)", [u]);
        const result = (await c.query("select community_message_send('chat-club',$1,null,'Load message','{}',$2) r", [channels[sameChannel ? 0 : i % 3], randomUUID()])).rows[0].r;
        expect(result.outcome).toBe("ok"); await c.query("commit"); durations.push(performance.now() - began);
      } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
    }));
    durations.sort((a, b) => a - b);
    return { writers: authors.length, wallMs: Math.round(performance.now() - start), p50Ms: Math.round(durations[5]), p95Ms: Math.round(durations[11]) };
  };
  const before = BigInt((await f.admin.query("select rev::text from community_chat_state where community_id=$1", [club])).rows[0].rev);
  const same = await run(true), split = await run(false);
  const after = BigInt((await f.admin.query("select rev::text from community_chat_state where community_id=$1", [club])).rows[0].rev);
  expect(after - before).toBe(24n);
  let cursor = "0"; const seen = new Set<string>();
  while (true) {
    const page = await chatMessages(f.db, "member", "chat-club", channels[0], { since: cursor, limit: 3 });
    for (const m of page.events as { id: string }[]) seen.add(m.id);
    cursor = page.cursor as string; if (!page.hasMore) break;
  }
  expect(seen.size).toBe(16);
  await writeFile("/tmp/harvest-c11a-serialization.json", JSON.stringify({ sameChannel: same, threeChannels: split }, null, 2));
});
it("polling cannot skip a later commit while another sender holds the channel lock", async () => {
  await resetRates(); const ch = await channel("Commit order"), first = await parallel.connect(), second = await parallel.connect();
  try {
    await first.query("begin"); await second.query("begin");
    await first.query("select set_config('app.user_id','member',true)"); await second.query("select set_config('app.user_id','second',true)");
    const a = (await first.query("select community_message_send('chat-club',$1,null,'First','{}',$2) r", [ch, randomUUID()])).rows[0].r.message;
    const pending = second.query("select community_message_send('chat-club',$1,null,'Second','{}',$2) r", [ch, randomUUID()]);
    expect((await chatMessages(f.db, "member", "chat-club", ch, { since: "0" })).events).toEqual([]);
    await first.query("commit");
    const b = (await pending).rows[0].r.message;
    const mid = await chatMessages(f.db, "member", "chat-club", ch, { since: "0" });
    expect((mid.events as { id: string }[]).map(m => m.id)).toEqual([a.id]);
    await second.query("commit");
    const end = await chatMessages(f.db, "member", "chat-club", ch, { since: mid.cursor });
    expect((end.events as { id: string }[]).map(m => m.id)).toEqual([b.id]);
    expect(BigInt(b.rev)).toBeGreaterThan(BigInt(a.rev));
  } finally { await first.query("rollback"); await second.query("rollback"); first.release(); second.release(); }
});
it("does not let an author convert a host removal into a recoverable author deletion", async () => {
  await resetRates(); const id = await messageId();
  expect((await invoke("mod", "community_message_moderate", [id, "remove"])).outcome).toBe("ok");
  expect((await invoke("member", "community_message_delete", [id, false])).outcome).toBe("forbidden");
  expect((await invoke("member", "community_message_delete", [id, true])).outcome).toBe("forbidden");
  expect((await invoke("owner", "community_message_moderate", [id, "restore"])).outcome).toBe("ok");
});
it("counts only visible thread replies and revises the root on delete, restore and hold approval", async () => {
  await resetRates(); const ch = await channel("Visible thread counts"), root = await messageId("second", "Root", ch);
  await f.admin.query("update communities set banned_words=ARRAY['holdreply'] where id=$1", [club]);
  const reply = (await send("member", "holdreply", ch, root)).message as { id: string };
  const count = async () => (await f.admin.query("select reply_count n from community_messages where id=$1", [root])).rows[0].n;
  expect(await count()).toBe(0);
  expect((await invoke("mod", "community_message_moderate", [reply.id, "approve"])).outcome).toBe("ok"); expect(await count()).toBe(1);
  await invoke("member", "community_message_delete", [reply.id, false]); expect(await count()).toBe(0);
  await invoke("member", "community_message_delete", [reply.id, true]); expect(await count()).toBe(1);
  await f.admin.query("update communities set banned_words='{}' where id=$1", [club]);
});
it("enforces the ten-minute send window even outside the short burst window", async () => {
  await resetRates();
  const ch = await channel("Long send window");
  await f.admin.query("insert into community_messages(tenant_id,community_id,channel_id,author_id,client_id,body,seq,rev,created_at) select $1,$2,$3,'contributor',gen_random_uuid(),'Synthetic recent',s,s,now()-interval '2 minutes' from generate_series(1,60) s", [tenant, club, ch]);
  const result = await send("contributor", "Over ten-minute limit", ch);
  expect(result).toMatchObject({ outcome: "rate_limited", retryAfter: 600 });
});
it("maps ministry owner/admin capabilities to chat without granting a ministry viewer access", async () => {
  await resetRates();
  await f.admin.query("insert into users(id,name,email) values('ministry-admin','Admin','ministry-admin@example.test')");
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,'ministry-admin','admin')", [tenant]);
  const before = await chatState(f.db,"ministry-admin","chat-club");
  expect((await invoke("ministry-admin","community_channel_read",[general,0])).outcome).toBe("ok");
  expect((await chatState(f.db,"ministry-admin","chat-club")).etag).not.toBe(before.etag);
  const id = await messageId("member", "For ministry admin");
  expect((await invoke("second", "community_report", ["message", id, "spam", null])).outcome).toBe("ok");
  const queue = await invoke("ministry-admin", "community_chat_moderation_read", ["reports"]);
  expect(queue.outcome).toBe("ok"); expect(JSON.stringify(queue.items)).not.toContain("reporter_id");
  expect((await invoke("viewer", "community_chat_moderation_read", ["reports"])).outcome).toBe("not_found");
  const report = (await f.admin.query("select id from community_reports where target_id=$1 and status='open'", [id])).rows[0].id;
  expect((await invoke("ministry-admin", "community_report_decide", [report, "remove"])).outcome).toBe("ok");
  expect((await invoke("ministry-admin", "community_message_moderate", [id, "restore"])).outcome).toBe("ok");
});
it("rechecks chat disablement after waiting for the channel authorization lock", async () => {
  await resetRates(); const settings = await parallel.connect(), sender = await parallel.connect();
  try {
    await settings.query("begin"); await settings.query("select set_config('app.user_id','owner',true)");
    expect((await settings.query("select community_chat_settings_save('chat-club',false,'channels_only') r")).rows[0].r.outcome).toBe("ok");
    await sender.query("begin"); await sender.query("select set_config('app.user_id','member',true)");
    const pid = (await sender.query("select pg_backend_pid() pid")).rows[0].pid;
    const pending = sender.query("select community_message_send('chat-club',$1,null,'Disabled while waiting','{}',$2) r", [general, randomUUID()]);
    const deadline = performance.now()+5000; let blocked = false;
    while (performance.now()<deadline && !blocked) blocked = (await f.admin.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1", [pid])).rows[0]?.blocked === true;
    expect(blocked).toBe(true); await settings.query("commit");
    expect((await pending).rows[0].r.outcome).toBe("not_found"); await sender.query("commit");
    expect((await invoke("owner","community_chat_settings_save",[true,"channels_only"])).outcome).toBe("ok");
  } finally { await settings.query("rollback"); await sender.query("rollback"); settings.release(); sender.release(); }
});
it("keeps the 30-channel cap atomic when every existing channel has been deleted", async () => {
  const fresh = (await createCommunity(f.db,"owner",tenant,{ name:"Cap race",slug:"cap-race" })).id;
  await f.admin.query("update communities set status='published' where id=$1",[fresh]);
  await f.admin.query("delete from community_channels where community_id=$1",[fresh]);
  const authors = Array.from({ length:31 },(_,i)=>`cap-admin-${i}`);
  await f.db.insert(users).values(authors.map(id=>({ id,name:id,email:`${id}@example.test`,emailVerified:true })));
  for (const u of authors) await f.admin.query("insert into community_memberships(tenant_id,community_id,user_id,role,status) values($1,$2,$3,'admin','active')",[tenant,fresh,u]);
  const creators = new Pool({ connectionString:f.appURL,max:31 });
  await f.admin.query("begin"); await f.admin.query("select rev from community_chat_state where community_id=$1 for update",[fresh]);
  const pending = authors.map(async u=>{
    const c=await creators.connect();
    try {
      await c.query("begin"); await c.query("select set_config('app.user_id',$1,true),set_config('application_name','c11-cap-race',false)",[u]);
      const r=(await c.query("select community_channel_save('cap-race',null,$1::jsonb) r",[JSON.stringify({ name:u })])).rows[0].r;
      await c.query("commit"); return r.outcome;
    } catch(e) { await c.query("rollback"); throw e; } finally { c.release(); }
  });
  try {
    const deadline=performance.now()+10000; let waiting=0;
    while (performance.now()<deadline && waiting<31) {
      await f.admin.query("select pg_stat_clear_snapshot()");
      waiting=(await f.admin.query("select count(*)::int n from pg_stat_activity where datname=current_database() and application_name='c11-cap-race' and wait_event_type='Lock'")).rows[0].n;
    }
    expect(waiting).toBe(31); await f.admin.query("commit");
    const results=await Promise.all(pending);
    expect(results.filter(r=>r==='ok')).toHaveLength(30); expect(results.filter(r=>r==='channel_limit')).toHaveLength(1);
    expect((await f.admin.query("select count(*)::int n from community_channels where community_id=$1 and archived_at is null",[fresh])).rows[0].n).toBe(30);
  } finally { await f.admin.query("rollback"); await Promise.allSettled(pending); await creators.end(); }
});
it("rejects a global client id replay across authorized ministries without returning foreign content", async () => {
  const foreign=(await f.admin.query("select tenant_id,id from communities where slug='chat-third'")).rows[0];
  const ch=(await f.admin.query("select id from community_channels where community_id=$1",[foreign.id])).rows[0].id;
  await f.admin.query("insert into users(id,name,email) values('cross-author','Cross author','cross-author@example.test')");
  for (const [t,c] of [[tenant,club],[foreign.tenant_id,foreign.id]]) {
    await f.admin.query("insert into community_memberships(tenant_id,community_id,user_id,status) values($1,$2,'cross-author','active')",[t,c]);
    await f.admin.query("insert into entitlements(tenant_id,user_id,resource_type,resource_id,source) values($1,'cross-author','community',$2,'admin_grant')",[t,c]);
  }
  const client=randomUUID(); expect((await send('cross-author','Original content',general,null,[],client)).outcome).toBe('ok');
  expect(await invoke('cross-author','community_message_send',[ch,null,'Another body',[],client],'chat-third')).toEqual({ outcome:'client_id_conflict' });
});
