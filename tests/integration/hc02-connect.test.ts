import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createContact, eraseContact } from "../../src/server/contacts";
import { withTenant, withUser } from "../../src/server/tenancy";
import { eraseConnectResponse, isConnectResponsePurposeActive, listPendingResponseSummaries, purgeExpiredConnectResponses, withdrawConnectResponsePurpose } from "../../src/server/connect-responses";

// HC-02: every access check below runs as harvest_app (FORCE RLS, no BYPASSRLS). The admin pool
// only seeds rows that later slices will write through their own definers (HC-03 link publishing,
// HC-05 public intake, HC-06 association), so the database guards are exercised either way.
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, campaignA: string, campaignA2: string, campaignB: string;
let noticeA: string, noticeB: string, formA: string, versionA: string, versionB: string, linkA: string, linkB: string;
const rows = <T = Record<string, unknown>>(result: { rows: unknown[] }) => result.rows as T[];
const as = <T>(user: string, tenant: string, run: Parameters<typeof withTenant<T>>[4]) => withTenant(fixture.db, user, tenant, "workspace:read", run);
const code = () => randomBytes(16).toString("hex");

async function notice(user: string, tenant: string, body: string, key = "connect-response") {
  return as(user, tenant, async (tx) => rows<{ id: string; body_sha256: string }>(await tx.execute(sql`insert into privacy_notice_versions (tenant_id, notice_key, version, locale, body, body_sha256, created_by)
    values (${tenant}, ${key}, (select coalesce(max(version), 0) + 1 from privacy_notice_versions where tenant_id = ${tenant} and notice_key = ${key}), 'en', ${body}, ${"0".repeat(64)}, ${user}) returning id, body_sha256`))[0]);
}
async function form(user: string, tenant: string) {
  return as(user, tenant, async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into forms (tenant_id, name, created_by) values (${tenant}, 'Synthetic response form', ${user}) returning id`))[0].id);
}
async function draftVersion(user: string, tenant: string, formId: string, values: { notice?: string | null; purposes?: string[]; retention?: number | null; version?: number } = {}) {
  const purposes = values.purposes ?? ["account_communications", "outreach_follow_up", "newsletter"];
  return as(user, tenant, async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into form_versions (tenant_id, form_id, version, offered_purposes, notice_version_id, pending_retention_days, definition, created_by)
    values (${tenant}, ${formId}, ${values.version ?? 1}, ${`{${purposes.join(",")}}`}::text[], ${values.notice === undefined ? null : values.notice}, ${values.retention === undefined ? 30 : values.retention}, '{"fields":[]}'::jsonb, ${user}) returning id`))[0].id);
}
async function publish(user: string, tenant: string, version: string) {
  return as(user, tenant, (tx) => tx.execute(sql`update form_versions set status = 'published', published_by = ${user} where tenant_id = ${tenant} and id = ${version}`));
}
async function link(user: string, tenant: string, campaign: string, version: string | null, status: "published" | "draft" = "published") {
  const id = await as(user, tenant, async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, form_version_id, public_code, locale, created_by)
    values (${tenant}, ${campaign}, ${version}, ${code()}, 'en', ${user}) returning id`))[0].id);
  // HC-03 owns publishing; until then a test seeds the published state directly.
  if (status === "published") await fixture.admin.query("update campaign_response_links set status = 'published' where tenant_id = $1 and id = $2", [tenant, id]);
  return id;
}
type Seed = { tenant: string; campaign: string; link: string; version: string; notice: string; name?: string; email?: string; grants?: { purpose: string; channel?: "email" | "sms" | null }[] };
// Stands in for HC-05's intake definer: one response, its pending contact method and its grants.
async function seedResponse(seed: Seed) {
  const submission = randomUUID();
  const { rows: [response] } = await fixture.admin.query(`insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id, preferred_name, locale)
    values ($1, $2, $3, $4, $5, $6, 'en') returning id, submitted_at, expires_at`, [seed.tenant, seed.campaign, seed.link, seed.version, submission, seed.name ?? "Synthetic Guest"]);
  if (seed.email !== undefined) await fixture.admin.query(`insert into campaign_response_contact_methods (tenant_id, response_id, kind, value, normalized_value) values ($1, $2, 'email', $3, lower($3))`, [seed.tenant, response.id, seed.email]);
  for (const grant of seed.grants ?? []) {
    await fixture.admin.query(`insert into campaign_response_consents (tenant_id, response_id, purpose, status, channel, form_version_id, notice_version_id, actor_kind)
      values ($1, $2, $3, 'granted', $4, $5, $6, 'subject')`, [seed.tenant, response.id, grant.purpose, grant.channel ?? null, seed.version, seed.notice]);
  }
  return { id: response.id as string, submission, submittedAt: response.submitted_at as Date, expiresAt: response.expires_at as Date };
}
const seedA = (extra: Partial<Seed> = {}) => seedResponse({ tenant: tenantA, campaign: campaignA, link: linkA, version: versionA, notice: noticeA, email: "guest-a@example.test", ...extra });
async function tenantRowCount(table: string, tenant: string) {
  return (await fixture.admin.query(`select count(*)::int as count from ${table} where tenant_id = $1`, [tenant])).rows[0].count as number;
}

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "admin-a", "member-a", "viewer-a", "owner-b"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Connect A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Connect B")).tenantId;
  for (const [user, role] of [["admin-a", "admin"], ["member-a", "member"], ["viewer-a", "viewer"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${user}@example.test`, role);
  const campaign = { name: "Synthetic crusade", type: "evangelistic_crusade" };
  campaignA = (await createCampaign(fixture.db, "owner-a", tenantA, campaign, "hc02-a")).id;
  campaignA2 = (await createCampaign(fixture.db, "owner-a", tenantA, campaign, "hc02-a2")).id;
  campaignB = (await createCampaign(fixture.db, "owner-b", tenantB, campaign, "hc02-b")).id;
  noticeA = (await notice("owner-a", tenantA, "Synthetic notice text A (test fixture, not approved copy)")).id;
  noticeB = (await notice("owner-b", tenantB, "Synthetic notice text B (test fixture, not approved copy)")).id;
  formA = await form("owner-a", tenantA);
  versionA = await draftVersion("owner-a", tenantA, formA, { notice: noticeA });
  await publish("owner-a", tenantA, versionA);
  const formB = await form("owner-b", tenantB);
  versionB = await draftVersion("owner-b", tenantB, formB, { notice: noticeB });
  await publish("owner-b", tenantB, versionB);
  linkA = await link("member-a", tenantA, campaignA, versionA);
  linkB = await link("owner-b", tenantB, campaignB, versionB);
});
afterAll(async () => { await fixture?.close(); });

describe("HC-02 schema, FORCE RLS and grants", () => {
  const tables = ["privacy_notice_versions", "forms", "form_versions", "campaign_response_links", "campaign_responses", "campaign_response_contact_methods", "campaign_response_consents"];
  it("forces RLS on every Connect table and grants harvest_app only the intended privileges", async () => {
    const { rows: flags } = await fixture.admin.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) order by relname", [tables]);
    expect(flags).toHaveLength(tables.length);
    for (const flag of flags) expect(flag).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const privileges = async (table: string) => (await fixture.admin.query(`select array_remove(array[
      case when has_table_privilege('harvest_app', $1, 'SELECT') then 'SELECT' end, case when has_table_privilege('harvest_app', $1, 'INSERT') then 'INSERT' end,
      case when has_table_privilege('harvest_app', $1, 'UPDATE') then 'UPDATE' end, case when has_table_privilege('harvest_app', $1, 'DELETE') then 'DELETE' end,
      case when has_table_privilege('harvest_app', $1, 'TRUNCATE') then 'TRUNCATE' end], null) as granted`, [table])).rows[0].granted;
    expect(await privileges("privacy_notice_versions")).toEqual(["SELECT", "INSERT"]);
    expect(await privileges("forms")).toEqual(["SELECT", "INSERT"]);
    expect(await privileges("form_versions")).toEqual(["SELECT", "INSERT", "UPDATE"]);
    expect(await privileges("campaign_response_links")).toEqual(["SELECT", "INSERT"]);
    // HC-DEC2: evidence rows have no direct application reader; the audited owner/admin definer reads them.
    expect(await privileges("campaign_response_consents")).toEqual([]);
    // Restricted pending data: column-level metadata only, and nothing at all on contact methods.
    expect(await privileges("campaign_responses")).toEqual([]);
    expect(await privileges("campaign_response_contact_methods")).toEqual([]);
    const { rows: columns } = await fixture.admin.query("select column_name from information_schema.column_privileges where grantee = 'harvest_app' and table_name = 'campaign_responses' and privilege_type = 'SELECT' order by column_name");
    expect(columns.map((row) => row.column_name)).toEqual(["associated_at", "campaign_id", "erased_at", "expires_at", "form_version_id", "id", "link_id", "status", "submitted_at", "tenant_id"]);
    const { rows: policies } = await fixture.admin.query("select tablename, roles::text[] as roles from pg_policies where tablename = any($1)", [tables]);
    for (const policy of policies) expect(policy.roles.some((role: string) => role === "public")).toBe(false);
    expect((await fixture.admin.query("select has_function_privilege('harvest_app', 'public.connect_scrub_response(uuid,uuid)', 'EXECUTE') as callable")).rows[0].callable).toBe(false);
  });
});

describe("canonical Forms and immutable notice versions", () => {
  it("stores the presented notice exactly, hashes it server-side and never changes it", async () => {
    const body = "Synthetic notice — exact copy as presented.";
    const created = await notice("admin-a", tenantA, body, "hash-check");
    expect(created.body_sha256).toBe(createHash("sha256").update(body, "utf8").digest("hex"));
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`update privacy_notice_versions set body = 'changed' where id = ${created.id}`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`delete from privacy_notice_versions where id = ${created.id}`))).rejects.toMatchObject({ cause: { code: "42501" } });
    // Even owner DML is rejected by the guard.
    await expect(fixture.admin.query("update privacy_notice_versions set body = 'changed' where id = $1", [created.id])).rejects.toThrow("privacy notice versions are immutable");
    await expect(fixture.admin.query("delete from privacy_notice_versions where id = $1", [created.id])).rejects.toThrow("privacy notice versions are immutable");
  });

  it("lets only owners/admins author notices, forms and versions; every member can read them", async () => {
    await expect(notice("member-a", tenantA, "Member notice")).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(form("viewer-a", tenantA)).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(draftVersion("member-a", tenantA, formA, { version: 9 })).rejects.toMatchObject({ cause: { code: "42501" } });
    const visible = await as("viewer-a", tenantA, async (tx) => rows(await tx.execute(sql`select id from form_versions where id = ${versionA}`)));
    expect(visible).toHaveLength(1);
    // A member cannot publish a draft, and nobody can publish for someone else.
    const draft = await draftVersion("owner-a", tenantA, formA, { notice: noticeA, version: 2 });
    await expect(as("member-a", tenantA, (tx) => tx.execute(sql`update form_versions set status = 'published', published_by = 'member-a' where id = ${draft}`)).then((result) => result.rowCount)).resolves.toBe(0);
    await publish("admin-a", tenantA, draft);
    expect((await fixture.admin.query("select status, published_by from form_versions where id = $1", [draft])).rows[0]).toEqual({ status: "published", published_by: "admin-a" });
    const other = await draftVersion("owner-a", tenantA, formA, { notice: noticeA, version: 3 });
    await expect(as("admin-a", tenantA, (tx) => tx.execute(sql`update form_versions set status = 'published', published_by = 'owner-a' where id = ${other}`))).rejects.toMatchObject({ cause: { message: "invalid publication provenance" } });
  });

  it("requires a notice, retention and at least one distinct known purpose to publish, then freezes the version", async () => {
    const noNotice = await draftVersion("owner-a", tenantA, formA, { notice: null, version: 4 });
    await expect(publish("owner-a", tenantA, noNotice)).rejects.toMatchObject({ cause: { constraint: "form_version_publication" } });
    const noRetention = await draftVersion("owner-a", tenantA, formA, { notice: noticeA, retention: null, version: 5 });
    await expect(publish("owner-a", tenantA, noRetention)).rejects.toMatchObject({ cause: { constraint: "form_version_publication" } });
    const noPurpose = await draftVersion("owner-a", tenantA, formA, { notice: noticeA, purposes: [], version: 6 });
    await expect(publish("owner-a", tenantA, noPurpose)).rejects.toMatchObject({ cause: { constraint: "form_version_publication" } });
    await expect(draftVersion("owner-a", tenantA, formA, { notice: noticeA, purposes: ["marketing"], version: 7 })).rejects.toMatchObject({ cause: { constraint: "form_version_purposes" } });
    await expect(draftVersion("owner-a", tenantA, formA, { notice: noticeA, purposes: ["newsletter", "newsletter"], version: 7 })).rejects.toMatchObject({ cause: { message: "each purpose is offered once" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`insert into form_versions (tenant_id, form_id, version, status, created_by) values (${tenantA}, ${formA}, 8, 'published', 'owner-a')`))).rejects.toMatchObject({ cause: { message: "form versions start as drafts" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`update form_versions set definition = '{"fields":["changed"]}'::jsonb where id = ${versionA}`))).rejects.toMatchObject({ cause: { message: "published form versions are immutable" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`update form_versions set offered_purposes = '{newsletter}' where id = ${versionA}`))).rejects.toMatchObject({ cause: { message: "published form versions are immutable" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`update form_versions set status = 'draft' where id = ${versionA}`))).rejects.toMatchObject({ cause: { message: "published form versions are immutable" } });
    // Retiring keeps the content; a retired version is final.
    const retiring = await draftVersion("owner-a", tenantA, formA, { notice: noticeA, version: 10 });
    await publish("owner-a", tenantA, retiring);
    await as("owner-a", tenantA, (tx) => tx.execute(sql`update form_versions set status = 'retired' where id = ${retiring}`));
    const { rows: [retired] } = await fixture.admin.query("select status, retired_at, published_at from form_versions where id = $1", [retiring]);
    expect(retired.status).toBe("retired"); expect(retired.retired_at).toBeInstanceOf(Date);
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`update form_versions set status = 'published' where id = ${retiring}`))).rejects.toMatchObject({ cause: { message: "published form versions are immutable" } });
    await expect(fixture.admin.query("delete from form_versions where id = $1", [versionA])).rejects.toThrow("published form versions are immutable");
  });
});

describe("tenant isolation and composite parents", () => {
  it("hides one workspace's forms, notices, links and responses from another workspace", async () => {
    await seedA();
    for (const table of ["privacy_notice_versions", "forms", "form_versions", "campaign_response_links"]) {
      const seen = await as("owner-b", tenantB, async (tx) => rows(await tx.execute(sql.raw(`select tenant_id from ${table}`))));
      expect(seen.every((row) => row.tenant_id === tenantB), table).toBe(true);
    }
    expect(await as("owner-b", tenantB, async (tx) => rows(await tx.execute(sql`select id from campaign_responses where tenant_id = ${tenantA}`)))).toEqual([]);
    // A forged hint is refused before any query; a forged transaction setting still sees nothing.
    await expect(as("owner-b", tenantA, (tx) => tx.execute(sql`select 1`))).rejects.toMatchObject({ status: 403 });
    const forged = await withUser(fixture.db, "owner-b", async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantA}, true)`);
      const counts: number[] = [];
      for (const table of ["forms", "form_versions", "privacy_notice_versions", "campaign_response_links"]) counts.push(rows(await tx.execute(sql.raw(`select id from ${table}`))).length);
      return counts;
    });
    expect(forged).toEqual([0, 0, 0, 0]);
    await expect(withUser(fixture.db, "owner-b", async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantA}, true)`);
      return tx.execute(sql`select id from campaign_responses`);
    }).then((result) => result.rows)).resolves.toEqual([]);
  });

  it("rejects writes into another workspace and cross-workspace or cross-campaign parents", async () => {
    await expect(as("owner-b", tenantB, (tx) => tx.execute(sql`insert into forms (tenant_id, name, created_by) values (${tenantA}, 'Forged', 'owner-b')`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(draftVersion("owner-a", tenantA, formA, { notice: noticeB, version: 20 })).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(link("owner-a", tenantA, campaignB, null, "draft")).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(link("owner-a", tenantA, campaignA, versionB, "draft")).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, public_code, created_by, status) values (${tenantA}, ${campaignA}, ${code()}, 'owner-a', 'published')`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(as("viewer-a", tenantA, (tx) => tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, public_code, created_by) values (${tenantA}, ${campaignA}, ${code()}, 'viewer-a')`))).rejects.toMatchObject({ cause: { code: "42501" } });
    // HC-03: both codes are generated by the database. A caller-supplied code (malformed or another
    // workspace's) is overwritten, and the global unique index still holds even for owner DML.
    const [{ public_code: first }] = await as("owner-a", tenantA, async (tx) => rows<{ public_code: string }>(await tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, public_code, created_by) values (${tenantA}, ${campaignA}, 'ABC', 'owner-a') returning public_code`)));
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    const [{ public_code: second }] = await as("owner-b", tenantB, async (tx) => rows<{ public_code: string }>(await tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, public_code, created_by) values (${tenantB}, ${campaignB}, ${first}, 'owner-b') returning public_code`)));
    expect(second).toMatch(/^[a-f0-9]{32}$/);
    expect(second).not.toBe(first);
    await expect(fixture.admin.query("update campaign_response_links set public_code = $1, code_generation = code_generation + 1 where tenant_id = $2 and public_code = $3", [first, tenantB, second])).rejects.toMatchObject({ code: "23505" });
    // A response must agree with its link's campaign and form version, inside one workspace: the
    // guard refuses it, and the composite key refuses it independently of the guard.
    const mismatches = [[tenantA, campaignA2, linkA, versionA], [tenantA, campaignB, linkB, versionB], [tenantB, campaignB, linkA, versionA], [tenantA, campaignA, linkA, versionB]];
    for (const [tenant, campaign, source, version] of mismatches) {
      await expect(seedResponse({ tenant, campaign, link: source, version, notice: noticeA })).rejects.toThrow("response source is not accepting responses");
    }
    await fixture.admin.query("alter table campaign_responses disable trigger campaign_response_guard");
    try {
      for (const [tenant, campaign, source, version] of mismatches) {
        await expect(fixture.admin.query("insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id, expires_at) values ($1,$2,$3,$4,$5, now())", [tenant, campaign, source, version, randomUUID()])).rejects.toMatchObject({ code: "23503" });
      }
    } finally { await fixture.admin.query("alter table campaign_responses enable trigger campaign_response_guard"); }
  });
});

describe("restricted pending responses", () => {
  it("shows owners/admins metadata only, members and viewers nothing, and nobody the personal columns", async () => {
    const response = await seedA({ grants: [{ purpose: "outreach_follow_up", channel: "email" }] });
    // HC-DEC2: pending rows are invisible to direct reads for every role, owners and admins included; see hc-dec2-pending-access.test.ts.
    for (const user of ["owner-a", "admin-a", "member-a", "viewer-a"]) {
      expect(await as(user, tenantA, async (tx) => rows(await tx.execute(sql`select id, status from campaign_responses where id = ${response.id}`)))).toEqual([]);
    }
    for (const user of ["owner-a", "admin-a"]) await expect(as(user, tenantA, (tx) => tx.execute(sql`select purpose from campaign_response_consents`))).rejects.toMatchObject({ cause: { code: "42501" } });
    for (const column of ["preferred_name", "public_submission_id", "contact_id", "locale", "*"]) {
      await expect(as("owner-a", tenantA, (tx) => tx.execute(sql.raw(`select ${column} from campaign_responses`)))).rejects.toMatchObject({ cause: { code: "42501" } });
    }
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`select value from campaign_response_contact_methods`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id) values (${tenantA}, ${campaignA}, ${linkA}, ${versionA}, ${randomUUID()})`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`update campaign_responses set status = 'erased' where id = ${response.id}`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`insert into campaign_response_consents (tenant_id, response_id, purpose, status, form_version_id, notice_version_id, actor_kind) values (${tenantA}, ${response.id}, 'newsletter', 'granted', ${versionA}, ${noticeA}, 'subject')`))).rejects.toMatchObject({ cause: { code: "42501" } });

    const summaries = await listPendingResponseSummaries(fixture.db, "admin-a", tenantA, campaignA);
    const summary = summaries.find((row) => row.id === response.id)!;
    expect(Object.keys(summary).sort()).toEqual(["activePurposes", "expiresAt", "formVersionId", "id", "linkId", "noticeVersionId", "status", "submittedAt"]);
    expect(summary.activePurposes).toEqual(["outreach_follow_up"]);
    expect(JSON.stringify(summaries)).not.toMatch(/Synthetic Guest|guest-a@example\.test/);
    await expect(listPendingResponseSummaries(fixture.db, "member-a", tenantA, campaignA)).rejects.toMatchObject({ status: 403 });
    await expect(listPendingResponseSummaries(fixture.db, "owner-b", tenantA, campaignA)).rejects.toMatchObject({ status: 403 });
    expect(await listPendingResponseSummaries(fixture.db, "owner-b", tenantB, campaignA)).toEqual([]);
  });

  it("accepts a response only from a published link and version, with server-set time and expiry", async () => {
    const draftLink = await link("owner-a", tenantA, campaignA, versionA, "draft");
    await expect(seedResponse({ tenant: tenantA, campaign: campaignA, link: draftLink, version: versionA, notice: noticeA })).rejects.toThrow("response source is not accepting responses");
    const resourceOnly = await link("owner-a", tenantA, campaignA, null);
    await expect(fixture.admin.query("insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id) values ($1,$2,$3,$4,$5)", [tenantA, campaignA, resourceOnly, versionA, randomUUID()])).rejects.toThrow("response source is not accepting responses");
    const retiring = await draftVersion("owner-a", tenantA, formA, { notice: noticeA, version: 30 });
    await publish("owner-a", tenantA, retiring);
    const retiringLink = await link("owner-a", tenantA, campaignA, retiring);
    await seedResponse({ tenant: tenantA, campaign: campaignA, link: retiringLink, version: retiring, notice: noticeA });
    await as("owner-a", tenantA, (tx) => tx.execute(sql`update form_versions set status = 'retired' where id = ${retiring}`));
    await expect(seedResponse({ tenant: tenantA, campaign: campaignA, link: retiringLink, version: retiring, notice: noticeA })).rejects.toThrow("response source is not accepting responses");

    const before = Date.now();
    const { rows: [forged] } = await fixture.admin.query(`insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id, submitted_at, expires_at)
      values ($1,$2,$3,$4,$5,'2000-01-01','2999-01-01') returning submitted_at, expires_at`, [tenantA, campaignA, linkA, versionA, randomUUID()]);
    expect(forged.submitted_at.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(forged.expires_at.getTime() - forged.submitted_at.getTime()).toBe(30 * 24 * 3600 * 1000);
    await expect(fixture.admin.query("insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id, status) values ($1,$2,$3,$4,$5,'associated')", [tenantA, campaignA, linkA, versionA, randomUUID()])).rejects.toThrow("responses start pending and unassociated");
    await expect(fixture.admin.query(`insert into campaign_response_contact_methods (tenant_id, response_id, kind, value, normalized_value, verified_at) select tenant_id, id, 'phone', '+1555', '+1555', now() from campaign_responses where tenant_id = $1 limit 1`, [tenantA])).rejects.toThrow("contact methods start unverified");
  });

  it("makes a retried submission one response per campaign", async () => {
    const first = await seedA();
    await expect(fixture.admin.query("insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id) values ($1,$2,$3,$4,$5)", [tenantA, campaignA, linkA, versionA, first.submission])).rejects.toMatchObject({ code: "23505", constraint: "campaign_responses_submission_idx" });
    const otherLink = await link("owner-a", tenantA, campaignA2, versionA);
    await expect(fixture.admin.query("insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id) values ($1,$2,$3,$4,$5)", [tenantA, campaignA2, otherLink, versionA, first.submission])).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("separate purposes: no silent enrollment, association or bundled consent", () => {
  it("records only the chosen purpose and creates no contact, CRM consent, membership or event", async () => {
    const counts = async () => Promise.all(["contacts", "contact_identifiers", "contact_consents", "crm_associations", "workspace_members", "outbox_events", "jobs"].map((table) => tenantRowCount(table, tenantA)));
    const before = await counts();
    const response = await seedA({ grants: [{ purpose: "newsletter", channel: "email" }] });
    expect(await counts()).toEqual(before);
    expect(await isConnectResponsePurposeActive(fixture.db, "owner-a", tenantA, response.id, "newsletter")).toBe(true);
    expect(await isConnectResponsePurposeActive(fixture.db, "owner-a", tenantA, response.id, "outreach_follow_up")).toBe(false);
    expect(await isConnectResponsePurposeActive(fixture.db, "owner-a", tenantA, response.id, "account_communications")).toBe(false);
    const { rows: [state] } = await fixture.admin.query("select contact_id, status from campaign_responses where id = $1", [response.id]);
    expect(state).toEqual({ contact_id: null, status: "pending" });
  });

  it("rejects grants the form did not offer, staff-made grants, unbacked channels and mismatched evidence", async () => {
    const narrowNotice = await notice("owner-a", tenantA, "Synthetic narrow notice");
    const narrowForm = await draftVersion("owner-a", tenantA, formA, { notice: narrowNotice.id, purposes: ["outreach_follow_up"], version: 40 });
    await publish("owner-a", tenantA, narrowForm);
    const narrowLink = await link("owner-a", tenantA, campaignA, narrowForm);
    const response = await seedResponse({ tenant: tenantA, campaign: campaignA, link: narrowLink, version: narrowForm, notice: narrowNotice.id });
    const evidence = (purpose: string, extra: { status?: string; channel?: string | null; version?: string; notice?: string; actor?: string; by?: string | null } = {}) => fixture.admin.query(
      `insert into campaign_response_consents (tenant_id, response_id, purpose, status, channel, form_version_id, notice_version_id, actor_kind, recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenantA, response.id, purpose, extra.status ?? "granted", extra.channel ?? null, extra.version ?? narrowForm, extra.notice ?? narrowNotice.id, extra.actor ?? "subject", extra.by ?? null]);
    await expect(evidence("newsletter")).rejects.toThrow("purpose was not offered by this form");
    await expect(evidence("marketing")).rejects.toThrow("purpose was not offered by this form");
    await expect(evidence("outreach_follow_up", { actor: "staff", by: "owner-a" })).rejects.toMatchObject({ constraint: "campaign_response_consent_grantor" });
    await expect(evidence("outreach_follow_up", { channel: "sms" })).rejects.toThrow("channel has no contact method");
    await expect(evidence("outreach_follow_up", { notice: noticeA })).rejects.toThrow("evidence must reference the presented form and notice");
    await expect(evidence("outreach_follow_up", { version: versionA, notice: noticeA })).rejects.toThrow("evidence must reference the presented form and notice");
    await expect(evidence("outreach_follow_up", { status: "withdrawn" })).rejects.toThrow("nothing to withdraw");
    await evidence("outreach_follow_up");
    await expect(evidence("outreach_follow_up")).rejects.toMatchObject({ constraint: "campaign_response_consents_grant_idx" });
    await expect(fixture.admin.query("update campaign_response_consents set purpose = 'newsletter' where response_id = $1", [response.id])).rejects.toThrow("consent evidence is append-only");
    await expect(fixture.admin.query("delete from campaign_response_consents where response_id = $1", [response.id])).rejects.toThrow("consent evidence is append-only");
  });

  it("allows no association in HC-02 and only same-workspace contacts in the reserved link", async () => {
    const response = await seedA();
    const contactA = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic CRM person" });
    const contactB = await createContact(fixture.db, "owner-b", tenantB, { name: "Synthetic other person" });
    await expect(fixture.admin.query("update campaign_responses set status = 'associated', contact_id = $2, associated_at = now() where id = $1", [response.id, contactA.id])).rejects.toThrow("response association requires a verified claim");
    await expect(as("owner-a", tenantA, (tx) => tx.execute(sql`update campaign_responses set contact_id = ${contactA.id} where id = ${response.id}`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(fixture.admin.query("update campaign_responses set campaign_id = $2 where id = $1", [response.id, campaignA2])).rejects.toThrow("response identity is immutable");
    await expect(fixture.admin.query("delete from campaign_responses where id = $1", [response.id])).rejects.toThrow("responses are erased, not deleted");
    // Even with the guard bypassed, the composite key refuses another workspace's contact.
    await fixture.admin.query("alter table campaign_responses disable trigger campaign_response_guard");
    try {
      await expect(fixture.admin.query("update campaign_responses set status = 'associated', contact_id = $2, associated_at = now(), expires_at = null where id = $1", [response.id, contactB.id])).rejects.toMatchObject({ code: "23503" });
    } finally { await fixture.admin.query("alter table campaign_responses enable trigger campaign_response_guard"); }
  });
});

describe("withdrawal, erasure and retention hooks", () => {
  it("withdraws one purpose for owners/admins only, without touching the others", async () => {
    const response = await seedA({ grants: [{ purpose: "newsletter", channel: "email" }, { purpose: "outreach_follow_up", channel: "email" }] });
    await expect(withdrawConnectResponsePurpose(fixture.db, "member-a", tenantA, response.id, "newsletter")).rejects.toMatchObject({ status: 403 });
    await expect(as("member-a", tenantA, (tx) => tx.execute(sql`select public.withdraw_connect_response_purpose(${tenantA}::uuid, ${response.id}::uuid, 'newsletter')`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(as("owner-b", tenantB, (tx) => tx.execute(sql`select public.withdraw_connect_response_purpose(${tenantA}::uuid, ${response.id}::uuid, 'newsletter')`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(withdrawConnectResponsePurpose(fixture.db, "owner-b", tenantB, response.id, "newsletter")).rejects.toMatchObject({ status: 404 });
    expect(() => withdrawConnectResponsePurpose(fixture.db, "admin-a", tenantA, response.id, "marketing")).toThrow();
    await expect(as("admin-a", tenantA, async (tx) => rows(await tx.execute(sql`select public.withdraw_connect_response_purpose(${tenantA}::uuid, ${response.id}::uuid, 'marketing') as outcome`)))).resolves.toEqual([{ outcome: "not_granted" }]);
    expect(await withdrawConnectResponsePurpose(fixture.db, "admin-a", tenantA, response.id, "newsletter")).toEqual({ outcome: "withdrawn" });
    expect(await withdrawConnectResponsePurpose(fixture.db, "admin-a", tenantA, response.id, "newsletter")).toEqual({ outcome: "already_withdrawn" });
    expect(await withdrawConnectResponsePurpose(fixture.db, "admin-a", tenantA, response.id, "account_communications")).toEqual({ outcome: "not_granted" });
    expect(await isConnectResponsePurposeActive(fixture.db, "owner-a", tenantA, response.id, "newsletter")).toBe(false);
    expect(await isConnectResponsePurposeActive(fixture.db, "owner-a", tenantA, response.id, "outreach_follow_up")).toBe(true);
    await expect(fixture.admin.query(`insert into campaign_response_consents (tenant_id, response_id, purpose, status, form_version_id, notice_version_id, actor_kind) values ($1,$2,'newsletter','granted',$3,$4,'subject')`, [tenantA, response.id, versionA, noticeA])).rejects.toThrow();
    const { rows: [withdrawal] } = await fixture.admin.query("select actor_kind, recorded_by, channel from campaign_response_consents where response_id = $1 and status = 'withdrawn'", [response.id]);
    expect(withdrawal).toEqual({ actor_kind: "staff", recorded_by: "admin-a", channel: null });
    const { rows: audit } = await fixture.admin.query("select actor_id, target_id, metadata from audit_logs where tenant_id = $1 and action = 'connect.response.withdraw' and target_id = $2", [tenantA, response.id]);
    expect(audit).toEqual([{ actor_id: "admin-a", target_id: response.id, metadata: { purpose: "newsletter" } }]);
    // The activity check refuses a forged workspace.
    await expect(as("owner-b", tenantB, (tx) => tx.execute(sql`select public.connect_response_purpose_active(${tenantA}::uuid, ${response.id}::uuid, 'outreach_follow_up')`))).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("answers the purpose recheck only to live owners/admins of the response's workspace, in direct SQL too (review B1)", async () => {
    const response = await seedA({ grants: [{ purpose: "outreach_follow_up", channel: "email" }] });
    const check = sql`select public.connect_response_purpose_active(${tenantA}::uuid, ${response.id}::uuid, 'outreach_follow_up') as active`;
    for (const user of ["owner-a", "admin-a"]) expect(await as(user, tenantA, async (tx) => rows(await tx.execute(check)))).toEqual([{ active: true }]);
    for (const user of ["member-a", "viewer-a"]) await expect(as(user, tenantA, (tx) => tx.execute(check))).rejects.toMatchObject({ cause: { code: "42501" } });
    await fixture.db.insert(users).values(["outsider-b1", "revoked-b1"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
    const forged = (user: string) => withUser(fixture.db, user, async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantA}, true)`);
      return tx.execute(check);
    });
    // A non-member with a forged tenant setting.
    await expect(forged("outsider-b1")).rejects.toMatchObject({ cause: { code: "42501" } });
    // Tenant context without any authenticated actor.
    await expect(fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantA}, true)`);
      return tx.execute(check);
    })).rejects.toMatchObject({ cause: { code: "42501" } });
    // An administrator whose membership was revoked, still holding the response id.
    await putMember(fixture.db, "owner-a", tenantA, "revoked-b1@example.test", "admin");
    expect(await as("revoked-b1", tenantA, async (tx) => rows(await tx.execute(check)))).toEqual([{ active: true }]);
    await fixture.admin.query("delete from workspace_members where tenant_id = $1 and user_id = 'revoked-b1'", [tenantA]);
    await expect(forged("revoked-b1")).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("erases a pending response: contact methods, evidence detail, payload references and audit links", async () => {
    const response = await seedA({ name: "Erase Me Guest", email: "erase-me@example.test", grants: [{ purpose: "newsletter", channel: "email" }, { purpose: "account_communications", channel: "email" }] });
    const keep = await seedResponse({ tenant: tenantB, campaign: campaignB, link: linkB, version: versionB, notice: noticeB, name: "Erase Me Guest", email: "erase-me@example.test", grants: [{ purpose: "newsletter", channel: "email" }] });
    await withdrawConnectResponsePurpose(fixture.db, "owner-a", tenantA, response.id, "newsletter");
    const key = randomUUID();
    await fixture.admin.query("insert into outbox_events (tenant_id, kind, idempotency_key, fingerprint, payload) values ($1, 'connect.response_submitted', $2, $3, $4)", [tenantA, key, "a".repeat(64), { responseId: response.id, purpose: "newsletter" }]);
    await fixture.admin.query("insert into jobs (tenant_id, kind, idempotency_key, fingerprint, payload) values ($1, 'connect.response_submitted', $2, $3, $4)", [tenantA, key, "a".repeat(64), { responseId: response.id }]);
    await fixture.admin.query("insert into outbox_events (tenant_id, kind, idempotency_key, fingerprint, payload) values ($1, 'connect.response_submitted', $2, $3, $4)", [tenantB, key, "a".repeat(64), { responseId: keep.id }]);

    // What an authorized owner could observe and cache before erasure (review B3).
    // Since HC-DEC2 an owner reads pending rows only through the audited definer, which never returns evidence ids or times; the
    // evidence is read directly here to prove that nothing of it survives erasure.
    const observedResponse = (await listPendingResponseSummaries(fixture.db, "owner-a", tenantA, campaignA)).filter((row) => row.id === response.id);
    const observedEvidence = (await fixture.admin.query("select id, recorded_at, occurred_at from campaign_response_consents where response_id = $1", [response.id])).rows as { id: string; recorded_at: Date; occurred_at: Date }[];
    expect(observedResponse).toHaveLength(1); expect(observedEvidence).toHaveLength(3);
    await expect(eraseConnectResponse(fixture.db, "member-a", tenantA, response.id)).rejects.toMatchObject({ status: 403 });
    await expect(as("viewer-a", tenantA, (tx) => tx.execute(sql`select public.erase_connect_response(${tenantA}::uuid, ${response.id}::uuid)`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(eraseConnectResponse(fixture.db, "owner-b", tenantB, response.id)).rejects.toMatchObject({ status: 404 });
    await expect(as("owner-b", tenantB, (tx) => tx.execute(sql`select public.erase_connect_response(${tenantA}::uuid, ${response.id}::uuid)`))).rejects.toMatchObject({ cause: { code: "42501" } });
    expect(await eraseConnectResponse(fixture.db, "admin-a", tenantA, response.id)).toEqual({ erased: true });
    await expect(eraseConnectResponse(fixture.db, "admin-a", tenantA, response.id)).rejects.toMatchObject({ status: 404 });

    // No app-readable key or exact time survives to join the cached view to the tombstone.
    const visibleAfter = await as("owner-a", tenantA, async (tx) => JSON.stringify([
      rows(await tx.execute(sql`select tenant_id, id, campaign_id, link_id, form_version_id, status, submitted_at, expires_at, associated_at, erased_at from campaign_responses`)),
      await tx.execute(sql`select 1`).then(() => [])]));
    for (const value of [response.id, ...observedEvidence.map((row) => row.id), ...observedEvidence.flatMap((row) => [row.recorded_at, row.occurred_at]).map((time) => new Date(time).toISOString())]) {
      expect(visibleAfter).not.toContain(value);
    }
    expect((await fixture.admin.query("select id from campaign_response_consents where id = any($1::uuid[])", [observedEvidence.map((row) => row.id)])).rows).toEqual([]);
    expect(await as("owner-a", tenantA, async (tx) => rows(await tx.execute(sql`select id from campaign_responses where id = ${response.id}`)))).toEqual([]);
    const dump = async (tenant: string) => JSON.stringify(await Promise.all(["campaign_responses", "campaign_response_contact_methods", "campaign_response_consents", "outbox_events", "jobs", "audit_logs"].map(async (table) => (await fixture.admin.query(`select * from ${table} where tenant_id = $1`, [tenant])).rows)));
    const after = await dump(tenantA);
    for (const secret of [response.id, response.submission, "Erase Me Guest", "erase-me@example.test"]) expect(after).not.toContain(secret);
    const { rows: tombstones } = await fixture.admin.query("select * from campaign_responses where tenant_id = $1 and status = 'erased'", [tenantA]);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatchObject({ campaign_id: campaignA, link_id: linkA, preferred_name: null, locale: null, contact_id: null, expires_at: null });
    expect(tombstones[0].submitted_at.toISOString()).toMatch(/T00:00:00\.000Z$/);
    const { rows: evidence } = await fixture.admin.query("select purpose, status, channel, recorded_by, redacted_at, recorded_at from campaign_response_consents where tenant_id = $1 and response_id = $2 order by purpose, status", [tenantA, tombstones[0].id]);
    expect(evidence.map((row) => [row.purpose, row.status, row.channel, row.recorded_by])).toEqual([["account_communications", "granted", null, null], ["newsletter", "granted", null, null], ["newsletter", "withdrawn", null, null]]);
    for (const row of evidence) { expect(row.redacted_at).toBeInstanceOf(Date); expect(row.recorded_at.toISOString()).toMatch(/T00:00:00\.000Z$/); }
    expect((await fixture.admin.query("select payload from outbox_events where tenant_id = $1 and idempotency_key = $2", [tenantA, key])).rows[0].payload).toEqual({ responseId: null, purpose: "newsletter" });
    expect((await fixture.admin.query("select payload from jobs where tenant_id = $1 and idempotency_key = $2", [tenantA, key])).rows[0].payload).toEqual({ responseId: null });
    expect((await fixture.admin.query("select count(*)::int as count from audit_logs where tenant_id = $1 and action = 'connect.response.erase' and target_id is null and actor_id = 'admin-a'", [tenantA])).rows[0].count).toBe(1);
    // The other workspace's identical-looking guest is untouched.
    expect(await dump(tenantB)).toContain(keep.id);
    expect((await fixture.admin.query("select value from campaign_response_contact_methods where tenant_id = $1 and response_id = $2", [tenantB, keep.id])).rows).toEqual([{ value: "erase-me@example.test" }]);
    // Audit history stays append-only outside controlled erasure.
    await expect(fixture.admin.query("update audit_logs set target_id = null where tenant_id = $1 and action = 'connect.response.withdraw'", [tenantA])).rejects.toThrow("append-only");
  });

  it("purges only expired pending responses, for owners/admins", async () => {
    const expired = await seedA({ name: "Expired Guest", grants: [{ purpose: "outreach_follow_up", channel: "email" }] });
    const current = await seedA();
    // Retention elapsed (simulated clock): only a controlled writer may move expiry.
    await fixture.admin.query("update campaign_responses set expires_at = now() - interval '1 second' where id = $1", [expired.id]);
    expect(await isConnectResponsePurposeActive(fixture.db, "owner-a", tenantA, expired.id, "outreach_follow_up")).toBe(false);
    // The summary agrees with the authoritative recheck: nothing is in force after expiry (review N1).
    const summaries = await listPendingResponseSummaries(fixture.db, "owner-a", tenantA, campaignA);
    expect(summaries.find((row) => row.id === expired.id)?.activePurposes).toEqual([]);
    await expect(purgeExpiredConnectResponses(fixture.db, "member-a", tenantA)).rejects.toMatchObject({ status: 403 });
    expect(await purgeExpiredConnectResponses(fixture.db, "owner-b", tenantB)).toEqual({ purged: 0 });
    expect(await purgeExpiredConnectResponses(fixture.db, "owner-a", tenantA)).toEqual({ purged: 1 });
    expect((await fixture.admin.query("select count(*)::int as count from campaign_responses where id = $1", [expired.id])).rows[0].count).toBe(0);
    expect((await fixture.admin.query("select status from campaign_responses where id = $1", [current.id])).rows).toEqual([{ status: "pending" }]);
    expect((await fixture.admin.query("select count(*)::int as count from campaign_responses where tenant_id = $1 and preferred_name = 'Expired Guest'", [tenantA])).rows[0].count).toBe(0);
    expect((await fixture.admin.query("select metadata from audit_logs where tenant_id = $1 and action = 'connect.response.purge'", [tenantA])).rows).toEqual([{ metadata: { count: "1" } }]);
    expect(await purgeExpiredConnectResponses(fixture.db, "admin-a", tenantA)).toEqual({ purged: 0 });
  });

  it("erases a person's associated responses through erase_contact (HC-06 handoff hook)", async () => {
    const contact = await createContact(fixture.db, "owner-a", tenantA, { name: "Associated Person", email: "associated@example.test" });
    const response = await seedA({ name: "Associated Guest", email: "associated@example.test", grants: [{ purpose: "outreach_follow_up", channel: "email" }] });
    // Simulates HC-06's verified association, which HC-02 deliberately cannot perform.
    await fixture.admin.query("alter table campaign_responses disable trigger campaign_response_guard");
    try {
      await fixture.admin.query("update campaign_responses set status = 'associated', contact_id = $2, associated_at = now(), expires_at = null where id = $1", [response.id, contact.id]);
    } finally { await fixture.admin.query("alter table campaign_responses enable trigger campaign_response_guard"); }
    expect(await withdrawConnectResponsePurpose(fixture.db, "owner-a", tenantA, response.id, "outreach_follow_up")).toEqual({ outcome: "not_pending" });
    expect(await eraseContact(fixture.db, "owner-a", tenantA, contact.id)).toEqual({ erased: true });
    const after = JSON.stringify((await fixture.admin.query("select * from campaign_responses where tenant_id = $1", [tenantA])).rows)
      + JSON.stringify((await fixture.admin.query("select * from campaign_response_contact_methods where tenant_id = $1", [tenantA])).rows);
    for (const secret of [response.id, contact.id, "Associated Guest", "associated@example.test"]) expect(after).not.toContain(secret);
  });
});
