import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GET } from "../../src/app/f/[slug]/route";
import { POST } from "../../src/app/f/[slug]/submit/route";
import { fullState, serializeSourceRule, sourceRule } from "../../src/lib/crm-fields";
import { buildForm, type FormDefinition } from "../../src/lib/crm-forms";
import { mayContact } from "../../src/server/consent-gate";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { createContact, eraseContact, getContact, listContacts } from "../../src/server/contacts";
import { listCrmFormResponses, purgeCrmFormResponses, transitionCrmForm } from "../../src/server/crm-form-publication";
import { createCrmForm, getCrmForm, saveCrmForm } from "../../src/server/crm-forms";
import { exportCount, exportRecords } from "../../src/server/crm-export";
import { resolveListView } from "../../src/server/crm-list-view";
import { sourceOptions } from "../../src/server/crm-sources";
import { createView } from "../../src/server/crm-views";
import { createPipeline } from "../../src/server/crm-deals";
import { mergeContacts } from "../../src/server/crm-merge";
import { withTenant } from "../../src/server/tenancy";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => fixture.db }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
const legacy = { tenant: randomUUID(), form: randomUUID(), contact: randomUUID(), owner: "legacy-crm-form-owner" };
const origin = "http://localhost:3000";

beforeAll(async () => {
  fetchSpy = noNetwork();
  fixture = await testDatabase({ migrationOwner: true, beforeCrmFormsMigration: async db => {
    await db.query("insert into users(id,name,email) values($1,$1,$2)", [legacy.owner, `${legacy.owner}@example.test`]);
    await db.query("insert into workspaces(tenant_id,name,created_by) values($1,'Existing ministry',$2)", [legacy.tenant, legacy.owner]);
    await db.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'owner')", [legacy.tenant, legacy.owner]);
    await db.query("insert into forms(tenant_id,id,name,created_by) values($1,$2,'Draft before migration',$3)", [legacy.tenant, legacy.form, legacy.owner]);
    const earlier = buildForm(null, { type: "people" }, key => key, new Date().toISOString());
    await db.query("insert into form_versions(tenant_id,form_id,version,definition,created_by) values($1,$2,1,$3,$4)",
      [legacy.tenant, legacy.form, earlier, legacy.owner]);
  }, beforeCrmFormProvenanceMigration: async db => {
    await db.query("insert into contacts(tenant_id,id,name) values($1,$2,'Existing person')", [legacy.tenant, legacy.contact]);
    await db.query("insert into contact_source_events(tenant_id,contact_id,kind,outcome) values($1,$2,'manual','created')",
      [legacy.tenant, legacy.contact]);
  } });
  people = await seedPeople(fixture, "hosted-forms");
  vi.stubEnv("HARVEST_CRM_FORMS", "synthetic");
  vi.stubEnv("HARVEST_CRM_FORMS_TEST_KEY", "37".repeat(32));
  vi.stubEnv("DATABASE_URL", fixture.appURL);
  vi.stubEnv("BETTER_AUTH_URL", origin);
}, 90_000);
afterAll(async () => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); } finally {
    fetchSpy?.mockRestore();
    vi.unstubAllEnvs();
    await fixture?.close();
  }
});

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const get = (slug: string) => GET(new Request(`${origin}/f/${slug}`), ctx(slug));
const post = (slug: string, raw: string, requestOrigin = origin, mime = "application/json") => POST(new Request(`${origin}/f/${slug}/submit`, {
  method: "POST", headers: { origin: requestOrigin, "content-type": mime }, body: raw,
}), ctx(slug));
async function publish(id: string, slug: string, revision: number) {
  return transitionCrmForm(fixture.db, people.admin, people.tenant, id, { action: "publish", slug, revision });
}
async function draft(change?: (definition: FormDefinition) => void) {
  const created = await createCrmForm(fixture.db, people.admin, people.tenant, { destination: { type: "people" } });
  const { definition } = await getCrmForm(fixture.db, people.admin, people.tenant, created.id);
  definition.blocks.unshift(
    { id: "fullname", type: "short", label: "Name", required: true, mapTo: "name" },
    { id: "email000", type: "email", label: "Email", required: false, mapTo: "email" },
    { id: "phone000", type: "phone", label: "Phone", required: false, mapTo: "phone" },
    { id: "company0", type: "short", label: "Organization", required: false, mapTo: "organization" },
    { id: "choice00", type: "choice", label: "Choice", required: false, options: ["A", "B"] },
  );
  definition.settings.spamCheck = false;
  definition.settings.ownerId = people.member;
  definition.settings.labels = ["Visitor", "Registration"];
  change?.(definition);
  const saved = await saveCrmForm(fixture.db, people.admin, people.tenant, created.id, { definition, revision: 1 });
  return { id: created.id, definition, revision: saved.revision };
}
const answers = (email = "visitor@example.test") => ({ fullname: "Synthetic Person", email000: email, choice00: "A", consent0: "yes" });
async function body(slug: string, responseAnswers: Record<string, string> = answers()) {
  const response = await get(slug);
  expect(response.status).toBe(200);
  const { proof } = await response.json() as { proof: string };
  return { proof, answers: responseAnswers };
}

it("upgrades an existing draft as a restricted owner and scopes table and function privileges", async () => {
  expect(await getCrmForm(fixture.db, legacy.owner, legacy.tenant, legacy.form)).toMatchObject({ responseCount: 0, publication: null });
  expect(await getContact(fixture.db, legacy.owner, legacy.tenant, legacy.contact)).toMatchObject({
    sourceHistory: [{ kind: "manual", outcome: "created" }],
  });
  const { rows: [owner] } = await fixture.admin.query("select rolsuper, rolbypassrls from pg_roles where rolname=$1", [fixture.migrationOwner]);
  expect(owner).toEqual({ rolsuper: false, rolbypassrls: false });
  const { rows } = await fixture.admin.query(`select relname, relforcerowsecurity from pg_class
    where relname in ('crm_form_responses','crm_form_addresses','crm_form_publications','crm_form_quotas','crm_form_receipts')`);
  expect(rows).toHaveLength(5);
  expect(rows.every(row => row.relforcerowsecurity)).toBe(true);
  const { rows: procedures } = await fixture.admin.query(`select p.proname, p.prosecdef, p.proconfig,
      has_function_privilege('harvest_worker',p.oid,'execute') as worker,
      has_function_privilege('harvest_app',p.oid,'execute') as app,
      exists(select from aclexplode(p.proacl) acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE') as everyone
    from pg_proc p where proname in ('crm_form_public_form','crm_form_submit')`);
  expect(procedures).toHaveLength(2);
  for (const procedure of procedures) expect(procedure).toMatchObject({
    prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"], worker: false, app: true, everyone: false,
  });
  await expect(fixture.pool.query("select * from public.crm_form_receipts")).rejects.toMatchObject({ code: "42501" });
});

it("refuses owner publication and retirement in production mode", async () => {
  const unpublished = await draft();
  const active = await draft();
  await publish(active.id, "production-mode-active", active.revision);
  const transitions = [
    { formId: unpublished.id, input: { action: "publish", slug: "production-mode-blocked", revision: unpublished.revision } },
    { formId: active.id, input: { action: "retire" } },
  ];
  for (const setting of ["NODE_ENV", "VERCEL_ENV", "HARVEST_ENV"]) {
    const prior = process.env[setting];
    process.env[setting] = "production";
    try {
      expect((await get("production-mode-active")).status).toBe(404);
      expect((await post("production-mode-active", "{}")).status).toBe(404);
      for (const { formId, input } of transitions) {
        await expect(transitionCrmForm(fixture.db, people.owner, people.tenant, formId, input)).rejects.toMatchObject({ status: 404 });
      }
    } finally {
      if (prior === undefined) delete process.env[setting];
      else process.env[setting] = prior;
    }
  }
  expect(await getCrmForm(fixture.db, people.owner, people.tenant, unpublished.id)).toMatchObject({ publication: null });
  expect(await getCrmForm(fixture.db, people.owner, people.tenant, active.id)).toMatchObject({ publication: { state: "published" } });
  const { rows } = await fixture.admin.query("select count(*)::int n from privacy_notice_versions where tenant_id=$1 and notice_key='crm-hosted-form-v1'", [people.tenant]);
  expect(rows[0].n).toBe(1);
});

it("publishes, freezes edits, keeps the slug, binds notice versions and audits retirement", async () => {
  const form = await draft(definition => { definition.title = "First published title"; });
  await expect(publish(form.id, "Admin", form.revision)).rejects.toMatchObject({ status: 400 });
  await expect(publish(form.id, "admin", form.revision)).rejects.toMatchObject({ status: 400 });
  await expect(publish(form.id, "bad--slug", form.revision)).rejects.toMatchObject({ status: 400 });
  await expect(transitionCrmForm(fixture.db, people.member, people.tenant, form.id, { action: "publish", slug: "member-publish", revision: form.revision })).rejects.toMatchObject({ status: 403 });

  const first = await publish(form.id, "publication-test", form.revision);
  expect(first).toMatchObject({ state: "published", slug: "publication-test" });
  await expect(publish(form.id, "renamed-test", form.revision)).rejects.toMatchObject({ status: 409, details: { reason: "immutable_slug" } });
  const other = await createCrmForm(fixture.db, people.outsider, people.other, { destination: { type: "people" } });
  const otherDraft = await getCrmForm(fixture.db, people.outsider, people.other, other.id);
  otherDraft.definition.blocks = form.definition.blocks;
  await saveCrmForm(fixture.db, people.outsider, people.other, other.id, { definition: otherDraft.definition, revision: 1 });
  await expect(transitionCrmForm(fixture.db, people.outsider, people.other, other.id, { action: "publish", slug: "publication-test", revision: 2 })).rejects.toMatchObject({ status: 409 });
  await expect(saveCrmForm(fixture.db, people.owner, people.tenant, form.id, {
    definition: { ...form.definition, settings: { ...form.definition.settings, ownerId: people.outsider } }, revision: form.revision,
  })).rejects.toMatchObject({ status: 400 });
  await expect(withTenant(fixture.db, people.owner, people.tenant, "crm:forms_manage", tx => tx.execute(
    sql`update form_versions set definition = definition || '{"title":"unsafe mutation"}'::jsonb where id = ${first?.versionId}`,
  ))).rejects.toThrow();

  const originalManifest = await (await get("publication-test")).json();
  const submitted = { proof: originalManifest.proof, answers: answers() };
  form.definition.title = "Second draft";
  form.definition.blocks.at(-1)!.text = "Synthetic form wording for the second revision.";
  const revision = await saveCrmForm(fixture.db, people.admin, people.tenant, form.id, { definition: form.definition, revision: form.revision });
  expect(await (await get("publication-test")).json()).toMatchObject({ title: "First published title", notice: originalManifest.notice });
  expect((await fixture.admin.query("select count(*)::int n from form_versions where tenant_id=$1 and form_id=$2", [people.tenant, form.id])).rows[0].n).toBe(2);
  const next = await publish(form.id, "publication-test", revision.revision);
  expect(next?.versionId).not.toBe(first?.versionId);
  expect(await (await get("publication-test")).json()).toMatchObject({
    title: "Second draft", notice: { body: "Synthetic form wording for the second revision.", purpose: "form_response_processing" },
  });
  expect((await post("publication-test", JSON.stringify(submitted))).status).toBe(404);
  await transitionCrmForm(fixture.db, people.owner, people.tenant, form.id, { action: "retire" });
  expect((await get("publication-test")).status).toBe(404);
  expect((await fixture.admin.query("select action from audit_logs where tenant_id=$1 and target_id=$2 and action in ('crm.form.publish','crm.form.retire') order by created_at",
    [people.tenant, form.id])).rows.map(row => row.action)).toEqual(["crm.form.publish", "crm.form.publish", "crm.form.retire"]);
});

it("uses the same neutral 404 for every unavailable public form before inspecting the body", async () => {
  const form = await draft();
  const baseline = await (await get("missing-form")).text();
  const unavailable = async (slug: string) => {
    const read = await get(slug);
    const write = await post(slug, "{{", "https://wrong.example.test");
    expect([read.status, write.status]).toEqual([404, 404]);
    expect(await read.text()).toBe(baseline);
    expect(await write.text()).toBe(baseline);
    expect(write.headers.get("cache-control")).toBe("no-store");
  };
  for (const slug of ["missing-form", "draft-form", "Uppercase", "admin"]) await unavailable(slug);
  await publish(form.id, "archived-form", form.revision);
  await fixture.admin.query("update forms set archived_at=now() where tenant_id=$1 and id=$2", [people.tenant, form.id]);
  await unavailable("archived-form");
  const retired = await draft();
  await publish(retired.id, "retired-form", retired.revision);
  await transitionCrmForm(fixture.db, people.owner, people.tenant, retired.id, { action: "retire" });
  await unavailable("retired-form");
  const disabled = await draft();
  await publish(disabled.id, "disabled-form", disabled.revision);
  const prior = process.env.HARVEST_CRM_FORMS;
  process.env.HARVEST_CRM_FORMS = "off";
  try { await unavailable("disabled-form"); } finally { process.env.HARVEST_CRM_FORMS = prior; }
});

async function campaign(tenantId: string, ownerId: string, title: string) {
  const id = randomUUID();
  await fixture.admin.query(`insert into campaigns(tenant_id,id,owner_user_id,type,status,name,idempotency_key,fingerprint)
    values($1,$2::uuid,$3,'local_outreach','active',$4,$2::uuid::text,repeat('a',64))`, [tenantId, id, ownerId, title]);
  const draftLink = await createConnectLink(fixture.db, ownerId, tenantId, id, {});
  const { link } = await transitionConnectLink(fixture.db, ownerId, tenantId, id, draftLink.id, { action: "publish" });
  return { id, link };
}

it("accepts an account-less response once, scopes provenance, and exposes a paginated manager count", async () => {
  const form = await draft(definition => { definition.destination = { type: "organizations" }; });
  const publication = await publish(form.id, "organization-form", form.revision);
  const local = await campaign(people.tenant, people.owner, "Local campaign");
  const foreign = await campaign(people.other, people.outsider, "Foreign campaign");
  const otherLocal = await campaign(people.tenant, people.owner, "Other local campaign");
  const withOrganization = { ...answers(), company0: "Synthetic Organization" };
  const request = await body("organization-form", withOrganization);
  const send = (data: object) => post("organization-form", JSON.stringify({ ...request, ...data }));
  for (const data of [{ campaign: foreign.id }, { qr: foreign.link.publicCode }, { campaign: otherLocal.id, qr: local.link.publicCode }]) {
    expect((await send(data)).status).toBe(400);
  }
  const original = { campaign: local.id, qr: local.link.publicCode };
  const accountsBefore = (await fixture.admin.query("select count(*)::int n from users")).rows[0].n;
  const outboxBefore = (await fixture.admin.query("select count(*)::int n from outbox_events")).rows[0].n;
  const accepted = await send(original);
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ accepted: true });
  const sources = () => fixture.admin.query(`select s.kind, s.outcome, a.slug, r.form_id, r.campaign_id, r.qr_link_id
    from contact_source_events s join crm_form_responses r on (r.tenant_id,r.id)=(s.tenant_id,s.crm_form_response_id)
    join crm_form_addresses a on (a.tenant_id,a.form_id)=(r.tenant_id,r.form_id) where r.form_id=$1
    order by s.occurred_at`, [form.id]);
  const firstSource = { kind: "form", outcome: "created", slug: "organization-form", form_id: form.id,
    campaign_id: local.id, qr_link_id: local.link.id };
  expect((await sources()).rows).toEqual([firstSource]);
  expect((await send(original)).status).toBe(200);
  expect((await sources()).rows).toEqual([firstSource]);
  expect((await send({ ...original, answers: { ...withOrganization, choice00: "B" } })).status).toBe(409);

  const second = await body("organization-form", { ...withOrganization, fullname: "Unverified overwrite" });
  expect((await send({ ...second, campaign: local.id })).status).toBe(200);
  expect((await sources()).rows).toEqual([firstSource, { ...firstSource, outcome: "updated", qr_link_id: null }]);
  const page = await listCrmFormResponses(fixture.db, people.owner, people.tenant, form.id, { limit: 1 });
  expect(page).toMatchObject({ count: 2, nextCursor: expect.any(String), responses: [{
    versionId: publication?.versionId, ownerId: people.member, labels: ["Registration", "Visitor"], campaignId: local.id,
    createdContact: false, answers: second.answers, consentBlockId: "consent0", noticeVersionId: expect.any(String),
  }] });
  const older = await listCrmFormResponses(fixture.db, people.admin, people.tenant, form.id, { limit: 1, cursor: page.nextCursor });
  expect(older).toMatchObject({ count: 2, nextCursor: null, responses: [{
    contactId: expect.any(String), companyId: expect.any(String), qrLinkId: local.link.id, createdContact: true,
  }] });
  const [saved] = (await fixture.admin.query("select * from crm_form_responses where form_id=$1 order by submitted_at", [form.id])).rows;
  expect((await fixture.admin.query("select name,form_owner_id,form_labels from contacts where tenant_id=$1 and id=$2",
    [people.tenant, saved.contact_id])).rows[0]).toEqual({ name: "Synthetic Person", form_owner_id: people.member, form_labels: ["Registration", "Visitor"] });
  expect((await fixture.admin.query("select count(*)::int n from contact_company_links where tenant_id=$1 and contact_id=$2",
    [people.tenant, saved.contact_id])).rows[0].n).toBe(1);
  expect((await fixture.admin.query("select count(*)::int n from contact_consents where tenant_id=$1 and contact_id=$2",
    [people.tenant, saved.contact_id])).rows[0].n).toBe(0);
  for (const purpose of ["newsletter", "outreach_follow_up", "form_follow_up", "account_communications"] as const) {
    const result = await withTenant(fixture.db, people.owner, people.tenant, "crm:forms_manage",
      (tx, tenant) => mayContact(tx, tenant, saved.contact_id, purpose, "email"));
    expect(result.allowed).toBe(false);
  }
  expect((await fixture.admin.query("select count(*)::int n from users")).rows[0].n).toBe(accountsBefore);
  expect((await fixture.admin.query("select count(*)::int n from outbox_events")).rows[0].n).toBe(outboxBefore);
  expect((await fixture.admin.query("select count(*)::int n from audit_logs where action='crm.form.submit' and actor_id is null and target_id=$1",
    [form.id])).rows[0].n).toBe(2);
  expect(await getCrmForm(fixture.db, people.admin, people.tenant, form.id)).toMatchObject({ responseCount: 2 });
  for (const user of [people.member, people.viewer, people.outsider]) {
    await expect(getCrmForm(fixture.db, user, people.tenant, form.id)).rejects.toMatchObject({ status: 403 });
    await expect(listCrmFormResponses(fixture.db, user, people.tenant, form.id, {})).rejects.toMatchObject({ status: 403 });
  }
  await expect(getCrmForm(fixture.db, people.outsider, people.other, form.id)).rejects.toMatchObject({ status: 404 });
  await expect(listCrmFormResponses(fixture.db, people.outsider, people.other, form.id, {})).rejects.toMatchObject({ status: 404 });
  await withTenant(fixture.db, people.outsider, people.other, "crm:forms_manage", async tx => {
    expect((await tx.execute(sql`select id from crm_form_responses where tenant_id = ${people.tenant}`)).rows).toEqual([]);
    expect((await tx.execute(sql`select current_setting('app.crm_forms_tenant', true) as scope
      from (select public.crm_form_public_form('organization-form',false)) as resolved`)).rows).toEqual([{ scope: "" }]);
  });
  expect((await fixture.pool.query("select * from crm_form_responses")).rows).toEqual([]);
});

it("rejects malformed, oversized, cross-origin and spam requests, then applies a persistent quota", async () => {
  const form = await draft(definition => { definition.settings.spamCheck = true; });
  await publish(form.id, "spam-form", form.revision);
  const payload = await body("spam-form");
  const raw = JSON.stringify(payload);
  expect((await post("spam-form", raw, "https://cross-origin.example.test")).status).toBe(403);
  expect((await post("spam-form", raw, origin, "text/plain")).status).toBe(415);
  expect((await post("spam-form", "{")).status).toBe(400);
  expect((await post("spam-form", "x".repeat(32 * 1024 + 1))).status).toBe(413);
  expect((await post("spam-form", raw)).status).toBe(400); // Within the minimum presentation time.
  await new Promise(resolve => setTimeout(resolve, 1050));
  expect((await post("spam-form", JSON.stringify({ ...payload, website: "bot" }))).status).toBe(400);
  for (const bad of [
    { ...answers(), consent0: "no" }, { ...answers(), choice00: "injected" }, { ...answers(), invented: "unknown" },
    { ...answers(), email000: "outside@example.com" }, { ...answers(), phone000: "+12025551234" },
  ]) {
    expect((await post("spam-form", JSON.stringify({ ...payload, answers: bad }))).status).toBe(400);
  }
  expect((await post("spam-form", raw)).status).toBe(200);

  // Use a separate form and prime adjacent buckets so timing at a minute
  // boundary cannot turn a true quota failure into a flaky test.
  const quota = await draft();
  await publish(quota.id, "quota-form", quota.revision);
  await fixture.admin.query(`insert into crm_form_quotas(scope,minute,attempts)
    select 'quota-form',date_trunc('minute',clock_timestamp()) + step * interval '1 minute',30 from generate_series(0,1) step`);
  const limited = await post("quota-form", "{");
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
});

it("avoids split-identity merges and creates the published pipeline destination for a Phone response", async () => {
  const created = await createPipeline(fixture.db, people.owner, people.tenant, { name: "Test pipeline" });
  const pipeline = created.id;
  const stage = created.stages.find(candidate => candidate.kind === "open")!.id;
  const form = await draft(definition => {
    definition.destination = { type: "pipeline", pipelineId: pipeline };
    definition.settings.hiddenSource = false;
    definition.settings.hiddenCampaign = false;
  });
  await publish(form.id, "pipeline-form", form.revision);
  const local = await campaign(people.tenant, people.owner, "Pipeline campaign");
  const phonePerson = await createContact(fixture.db, people.owner, people.tenant, { name: "Phone fixture", phone: "+12025550116" });
  await createContact(fixture.db, people.owner, people.tenant, { name: "Email fixture", email: "email-only@example.test" });
  const phoneOnly = { fullname: "No account needed", phone000: "+1 (202) 555-0116", consent0: "yes" };
  const payload = await body("pipeline-form", phoneOnly);
  for (const hidden of [{ campaign: local.id }, { qr: local.link.publicCode }]) {
    expect((await post("pipeline-form", JSON.stringify({ ...payload, ...hidden }))).status).toBe(400);
  }
  expect((await post("pipeline-form", JSON.stringify({ ...payload, answers: { ...phoneOnly, email000: "email-only@example.test" } }))).status).toBe(409);
  expect((await post("pipeline-form", JSON.stringify(payload))).status).toBe(200);
  expect((await fixture.admin.query("select contact_id,pipeline_id,stage_id,owner_user_id from opportunities where tenant_id=$1 and pipeline_id=$2",
    [people.tenant, pipeline])).rows).toEqual([{ contact_id: phonePerson.id, pipeline_id: pipeline, stage_id: stage, owner_user_id: people.member }]);
});

it("repoints responses on merge, deletes them on erasure, suppresses replay, and purges expired responses", async () => {
  const form = await draft();
  const publication = await publish(form.id, "rights-form", form.revision);
  const payload = await body("rights-form", answers("rights@example.test"));
  const send = () => post("rights-form", JSON.stringify(payload));
  expect((await send()).status).toBe(200);
  const source = (await fixture.admin.query("select contact_id from crm_form_responses where form_id=$1", [form.id])).rows[0].contact_id;
  const target = await createContact(fixture.db, people.owner, people.tenant, { name: "Merge target" });
  await mergeContacts(fixture.db, people.owner, people.tenant, target.id, { sourceId: source, sourceVersion: 1, targetVersion: target.version });
  expect(await listCrmFormResponses(fixture.db, people.admin, people.tenant, form.id, {})).toMatchObject({
    count: 1, responses: [{ contactId: target.id, answers: payload.answers }],
  });
  expect((await fixture.admin.query("select count(*)::int n from contacts where tenant_id=$1 and id=$2", [people.tenant, source])).rows[0].n).toBe(0);
  expect(await getContact(fixture.db, people.admin, people.tenant, target.id)).toMatchObject({
    sourceHistory: expect.arrayContaining([expect.objectContaining({ kind: "form", outcome: "created" })]),
  });
  const sourceEvent = (await fixture.admin.query("select id from contact_source_events where contact_id=$1 and kind='form'", [target.id])).rows[0].id;
  await eraseContact(fixture.db, people.owner, people.tenant, target.id);
  expect((await send()).status).toBe(200);
  expect((await fixture.admin.query("select count(*)::int n from crm_form_responses where form_id=$1", [form.id])).rows[0].n).toBe(0);

  expect((await fixture.admin.query("select id from contact_source_events where id=$1", [sourceEvent])).rows).toEqual([]);

  const expired = await body("rights-form", answers("expires@example.test"));
  expect((await post("rights-form", JSON.stringify(expired))).status).toBe(200);
  expect(await getCrmForm(fixture.db, people.owner, people.tenant, form.id)).toMatchObject({ responseCount: 1 });
  await fixture.admin.query(`update crm_form_responses set submitted_at=now()-interval '31 days', expires_at=now()-interval '1 day' where form_id=$1`, [form.id]);
  expect(await getCrmForm(fixture.db, people.owner, people.tenant, form.id)).toMatchObject({ responseCount: 0 });
  expect(await listCrmFormResponses(fixture.db, people.admin, people.tenant, form.id, {})).toEqual({ count: 0, responses: [], nextCursor: null });
  expect(await listContacts(fixture.db, people.owner, people.tenant, {
    s: serializeSourceRule(sourceRule.parse({ mode: "include", kinds: ["form"], forms: [publication?.versionId] })),
  })).toMatchObject({ total: 0 });
  expect(await purgeCrmFormResponses(fixture.db, people.admin, people.tenant)).toEqual({ removed: 1 });
  expect((await fixture.admin.query("select count(*)::int n from crm_form_responses where form_id=$1", [form.id])).rows[0].n).toBe(0);
});

it("uses the same hosted source rules for list, count, saved views and export", async () => {
  const form = await draft(definition => { definition.title = "Welcome registration"; });
  const publication = await publish(form.id, "source-filter-form", form.revision);
  const version = publication!.versionId!;
  const local = await campaign(people.tenant, people.owner, "Source filter campaign");
  const payload = await body("source-filter-form", answers("source-filter@example.test"));
  expect((await post("source-filter-form", JSON.stringify({ ...payload, qr: local.link.publicCode }))).status).toBe(200);
  const [person] = (await fixture.admin.query("select contact_id from crm_form_responses where form_id=$1", [form.id])).rows;
  const manual = await createContact(fixture.db, people.owner, people.tenant, { name: "Source filter manual", email: "manual-source-filter@example.test" });
  await createContact(fixture.db, people.outsider, people.other, { name: "Other ministry", email: "source-filter@example.test" });

  form.definition.title = "Unpublished rename";
  await saveCrmForm(fixture.db, people.admin, people.tenant, form.id, { definition: form.definition, revision: form.revision });
  expect(await getContact(fixture.db, people.owner, people.tenant, person.contact_id)).toMatchObject({
    sourceHistory: [{ kind: "form", sourceLabel: "Welcome registration" }],
  });
  expect((await sourceOptions(fixture.db, people.admin, people.tenant)).hostedForms).toContainEqual({ id: version, name: "Welcome registration" });
  expect((await sourceOptions(fixture.db, people.outsider, people.other)).hostedForms).toEqual([]);

  const attributes = { kinds: ["form"], forms: [version], campaigns: [local.id], links: [local.link.id] };
  const include = sourceRule.parse({ mode: "include", ...attributes });
  const exclude = sourceRule.parse({ mode: "exclude", ...attributes });
  const actor = people.owner;
  const tenant = people.tenant;
  for (const [rule, expectedId, email] of [[include, person.contact_id, "source-filter@example.test"], [exclude, manual.id, "manual-source-filter@example.test"]] as const) {
    const state = fullState({ sources: [rule], columns: ["name", "source"] });
    const params = { s: serializeSourceRule(rule), cols: "name,source" };
    const list = await listContacts(fixture.db, actor, tenant, params);
    const count = await exportCount(fixture.db, actor, tenant, "person", params);
    const csv = await exportRecords(fixture.db, actor, tenant, "person", params);
    expect(list.rows.some(row => row.id === person.contact_id)).toBe(rule.mode === "include");
    expect(list.rows.some(row => row.id === manual.id)).toBe(rule.mode === "exclude");
    expect(list.total).toBe(count.total);
    expect(list.total).toBe(csv.rows);
    expect(csv.body).toContain(`,${email},`);
    expect(csv.body).not.toContain(rule.mode === "include" ? ",manual-source-filter@example.test," : ",source-filter@example.test,");
    const view = await createView(fixture.db, actor, tenant, { objectType: "person", name: `Hosted source ${rule.mode}`, state });
    const saved = await resolveListView(fixture.db, actor, tenant, "person", { view: view.id }, true,
      raw => listContacts(fixture.db, actor, tenant, raw));
    expect(saved.list.rows.map(row => row.id)).toContain(expectedId);
    expect(saved.list.rows.map(row => row.id)).toEqual(list.rows.map(row => row.id));
  }
  const kindOnly = { s: serializeSourceRule(sourceRule.parse({ mode: "include", kinds: ["form"] })) };
  expect(await listContacts(fixture.db, people.outsider, people.other, kindOnly)).toMatchObject({ total: 0 });
  expect(await exportCount(fixture.db, people.outsider, people.other, "person", kindOnly)).toMatchObject({ total: 0 });
  expect(await exportRecords(fixture.db, people.outsider, people.other, "person", kindOnly)).toMatchObject({ rows: 0 });
  expect(await listContacts(fixture.db, people.member, tenant, kindOnly)).toMatchObject({ locked: "source_access", total: 0 });
  expect(await listContacts(fixture.db, people.outsider, people.other, { s: serializeSourceRule(include) }))
    .toMatchObject({ locked: "invalid_source", total: 0 });
});
