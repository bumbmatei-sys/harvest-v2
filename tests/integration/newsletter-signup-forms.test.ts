import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GET } from "../../src/app/f/[slug]/route";
import { POST } from "../../src/app/f/[slug]/submit/route";
import { GET as sinkGET } from "../../src/app/api/newsletter/confirmation-sink/route";
import { NEWSLETTER_BLOCK_IDS, newsletterWordings } from "../../src/lib/newsletter-signup";
import { createCrmForm, duplicateCrmForm, getCrmForm, listCrmForms, saveCrmForm } from "../../src/server/crm-forms";
import { transitionCrmForm } from "../../src/server/crm-form-publication";
import { hostedFormSourceOptions } from "../../src/server/crm-sources";
import { mayContact } from "../../src/server/consent-gate";
import { createContact, eraseContact, recordConsent } from "../../src/server/contacts";
import { mergeContacts } from "../../src/server/crm-merge";
import { createNewsletterAudience, createNewsletterList } from "../../src/server/newsletter";
import { archiveNewsletterSignupForm, createNewsletterSignupFormDraft, listNewsletterSignupForms, newsletterSignupCounts } from "../../src/server/newsletter-forms";
import { confirmNewsletterSignup, createNewsletterSignupForm, newsletterSignupNotice, startNewsletterSignup } from "../../src/server/newsletter-public";
import { withTenant } from "../../src/server/tenancy";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => fixture.db }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
let listA: string, listB: string, otherList: string;
const origin = "http://localhost:3000";
const legacy = { tenant: randomUUID(), owner: "nlsf-legacy-owner", audience: randomUUID(), list: randomUUID(), form: randomUUID() };

beforeAll(async () => {
  fetchSpy = noNetwork();
  fixture = await testDatabase({ migrationOwner: true, beforeNewsletterSignupFormsMigration: async db => {
    // An installation that already has an NL-02 form: the shared grant step must leave it working after the upgrade.
    await db.query("insert into users(id,name,email) values($1,$1,$2)", [legacy.owner, `${legacy.owner}@example.test`]);
    await db.query("insert into workspaces(tenant_id,name,created_by) values($1,'Existing ministry',$2)", [legacy.tenant, legacy.owner]);
    await db.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'owner')", [legacy.tenant, legacy.owner]);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("select set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)", [legacy.tenant, legacy.owner]);
      await client.query("insert into newsletter_audiences(tenant_id,id,name,created_by) values($1,$2,'Existing',$3)", [legacy.tenant, legacy.audience, legacy.owner]);
      await client.query("insert into newsletter_lists(tenant_id,id,audience_id,name,created_by) values($1,$2,$3,'Existing list',$4)", [legacy.tenant, legacy.list, legacy.audience, legacy.owner]);
      await client.query("insert into newsletter_signup_forms(tenant_id,id,list_id,created_by,active) values($1,$2,$3,$4,true)", [legacy.tenant, legacy.form, legacy.list, legacy.owner]);
      await client.query("COMMIT");
    } finally { client.release(); }
  } });
  people = await seedPeople(fixture, "nlsf");
  const outsider = people.outsider;
  const audience = (await createNewsletterAudience(fixture.db, people.owner, people.tenant, { name: "Audience" })).id;
  listA = (await createNewsletterList(fixture.db, people.owner, people.tenant, audience, { name: "Weekly" })).id;
  listB = (await createNewsletterList(fixture.db, people.owner, people.tenant, audience, { name: "Events" })).id;
  const foreign = (await createNewsletterAudience(fixture.db, outsider, people.other, { name: "Other" })).id;
  otherList = (await createNewsletterList(fixture.db, outsider, people.other, foreign, { name: "Other list" })).id;
  vi.stubEnv("HARVEST_CRM_FORMS", "synthetic");
  vi.stubEnv("HARVEST_CRM_FORMS_TEST_KEY", "5a".repeat(32));
  vi.stubEnv("HARVEST_NEWSLETTER_TOKEN_KEY", randomBytes(32).toString("hex"));
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", JSON.stringify([randomBytes(32).toString("hex")]));
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
let visitors = 0;
const fresh = () => `198.52.${(visitors >> 8) & 255}.${visitors++ & 255}`;
const address = () => `nlsf-${randomUUID()}@example.test`;
let slugs = 0;
const slug = () => `signup-${Date.now().toString(36)}-${slugs++}`;
const manifest = async (at: string) => {
  const response = await GET(new Request(`${origin}/f/${at}`, { headers: { "x-forwarded-for": fresh() } }), ctx(at));
  return { status: response.status, body: response.status === 200 ? await response.json() as { proof: string; newsletter?: Record<string, string>; blocks: { id: string; label: string }[]; ministryName: string } : null };
};
const submit = async (at: string, answers: Record<string, string>, extra: Record<string, unknown> = {}) => {
  const { body } = await manifest(at);
  const response = await POST(new Request(`${origin}/f/${at}/submit`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": fresh() },
    body: JSON.stringify({ proof: body?.proof, answers, ...extra }) }), ctx(at));
  return response.status;
};
const answers = (email: string, first = "", last = "") => ({ [NEWSLETTER_BLOCK_IDS.email]: email, ...(first ? { [NEWSLETTER_BLOCK_IDS.first]: first } : {}), ...(last ? { [NEWSLETTER_BLOCK_IDS.last]: last } : {}), consent0: "yes" });
async function createForm(listIds = [listA, listB], actor = people.admin, spamCheck = false) {
  const { id } = await createNewsletterSignupFormDraft(fixture.db, actor, people.tenant, { listIds });
  const { definition } = await getCrmForm(fixture.db, actor, people.tenant, id);
  definition.settings.spamCheck = spamCheck;
  await saveCrmForm(fixture.db, actor, people.tenant, id, { definition, revision: definition.revision });
  return id;
}
async function publishForm(id: string, at = slug()) {
  const { definition } = await getCrmForm(fixture.db, people.admin, people.tenant, id);
  await transitionCrmForm(fixture.db, people.admin, people.tenant, id, { action: "publish", slug: at, revision: definition.revision });
  return at;
}
const sink = async (to: string) => {
  const response = sinkGET(new Request(`${origin}/api/newsletter/confirmation-sink?to=${encodeURIComponent(to)}`));
  return response.status === 200 ? (await response.json() as { messages: { path: string }[] }).messages : null;
};
async function link(to: string) {
  const [entry] = (await sink(to)) ?? [];
  const query = new URL(entry.path, origin).searchParams;
  return { email: query.get("email")!, token: query.get("token")! };
}
const subscribed = async (email: string, list: string) => (await fixture.admin.query(`select s.state from newsletter_subscriptions s join newsletter_subscribers b on b.tenant_id=s.tenant_id and b.id=s.subscriber_id
  join contact_identifiers i on i.tenant_id=b.tenant_id and i.contact_id=b.contact_id and i.kind='email' where i.normalized_value=$1 and s.list_id=$2`, [email, list])).rows[0]?.state;
const may = (contact: string) => withTenant(fixture.db, people.admin, people.tenant, "newsletter:manage", tx => mayContact(tx, people.tenant, contact, "newsletter", "email"));
const signups = async (form: string) => (await fixture.admin.query("select state, first_name, last_name, contact_id, wording_version from newsletter_form_signups where form_id=$1 order by created_at", [form])).rows;

it("upgrades as a restricted owner, forces row security and keeps the existing NL-02 sign-up working through the shared grant step", async () => {
  const { rows } = await fixture.admin.query(`select relforcerowsecurity from pg_class where relname='newsletter_form_signups'`);
  expect(rows).toEqual([{ relforcerowsecurity: true }]);
  const { rows: procs } = await fixture.admin.query(`select p.proname, p.prosecdef, p.proconfig, has_function_privilege('public',p.oid,'execute') as pub, has_function_privilege('harvest_app',p.oid,'execute') as app
    from pg_proc p where p.proname in ('nl02_grant_list','nl02_accept_form_signup','newsletter_form_signup_start','newsletter_form_signup_confirm','newsletter_form_archive','newsletter_form_signup_before_erase')`);
  expect(procs).toHaveLength(6);
  for (const proc of procs) {
    expect(proc.pub, proc.proname).toBe(false);
    expect(String(proc.proconfig)).toContain("search_path=pg_catalog, pg_temp");
    expect(proc.prosecdef, proc.proname).toBe(["newsletter_form_signup_start", "newsletter_form_signup_confirm", "newsletter_form_archive", "newsletter_form_signup_before_erase"].includes(proc.proname));
    expect(proc.app, proc.proname).toBe(["newsletter_form_signup_start", "newsletter_form_signup_confirm", "newsletter_form_archive"].includes(proc.proname));
  }
  // The app role has no access to the table's private columns.
  await expect(fixture.pool.query("select token_hash from newsletter_form_signups")).rejects.toThrow();
  await expect(fixture.pool.query("select first_name from newsletter_form_signups")).rejects.toThrow();
  // The pre-upgrade NL-02 form still works end to end.
  const email = address();
  const token = await startNewsletterSignup(fixture.db, { formId: legacy.form, email, notice: newsletterSignupNotice, accepted: true });
  expect(token).toBeTruthy();
  await confirmNewsletterSignup(fixture.db, { email, token });
  expect((await fixture.admin.query(`select s.state from newsletter_subscriptions s join newsletter_subscribers b on b.tenant_id=s.tenant_id and b.id=s.subscriber_id
    join contact_identifiers i on i.tenant_id=b.tenant_id and i.contact_id=b.contact_id where i.normalized_value=$1 and s.list_id=$2`, [email, legacy.list])).rows).toEqual([{ state: "subscribed" }]);
  expect(createNewsletterSignupForm).toBeTypeOf("function");
});

it("creates the preset for owners and admins only, scoped to this ministry's lists, with the wording stamped", async () => {
  const id = await createForm();
  const { definition } = await getCrmForm(fixture.db, people.admin, people.tenant, id);
  expect(definition.newsletter).toMatchObject({ listIds: [listA, listB], wordingVersion: "newsletter-consent-v1" });
  expect(definition.destination).toBeNull();
  expect(definition.blocks.map((block) => block.id)).toEqual([NEWSLETTER_BLOCK_IDS.email, NEWSLETTER_BLOCK_IDS.first, NEWSLETTER_BLOCK_IDS.last, "consent0"]);
  const consent = definition.blocks.at(-1)!;
  expect(consent.required).toBe(true);
  expect(consent.label).toBe(definition.newsletter!.consentText);
  expect(consent.label).toContain("nlsf ministry");
  expect(definition.newsletter!.fixedNotice).toBe("Your details go to nlsf ministry. You can ask them to delete them.");
  expect(consent.text).toBe(`${consent.label} ${definition.newsletter!.fixedNotice}`);
  expect(newsletterWordings["newsletter-consent-v1"].consent).toContain("{ministry}");
  for (const actor of [people.member, people.viewer]) {
    await expect(createNewsletterSignupFormDraft(fixture.db, actor, people.tenant, { listIds: [listA] })).rejects.toMatchObject({ status: 403 });
    await expect(listNewsletterSignupForms(fixture.db, actor, people.tenant)).rejects.toMatchObject({ status: 403 });
  }
  await expect(createNewsletterSignupFormDraft(fixture.db, people.outsider, people.tenant, { listIds: [listA] })).rejects.toMatchObject({ status: 403 });
  await expect(createNewsletterSignupFormDraft(fixture.db, people.admin, people.tenant, { listIds: [otherList] })).rejects.toMatchObject({ status: 400 });
  expect(() => createNewsletterSignupFormDraft(fixture.db, people.admin, people.tenant, { listIds: [] })).toThrow();
});

it("restamps edited wording, rejects foreign lists and never turns a form into a sign-up form or back", async () => {
  const id = await createForm([listA]);
  const { definition } = await getCrmForm(fixture.db, people.admin, people.tenant, id);
  const tampered = structuredClone(definition);
  tampered.newsletter!.consentText = "Anything at all"; tampered.blocks.at(-1)!.label = "Anything at all"; tampered.blocks.at(-1)!.text = "Something else";
  const saved = await saveCrmForm(fixture.db, people.admin, people.tenant, id, { definition: tampered, revision: definition.revision });
  const after = (await getCrmForm(fixture.db, people.admin, people.tenant, id)).definition;
  expect(after.revision).toBe(saved.revision);
  expect(after.newsletter!.consentText).toBe(definition.newsletter!.consentText);
  expect(after.blocks.at(-1)!.label).toBe(definition.newsletter!.consentText);
  const foreign = structuredClone(after);
  foreign.newsletter!.listIds = [otherList];
  await expect(saveCrmForm(fixture.db, people.admin, people.tenant, id, { definition: foreign, revision: after.revision })).rejects.toMatchObject({ status: 400 });
  const plain = structuredClone(after) as typeof after;
  delete plain.newsletter;
  await expect(saveCrmForm(fixture.db, people.admin, people.tenant, id, { definition: plain, revision: after.revision })).rejects.toMatchObject({ status: 400 });
  const crm = await createCrmForm(fixture.db, people.admin, people.tenant, { destination: { type: "people" } });
  const crmDefinition = (await getCrmForm(fixture.db, people.admin, people.tenant, crm.id)).definition;
  await expect(saveCrmForm(fixture.db, people.admin, people.tenant, crm.id, { definition: { ...crmDefinition, newsletter: after.newsletter }, revision: 1 })).rejects.toThrow();
  // Not publishable without a list.
  const empty = structuredClone(after); empty.newsletter!.listIds = [];
  const saved2 = await saveCrmForm(fixture.db, people.admin, people.tenant, id, { definition: empty, revision: after.revision });
  await expect(transitionCrmForm(fixture.db, people.admin, people.tenant, id, { action: "publish", slug: slug(), revision: saved2.revision })).rejects.toMatchObject({ status: 400 });
});

it("records only a pending sign-up, sends one message to the fake sink and grants nothing before the link is used", async () => {
  const id = await createForm(), at = await publishForm(id);
  const { status, body } = await manifest(at);
  expect(status).toBe(200);
  expect(body!.newsletter).toMatchObject({ wordingVersion: "newsletter-consent-v1" });
  expect(JSON.stringify(body)).not.toContain(listA);
  expect(body!.ministryName).toBe("nlsf ministry");
  const known = address();
  const contact = await createContact(fixture.db, people.admin, people.tenant, { name: "Known person", email: known, notes: "" });
  const email = address();
  expect(await submit(at, answers(known))).toBe(200);
  expect(await submit(at, answers(email, "Ada", "Lovelace"))).toBe(200);
  expect((await sink(email))).toHaveLength(1);
  expect((await sink(known))).toHaveLength(1);
  expect(await signups(id)).toEqual([expect.objectContaining({ state: "pending", first_name: null }), expect.objectContaining({ state: "pending", first_name: "Ada", last_name: "Lovelace", contact_id: null })]);
  expect((await fixture.admin.query("select count(*)::int n from contact_identifiers where normalized_value=$1", [email])).rows[0].n).toBe(0);
  expect(await subscribed(known, listA)).toBeUndefined();
  expect(await may(contact.id)).toMatchObject({ allowed: false });
  expect((await fixture.admin.query("select count(*)::int n from contact_consents where contact_id=$1 and purpose='newsletter' and status='granted'", [contact.id])).rows[0].n).toBe(0);
  expect(await newsletterSignupCounts(fixture.db, people.admin, people.tenant, id)).toMatchObject({ total: 2, pending: 2, confirmed: 0, notConfirmed: 0 });
});

it("answers a refused, repeated or malformed request exactly like the form allows, and sends nothing", async () => {
  const id = await createForm(), at = await publishForm(id);
  const email = address();
  expect(await submit(at, { ...answers(email), consent0: "no" })).toBe(400);
  expect(await submit(at, { [NEWSLETTER_BLOCK_IDS.email]: email })).toBe(400);
  expect(await submit(at, answers("real.person@example.org"))).toBe(400);
  expect(await submit(at, answers("not-an-address"))).toBe(400);
  expect(await submit(at, answers(email), { website: "spam" })).toBe(400);
  expect(await submit(at, { ...answers(email), unknown1: "x" })).toBe(400);
  expect(await sink(email)).toEqual([]);
  // Replaying one proof records one sign-up; the repeat looks successful and sends nothing more.
  const { body } = await manifest(at), request = () => new Request(`${origin}/f/${at}/submit`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": fresh() },
    body: JSON.stringify({ proof: body!.proof, answers: answers(email) }) });
  expect((await POST(request(), ctx(at))).status).toBe(200);
  expect((await POST(request(), ctx(at))).status).toBe(200);
  expect(await sink(email)).toHaveLength(1);
  // The same address is capped per hour per form (a replay counts): the later requests look like the others but record nothing.
  for (let i = 0; i < 4; i++) expect(await submit(at, answers(email))).toBe(200);
  expect((await signups(id)).length).toBe(2);
  expect(await sink(email)).toHaveLength(2);
  // Unknown, other-form and unpublished addresses are indistinguishable.
  expect((await manifest("signup-does-not-exist")).status).toBe(404);
});

it("confirms every list from one verified link, once, with names only for a new person, and records the wording version", async () => {
  const id = await createForm(), at = await publishForm(id), email = address();
  expect(await submit(at, answers(email, "Grace", "Hopper"))).toBe(200);
  const { token } = await link(email);
  await confirmNewsletterSignup(fixture.db, { email: address(), token });
  await confirmNewsletterSignup(fixture.db, { email, token: randomBytes(32).toString("base64url") });
  expect(await subscribed(email, listA)).toBeUndefined();
  await confirmNewsletterSignup(fixture.db, { email, token });
  expect(await subscribed(email, listA)).toBe("subscribed");
  expect(await subscribed(email, listB)).toBe("subscribed");
  expect(await signups(id)).toEqual([{ state: "confirmed", first_name: null, last_name: null, contact_id: null, wording_version: "newsletter-consent-v1" }]);
  const { rows: [person] } = await fixture.admin.query("select c.id, c.name from contacts c join contact_identifiers i on i.tenant_id=c.tenant_id and i.contact_id=c.id where i.normalized_value=$1", [email]);
  expect(person.name).toBe("Grace Hopper");
  expect(await may(person.id)).toMatchObject({ allowed: true });
  const { rows: grants } = await fixture.admin.query("select evidence, source from contact_consents where contact_id=$1 and status='granted'", [person.id]);
  expect(grants).toHaveLength(2);
  expect(grants[0]).toMatchObject({ source: "newsletter_verified_signup" });
  expect(grants[0].evidence).toContain("newsletter-consent-v1");
  await confirmNewsletterSignup(fixture.db, { email, token });
  expect((await fixture.admin.query("select count(*)::int n from contact_consents where contact_id=$1 and status='granted'", [person.id])).rows[0].n).toBe(2);
  expect(await newsletterSignupCounts(fixture.db, people.admin, people.tenant, id)).toMatchObject({ total: 1, pending: 0, confirmed: 1 });
});

it("lets a later withdrawal, an unpublished form, an archive or an expiry win over the link", async () => {
  const id = await createForm([listA]), at = await publishForm(id);
  const withdrawn = address(), person = await createContact(fixture.db, people.admin, people.tenant, { name: "Withdrawn person", email: withdrawn, notes: "" });
  expect(await submit(at, answers(withdrawn))).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await recordConsent(fixture.db, people.admin, people.tenant, person.id, { purpose: "newsletter", status: "withdrawn", channel: "email", noticeVersion: "notice-v1", source: "test", evidence: "Synthetic" });
  await confirmNewsletterSignup(fixture.db, (await link(withdrawn)));
  expect(await subscribed(withdrawn, listA)).toBeUndefined();
  expect((await signups(id))[0]).toMatchObject({ state: "blocked", first_name: null });
  expect(await may(person.id)).toMatchObject({ allowed: false });

  const later = address();
  expect(await submit(at, answers(later))).toBe(200);
  const unpublish = await getCrmForm(fixture.db, people.admin, people.tenant, id);
  expect(unpublish.publication?.state).toBe("published");
  await transitionCrmForm(fixture.db, people.admin, people.tenant, id, { action: "retire" });
  await confirmNewsletterSignup(fixture.db, (await link(later)));
  expect(await subscribed(later, listA)).toBeUndefined();
  expect((await manifest(at)).status).toBe(404);
  expect(await submit(at, answers(address()))).toBe(404);
  await transitionCrmForm(fixture.db, people.admin, people.tenant, id, { action: "publish", slug: at, revision: unpublish.definition.revision });

  const expired = address();
  expect(await submit(at, answers(expired, "Old", "Entry"))).toBe(200);
  await fixture.admin.query("update newsletter_form_signups set expires_at=now()-interval '1 minute', created_at=now()-interval '31 minutes' where form_id=$1 and state='pending'", [id]);
  await confirmNewsletterSignup(fixture.db, (await link(expired)));
  expect(await subscribed(expired, listA)).toBeUndefined();
  expect(await submit(at, answers(address()))).toBe(200);
  expect((await signups(id)).filter((row) => row.state === "expired").every((row) => row.first_name === null && row.last_name === null)).toBe(true);
  expect((await signups(id)).some((row) => row.state === "expired")).toBe(true);

  const last = address();
  expect(await submit(at, answers(last))).toBe(200);
  await archiveNewsletterSignupForm(fixture.db, people.admin, people.tenant, id);
  await confirmNewsletterSignup(fixture.db, (await link(last)));
  expect(await subscribed(last, listA)).toBeUndefined();
  expect((await manifest(at)).status).toBe(404);
  expect((await listNewsletterSignupForms(fixture.db, people.admin, people.tenant)).some((form) => form.id === id)).toBe(false);
  await expect(archiveNewsletterSignupForm(fixture.db, people.admin, people.tenant, id)).rejects.toMatchObject({ status: 404 });
  expect((await fixture.admin.query("select action from audit_logs where target_id=$1 and action='newsletter.signup_form.archive'", [id])).rows).toHaveLength(1);
});

it("freezes the wording into the publication: a rename or a later edit never changes what a visitor saw", async () => {
  const id = await createForm([listA]), at = await publishForm(id);
  const before = (await manifest(at)).body!;
  await fixture.admin.query("update workspaces set name='Renamed ministry' where tenant_id=$1", [people.tenant]);
  try {
    const { definition } = await getCrmForm(fixture.db, people.admin, people.tenant, id);
    const edited = structuredClone(definition);
    edited.title = "Edited later";
    edited.newsletter!.listIds = [listB];
    await saveCrmForm(fixture.db, people.admin, people.tenant, id, { definition: edited, revision: definition.revision });
    const after = (await manifest(at)).body!;
    expect(after.newsletter).toEqual(before.newsletter);
    expect(after.ministryName).toBe("nlsf ministry");
    expect(after.blocks.at(-1)!.label).toBe(before.blocks.at(-1)!.label);
    const { rows: [published] } = await fixture.admin.query("select definition->'newsletter'->'listIds' as lists from crm_form_publications where form_id=$1", [id]);
    expect(published.lists).toEqual([listA]);
    // Publishing the new draft takes the current ministry name and the new lists, as a new immutable version.
    const next = (await getCrmForm(fixture.db, people.admin, people.tenant, id)).definition;
    await transitionCrmForm(fixture.db, people.admin, people.tenant, id, { action: "publish", slug: at, revision: next.revision });
    expect((await manifest(at)).body!.newsletter!.consentText).toContain("Renamed ministry");
    const { rows: versions } = await fixture.admin.query("select count(*)::int n from crm_form_publications where form_id=$1", [id]);
    expect(versions[0].n).toBe(2);
  } finally { await fixture.admin.query("update workspaces set name='nlsf ministry' where tenant_id=$1", [people.tenant]); }
});

it("shows counts and lists only to the ministry's owners and admins, and keeps sign-up forms out of the CRM forms list and source filters", async () => {
  const id = await createForm([listA]), at = await publishForm(id);
  const email = address();
  expect(await submit(at, answers(email))).toBe(200);
  await confirmNewsletterSignup(fixture.db, (await link(email)));
  expect(await submit(at, answers(address()))).toBe(200);
  const list = await listNewsletterSignupForms(fixture.db, people.owner, people.tenant);
  expect(list.find((form) => form.id === id)).toMatchObject({ status: "published", slug: at, signups: 2, pending: 1, confirmed: 1, lists: [{ id: listA, name: "Weekly" }] });
  expect(JSON.stringify(list)).not.toContain("@example.test");
  expect((await listCrmForms(fixture.db, people.admin, people.tenant)).some((form) => form.id === id)).toBe(false);
  const options = await withTenant(fixture.db, people.admin, people.tenant, "crm:forms_manage", (tx, tenant) => hostedFormSourceOptions(tx, tenant));
  expect(options.some((option) => option.name === "Join our newsletter")).toBe(false);
  for (const actor of [people.member, people.viewer, people.outsider]) {
    await expect(newsletterSignupCounts(fixture.db, actor, people.tenant, id)).rejects.toMatchObject({ status: 403 });
    await expect(archiveNewsletterSignupForm(fixture.db, actor, people.tenant, id)).rejects.toMatchObject({ status: 403 });
  }
  await expect(newsletterSignupCounts(fixture.db, people.outsider, people.other, id)).rejects.toMatchObject({ status: 404 });
  expect((await listNewsletterSignupForms(fixture.db, people.outsider, people.other)).length).toBe(0);
  expect((await fixture.pool.query("select count(*)::int n from newsletter_form_signups")).rows[0].n).toBe(0);
  const copy = await duplicateCrmForm(fixture.db, people.admin, people.tenant, id);
  expect((await getCrmForm(fixture.db, people.admin, people.tenant, copy.id)).definition.newsletter?.listIds).toEqual([listA]);
  expect((await getCrmForm(fixture.db, people.admin, people.tenant, copy.id)).publication).toBeNull();
});

it("drops a person's pending sign-ups on erase, survives a merge and leaves confirmed counts intact", async () => {
  const id = await createForm([listA]), at = await publishForm(id);
  const email = address(), person = await createContact(fixture.db, people.admin, people.tenant, { name: "To erase", email, notes: "" });
  expect(await submit(at, answers(email, "Erase", "Me"))).toBe(200);
  expect((await signups(id))[0]).toMatchObject({ state: "pending", contact_id: person.id, first_name: "Erase" });
  const { token } = await link(email);
  await eraseContact(fixture.db, people.admin, people.tenant, person.id);
  expect(await signups(id)).toEqual([]);
  await confirmNewsletterSignup(fixture.db, { email, token });
  expect(await subscribed(email, listA)).toBeUndefined();

  // A confirmed sign-up has no link to the person, so a merge needs nothing from it.
  const keep = address(), drop = address();
  expect(await submit(at, answers(drop, "Drop", "Me"))).toBe(200);
  await confirmNewsletterSignup(fixture.db, (await link(drop)));
  const target = await createContact(fixture.db, people.admin, people.tenant, { name: "Keep", email: keep, notes: "" });
  const { rows: [source] } = await fixture.admin.query("select c.id, c.version from contacts c join contact_identifiers i on i.tenant_id=c.tenant_id and i.contact_id=c.id where i.normalized_value=$1", [drop]);
  await mergeContacts(fixture.db, people.admin, people.tenant, target.id, { sourceId: source.id, targetVersion: target.version, sourceVersion: source.version });
  expect((await signups(id)).filter((row) => row.state === "confirmed")).toHaveLength(1);
  // A pending sign-up for a contact that is merged away is dropped with the merged contact, and its link grants nothing.
  const merged = address();
  const other = await createContact(fixture.db, people.admin, people.tenant, { name: "Merged away", email: merged, notes: "" });
  expect(await submit(at, answers(merged))).toBe(200);
  const mergedLink = await link(merged);
  const { rows: [row] } = await fixture.admin.query("select version from contacts where id=$1", [other.id]);
  await mergeContacts(fixture.db, people.admin, people.tenant, target.id, { sourceId: other.id, targetVersion: (await fixture.admin.query("select version from contacts where id=$1", [target.id])).rows[0].version, sourceVersion: row.version });
  await confirmNewsletterSignup(fixture.db, mergedLink);
  expect(await newsletterSignupCounts(fixture.db, people.admin, people.tenant, id)).toMatchObject({ confirmed: 1 });
});
