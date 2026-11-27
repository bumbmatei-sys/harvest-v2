import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GET } from "../../src/app/f/[slug]/route";
import { POST } from "../../src/app/f/[slug]/submit/route";
import { GET as sinkGET } from "../../src/app/api/newsletter/confirmation-sink/route";
import { CLICKS_COUNTED_LINE, NEWSLETTER_BLOCK_IDS, newsletterWordings } from "../../src/lib/newsletter-signup";
import { getCrmForm, saveCrmForm } from "../../src/server/crm-forms";
import { transitionCrmForm } from "../../src/server/crm-form-publication";
import { createNewsletterAudience, createNewsletterList } from "../../src/server/newsletter";
import { newsletterClickSettings, saveNewsletterClickSettings } from "../../src/server/newsletter-clicks";
import { createNewsletterSignupFormDraft } from "../../src/server/newsletter-forms";
import { confirmNewsletterSignup } from "../../src/server/newsletter-public";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";

// Founder decision 27 Nov 2026: the "links are counted" line is part of the recorded consent wording. A hosted sign-up records newsletter-consent-v2
// while the ministry counts link clicks and newsletter-consent-v1 otherwise; earlier v1 sign-ups and grants are never rewritten.
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => fixture.db }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
let list: string, formId: string, at: string;
const origin = "http://localhost:3000";

beforeAll(async () => {
  fetchSpy = noNetwork();
  fixture = await testDatabase({ migrationOwner: true });
  people = await seedPeople(fixture, "nlcv");
  const audience = (await createNewsletterAudience(fixture.db, people.owner, people.tenant, { name: "Audience" })).id;
  list = (await createNewsletterList(fixture.db, people.owner, people.tenant, audience, { name: "Weekly" })).id;
  vi.stubEnv("HARVEST_CRM_FORMS", "synthetic");
  vi.stubEnv("HARVEST_CRM_FORMS_TEST_KEY", "5b".repeat(32));
  vi.stubEnv("HARVEST_NEWSLETTER_TOKEN_KEY", randomBytes(32).toString("hex"));
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", JSON.stringify([randomBytes(32).toString("hex")]));
  vi.stubEnv("DATABASE_URL", fixture.appURL);
  vi.stubEnv("BETTER_AUTH_URL", origin);
  formId = (await createNewsletterSignupFormDraft(fixture.db, people.admin, people.tenant, { listIds: [list] })).id;
  const { definition } = await getCrmForm(fixture.db, people.admin, people.tenant, formId);
  definition.settings.spamCheck = false;
  await saveCrmForm(fixture.db, people.admin, people.tenant, formId, { definition, revision: definition.revision });
  at = `consent-v2-${Date.now().toString(36)}`;
  const saved = (await getCrmForm(fixture.db, people.admin, people.tenant, formId)).definition;
  await transitionCrmForm(fixture.db, people.admin, people.tenant, formId, { action: "publish", slug: at, revision: saved.revision });
}, 90_000);
afterAll(async () => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); } finally {
    fetchSpy?.mockRestore();
    vi.unstubAllEnvs();
    await fixture?.close();
  }
});

let visitors = 0;
const fresh = () => `198.53.${(visitors >> 8) & 255}.${visitors++ & 255}`;
// The hosted path accepts only synthetic @example.test addresses (every hosted form, while the activation decisions are open).
const address = () => `nlcv-${randomUUID()}@example.test`;
type Manifest = { proof: string; newsletter: { wordingVersion: string; consentText: string; fixedNotice: string }; blocks: { id: string; type: string; label: string; text?: string }[] };
const manifest = async () => {
  const response = await GET(new Request(`${origin}/f/${at}`, { headers: { "x-forwarded-for": fresh() } }), { params: Promise.resolve({ slug: at }) });
  expect(response.status).toBe(200);
  return await response.json() as Manifest;
};
const post = (proof: string, email: string, wording?: string) => POST(new Request(`${origin}/f/${at}/submit`, {
  method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": fresh() },
  body: JSON.stringify({ proof, answers: { [NEWSLETTER_BLOCK_IDS.email]: email, consent0: "yes" }, ...(wording ? { wording } : {}) }) }), { params: Promise.resolve({ slug: at }) });
const messages = async (to: string) => {
  const response = sinkGET(new Request(`${origin}/api/newsletter/confirmation-sink?to=${encodeURIComponent(to)}`));
  return response.status === 200 ? (await response.json() as { messages: { path: string }[] }).messages : [];
};
async function confirm(email: string) {
  const [entry] = await messages(email);
  const query = new URL(entry.path, origin).searchParams;
  await confirmNewsletterSignup(fixture.db, { email: query.get("email")!, token: query.get("token")! });
}
/** The newest sign-ups of the form, newest first (the address is never stored, so rows cannot be found by it). */
const signup = async () => (await fixture.admin.query("select wording_version, state from newsletter_form_signups where form_id=$1 order by created_at desc", [formId])).rows;
const person = async (email: string) => (await fixture.admin.query("select contact_id from contact_identifiers where normalized_value=$1", [email])).rows[0]?.contact_id as string | undefined;
const grants = async (contact: string) => (await fixture.admin.query("select * from contact_consents where contact_id=$1 order by recorded_at, id", [contact])).rows;
const subscription = async (contact: string) => (await fixture.admin.query(`select s.* from newsletter_subscriptions s join newsletter_subscribers b on b.tenant_id=s.tenant_id
  and b.id=s.subscriber_id where b.contact_id=$1`, [contact])).rows;
const setClicks = async (on: boolean) => {
  const current = await newsletterClickSettings(fixture.db, people.owner, people.tenant);
  return saveNewsletterClickSettings(fixture.db, people.owner, people.tenant, { clickTracking: on, version: current.version });
};
const consentBlock = (body: Manifest) => body.blocks.find((block) => block.type === "consent")!;
const start = (version: string, email: string, wording: string) => fixture.pool.query<{ queued: boolean }>(
  "select public.newsletter_form_signup_start($1,$2::uuid,$3::uuid,$4,'','',$5,$6,$7) as queued",
  [at, version, randomUUID(), email, randomBytes(32).toString("base64url"), randomBytes(32).toString("hex"), wording]);

let earlier: { email: string; contact: string; grants: unknown[]; subscription: unknown[] };

it("keeps v1 immutable and defines v2 as the v1 statement plus the clicks line", () => {
  expect(newsletterWordings["newsletter-consent-v1"].consent).toBe("I agree to receive the {ministry} newsletter by email. I can unsubscribe at any time.");
  expect(newsletterWordings["newsletter-consent-v2"]).toEqual({
    consent: `${newsletterWordings["newsletter-consent-v1"].consent} ${CLICKS_COUNTED_LINE}`, fixed: newsletterWordings["newsletter-consent-v1"].fixed });
  expect(CLICKS_COUNTED_LINE).toBe("This ministry counts link clicks in its emails, as totals only.");
});

it("records newsletter-consent-v1 while the ministry does not count link clicks", async () => {
  const body = await manifest();
  expect(body.newsletter.wordingVersion).toBe("newsletter-consent-v1");
  expect(consentBlock(body).label).not.toContain(CLICKS_COUNTED_LINE);
  expect(body).not.toHaveProperty("clicksCounted", true);
  const email = address();
  expect((await post(body.proof, email, "newsletter-consent-v1")).status).toBe(200);
  expect((await signup())[0]).toMatchObject({ wording_version: "newsletter-consent-v1", state: "pending" });
  await confirm(email);
  const contact = (await person(email))!;
  const rows = await grants(contact);
  expect(rows.filter((row) => row.status === "granted")).toHaveLength(1);
  expect(rows[0].evidence).toContain("newsletter-consent-v1");
  earlier = { email, contact, grants: rows, subscription: await subscription(contact) };
  expect(earlier.subscription).toMatchObject([{ state: "subscribed" }]);
});

it("records newsletter-consent-v2, with the clicks line in the consent the page shows, while counting is on", async () => {
  await setClicks(true);
  const body = await manifest();
  const v1Text = `I agree to receive the ${(await fixture.admin.query("select name from workspaces where tenant_id=$1", [people.tenant])).rows[0].name} newsletter by email. I can unsubscribe at any time.`;
  expect(body.newsletter).toMatchObject({ wordingVersion: "newsletter-consent-v2", consentText: `${v1Text} ${CLICKS_COUNTED_LINE}` });
  expect(consentBlock(body).label).toBe(`${v1Text} ${CLICKS_COUNTED_LINE}`);
  expect(consentBlock(body).text).toBe(`${v1Text} ${CLICKS_COUNTED_LINE} ${body.newsletter.fixedNotice}`);
  // The form itself keeps its frozen v1 wording: v2 is chosen at sign-up, never stored on the form.
  const { definition } = await getCrmForm(fixture.db, people.admin, people.tenant, formId);
  expect(definition.newsletter?.wordingVersion).toBe("newsletter-consent-v1");
  const email = address();
  expect((await post(body.proof, email, "newsletter-consent-v2")).status).toBe(200);
  expect((await signup())[0]).toMatchObject({ wording_version: "newsletter-consent-v2", state: "pending" });
  await confirm(email);
  const [grant] = (await grants((await person(email))!)).filter((row) => row.status === "granted");
  expect(grant.evidence).toContain("newsletter-consent-v2");
  expect(grant.evidence).not.toContain("newsletter-consent-v1");
});

it("leaves earlier v1 sign-ups, grants and subscriptions untouched when counting is turned on later", async () => {
  expect(await grants(earlier.contact)).toEqual(earlier.grants);
  expect(await subscription(earlier.contact)).toEqual(earlier.subscription);
  const { rows } = await fixture.admin.query("select wording_version, count(*)::int as n from newsletter_form_signups where form_id=$1 group by 1 order by 1", [formId]);
  expect(rows).toEqual([{ wording_version: "newsletter-consent-v1", n: 1 }, { wording_version: "newsletter-consent-v2", n: 1 }]);
});

it("asks a page that showed another wording to reload, and records nothing for it", async () => {
  const before = (await fixture.admin.query("select count(*)::int as n from newsletter_form_signups where form_id=$1", [formId])).rows[0].n;
  // Counting is on: a page still showing v1 (or an old page that names no wording) is refused with 409 and sends nothing.
  for (const wording of ["newsletter-consent-v1", undefined]) {
    const email = address();
    expect((await post((await manifest()).proof, email, wording)).status).toBe(409);
    expect(await messages(email)).toEqual([]);
  }
  await setClicks(false);
  const email = address();
  expect((await post((await manifest()).proof, email, "newsletter-consent-v2")).status).toBe(409);
  expect(await messages(email)).toEqual([]);
  expect((await fixture.admin.query("select count(*)::int as n from newsletter_form_signups where form_id=$1", [formId])).rows[0].n).toBe(before);
  // The database applies the same rule on its own, so a setting changed mid-request still never records words the person did not see.
  const { rows: [{ version_id: version }] } = await fixture.admin.query("select version_id from crm_form_addresses where slug=$1", [at]);
  expect((await start(version, address(), "newsletter-consent-v2")).rows[0].queued).toBe(false);
  expect((await start(version, address(), "not-a-wording")).rows[0].queued).toBe(false);
  expect((await start(version, address(), "newsletter-consent-v1")).rows[0].queued).toBe(true);
  await setClicks(true);
  expect((await start(version, address(), "newsletter-consent-v1")).rows[0].queued).toBe(false);
  expect((await start(version, address(), "newsletter-consent-v2")).rows[0].queued).toBe(true);
  const { rows } = await fixture.admin.query("select wording_version from newsletter_form_signups where form_id=$1 order by created_at desc limit 2", [formId]);
  expect(rows.map((row) => row.wording_version)).toEqual(["newsletter-consent-v2", "newsletter-consent-v1"]);
});

it("replaces the start function with one pinned definer reachable by the app only", async () => {
  const { rows } = await fixture.admin.query(`select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig::text as config,
    has_function_privilege('harvest_app',p.oid,'execute') as app, has_function_privilege('public',p.oid,'execute') as pub, pg_get_functiondef(p.oid) as body
    from pg_proc p where p.proname='newsletter_form_signup_start'`);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ prosecdef: true, app: true, pub: false });
  expect(rows[0].args).toContain("p_wording text");
  expect(rows[0].config).toContain("search_path=pg_catalog, pg_temp");
  expect(rows[0].body).not.toMatch(/pg_settings/);
  // Every app.* setting it changes is restored.
  for (const setting of ["app.tenant_id", "app.nl02_tenant", "app.crm_forms_slug", "app.crm_forms_tenant", "app.nl02_private", "app.nl_send_tenant"]) {
    expect(rows[0].body).toContain(`set_config('${setting}', coalesce(previous_`);
  }
});
