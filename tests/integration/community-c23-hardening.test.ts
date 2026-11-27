import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/server/auth-instance", () => ({ getAuth: vi.fn() }));
import { randomUUID } from "node:crypto";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, getCommunity, listCategories, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity } from "../../src/server/community-joining";
import { saveComment, savePost } from "../../src/server/community-forum";
import { reportContent } from "../../src/server/community-moderation";
import { errorResponse } from "../../src/server/http";

// C23 release gate, database half: catalog loops over every community and Discover table and function, so a future table
// without FORCE RLS, a definer without a pinned search_path, or a new definer that skips the app.* reset fails here.
// The static half (logs, audit metadata, route wrappers) is tests/unit/community-c23-hardening.test.ts.
let f: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { f = await testDatabase(); });
afterAll(async () => { await f?.close(); });

const communityTables = `select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and (c.relname ~ '^(communit|discover_)'
    or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'community_id' and not a.attisdropped))`;
const communityFunctions = `select p.oid, p.oid::regprocedure::text as sig, p.proname, p.prosecdef, p.proconfig, p.prosrc,
    p.prorettype = 'trigger'::regtype as is_trigger, pg_get_userbyid(p.proowner) as owner,
    has_function_privilege('public', p.oid, 'execute') as public_exec,
    has_function_privilege('harvest_app', p.oid, 'execute') as app_exec, has_function_privilege('harvest_worker', p.oid, 'execute') as worker_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`;
type Fn = { sig: string; proname: string; prosecdef: boolean; proconfig: string[] | null; prosrc: string; is_trigger: boolean; owner: string; public_exec: boolean; app_exec: boolean; worker_exec: boolean };
const isCommunity = (name: string) => /communit|^discover_|^dm_|^chat_/.test(name);

// Application privileges per table (S select, I insert, U update, D delete). A change here is a reviewed decision.
const appGrants: Record<string, string> = {
  communities: "SIU", community_appeals: "S", community_applications: "SIU", community_categories: "SIUD", community_channel_members: "S",
  community_channel_reads: "S", community_channels: "S", community_chat_purge_runs: "", community_chat_state: "S", community_comment_revisions: "S",
  community_comments: "SIU", community_daily_counts: "S", community_dm_blocks: "S", community_dm_conversations: "S", community_dm_messages: "S",
  community_dm_participants: "S", community_dm_report_evidence: "", community_email_deliveries: "", community_event_links: "", community_exits: "S",
  community_files: "SIU", community_invites: "SIU", community_likes: "SIU", community_live_events: "S", community_member_profiles: "",
  community_memberships: "SIU", community_message_reactions: "S", community_messages: "S", community_moderation_actions: "S",
  community_notifications: "SI", community_post_revisions: "S", community_posts: "SIU", community_product_links: "SIUD", community_reports: "S",
  community_warnings: "S", discover_controls: "SIU", discover_listings: "SIUD", discover_ministry_standing: "", discover_reports: "", discover_review_events: "",
};

// Reviewed definers that do not clear every app.* flag on entry. Each sets only its own single-purpose flag, keys every read on
// the explicit tenant, community and caller it is given, and restores or blanks its flag before it returns.
const scopedFlagDefiners: Record<string, string> = {
  community_channel_can_read: "app.community_definer_tenant", community_dm_notice_allowed: "app.community_definer_tenant",
  community_dm_participant_allowed: "app.community_definer_tenant", community_chat_purge_channels: "app.chat_purge",
  community_chat_purge_health: "app.chat_purge", community_chat_purge_record_failure: "app.chat_purge", discover_platform_reports: "app.discover_platform",
  discover_platform_resolve_report: "app.discover_platform", community_exit_record: "app.community_stats_write",
  // Trigger functions with no application EXECUTE: they scope to NEW.tenant_id and restore the previous value.
  community_chat_grant_revision: "app.community_definer_tenant", community_chat_initialize: "app.community_definer_tenant",
  community_chat_settings_revision: "app.community_definer_tenant",
};

// Worker-only definers (harvest_worker, 0044 and later). A new one is a reviewed decision.
const workerDefiners = ["community_chat_purge_channels", "community_chat_purge_dm", "community_chat_purge_health", "community_chat_purge_record_failure",
  "community_email_claim", "community_email_complete", "community_email_enqueue", "community_purge_applications", "community_purge_notifications",
  "discover_platform_decide", "discover_platform_queue", "discover_platform_reports", "discover_platform_resolve_report", "discover_platform_standing"];

describe("catalog", () => {
  it("forces row-level security on every community and Discover table, with policies and the reviewed grants", async () => {
    const { rows } = await f.admin.query(`select t.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force, pg_get_userbyid(c.relowner) as owner,
      (select count(*)::int from pg_policy p where p.polrelid = t.oid) as policies,
      concat(case when has_table_privilege('harvest_app', t.oid, 'SELECT') then 'S' end, case when has_table_privilege('harvest_app', t.oid, 'INSERT') then 'I' end,
        case when has_table_privilege('harvest_app', t.oid, 'UPDATE') then 'U' end, case when has_table_privilege('harvest_app', t.oid, 'DELETE') then 'D' end) as app,
      has_table_privilege('harvest_app', t.oid, 'TRUNCATE') or has_table_privilege('harvest_app', t.oid, 'REFERENCES') or has_table_privilege('harvest_app', t.oid, 'TRIGGER') as app_extra,
      has_table_privilege('harvest_worker', t.oid, 'SELECT') or has_table_privilege('harvest_worker', t.oid, 'INSERT') or has_table_privilege('harvest_worker', t.oid, 'UPDATE') or has_table_privilege('harvest_worker', t.oid, 'DELETE') as worker_any,
      exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0) as public_any
      from (${communityTables}) t join pg_class c on c.oid = t.oid order by 1`);
    expect(rows.length).toBeGreaterThanOrEqual(40);
    const problems = rows.flatMap((r) => [
      !r.rls && `${r.relname}: RLS off`, !r.force && `${r.relname}: FORCE RLS off`, r.policies === 0 && `${r.relname}: no policy`,
      r.owner === "harvest_app" && `${r.relname}: owned by the app`, r.app_extra && `${r.relname}: app has TRUNCATE/REFERENCES/TRIGGER`,
      r.worker_any && `${r.relname}: worker has table privileges`, r.public_any && `${r.relname}: PUBLIC has privileges`,
      appGrants[r.relname] === undefined ? `${r.relname}: not in the reviewed grant list` : appGrants[r.relname] !== r.app && `${r.relname}: app grants ${r.app}, reviewed ${appGrants[r.relname]}`,
    ]).filter(Boolean);
    expect(problems).toEqual([]);
    expect(Object.keys(appGrants).filter((name) => !rows.some((r) => r.relname === name))).toEqual([]);
  });

  it("pins search_path on every community function and keeps definers off PUBLIC", async () => {
    const fns = (await f.admin.query<Fn>(communityFunctions)).rows.filter((fn) => isCommunity(fn.proname));
    expect(fns.filter((fn) => fn.prosecdef).length).toBeGreaterThanOrEqual(100);
    const problems = fns.flatMap((fn) => [
      !(fn.proconfig ?? []).includes("search_path=pg_catalog, pg_temp") && `${fn.sig}: search_path not pinned to pg_catalog, pg_temp`,
      fn.prosecdef && fn.public_exec && `${fn.sig}: PUBLIC may execute a definer`,
      fn.prosecdef && fn.owner === "harvest_app" && `${fn.sig}: definer owned by the app`,
      fn.public_exec && !fn.is_trigger && `${fn.sig}: PUBLIC may execute`,
      fn.prosecdef && fn.worker_exec && !workerDefiners.includes(fn.proname) && `${fn.sig}: worker may execute an unreviewed definer`,
      fn.prosecdef && fn.worker_exec && fn.app_exec && `${fn.sig}: both app and worker may execute`,
    ]).filter(Boolean);
    expect(problems).toEqual([]);
  });

  it("clears the app.* flags on entry to every community definer, through the reset helpers or a reviewed single flag", async () => {
    const all = (await f.admin.query<Fn>(communityFunctions)).rows;
    const byName = new Map<string, Fn[]>();
    for (const fn of all) byName.set(fn.proname, [...(byName.get(fn.proname) ?? []), fn]);
    const callees = (fn: Fn) => [...new Set([...fn.prosrc.matchAll(/public\.([a-z0-9_]+)\s*\(/g)].map((m) => m[1]).filter((n) => byName.has(n)))];
    // Full reset: community_definer_reset, a *_scope_clear helper, or a loop that blanks an explicit list of app.* flags.
    const direct = (fn: Fn) => /community_definer_reset\(|_scope_clear\(|FOREACH [a-z]+ IN ARRAY ARRAY\['app\./.test(fn.prosrc);
    const memo = new Map<string, boolean>();
    const resets = (name: string, seen = new Set<string>()): boolean => {
      if (memo.has(name)) return memo.get(name)!;
      if (seen.has(name)) return false;
      seen.add(name);
      const value = (byName.get(name) ?? []).some((fn) => direct(fn) || callees(fn).some((c) => resets(c, seen)));
      memo.set(name, value);
      return value;
    };
    const definers = all.filter((fn) => fn.prosecdef && isCommunity(fn.proname));
    const unreviewed = definers.filter((fn) => !resets(fn.proname) && scopedFlagDefiners[fn.proname] === undefined).map((fn) => fn.sig);
    expect(unreviewed).toEqual([]);
    // The reviewed exceptions still exist, still set only the flag named, and blank or restore it before returning.
    for (const [name, flag] of Object.entries(scopedFlagDefiners)) {
      const fns = byName.get(name) ?? [];
      expect(fns.length, name).toBeGreaterThan(0);
      for (const fn of fns) {
        expect(fn.prosecdef, name).toBe(true);
        const set = [...fn.prosrc.matchAll(/set_config\(\s*'(app\.[a-z_]+)'/g)].map((m) => m[1]);
        expect(new Set(set), name).toEqual(new Set(flag ? [flag] : []));
        expect(/set_config\(\s*'app\.[a-z_]+'\s*,\s*(coalesce\(previous|'')/.test(fn.prosrc), `${name} blanks or restores its flag`).toBe(true);
        if (fn.is_trigger) expect(fn.app_exec || fn.worker_exec, name).toBe(false);
      }
    }
    // community_definer_reset itself blanks every flag that an owner-role policy on a community table reads (0129 added nine).
    const policyFlags = new Set((await f.admin.query(`select coalesce(qual, '') || coalesce(with_check, '') as expr from pg_policies p
      where p.schemaname = 'public' and not ('harvest_app' = any (p.roles)) and (p.tablename ~ '^(communit|discover_)')`)).rows
      .flatMap((r) => [...(r.expr as string).matchAll(/app\.[a-z_]+/g)].map((m) => m[0])));
    expect(policyFlags.size).toBeGreaterThan(15);
    const reset = byName.get("community_definer_reset")![0].prosrc;
    expect([...policyFlags].filter((flag) => !reset.includes(`'${flag}'`) && flag !== "app.tenant_id" && flag !== "app.user_id").sort()).toEqual([]);
  });

  it("asks public.access_role for workspace roles in every community function and policy", async () => {
    const fns = (await f.admin.query<Fn>(communityFunctions)).rows.filter((fn) => isCommunity(fn.proname));
    expect(fns.filter((fn) => /\brole_id\b/.test(fn.prosrc) && !/access_role\(/.test(fn.prosrc)).map((fn) => fn.sig)).toEqual([]);
    const { rows } = await f.admin.query(`select tablename, policyname, coalesce(qual, '') || coalesce(with_check, '') as expr from pg_policies
      where schemaname = 'public' and tablename ~ '^(communit|discover_)'`);
    expect(rows.filter((r) => /\brole_id\b/.test(r.expr) && !/access_role\(/.test(r.expr)).map((r) => `${r.tablename}.${r.policyname}`)).toEqual([]);
  });

  it("writes no contact details or member text into audit rows from community definers", async () => {
    const fns = (await f.admin.query<Fn>(communityFunctions)).rows.filter((fn) => isCommunity(fn.proname));
    const offenders: string[] = [];
    for (const fn of fns) for (const m of fn.prosrc.matchAll(/INSERT INTO public\.audit_logs[^;]*/gi)) {
      const statement = m[0].replace(/'[^']*'/g, "''");
      if (/email|phone|address|body|note|other_text|answers|\bname\b|display_name|message_text|token/i.test(statement)) offenders.push(`${fn.proname}: ${statement.slice(0, 160)}`);
    }
    expect(offenders).toEqual([]);
  });

  it("never reads Harvest Connect responses, consents or follow-up cases from a community function (PRD edge case 16)", async () => {
    const fns = (await f.admin.query<Fn>(communityFunctions)).rows.filter((fn) => isCommunity(fn.proname));
    const pastoral = /\b(campaign_responses|campaign_response_[a-z_]+|connect_[a-z_]+|response_account_claims|followup_cases|campaign_followup_team|crm_form_responses|fundraising_pledges)\b/;
    expect(fns.filter((fn) => pastoral.test(fn.prosrc)).map((fn) => `${fn.proname}: ${fn.prosrc.match(pastoral)![0]}`)).toEqual([]);
    // Nor does any community policy.
    const { rows } = await f.admin.query(`select tablename, policyname from pg_policies where schemaname = 'public' and tablename ~ '^(communit|discover_)'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(campaign_respon|connect_|followup_cases|crm_form_responses)'`);
    expect(rows).toEqual([]);
  });

  it("indexes the hot queries: forum list, comments, chat and private-message unread, member list, inbox and write limits", async () => {
    const { rows } = await f.admin.query(`select t.relname as tbl, array_agg(a.attname order by k.ord)::text[] as cols
      from pg_index i join pg_class t on t.oid = i.indrelid join pg_namespace n on n.oid = t.relnamespace
      cross join lateral unnest(i.indkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      where n.nspname = 'public' and t.relname ~ '^communit' group by i.indexrelid, t.relname`);
    const has = (table: string, cols: string[]) => rows.some((r) => r.tbl === table && cols.every((c, i) => r.cols[i] === c));
    const required: [string, string[]][] = [
      ["community_posts", ["community_id", "pinned", "created_at"]], ["community_posts", ["community_id", "category_id", "pinned", "created_at"]],
      ["community_comments", ["post_id", "created_at"]], ["community_likes", ["target_type", "target_id", "user_id"]],
      ["community_channel_reads", ["channel_id", "user_id"]], ["community_messages", ["channel_id", "seq"]], ["community_messages", ["parent_id", "seq"]],
      ["community_dm_participants", ["user_id", "community_id", "conversation_id"]], ["community_dm_messages", ["conversation_id", "seq"]],
      ["community_memberships", ["tenant_id", "community_id", "user_id"]], ["community_memberships", ["user_id", "status"]],
      ["community_member_profiles", ["tenant_id", "community_id", "user_id"]],
      ["community_notifications", ["recipient_id", "community_id", "read_at", "created_at"]],
      ["community_applications", ["tenant_id", "community_id", "status", "created_at"]], ["community_reports", ["community_id", "status", "target_type", "target_id"]],
      ["community_posts", ["community_id", "author_id", "created_at"]], ["community_comments", ["community_id", "author_id", "created_at"]],
      ["community_reports", ["community_id", "reporter_id", "created_at"]],
    ];
    expect(required.filter(([table, cols]) => !has(table, cols)).map(([table, cols]) => `${table}(${cols.join(", ")})`)).toEqual([]);
  });

  it("guards forum posts, comments and reports with the write-limit trigger", async () => {
    const { rows } = await f.admin.query(`select c.relname, t.tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname like '%_rate_guard' order by 1`);
    expect(rows.map((r) => [r.relname, r.def.match(/community_write_rate_guard\((.*)\)/)?.[1]])).toEqual([
      ["community_comments", "'author_id', '30'"], ["community_posts", "'author_id', '10'"], ["community_reports", "'reporter_id', '20'"]]);
  });
});

describe("behaviour", () => {
  let tenant: string, club: string, general: string;
  const slug = "c23-hardening";
  const people = ["h-owner", "h-one", "h-two", "h-three"];
  beforeAll(async () => {
    await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
    tenant = (await createWorkspace(f.db, "h-owner", "Hardening Church", "church")).tenantId;
    club = (await createCommunity(f.db, "h-owner", tenant, { name: "Hardening", slug })).id;
    const { version } = await getCommunity(f.db, "h-owner", tenant, club);
    const updated = await updateCommunity(f.db, "h-owner", tenant, club, { version, visibility: "listed", allowOpen: true });
    await publishCommunity(f.db, "h-owner", tenant, club, { version: updated.version, published: true });
    for (const user of ["h-one", "h-two", "h-three"]) await enterCommunity(f.db, user, slug, { rulesVersion: 0, adult: true });
    general = (await listCategories(f.db, "h-owner", tenant, club))[0].id;
  });
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Synthetic" }] }] };
  const post = (user: string, title: string) => savePost(f.db, user, slug, { categoryId: general, title, body: doc });
  const status = async (promise: Promise<unknown>) => { try { await promise; return 200; } catch (error) { return errorResponse(error).status; } };

  it("allows ten new forum posts per person per community in 10 minutes, then answers 429 and keeps nothing", async () => {
    for (let i = 0; i < 10; i++) await post("h-one", `Post ${i}`);
    expect(await status(post("h-one", "One too many"))).toBe(429);
    expect((await f.admin.query("select count(*)::int as n from community_posts where author_id = 'h-one'")).rows[0].n).toBe(10);
    // Another member is unaffected, and edits are not new rows.
    expect(await status(post("h-two", "Different author"))).toBe(200);
    const own = (await f.admin.query("select id from community_posts where author_id = 'h-one' limit 1")).rows[0].id;
    expect(await status(savePost(f.db, "h-one", slug, { categoryId: general, title: "Edited", body: doc }, own))).toBe(200);
    // Once the window passes, posting works again.
    await f.admin.query("update community_posts set created_at = created_at - interval '11 minutes' where author_id = 'h-one'");
    expect(await status(post("h-one", "After the window"))).toBe(200);
  });

  it("allows thirty new replies per person per community in 10 minutes", async () => {
    const target = (await f.admin.query("select id from community_posts where author_id = 'h-two' limit 1")).rows[0].id;
    await f.admin.query(`insert into community_comments (tenant_id, community_id, post_id, author_id, body)
      select $1, $2, $3, 'h-three', 'Seeded ' || g from generate_series(1, 30) g`, [tenant, club, target]);
    expect(await status(saveComment(f.db, "h-three", slug, target, { body: "Thirty-first" }))).toBe(429);
    expect(await status(saveComment(f.db, "h-two", slug, target, { body: "Another member" }))).toBe(200);
  });

  it("allows twenty reports per person per community in 10 minutes", async () => {
    await f.admin.query(`insert into community_reports (tenant_id, community_id, reporter_id, target_type, target_id, reason)
      select $1, $2, 'h-two', 'post', gen_random_uuid()::text, 'spam' from generate_series(1, 20)`, [tenant, club]);
    const target = (await f.admin.query("select id from community_posts where author_id = 'h-one' limit 1")).rows[0].id;
    expect(await status(reportContent(f.db, "h-two", slug, { targetType: "post", targetId: target, reason: "spam" }))).toBe(429);
    expect(await status(reportContent(f.db, "h-three", slug, { targetType: "post", targetId: target, reason: "spam" }))).toBe(200);
  });

  it("counts rows in the same community only, so the same person elsewhere does not use up the limit", async () => {
    // A second ministry's community with the same author id: its rows never count towards this community's limit.
    const other = (await createWorkspace(f.db, "h-three", "Other Church", "church")).tenantId;
    const otherClub = (await createCommunity(f.db, "h-three", other, { name: "Other", slug: "c23-other" })).id;
    const cat = (await listCategories(f.db, "h-three", other, otherClub))[0].id;
    await f.admin.query(`insert into community_posts (tenant_id, community_id, category_id, author_id, title, body)
      select $1, $2, $3, 'h-three', 'Elsewhere ' || g, '{"type":"doc"}'::jsonb from generate_series(1, 10) g`, [other, otherClub, cat]);
    expect(await status(post("h-three", "Own community"))).toBe(200);
  });

  it("keeps the published address locked", async () => {
    const current = await getCommunity(f.db, "h-owner", tenant, club);
    await expect(updateCommunity(f.db, "h-owner", tenant, club, { version: current.version, slug: `renamed-${randomUUID().slice(0, 6)}` })).rejects.toMatchObject({ status: 409 });
    expect((await getCommunity(f.db, "h-owner", tenant, club)).slug).toBe(slug);
  });

  it("left no email address in any audit row these flows wrote", async () => {
    const { rows } = await f.admin.query("select action from audit_logs where metadata::text ~ '@' or target_id ~ '@'");
    expect(rows).toEqual([]);
    expect((await f.admin.query("select count(*)::int as n from audit_logs where action like 'community.%'")).rows[0].n).toBeGreaterThan(0);
  });
});
