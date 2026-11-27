import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { seedYourData, ydPeople, ydSlug } from "../helpers/your-data-seed";
import { users } from "../../src/db/schema";
import { deleteMyAccount, signInIsFresh, soleOwnerMinistries } from "../../src/server/account-deletion";
import { dmList } from "../../src/server/community-dm";
import { getPost, listPosts } from "../../src/server/community-forum";
import { leaveCommunity } from "../../src/server/community-joining";
import { withUser } from "../../src/server/tenancy";
import { OfficeProviderError } from "../../src/server/office-provider/types";
import { createWorkspace } from "../../src/server/workspaces";

// "Your data" (27 Nov), part 2: account deletion and "Former member" on leaving (policy pack §7, §11). Migrations run as a non-superuser owner,
// so every owner policy the definers rely on is exercised under FORCE RLS.
let f: Awaited<ReturnType<typeof testDatabase>>, seed: Awaited<ReturnType<typeof seedYourData>>;
const { owner, me, peer, outsider } = ydPeople;
const now = new Date("2026-11-27T10:00:00Z"), fresh = new Date("2026-11-27T09:50:00Z"), stale = new Date("2026-11-27T09:40:00Z");
const removedKeys: string[] = [];
const deleter = { async deleteObject(key: string) { removedKeys.push(key); } };
// A synthetic mail and calendar provider: it records revocations and makes no network call.
const revoked: string[] = [];
const office = (fail?: OfficeProviderError["code"]) => ({ credential: { secret: "synthetic-office-credential" }, provider: { id: "fake" as const,
  async disconnect(_credential: unknown, account: { ref: string }) { if (fail) throw new OfficeProviderError(fail); revoked.push(account.ref); } } });
const count = async (query: string, params: unknown[] = []) => (await f.admin.query(query, params)).rows[0].n as number;

beforeAll(async () => {
  vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  f = await testDatabase({ migrationOwner: true });
  seed = await seedYourData(f.db, f.admin);
  await f.admin.query(`insert into sessions(id, token, expires_at, user_id) values ('yd-s1', 'yd-t1', now() + interval '1 day', $1), ('yd-s2', 'yd-t2', now() + interval '1 day', $2)`, [me, peer]);
  await f.admin.query(`insert into accounts(id, account_id, provider_id, user_id, created_at, updated_at) values ('yd-a1', $1, 'email-otp', $1, now(), now())`, [me]);
  await f.admin.query(`insert into user_profiles(user_id, city_region) values ($1, 'Synthetic city')`, [me]);
  // Two personal connections (synthetic provider), with a thread marker that must go with them.
  await f.admin.query(`insert into office_connections(tenant_id, owner_user_id, kind, provider, external_account_ref, platform, profile_ref, health, grants, notice_version)
    values ($1, $2, 'mail', 'fake', 'yd-mail-ref', 'google', 'yd-profile', 'healthy', 1, 1), ($1, $2, 'calendar', 'fake', 'yd-calendar-ref', 'google', 'yd-profile', 'healthy', 2, 1)`, [seed.tenant, me]);
  // A hard-bounce block in the ministry's newsletter: it must survive the deletion (newsletter-sending acceptance).
  await f.admin.query(`insert into newsletter_suppressions(tenant_id, scope, address_hash, key_version, reason, blocked_at) values ($1, '00000000-0000-0000-0000-000000000000', $2, 'v1', 'hard_bounce', now())`, [seed.tenant, "a".repeat(64)]);
}, 120_000);
afterAll(async () => { await f?.close(); vi.unstubAllEnvs(); });

it("requires a sign-in within the last 15 minutes and the typed word", async () => {
  expect(signInIsFresh(fresh, now)).toBe(true);
  expect(signInIsFresh(stale, now)).toBe(false);
  expect(signInIsFresh(null, now)).toBe(false);
  await expect(deleteMyAccount(f.db, me, stale, { confirm: "DELETE" }, deleter, now)).rejects.toMatchObject({ status: 401, details: { code: "REAUTH_REQUIRED" } });
  await expect(deleteMyAccount(f.db, me, fresh, { confirm: "delete" }, deleter, now)).rejects.toMatchObject({ status: 400, details: { code: "CONFIRMATION_REQUIRED" } });
  await expect(deleteMyAccount(f.db, me, fresh, {}, deleter, now)).rejects.toMatchObject({ status: 400 });
  // The database checks the word too.
  expect((await withUser(f.db, me, (tx) => tx.execute<{ v: { outcome: string } }>(sql`select public.account_delete('yes') v`))).rows[0].v.outcome).toBe("invalid");
  expect(await count("select count(*)::int n from users where id = $1 and email = $2", [me, `${me}@example.invalid`])).toBe(1);
});

it("blocks the sole owner of a ministry until someone else is an owner", async () => {
  await f.db.insert(users).values({ id: "yd-solo", name: "Solo", email: "yd-solo@example.invalid", emailVerified: true });
  const solo = (await createWorkspace(f.db, "yd-solo", "Solo Example Ministry", "church")).tenantId;
  expect(await soleOwnerMinistries(f.db, "yd-solo")).toEqual([{ id: solo, name: "Solo Example Ministry" }]);
  expect(await soleOwnerMinistries(f.db, owner)).toEqual([expect.objectContaining({ name: "Grace Example Ministry" })]);
  expect(await soleOwnerMinistries(f.db, me)).toEqual([]);
  await expect(deleteMyAccount(f.db, "yd-solo", fresh, { confirm: "DELETE" }, deleter, now)).rejects.toMatchObject({ status: 409, details: { code: "SOLE_OWNER", ministries: 1 } });
  expect(await count("select count(*)::int n from workspace_members where user_id = 'yd-solo'")).toBe(1);
  await f.admin.query("insert into workspace_members(tenant_id, user_id, role_id) values ($1, $2, 'owner')", [solo, outsider]);
  expect(await soleOwnerMinistries(f.db, "yd-solo")).toEqual([]);
  await expect(deleteMyAccount(f.db, "yd-solo", fresh, { confirm: "DELETE" }, deleter, now)).resolves.toMatchObject({ reference: expect.any(String) });
  // The co-owner keeps the ministry.
  expect(await count("select count(*)::int n from workspace_members where tenant_id = $1 and role_id = 'owner'", [solo])).toBe(1);
});

it("shows a member who left as \"Former member\": posts, replies and chat detached; DMs kept with no name", async () => {
  await expect(leaveCommunity(f.db, peer, ydSlug, {})).resolves.toEqual({ outcome: "left" });
  const posts = (await listPosts(f.db, me, ydSlug)).posts;
  expect(posts.find((post) => post.id === seed.peerPost)).toMatchObject({ authorId: null, authorName: null });
  expect(posts.find((post) => post.id === seed.myPost)).toMatchObject({ authorId: me });
  const mine = await getPost(f.db, me, ydSlug, seed.myPost);
  expect(mine.comments.find((comment) => comment.body === "Peer synthetic reply")).toMatchObject({ authorId: null, authorName: null });
  expect(await count("select count(*)::int n from community_messages where id = $1 and author_id is null and body = 'Peer synthetic chat'", [seed.peerMessage])).toBe(1);
  // DMs stay, still authored (so a later account deletion can delete them), but the other person sees no name: "Former member".
  expect(await count("select count(*)::int n from community_dm_messages where author_id = $1", [peer])).toBe(2);
  const items = (await dmList(f.db, me, ydSlug)).items as { id: string; otherId: string | null; otherName: string | null }[];
  expect(items.find((item) => item.id === seed.conversation)).toMatchObject({ otherName: null });
});

it("revokes mail and calendar connections first, and stops the deletion if any revocation fails", async () => {
  await expect(deleteMyAccount(f.db, me, fresh, { confirm: "DELETE" }, deleter, now, office("TEMPORARY"))).rejects.toMatchObject({ status: 409, details: { code: "OFFICE_DISCONNECT_FAILED" } });
  // No provider configured for these connections: refused too, never left behind.
  await expect(deleteMyAccount(f.db, me, fresh, { confirm: "DELETE" }, deleter, now, null)).rejects.toMatchObject({ details: { code: "OFFICE_DISCONNECT_FAILED" } });
  expect(await count("select count(*)::int n from office_connections where owner_user_id = $1", [me])).toBe(2);
  expect(await count("select count(*)::int n from users where id = $1 and email = $2", [me, `${me}@example.invalid`])).toBe(1);
  expect(revoked).toEqual([]);
});

it("deletes the account: per-table outcomes, chat erasure, kept audit and suppression", async () => {
  const auditBefore = await count("select count(*)::int n from audit_logs where actor_id = $1", [me]);
  const result = await deleteMyAccount(f.db, me, fresh, { confirm: "DELETE" }, deleter, now, office());
  // Both connections were revoked at the provider, then deleted.
  expect(revoked.sort()).toEqual(["yd-calendar-ref", "yd-mail-ref"]);
  expect(await count("select count(*)::int n from office_connections where owner_user_id = $1", [me])).toBe(0);
  expect(result.reference).toMatch(/^[0-9a-f-]{36}$/);
  // The account row stays as a tombstone: no name, photo, language or real address.
  expect((await f.admin.query("select name, email, image, locale, email_verified from users where id = $1", [me])).rows[0])
    .toEqual({ name: "", email: `deleted-${result.reference}@deleted.invalid`, image: null, locale: null, email_verified: false });
  expect(await count("select count(*)::int n from account_deletions where user_id = $1 and reference = $2", [me, result.reference])).toBe(1);
  // Kept, as "Former member": the post, the reply and the chat message, with no author.
  expect((await f.admin.query("select author_id from community_posts where id = $1", [seed.myPost])).rows).toEqual([{ author_id: null }]);
  expect((await f.admin.query("select author_id from community_comments where id = $1", [seed.myReply])).rows).toEqual([{ author_id: null }]);
  expect((await f.admin.query("select author_id from community_messages where id = $1", [seed.myMessage])).rows).toEqual([{ author_id: null }]);
  // Deleted: the person's DMs (the chat-erasure hook); the other person's messages in the conversation stay.
  expect(await count("select count(*)::int n from community_dm_messages where author_id = $1", [me])).toBe(0);
  expect(await count("select count(*)::int n from community_dm_messages where conversation_id = $1 and author_id = $2", [seed.conversation, peer])).toBe(1);
  // Deleted or detached everywhere else; other people's rows are untouched.
  const personal: [string, string][] = [["community_dm_participants", "user_id"], ["community_likes", "user_id"], ["community_message_reactions", "user_id"],
    ["community_memberships", "user_id"], ["community_member_profiles", "user_id"], ["community_exits", "user_id"], ["community_notifications", "recipient_id"],
    ["catalog_progress", "user_id"], ["catalog_notes", "user_id"], ["catalog_enrolments", "user_id"], ["entitlements", "user_id"], ["event_rsvps", "user_id"],
    ["workspace_members", "user_id"], ["user_profiles", "user_id"], ["sessions", "user_id"], ["accounts", "user_id"], ["account_export_requests", "user_id"],
    ["community_dm_conversations", "started_by"], ["community_dm_conversations", "last_sender_id"], ["community_files", "uploader_id"]];
  for (const [table, column] of personal) expect([table, column, await count(`select count(*)::int n from ${table} where ${column} = $1`, [me])]).toEqual([table, column, 0]);
  for (const table of ["catalog_progress", "catalog_notes", "event_rsvps", "sessions"]) expect(await count(`select count(*)::int n from ${table} where user_id = $1`, [peer])).toBe(1);
  // Uploads: the attached file stays with its post; the never-attached upload is gone and its object was handed to the deleter.
  expect((await f.admin.query("select uploader_id from community_files where id = $1", [seed.file])).rows).toEqual([{ uploader_id: null }]);
  expect(await count("select count(*)::int n from community_files where id = $1", [seed.draftFile])).toBe(0);
  expect(removedKeys).toHaveLength(1);
  // Kept: append-only audit logs with the reference, and the newsletter hard-bounce block.
  expect(await count("select count(*)::int n from audit_logs where actor_id = $1", [me])).toBe(auditBefore + 1);
  expect(await count("select count(*)::int n from audit_logs where actor_id = $1 and action = 'account.delete' and target_id = $2 and tenant_id is null", [me, result.reference])).toBe(1);
  expect(await count("select count(*)::int n from newsletter_suppressions where reason = 'hard_bounce' and tenant_id = $1", [seed.tenant])).toBe(1);
  // Another post by the deleted person, read by a remaining member, has no author: the UI shows "Former member".
  expect((await getPost(f.db, outsider, ydSlug, seed.myPost)).post).toMatchObject({ authorId: null, authorName: null });
  // A second attempt finds nothing.
  await expect(deleteMyAccount(f.db, me, fresh, { confirm: "DELETE" }, deleter, now)).rejects.toMatchObject({ status: 404 });
});

it("leaves no flag set and gives the app role no access to the deletion register", async () => {
  await expect(withUser(f.db, peer, (tx) => tx.execute(sql`select * from account_deletions`))).rejects.toThrow();
  const after = await withUser(f.db, peer, async (tx) => {
    await tx.execute(sql`select public.account_delete_blockers()`);
    return (await tx.execute<{ e: string }>(sql`select current_setting('app.account_erase', true) e`)).rows[0].e;
  });
  expect(after).toBe("");
  // A self-set flag opens nothing for the app role.
  await expect(withUser(f.db, peer, async (tx) => {
    await tx.execute(sql`select set_config('app.account_erase', 'on', true)`);
    return tx.execute(sql`delete from community_dm_messages`);
  })).rejects.toThrow();
});

it("cannot be widened by a hand-set erase flag: an owner-role definer sees and changes no detached row", async () => {
  expect(await count("select count(*)::int n from community_posts where author_id is null")).toBeGreaterThan(0);
  expect(await count("select count(*)::int n from account_erase_grants")).toBe(0);
  const owner = f.migrationOwner!;
  // Run as the migration owner (what any SECURITY DEFINER runs as) with flags a harvest_app session could have set by hand, including the
  // reference of a real deletion: nothing opens, because no grant row of this caller exists in this transaction.
  const reference = (await f.admin.query("select reference from account_deletions limit 1")).rows[0].reference as string;
  for (const flag of ["on", reference, "00000000-0000-0000-0000-000000000000"]) {
    await f.admin.query("begin");
    try {
      await f.admin.query(`set local role ${owner}`);
      await f.admin.query("select set_config('app.user_id', $1, true), set_config('app.account_erase', $2, true)", [peer, flag]);
      expect((await f.admin.query("select public.account_erase_active() a")).rows[0].a).toBe(false);
      expect((await f.admin.query("select count(*)::int n from community_posts")).rows[0].n).toBe(0);
      expect((await f.admin.query("update community_posts set title = 'Hijacked' where author_id is null")).rowCount).toBe(0);
      expect((await f.admin.query("delete from community_dm_messages")).rowCount).toBe(0);
      expect((await f.admin.query("delete from workspace_members")).rowCount).toBe(0);
      await expect(f.admin.query("insert into account_erase_grants(token, user_id) values (gen_random_uuid(), $1)", [peer])).rejects.toThrow();
    } finally { await f.admin.query("rollback"); }
  }
  // The same as harvest_app calling a definer: the flag is blanked on entry and the definer only acts on its own token.
  await withUser(f.db, peer, async (tx) => {
    await tx.execute(sql`select set_config('app.account_erase', 'on', true)`);
    await tx.execute(sql`select public.account_delete_blockers()`);
  });
  expect(await count("select count(*)::int n from community_posts where title = 'Hijacked'")).toBe(0);
  expect(await count("select count(*)::int n from account_erase_grants")).toBe(0);
});
