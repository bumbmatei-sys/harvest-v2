import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { users } from "../../src/db/schema";
import { createContact, eraseContact, recordConsent } from "../../src/server/contacts";
import { mayContact } from "../../src/server/consent-gate";
import { mergeContacts } from "../../src/server/crm-merge";
import { createNewsletterAudience, createNewsletterList, setNewsletterSubscription, updateNewsletterSubscriber } from "../../src/server/newsletter";
import { confirmNewsletterSignup, createNewsletterSignupForm, issueNewsletterPreference, newsletterSignupNotice,
  startNewsletterSignup, unsubscribeNewsletter, updateNewsletterSignupForm } from "../../src/server/newsletter-public";
import { newsletterPublicInfo, newsletterPublicPost } from "../../src/server/newsletter-public-route";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => fixture.db }));
const owner = "nl02-owner", admin = "nl02-admin", reader = "nl02-member", viewer = "nl02-viewer", foreignOwner = "nl02-foreign";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, other: string, list: string, otherList: string, second: string, form: string;
const migrated = { tenant: randomUUID(), contact: randomUUID(), consent: randomUUID(),
  audience: randomUUID(), list: randomUUID(), subscriber: randomUUID() };
const address = () => `nl02-${randomUUID()}@example.test`;
const optIn = (email: string, formId = form) => ({ formId, email, notice: newsletterSignupNotice, accepted: true });

beforeAll(async () => {
  vi.stubEnv("HARVEST_NEWSLETTER_TOKEN_KEY", randomBytes(32).toString("hex"));
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", JSON.stringify([randomBytes(32).toString("hex")]));
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected_network"));
  fixture = await testDatabase({ migrationOwner: true, beforeNewsletterNl02Migration: async pool => {
    expect((await pool.query("select to_regclass('public.newsletter_signup_forms') t")).rows[0].t).toBeNull();
    const { tenant, contact, consent, audience, list, subscriber } = migrated;
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("select set_config('app.tenant_id',$1,true),set_config('app.user_id','nl02-upgrade',true)", [tenant]);
      await connection.query("insert into users(id,name,email) values('nl02-upgrade','Upgrade','upgrade@example.test')");
      await connection.query("insert into workspaces(tenant_id,name,created_by) values($1,'Upgrade','nl02-upgrade')", [tenant]);
      await connection.query("insert into contacts(tenant_id,id,name) values($1,$2,'Upgrade')", [tenant, contact]);
      await connection.query("insert into newsletter_audiences(tenant_id,id,name,created_by) values($1,$2,'Upgrade','nl02-upgrade')", [tenant, audience]);
      await connection.query("insert into newsletter_lists(tenant_id,id,audience_id,name,created_by) values($1,$2,$3,'Upgrade','nl02-upgrade')", [tenant, list, audience]);
      await connection.query("insert into newsletter_subscribers(tenant_id,id,contact_id,created_by) values($1,$2,$3,'nl02-upgrade')", [tenant, subscriber, contact]);
      await connection.query("insert into contact_consents(tenant_id,id,contact_id,recorded_by,purpose,channel,status,notice_version,source,evidence) values($1,$2,$3,'nl02-upgrade','newsletter','email','granted','notice-v1','test','test')", [tenant, consent, contact]);
      await connection.query("insert into newsletter_subscriptions(tenant_id,list_id,subscriber_id,state,consent_id) values($1,$2,$3,'subscribed',$4)", [tenant, list, subscriber, consent]);
      await connection.query("insert into contact_consents(tenant_id,contact_id,recorded_by,purpose,channel,status,notice_version,source,evidence) values($1,$2,'nl02-upgrade','newsletter','social','withdrawn','notice-v1','test','test')", [tenant, contact]);
      await connection.query("COMMIT");
    } finally { connection.release(); }
  } });
  await fixture.db.insert(users).values([owner, admin, reader, viewer, foreignOwner].map(id => ({ id, name: id, email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, owner, "Newsletter ministry", "church")).tenantId;
  other = (await createWorkspace(fixture.db, foreignOwner, "Other newsletter ministry", "church")).tenantId;
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'admin'),($1,$3,'member'),($1,$4,'viewer')", [tenant, admin, reader, viewer]);
  const a = (await createNewsletterAudience(fixture.db, owner, tenant, { name: "Audience" })).id;
  const b = (await createNewsletterAudience(fixture.db, foreignOwner, other, { name: "Other" })).id;
  list = (await createNewsletterList(fixture.db, owner, tenant, a, { name: "Primary" })).id;
  second = (await createNewsletterList(fixture.db, owner, tenant, a, { name: "Secondary" })).id;
  otherList = (await createNewsletterList(fixture.db, foreignOwner, other, b, { name: "Other primary" })).id;
  form = (await createNewsletterSignupForm(fixture.db, admin, tenant, { listId: list })).id;
  await updateNewsletterSignupForm(fixture.db, owner, tenant, form, { version: 1, active: true });
}, 120_000);
afterAll(async () => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await fixture?.close();
});

async function challenge(email: string) {
  const token = await startNewsletterSignup(fixture.db, optIn(email));
  if (!token) throw new Error("Expected a synthetic confirmation challenge");
  return token;
}
async function join(email = address()) {
  await confirmNewsletterSignup(fixture.db, { email, token: await challenge(email) });
  const { rows: [result] } = await fixture.admin.query<{ id: string; contact_id: string }>(
    "select s.id,s.contact_id from newsletter_subscribers s join contact_identifiers i using(tenant_id,contact_id) where s.tenant_id=$1 and i.normalized_value=$2", [tenant, email]);
  return result;
}
async function state(subscriber: string, l = list) {
  return (await fixture.admin.query("select state,version,consent_id from newsletter_subscriptions where tenant_id=$1 and subscriber_id=$2 and list_id=$3", [tenant, subscriber, l])).rows[0];
}
const staffConsent = (contact: string, status: "granted" | "withdrawn", channel: "email" | "social" = "email") =>
  recordConsent(fixture.db, owner, tenant, contact, { purpose: "newsletter", status, channel, noticeVersion: "notice-v1", source: "test", evidence: "Synthetic" });

it("upgrades a previously blocked NL-01 marker without inventing consent", async () => {
  const { rows: [row] } = await fixture.admin.query("select state,version,consent_id from newsletter_subscriptions where subscriber_id=$1", [migrated.subscriber]);
  expect(row).toEqual({ state: "unsubscribed", version: 2, consent_id: null });
  expect((await fixture.admin.query("select status from contact_consents where id=$1", [migrated.consent])).rows).toEqual([{ status: "granted" }]);
});

it("scopes manager forms and hides token, challenge and rate tables through withTenant", async () => {
  for (const actor of [reader, viewer]) {
    await expect(createNewsletterSignupForm(fixture.db, actor, tenant, { listId: list })).rejects.toMatchObject({ status: 403 });
    expect(await withTenant(fixture.db, actor, tenant, "workspace:read", async tx =>
      (await tx.execute(sql`select id from newsletter_signup_forms`)).rows)).toEqual([]);
    for (const table of ["newsletter_signup_challenges", "newsletter_preference_tokens", "newsletter_intake_limits"]) {
      await expect(withTenant(fixture.db, actor, tenant, "workspace:read", tx => tx.execute(sql`select * from ${sql.identifier(table)}`)))
        .rejects.toMatchObject({ cause: { code: "42501" } });
    }
  }
  await expect(createNewsletterSignupForm(fixture.db, owner, tenant, { listId: otherList })).rejects.toMatchObject({ status: 404 });
  expect(await withTenant(fixture.db, foreignOwner, other, "newsletter:manage", async tx =>
    (await tx.execute(sql`select id from newsletter_signup_forms where id=${form}::uuid`)).rows)).toEqual([]);
  const tables = await fixture.admin.query("select relforcerowsecurity from pg_class where relname in ('newsletter_signup_forms','newsletter_signup_challenges','newsletter_preference_tokens','newsletter_intake_limits')");
  expect(tables.rows).toEqual(Array.from({ length: 4 }, () => ({ relforcerowsecurity: true })));
});

it("requires explicit consent and matching confirmation with one canonical grant on concurrent replay", async () => {
  const email = address();
  expect(await startNewsletterSignup(fixture.db, { ...optIn(email), accepted: false })).toBeNull();
  const token = await challenge(email);
  await confirmNewsletterSignup(fixture.db, { email: address(), token });
  expect((await fixture.admin.query("select 1 from contact_identifiers where normalized_value=$1", [email])).rows).toEqual([]);
  await Promise.all([1, 2].map(() => confirmNewsletterSignup(fixture.db, { email, token })));
  const rows = await fixture.admin.query("select c.status,c.purpose,c.notice_version,c.recorded_by from contact_consents c join contact_identifiers i using(tenant_id,contact_id) where i.normalized_value=$1", [email]);
  expect(rows.rows).toEqual([{ status: "granted", purpose: "newsletter", notice_version: newsletterSignupNotice, recorded_by: null }]);
  expect(JSON.stringify((await fixture.admin.query("select * from audit_logs where action like 'newsletter.%'")).rows)).not.toContain(email);
  const rateEmail = address();
  for (let i = 0; i < 3; i++) await challenge(rateEmail);
  expect(await startNewsletterSignup(fixture.db, optIn(rateEmail))).toBeNull();
});

it("lists and all-newsletters tokens have separate authority, replays and withdrawals stay idempotent", async () => {
  const email = address(), sub = await join(email);
  const pending = await challenge(email);
  await setNewsletterSubscription(fixture.db, owner, tenant, second, sub.id, { state: "subscribed", version: 0 });
  const listToken = await issueNewsletterPreference(fixture.db, owner, tenant, sub.id, { scope: "list", listId: list });
  await expect(issueNewsletterPreference(fixture.db, foreignOwner, other, sub.id, { scope: "all" })).rejects.toMatchObject({ status: 404 });
  await unsubscribeNewsletter(fixture.db, "all", listToken);
  expect((await state(sub.id)).state).toBe("subscribed");
  const preview = newsletterPublicInfo("unsubscribe");
  expect(preview.status).toBe(200);
  expect((await state(sub.id)).state).toBe("subscribed");
  const oneClick = new FormData();
  oneClick.set("List-Unsubscribe", "One-Click");
  const unsubscribe = await newsletterPublicPost(new Request(`http://localhost/api/newsletter/unsubscribe?token=${encodeURIComponent(listToken)}`, {
    method: "POST", body: oneClick,
  }), "unsubscribe");
  expect(unsubscribe.status).toBe(202);
  await unsubscribeNewsletter(fixture.db, "list", listToken);
  await confirmNewsletterSignup(fixture.db, { email, token: pending });
  expect(await state(sub.id)).toEqual({ state: "unsubscribed", version: 2, consent_id: null });
  expect((await state(sub.id, second)).state).toBe("subscribed");
  const allToken = await issueNewsletterPreference(fixture.db, admin, tenant, sub.id, { scope: "all" });
  await Promise.all([1, 2].map(() => unsubscribeNewsletter(fixture.db, "all", allToken)));
  const decision = () => withTenant(fixture.db, owner, tenant, "newsletter:manage", tx => mayContact(tx, tenant, sub.contact_id, "newsletter", "email"));
  expect(await decision()).toMatchObject({ allowed: false, reason: "consent_withdrawn" });
  expect(await state(sub.id, second)).toEqual({ state: "unsubscribed", version: 2, consent_id: null });
  await staffConsent(sub.contact_id, "granted");
  expect(await decision()).toMatchObject({ allowed: true });
  expect((await state(sub.id, second)).state).toBe("unsubscribed");
});

it("checks current form version, withdrawals after initiation, and contact erasure", async () => {
  const known = address();
  const { contact_id } = await join(known);
  const pending = await challenge(known);
  await staffConsent(contact_id, "withdrawn");
  await confirmNewsletterSignup(fixture.db, { email: known, token: pending });
  expect((await fixture.admin.query("select count(*)::int n from contact_consents where contact_id=$1 and status='granted'", [contact_id])).rows[0].n).toBe(1);
  const stale = await challenge(known);
  await eraseContact(fixture.db, owner, tenant, contact_id);
  await confirmNewsletterSignup(fixture.db, { email: known, token: stale });
  expect((await fixture.admin.query("select id from contact_identifiers where normalized_value=$1", [known])).rows).toEqual([]);

  const fresh = address(), invalidated = await challenge(fresh);
  await updateNewsletterSignupForm(fixture.db, owner, tenant, form, { version: 2, active: false });
  await updateNewsletterSignupForm(fixture.db, owner, tenant, form, { version: 3, active: true });
  await confirmNewsletterSignup(fixture.db, { email: fresh, token: invalidated });
  expect((await fixture.admin.query("select id from contact_identifiers where normalized_value=$1", [fresh])).rows).toEqual([]);
});

it("keeps hard suppression through a canonical merge and fresh opt-in", async () => {
  const source = await join();
  await setNewsletterSubscription(fixture.db, owner, tenant, second, source.id, { state: "suppressed", version: 0 });
  await updateNewsletterSubscriber(fixture.db, owner, tenant, source.id, { version: 1, suppressed: true });
  const email = address();
  const target = await createContact(fixture.db, owner, tenant, { name: "Synthetic target", email, notes: "" });
  const { rows: [from] } = await fixture.admin.query("select version from contacts where id=$1", [source.contact_id]);
  await mergeContacts(fixture.db, owner, tenant, target.id, { sourceId: source.contact_id, targetVersion: target.version, sourceVersion: from.version });
  const { rows: [after] } = await fixture.admin.query("select id,suppressed from newsletter_subscribers where contact_id=$1", [target.id]);
  expect(after.suppressed).toBe(true);
  expect((await state(after.id, second)).state).toBe("suppressed");
  await confirmNewsletterSignup(fixture.db, { email, token: await challenge(email) });
  expect(await state(after.id)).toBeUndefined();
});

it("returns the same no-store acknowledgement for different identities, forms and malformed submissions", async () => {
  const email = address();
  const post = async (body: unknown) => {
    const response = await newsletterPublicPost(new Request("http://localhost/api/newsletter/signup", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), "signup");
    return [response.status, response.headers.get("cache-control"), await response.json()];
  };
  expect(await post(optIn(email))).toEqual([202, "private, no-store", { accepted: true }]);
  expect(await post(optIn(email, randomUUID()))).toEqual(await post({ email }));
});

it("returns 404 before touching a request body when the production gate is closed", async () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    const request = new Request("http://localhost/api/newsletter/signup", { method: "POST",
      headers: { "Content-Type": "application/json", "X-Vercel-Env": "preview" }, body: "invalid" });
    expect((await newsletterPublicPost(request, "signup")).status).toBe(404);
    expect(request.bodyUsed).toBe(false);
    expect(newsletterPublicInfo("unsubscribe").status).toBe(404);
  } finally { vi.stubEnv("NODE_ENV", "test"); }
});
