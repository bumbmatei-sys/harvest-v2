import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import * as schema from "../../src/db/schema";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createConnectLink, getConnectLink, listConnectLinks, resolveConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { exportConnectLink } from "../../src/server/connect-export";

// HC-03: every access check runs as harvest_app (FORCE RLS, no BYPASSRLS) through the real service
// and definers. The admin pool only reads state for assertions, archives a campaign (no archive
// path exists yet) and, where noted, proves a guard also holds for owner DML.
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, campaignA: string, campaignA2: string, campaignB: string;
let publishedVersionA: string, draftVersionA: string, retiredVersionA: string, publishedVersionB: string;
const rows = <T = Record<string, unknown>>(result: { rows: unknown[] }) => result.rows as T[];
const as = <T>(user: string, tenant: string, run: Parameters<typeof withTenant<T>>[4]) => withTenant(fixture.db, user, tenant, "workspace:read", run);
const anon = (kind: "qr" | "short", code: string) => resolveConnectLink(fixture.db, kind, code);
const act = (user: string, tenant: string, campaign: string, link: string, body: Record<string, unknown>) => transitionConnectLink(fixture.db, user, tenant, campaign, link, body);
async function link(id: string) {
  return (await fixture.admin.query("select * from campaign_response_links where id = $1", [id])).rows[0];
}
async function codes(id: string) {
  return (await fixture.admin.query("select kind, code, retired_at from campaign_response_link_codes where link_id = $1 order by issued_at, kind", [id])).rows as { kind: string; code: string; retired_at: Date | null }[];
}
async function formVersion(user: string, tenant: string, status: "draft" | "published" | "retired") {
  return as(user, tenant, async (tx) => {
    const [notice] = rows<{ id: string }>(await tx.execute(sql`insert into privacy_notice_versions (tenant_id, notice_key, version, locale, body, body_sha256, created_by)
      values (${tenant}, ${`hc03-${randomUUID().slice(0, 8)}`}, 1, 'en', 'Synthetic notice (test fixture, not approved copy)', ${"0".repeat(64)}, ${user}) returning id`));
    const [form] = rows<{ id: string }>(await tx.execute(sql`insert into forms (tenant_id, name, created_by) values (${tenant}, 'Synthetic response form', ${user}) returning id`));
    const [version] = rows<{ id: string }>(await tx.execute(sql`insert into form_versions (tenant_id, form_id, version, offered_purposes, notice_version_id, pending_retention_days, created_by)
      values (${tenant}, ${form.id}, 1, '{outreach_follow_up}', ${notice.id}, 30, ${user}) returning id`));
    if (status !== "draft") await tx.execute(sql`update form_versions set status = 'published', published_by = ${user} where id = ${version.id}`);
    if (status === "retired") await tx.execute(sql`update form_versions set status = 'retired' where id = ${version.id}`);
    return version.id;
  });
}
const sideEffectTables = ["campaign_responses", "campaign_response_contact_methods", "campaign_response_consents", "contacts", "contact_identifiers", "contact_consents",
  "workspace_members", "outbox_events", "jobs", "audit_logs", "campaign_response_link_codes", "campaign_response_links"];
async function sideEffectCounts() {
  const counts: Record<string, number> = {};
  for (const table of sideEffectTables) counts[table] = (await fixture.admin.query(`select count(*)::int as count from ${table}`)).rows[0].count;
  return counts;
}

beforeAll(async () => {
  process.env.BETTER_AUTH_URL ??= "https://harvest.example.test";
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "admin-a", "member-a", "viewer-a", "owner-b", "admin-b", "outsider"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Links A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Links B")).tenantId;
  for (const [user, role] of [["admin-a", "admin"], ["member-a", "member"], ["viewer-a", "viewer"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${user}@example.test`, role);
  await putMember(fixture.db, "owner-b", tenantB, "admin-b@example.test", "admin");
  const campaign = { name: "Synthetic crusade", type: "evangelistic_crusade" };
  campaignA = (await createCampaign(fixture.db, "owner-a", tenantA, campaign, "hc03-a")).id;
  campaignA2 = (await createCampaign(fixture.db, "owner-a", tenantA, campaign, "hc03-a2")).id;
  campaignB = (await createCampaign(fixture.db, "owner-b", tenantB, campaign, "hc03-b")).id;
  publishedVersionA = await formVersion("owner-a", tenantA, "published");
  draftVersionA = await formVersion("owner-a", tenantA, "draft");
  retiredVersionA = await formVersion("owner-a", tenantA, "retired");
  publishedVersionB = await formVersion("owner-b", tenantB, "published");
});
afterAll(async () => { await fixture?.close(); });

describe("HC-03 schema, grants and FORCE RLS", () => {
  it("adds a FORCE RLS code registry readable by members only and keeps the link grants of 0026", async () => {
    const { rows: [flags] } = await fixture.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'campaign_response_link_codes'");
    expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const privileges = async (table: string) => (await fixture.admin.query(`select array_remove(array[
      case when has_table_privilege('harvest_app', $1, 'SELECT') then 'SELECT' end, case when has_table_privilege('harvest_app', $1, 'INSERT') then 'INSERT' end,
      case when has_table_privilege('harvest_app', $1, 'UPDATE') then 'UPDATE' end, case when has_table_privilege('harvest_app', $1, 'DELETE') then 'DELETE' end,
      case when has_table_privilege('harvest_app', $1, 'TRUNCATE') then 'TRUNCATE' end], null) as granted`, [table])).rows[0].granted;
    expect(await privileges("campaign_response_links")).toEqual(["SELECT", "INSERT"]);
    expect(await privileges("campaign_response_link_codes")).toEqual(["SELECT"]);
    const callable = async (fn: string) => (await fixture.admin.query("select has_function_privilege('harvest_app', $1, 'EXECUTE') as ok", [fn])).rows[0].ok;
    expect(await callable("public.connect_link_transition(uuid,uuid,text,timestamptz,text)")).toBe(true);
    expect(await callable("public.resolve_connect_link(text,text)")).toBe(true);
    expect(await callable("public.connect_register_link_codes()")).toBe(false);
    const { rows: definers } = await fixture.admin.query(`select proname, prosecdef from pg_proc where proname in ('connect_link_transition', 'resolve_connect_link', 'connect_register_link_codes', 'guard_campaign_response_link')`);
    expect(Object.fromEntries(definers.map((row) => [row.proname, row.prosecdef]))).toEqual({ connect_link_transition: true, resolve_connect_link: true, connect_register_link_codes: true, guard_campaign_response_link: false });
    const { rows: policies } = await fixture.admin.query("select roles::text[] as roles from pg_policies where tablename in ('campaign_response_links', 'campaign_response_link_codes')");
    for (const policy of policies) expect(policy.roles).not.toContain("public");
  });
});

describe("draft creation", () => {
  it("lets organizers create drafts with database-generated codes, registered once, and audits creation", async () => {
    const created = await createConnectLink(fixture.db, "member-a", tenantA, campaignA, { label: "Night 1 — main screen", publicTitle: "Harvest Night (synthetic)", formVersionId: publishedVersionA });
    expect(created).toMatchObject({ status: "draft", label: "Night 1 — main screen", publicTitle: "Harvest Night (synthetic)", locale: "en", codeGeneration: 1, retiredCodes: 0 });
    expect(created.publicCode).toMatch(/^[a-f0-9]{32}$/);
    expect(created.shortCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect((await codes(created.id)).map(({ kind, code, retired_at }) => [kind, code, retired_at])).toEqual([["qr", created.publicCode, null], ["short", created.shortCode, null]]);
    const { rows: audit } = await fixture.admin.query("select actor_id, action, metadata from audit_logs where target_id = $1", [created.id]);
    expect(audit).toEqual([{ actor_id: "member-a", action: "connect.link.create", metadata: {} }]);
  });

  it("denies viewers, outsiders, forged workspaces and parents from another workspace", async () => {
    await expect(createConnectLink(fixture.db, "viewer-a", tenantA, campaignA, {})).rejects.toMatchObject({ status: 403 });
    await expect(createConnectLink(fixture.db, "outsider", tenantA, campaignA, {})).rejects.toMatchObject({ status: 403 });
    await expect(createConnectLink(fixture.db, "owner-b", tenantA, campaignA, {})).rejects.toMatchObject({ status: 403 });
    // Forged parent ids from the other workspace look like they do not exist.
    await expect(createConnectLink(fixture.db, "owner-a", tenantA, campaignB, {})).rejects.toMatchObject({ status: 404 });
    await expect(createConnectLink(fixture.db, "owner-b", tenantB, campaignA, {})).rejects.toMatchObject({ status: 404 });
    await expect(createConnectLink(fixture.db, "owner-a", tenantA, campaignA, { formVersionId: publishedVersionB })).rejects.toMatchObject({ status: 404 });
    await expect(createConnectLink(fixture.db, "owner-a", tenantA, campaignA, { formVersionId: draftVersionA })).rejects.toMatchObject({ status: 404 });
    // Raw SQL as harvest_app: the composite FK refuses the other workspace's form version, the guard a retired one.
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, form_version_id, public_code, short_code, created_by) values (${tenantA}, ${campaignA}, ${publishedVersionB}, '', '', 'owner-a')`))).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, form_version_id, public_code, short_code, created_by) values (${tenantA}, ${campaignA}, ${retiredVersionA}, '', '', 'owner-a')`))).rejects.toThrow();
    await expect(createConnectLink(fixture.db, "owner-a", tenantA, campaignA, { label: "x".repeat(81) })).rejects.toThrow();
    await expect(createConnectLink(fixture.db, "owner-a", tenantA, campaignA, { locale: "ro" })).rejects.toThrow();
    await expect(createConnectLink(fixture.db, "owner-a", tenantA, campaignA, { tenantId: tenantB })).rejects.toThrow();
  });

  it("overwrites caller-supplied codes and lifecycle fields at insert, and keeps every code unique", async () => {
    const [row] = await as("owner-a", tenantA, async (tx) => rows<{ id: string; public_code: string; short_code: string; status: string; expires_at: Date | null; code_generation: number }>(await tx.execute(sql`insert into campaign_response_links
      (tenant_id, campaign_id, public_code, short_code, expires_at, code_generation, created_by) values (${tenantA}, ${campaignA}, ${"a".repeat(32)}, 'AAAAAAAAAAAA', now() + interval '1 day', 9, 'owner-a')
      returning id, public_code, short_code, status, expires_at, code_generation`)));
    expect(row.public_code).not.toBe("a".repeat(32));
    expect(row.short_code).not.toBe("AAAAAAAAAAAA");
    expect(row).toMatchObject({ status: "draft", expires_at: null, code_generation: 1 });
    const created = await Promise.all(Array.from({ length: 40 }, (_, index) => createConnectLink(fixture.db, "owner-a", tenantA, campaignA2, { label: `Bulk ${index}` })));
    const all = (await fixture.admin.query("select code from campaign_response_link_codes")).rows.map((r) => r.code as string);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(created.map((c) => c.shortCode)).size).toBe(created.length);
  });
});

describe("publish, pause, rotate and archive", () => {
  it("allows only live owners/admins, inside the link's own workspace and campaign", async () => {
    const draft = await createConnectLink(fixture.db, "member-a", tenantA, campaignA, { label: "Permissions" });
    await expect(act("member-a", tenantA, campaignA, draft.id, { action: "publish" })).rejects.toMatchObject({ status: 403 });
    await expect(act("viewer-a", tenantA, campaignA, draft.id, { action: "publish" })).rejects.toMatchObject({ status: 403 });
    await expect(act("outsider", tenantA, campaignA, draft.id, { action: "publish" })).rejects.toMatchObject({ status: 403 });
    await expect(act("owner-b", tenantA, campaignA, draft.id, { action: "publish" })).rejects.toMatchObject({ status: 403 });
    await expect(act("owner-b", tenantB, campaignB, draft.id, { action: "publish" })).rejects.toMatchObject({ status: 404 });
    await expect(act("owner-a", tenantA, campaignA2, draft.id, { action: "publish" })).rejects.toMatchObject({ status: 404 });
    // Direct SQL as harvest_app: no table grant changes a link, and the definer re-checks the caller.
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`update campaign_response_links set status = 'published' where id = ${draft.id}`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`delete from campaign_response_links where id = ${draft.id}`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`insert into campaign_response_link_codes (tenant_id, link_id, kind, code) values (${tenantA}, ${draft.id}, 'qr', ${"b".repeat(32)})`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(as("member-a", tenantA, (tx) => tx.execute(sql`select public.connect_link_transition(${tenantA}::uuid, ${draft.id}::uuid, 'publish', null, null)`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`select public.connect_link_transition(${tenantB}::uuid, ${draft.id}::uuid, 'publish', null, null)`))).rejects.toMatchObject({ cause: { code: "42501" } });
    // A forged transaction tenant setting with a real owner of B: no membership in A, denied.
    await expect(withUser(fixture.db, "owner-b", async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantA}, true)`);
      return tx.execute(sql`select public.connect_link_transition(${tenantA}::uuid, ${draft.id}::uuid, 'publish', null, null)`);
    })).rejects.toMatchObject({ cause: { code: "42501" } });
    expect((await link(draft.id)).status).toBe("draft");
  });

  it("stops a publisher the moment their role is revoked or removed", async () => {
    const draft = await createConnectLink(fixture.db, "owner-b", tenantB, campaignB, { label: "Revocation" });
    expect((await act("admin-b", tenantB, campaignB, draft.id, { action: "publish" })).outcome).toBe("published");
    await putMember(fixture.db, "owner-b", tenantB, "admin-b@example.test", "member");
    await expect(act("admin-b", tenantB, campaignB, draft.id, { action: "disable" })).rejects.toMatchObject({ status: 403 });
    await fixture.admin.query("delete from workspace_members where tenant_id = $1 and user_id = 'admin-b'", [tenantB]);
    await expect(act("admin-b", tenantB, campaignB, draft.id, { action: "disable" })).rejects.toMatchObject({ status: 403 });
    expect((await link(draft.id)).status).toBe("published");
  });

  it("publishes, pauses and republishes with audit, and the resolver follows every change", async () => {
    const draft = await createConnectLink(fixture.db, "member-a", tenantA, campaignA, { label: "Lifecycle", publicTitle: "Synthetic Night", formVersionId: publishedVersionA });
    expect(await anon("qr", draft.publicCode)).toBeUndefined();
    expect(await anon("short", draft.shortCode)).toBeUndefined();
    await expect(act("owner-a", tenantA, campaignA, draft.id, { action: "disable" })).rejects.toMatchObject({ status: 409, details: { reason: "invalid_transition" } });
    const published = await act("admin-a", tenantA, campaignA, draft.id, { action: "publish", expectedCode: draft.publicCode });
    expect(published.outcome).toBe("published");
    expect(published.link).toMatchObject({ status: "published" });
    expect((await link(draft.id))).toMatchObject({ published_by: "admin-a" });
    expect(await anon("qr", draft.publicCode)).toEqual({ locale: "en", title: "Synthetic Night" });
    expect(await anon("short", draft.shortCode)).toEqual({ locale: "en", title: "Synthetic Night" });
    expect((await act("owner-a", tenantA, campaignA, draft.id, { action: "publish" })).outcome).toBe("unchanged");
    expect((await act("owner-a", tenantA, campaignA, draft.id, { action: "disable" })).outcome).toBe("disabled");
    expect(await anon("qr", draft.publicCode)).toBeUndefined();
    expect(await anon("short", draft.shortCode)).toBeUndefined();
    expect((await act("owner-a", tenantA, campaignA, draft.id, { action: "disable" })).outcome).toBe("unchanged");
    expect((await act("owner-a", tenantA, campaignA, draft.id, { action: "publish" })).outcome).toBe("published");
    expect(await anon("qr", draft.publicCode)).toEqual({ locale: "en", title: "Synthetic Night" });
    const { rows: audit } = await fixture.admin.query("select actor_id, action, metadata from audit_logs where target_id = $1 order by created_at, id", [draft.id]);
    expect(audit.map((row) => row.action)).toEqual(["connect.link.create", "connect.link.publish", "connect.link.disable", "connect.link.publish"]);
    expect(JSON.stringify(audit)).not.toContain(draft.publicCode);
  });

  it("expires at the chosen time and refuses an expiry in the past", async () => {
    const draft = await createConnectLink(fixture.db, "owner-a", tenantA, campaignA, { label: "Expiry" });
    await expect(act("owner-a", tenantA, campaignA, draft.id, { action: "publish", expiresAt: new Date(Date.now() - 60_000).toISOString() }))
      .rejects.toMatchObject({ status: 409, details: { reason: "expiry_in_past" } });
    await act("owner-a", tenantA, campaignA, draft.id, { action: "publish", expiresAt: new Date(Date.now() + 1500).toISOString() });
    expect(await anon("qr", draft.publicCode)).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(await anon("qr", draft.publicCode)).toBeUndefined();
    expect(await anon("short", draft.shortCode)).toBeUndefined();
    // Extending the expiry republishes it; the owner-DML guard rejects a past expiry too.
    expect((await act("owner-a", tenantA, campaignA, draft.id, { action: "publish", expiresAt: null })).outcome).toBe("published");
    expect(await anon("qr", draft.publicCode)).toBeDefined();
    await expect(fixture.admin.query("update campaign_response_links set expires_at = now() - interval '1 day' where id = $1", [draft.id])).rejects.toThrow("expiry must be in the future");
  });

  it("rotates to new never-reused codes; old QR and short codes fail safely at once", async () => {
    const draft = await createConnectLink(fixture.db, "owner-a", tenantA, campaignA, { label: "Rotation", publicTitle: "Rotation night" });
    await act("owner-a", tenantA, campaignA, draft.id, { action: "publish" });
    await expect(act("owner-a", tenantA, campaignA, draft.id, { action: "rotate" })).rejects.toMatchObject({ status: 409, details: { reason: "stale" } });
    await expect(act("owner-a", tenantA, campaignA, draft.id, { action: "rotate", expectedCode: "c".repeat(32) })).rejects.toMatchObject({ status: 409, details: { reason: "stale" } });
    const rotated = await act("owner-a", tenantA, campaignA, draft.id, { action: "rotate", expectedCode: draft.publicCode });
    expect(rotated.outcome).toBe("rotated");
    expect(rotated.link).toMatchObject({ status: "published", codeGeneration: 2, retiredCodes: 1 });
    expect(rotated.link.publicCode).not.toBe(draft.publicCode);
    expect(rotated.link.shortCode).not.toBe(draft.shortCode);
    expect(await anon("qr", draft.publicCode)).toBeUndefined();
    expect(await anon("short", draft.shortCode)).toBeUndefined();
    expect(await anon("qr", rotated.link.publicCode)).toEqual({ locale: "en", title: "Rotation night" });
    expect(await anon("short", rotated.link.shortCode)).toEqual({ locale: "en", title: "Rotation night" });
    const history = await codes(draft.id);
    expect(history.filter((code) => code.retired_at !== null).map((code) => code.code).sort()).toEqual([draft.publicCode, draft.shortCode].sort());
    expect(history.filter((code) => code.retired_at === null).map((code) => code.code).sort()).toEqual([rotated.link.publicCode, rotated.link.shortCode].sort());
    // A request based on the old code is stale now.
    await expect(act("owner-a", tenantA, campaignA, draft.id, { action: "rotate", expectedCode: draft.publicCode })).rejects.toMatchObject({ status: 409, details: { reason: "stale" } });
    // Owner DML cannot reissue a retired code to any link: the registry and unique indexes forbid it.
    const other = await createConnectLink(fixture.db, "owner-a", tenantA, campaignA, {});
    await expect(fixture.admin.query("insert into campaign_response_link_codes (tenant_id, link_id, kind, code) values ($1, $2, 'qr', $3)", [tenantA, other.id, draft.publicCode])).rejects.toMatchObject({ code: "23505" });
    await expect(fixture.admin.query("delete from campaign_response_link_codes where code = $1", [draft.publicCode])).rejects.toThrow("never reissued");
    await expect(fixture.admin.query("update campaign_response_link_codes set retired_at = null where code = $1", [draft.publicCode])).rejects.toThrow("only retire");
  });

  it("serializes concurrent rotations: exactly one wins, the other is stale", async () => {
    const draft = await createConnectLink(fixture.db, "owner-a", tenantA, campaignA, { label: "Concurrent" });
    const second = new Pool({ connectionString: fixture.appURL, max: 1 });
    try {
      const otherDb = drizzle(second, { schema });
      const results = await Promise.allSettled([
        transitionConnectLink(fixture.db, "owner-a", tenantA, campaignA, draft.id, { action: "rotate", expectedCode: draft.publicCode }),
        transitionConnectLink(otherDb, "admin-a", tenantA, campaignA, draft.id, { action: "rotate", expectedCode: draft.publicCode }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ status: 409, details: { reason: "stale" } });
      expect((await link(draft.id)).code_generation).toBe(2);
    } finally { await second.end(); }
  });

  it("archives for good: codes retire, nothing resolves, exports and later changes are refused", async () => {
    const draft = await createConnectLink(fixture.db, "owner-a", tenantA, campaignA, { label: "Archive" });
    await act("owner-a", tenantA, campaignA, draft.id, { action: "publish" });
    expect((await act("owner-a", tenantA, campaignA, draft.id, { action: "archive" })).outcome).toBe("archived");
    expect(await anon("qr", draft.publicCode)).toBeUndefined();
    expect(await anon("short", draft.shortCode)).toBeUndefined();
    expect((await codes(draft.id)).every((code) => code.retired_at !== null)).toBe(true);
    expect((await act("owner-a", tenantA, campaignA, draft.id, { action: "archive" })).outcome).toBe("unchanged");
    for (const action of ["publish", "disable", "rotate"]) {
      await expect(act("owner-a", tenantA, campaignA, draft.id, { action, expectedCode: draft.publicCode })).rejects.toMatchObject({ status: 409, details: { reason: "link_archived" } });
    }
    await expect(exportConnectLink(fixture.db, "owner-a", tenantA, campaignA, draft.id, { format: "png" })).rejects.toMatchObject({ status: 409 });
    await expect(fixture.admin.query("update campaign_response_links set status = 'published' where id = $1", [draft.id])).rejects.toThrow("archived response links are final");
    await expect(fixture.admin.query("delete from campaign_response_links where id = $1", [draft.id])).rejects.toThrow("archived, not deleted");
  });

  it("requires a published form version and a live campaign to publish, and stops resolving if the campaign is archived", async () => {
    const withDraftForm = (await as("owner-a", tenantA, async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, form_version_id, public_code, short_code, created_by)
      values (${tenantA}, ${campaignA}, ${draftVersionA}, '', '', 'owner-a') returning id`))))[0].id;
    await expect(act("owner-a", tenantA, campaignA, withDraftForm, { action: "publish" })).rejects.toMatchObject({ status: 409, details: { reason: "form_not_published" } });
    await expect(fixture.admin.query("update campaign_response_links set status = 'published' where id = $1", [withDraftForm])).rejects.toThrow("only a published form version can be published");
    const campaignC = (await createCampaign(fixture.db, "owner-a", tenantA, { name: "To archive", type: "conference" }, "hc03-c")).id;
    const live = await createConnectLink(fixture.db, "owner-a", tenantA, campaignC, {});
    const pending = await createConnectLink(fixture.db, "owner-a", tenantA, campaignC, {});
    await act("owner-a", tenantA, campaignC, live.id, { action: "publish" });
    expect(await anon("qr", live.publicCode)).toBeDefined();
    // No campaign archive path exists yet (CW slices); the admin pool stands in for it.
    await fixture.admin.query("update campaigns set archived_at = now() where id = $1", [campaignC]);
    expect(await anon("qr", live.publicCode)).toBeUndefined();
    expect(await anon("short", live.shortCode)).toBeUndefined();
    await expect(act("owner-a", tenantA, campaignC, pending.id, { action: "publish" })).rejects.toMatchObject({ status: 409, details: { reason: "campaign_archived" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`select public.connect_link_transition(${tenantA}::uuid, ${pending.id}::uuid, 'publish', null, null) as outcome`)))
      .resolves.toMatchObject({ rows: [{ outcome: "campaign_archived" }] });
    await expect(createConnectLink(fixture.db, "owner-a", tenantA, campaignC, {})).rejects.toMatchObject({ status: 404 });
  });
});

describe("public resolver", () => {
  it("derives ownership from the code alone and returns only the allowlisted public fields", async () => {
    const draft = await createConnectLink(fixture.db, "owner-b", tenantB, campaignB, { label: "Internal note: back door", publicTitle: "Public B" });
    await act("owner-b", tenantB, campaignB, draft.id, { action: "publish" });
    // A caller-supplied tenant/user context is irrelevant: B's link resolves with A's context set.
    const { rows: [resolved], fields } = await as("owner-a", tenantA, (tx) => tx.execute(sql`select * from public.resolve_connect_link('qr', ${draft.publicCode})`));
    expect(fields.map((field) => field.name)).toEqual(["locale", "public_title"]);
    expect(resolved).toEqual({ locale: "en", public_title: "Public B" });
    // The resolver's internal settings are cleared before it returns.
    const settings = await fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select * from public.resolve_connect_link('qr', ${draft.publicCode})`);
      return rows(await tx.execute(sql`select current_setting('app.connect_resolve_code', true) as code, current_setting('app.connect_resolve_tenant', true) as tenant`))[0];
    });
    expect(settings).toEqual({ code: "", tenant: "" });
    // harvest_app cannot borrow the resolver's settings to read links directly.
    const borrowed = await fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.connect_resolve_code', ${draft.publicCode}, true), set_config('app.connect_resolve_tenant', ${tenantB}, true)`);
      return [rows(await tx.execute(sql`select id from campaign_response_links`)).length, rows(await tx.execute(sql`select id from campaigns`)).length, rows(await tx.execute(sql`select id from form_versions`)).length];
    });
    expect(borrowed).toEqual([0, 0, 0]);
  });

  it("returns nothing for unknown, malformed, draft or cross-kind codes without leaking which", async () => {
    const draft = await createConnectLink(fixture.db, "owner-a", tenantA, campaignA, {});
    for (const [kind, code] of [["qr", draft.publicCode], ["short", draft.shortCode], ["qr", "0".repeat(32)], ["qr", draft.publicCode.toUpperCase()], ["qr", draft.publicCode.slice(1)],
      ["short", draft.publicCode], ["qr", draft.shortCode], ["short", "IIIIIIIIIIII"], ["short", ""], ["qr", "' or 1=1 --"], ["other", draft.publicCode]] as const) {
      const { rows: result } = await fixture.db.transaction((tx) => tx.execute(sql`select * from public.resolve_connect_link(${kind}, ${code})`));
      expect(result, `${kind}:${code}`).toEqual([]);
    }
    // NULL inputs return early too (not as a SQL NULL that falls through to a lookup).
    const live = await createConnectLink(fixture.db, "owner-a", tenantA, campaignA, {});
    await act("owner-a", tenantA, campaignA, live.id, { action: "publish" });
    expect(await anon("short", live.shortCode)).toBeDefined();
    for (const [kind, code] of [[null, live.shortCode], [null, live.publicCode], ["short", null], [null, null]] as const) {
      const { rows: result } = await fixture.db.transaction((tx) => tx.execute(sql`select * from public.resolve_connect_link(${kind}::text, ${code}::text)`));
      expect(result).toEqual([]);
    }
  });

  it("is read-only: scanning creates no response, contact, consent, membership, event, job, audit or code row", async () => {
    const draft = await createConnectLink(fixture.db, "owner-a", tenantA, campaignA, { formVersionId: publishedVersionA });
    await act("owner-a", tenantA, campaignA, draft.id, { action: "publish" });
    const before = await sideEffectCounts();
    for (let index = 0; index < 25; index++) {
      await anon("qr", draft.publicCode); await anon("short", draft.shortCode); await anon("qr", "f".repeat(32));
    }
    expect(await sideEffectCounts()).toEqual(before);
    const { rows: [state] } = await fixture.admin.query("select updated_at from campaign_response_links where id = $1", [draft.id]);
    expect(state.updated_at).toEqual((await link(draft.id)).updated_at);
  });
});

describe("organizer reads and exports", () => {
  it("lists only the workspace's own links and limits preview/export to organizers", async () => {
    const listA = await listConnectLinks(fixture.db, "viewer-a", tenantA, campaignA);
    expect(listA.permissions).toEqual({ manage: false, publish: false });
    expect(listA.links.length).toBeGreaterThan(0);
    expect((await listConnectLinks(fixture.db, "member-a", tenantA, campaignA)).permissions).toEqual({ manage: true, publish: false });
    expect((await listConnectLinks(fixture.db, "admin-a", tenantA, campaignA)).permissions).toEqual({ manage: true, publish: true });
    const listB = await listConnectLinks(fixture.db, "owner-b", tenantB, campaignB);
    const idsA = new Set(listA.links.map((row) => row.id));
    expect(listB.links.some((row) => idsA.has(row.id))).toBe(false);
    await expect(listConnectLinks(fixture.db, "owner-b", tenantB, campaignA)).rejects.toMatchObject({ status: 404 });
    await expect(listConnectLinks(fixture.db, "owner-b", tenantA, campaignA)).rejects.toMatchObject({ status: 403 });
    const someA = listA.links[0].id;
    await expect(getConnectLink(fixture.db, "viewer-a", tenantA, campaignA, someA)).rejects.toMatchObject({ status: 403 });
    await expect(exportConnectLink(fixture.db, "viewer-a", tenantA, campaignA, someA, { format: "svg" })).rejects.toMatchObject({ status: 403 });
    await expect(exportConnectLink(fixture.db, "owner-b", tenantB, campaignB, someA, { format: "svg" })).rejects.toMatchObject({ status: 404 });
    await expect(exportConnectLink(fixture.db, "owner-a", tenantA, campaignA, someA, { format: "gif" })).rejects.toThrow();
  });

  it("exports PNG, SVG and PDF that encode only the public URL", async () => {
    const draft = await createConnectLink(fixture.db, "member-a", tenantA, campaignA, { label: "Export", publicTitle: "Exported" });
    for (const format of ["png", "svg", "pdf"] as const) {
      const file = await exportConnectLink(fixture.db, "member-a", tenantA, campaignA, draft.id, { format, palette: "brand" });
      expect(file.disposition).toContain(`harvest-qr-${draft.shortCode.slice(0, 4)}-`);
      const text = file.body.toString("latin1");
      for (const secret of [tenantA, campaignA, draft.id, "member-a", "Export"]) expect(text).not.toContain(secret);
    }
    const svg = (await exportConnectLink(fixture.db, "member-a", tenantA, campaignA, draft.id, { format: "svg" })).body.toString("utf8");
    expect(svg).toContain(`/s/${draft.shortCode.slice(0, 4)}-${draft.shortCode.slice(4, 8)}-${draft.shortCode.slice(8)}`);
  });
});
