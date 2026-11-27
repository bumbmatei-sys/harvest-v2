import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GET as clickGET, HEAD as clickHEAD } from "../../src/app/api/newsletter/link/route";
import { GET as formGET } from "../../src/app/f/[slug]/route";
import { createContact, recordConsent } from "../../src/server/contacts";
import { addNewsletterSubscriber, createNewsletterAudience, createNewsletterList, setNewsletterSubscription } from "../../src/server/newsletter";
import { dispatchCampaign, reviewCampaign, writeCampaign } from "../../src/server/newsletter-campaigns/campaigns";
import { createIdentity, updateIdentity } from "../../src/server/newsletter-campaigns/identities";
import { FakeNewsletterProvider } from "../../src/server/newsletter-campaigns/fake-provider";
import { runNewsletterWorker } from "../../src/server/newsletter-campaigns/worker";
import { purgeNewsletterClicks, recheckNewsletterDomains } from "../../src/server/newsletter-campaigns/maintenance";
import { saveMailingAddress } from "../../src/server/newsletter-campaigns/sender-setup";
import { newsletterAnalyticsOverview, newsletterCampaignAnalytics } from "../../src/server/newsletter-campaigns/analytics-overview";
import { newsletterClickSettings, saveNewsletterClickSettings } from "../../src/server/newsletter-clicks";
import { createNewsletterSignupFormDraft } from "../../src/server/newsletter-forms";
import { getCrmForm } from "../../src/server/crm-forms";
import { transitionCrmForm } from "../../src/server/crm-form-publication";
import { withTenant } from "../../src/server/tenancy";
import { signClickToken, verifyClickToken } from "../../src/lib/newsletter-click-token";
import { testDatabase } from "../database";
import { seedCampaign } from "../helpers/newsletter-analytics-seed";
import { noNetwork, seedPeople } from "./social-layer-fixture";

// Newsletter link-click counting, end to end through the fake transport only: settings (owner only), send-time rewriting, the signed redirect,
// aggregate-only reports with small groups withheld, the 90-day roll-up, and no per-person click data anywhere the app can read.
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => fixture.db }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
let list: string, senderId: string, replyToId: string;
const origin = "https://newsletter.example.test";
const tokenKey = randomBytes(32).toString("hex"), suppressionKeys = JSON.stringify([randomBytes(32).toString("hex")]);
const workerEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", HARVEST_NEWSLETTER_WORKER_ENABLED: "1", HARVEST_NEWSLETTER_TOKEN_KEY: tokenKey, HARVEST_NEWSLETTER_SUPPRESSION_KEYS: suppressionKeys };
const retention = { ...workerEnv, HARVEST_NEWSLETTER_RETENTION_ENABLED: "1" };
const links = { a: "https://ministry.example.invalid/advent", b: "https://ministry.example.invalid/give", c: "https://ministry.example.invalid/events" };
const content = [
  { type: "richText", doc: { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "Hi {{firstName}}, read " }, { type: "text", text: "the advent plan", marks: [{ type: "link", attrs: { href: links.a } }] },
    { type: "text", text: " or see " }, { type: "text", text: "events", marks: [{ type: "link", attrs: { href: links.c } }] }] }] } },
  { type: "button", label: "Give", href: links.b },
];
const recipients: string[] = [];

beforeAll(async () => {
  fetchSpy = noNetwork();
  fixture = await testDatabase({ migrationOwner: true });
  people = await seedPeople(fixture, "nlclk");
  vi.stubEnv("HARVEST_NEWSLETTER_TOKEN_KEY", tokenKey);
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", suppressionKeys);
  vi.stubEnv("HARVEST_CRM_FORMS", "synthetic");
  vi.stubEnv("DATABASE_URL", fixture.appURL);
  vi.stubEnv("HARVEST_CRM_FORMS_TEST_KEY", "6c".repeat(32));
  const audience = (await createNewsletterAudience(fixture.db, people.owner, people.tenant, { name: "Congregation" })).id;
  list = (await createNewsletterList(fixture.db, people.owner, people.tenant, audience, { name: "Weekly" })).id;
  await saveMailingAddress(fixture.db, people.owner, people.tenant, { address: "1 Main Street, Example City" });
  senderId = (await verifyMailbox("hello@nlclk.example.test", "sender")).identity.id;
  replyToId = (await verifyMailbox("replies@nlclk.example.test", "reply-to")).identity.id;
  expect(await recheckNewsletterDomains(fixture.workerPool, { ...workerEnv, HARVEST_NEWSLETTER_DOMAIN_RECHECK_ENABLED: "1" }, new FakeNewsletterProvider())).toEqual({ checked: 1 });
  for (let index = 0; index < 6; index++) recipients.push(await subscribe(index));
}, 120_000);
afterAll(async () => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); } finally {
    fetchSpy?.mockRestore();
    vi.unstubAllEnvs();
    await fixture?.close();
  }
});

async function verifyMailbox(address: string, purpose: "sender" | "reply-to") {
  const confirmMailbox = vi.fn<FakeNewsletterProvider["confirmMailbox"]>();
  const created = await createIdentity(fixture.db, people.owner, people.tenant, { address, purpose }, { confirmMailbox });
  const code = confirmMailbox.mock.calls[0][0].text.split(" ").at(-1);
  return updateIdentity(fixture.db, people.owner, people.tenant, created.identity.id, { action: "confirm", code, version: 1 });
}
async function subscribe(index: number) {
  const email = `reader-${index}-${randomUUID()}@example.invalid`;
  const contact = await createContact(fixture.db, people.owner, people.tenant, { name: `Reader ${index}`, email });
  await recordConsent(fixture.db, people.owner, people.tenant, contact.id, { purpose: "newsletter", channel: "email", status: "granted", source: "test", evidence: "Synthetic consent", noticeVersion: "notice-v1" });
  const subscriber = await addNewsletterSubscriber(fixture.db, people.owner, people.tenant, { contactId: contact.id });
  await setNewsletterSubscription(fixture.db, people.owner, people.tenant, list, subscriber.id, { state: "subscribed", version: 0 });
  return email;
}
/** Writes, reviews and sends a campaign now, then runs the test worker against the fake provider; returns the messages it was handed. */
async function send(name: string) {
  const campaign = await writeCampaign(fixture.db, people.owner, people.tenant, { name, subject: "Ministry news", content, senderId, replyToId, selection: { listIds: [list], segmentIds: [] } });
  const dispatch = { mode: "now" } as const;
  const reviewed = await reviewCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: campaign.version, dispatch });
  await dispatchCampaign(fixture.db, people.owner, people.tenant, campaign.id, { version: reviewed.version, token: reviewed.token, dispatch }, "now");
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
  expect(await runNewsletterWorker(fixture.workerPool, workerEnv, provider)).toMatchObject({ claimed: 6, errors: 0 });
  return { id: campaign.id, messages: submit.mock.calls.map(([message]) => message) };
}
const tracked = (html: string) => [...html.matchAll(/https:\/\/newsletter\.example\.test\/api\/newsletter\/link\?t=([A-Za-z0-9_.-]+)/g)].map((match) => match[1]);
const click = (token: string, method: "GET" | "HEAD" = "GET") => (method === "GET" ? clickGET : clickHEAD)(new Request(`${origin}/api/newsletter/link?t=${token}`, { method }));
const clickRows = async () => (await fixture.admin.query("select * from newsletter_clicks order by clicked_at")).rows;
const setClicks = async (on: boolean) => {
  const current = await newsletterClickSettings(fixture.db, people.owner, people.tenant);
  return saveNewsletterClickSettings(fixture.db, people.owner, people.tenant, { clickTracking: on, version: current.version });
};
const fullTokens = new Map<string, Map<string, string>>();

it("creates forced-RLS tables with no IP, user agent, device or person columns, and pinned definers reached only through their roles", async () => {
  const tables = ["newsletter_settings", "newsletter_click_links", "newsletter_clicks", "newsletter_click_counts"];
  const { rows: rls } = await fixture.admin.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) order by relname", [tables]);
  expect(rls).toHaveLength(4);
  for (const row of rls) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  const { rows: columns } = await fixture.admin.query("select table_name, column_name from information_schema.columns where table_name = any($1)", [tables.slice(1)]);
  expect(columns.length).toBeGreaterThan(10);
  for (const { column_name } of columns) expect(column_name).not.toMatch(/ip|agent|device|address|email|subscriber|contact|referrer|header/i);
  for (const table of tables.slice(1)) {
    const { rows: [grant] } = await fixture.admin.query(`select has_table_privilege('harvest_app',$1,'select') as app_select, has_table_privilege('harvest_app',$1,'insert') as app_insert,
      has_table_privilege('harvest_worker',$1,'select') as worker_select, has_table_privilege('public',$1,'select') as public_select`, [table]);
    expect(grant, table).toEqual({ app_select: false, app_insert: false, worker_select: false, public_select: false });
  }
  const { rows: [settings] } = await fixture.admin.query(`select has_table_privilege('harvest_app','newsletter_settings','select') as s,
    has_column_privilege('harvest_app','newsletter_settings','click_tracking_since','update') as since, has_table_privilege('harvest_app','newsletter_settings','delete') as d`);
  expect(settings).toEqual({ s: true, since: false, d: false });
  const { rows: functions } = await fixture.admin.query(`select p.proname, p.prosecdef, p.proconfig::text as config, pg_get_functiondef(p.oid) as body,
    has_function_privilege('harvest_app',p.oid,'execute') as app, has_function_privilege('harvest_worker',p.oid,'execute') as worker, has_function_privilege('public',p.oid,'execute') as pub
    from pg_proc p where p.proname in ('newsletter_click','newsletter_click_target','newsletter_click_report','newsletter_form_counts_clicks','newsletter_click_links_store','newsletter_purge_clicks','newsletter_delivery_authorize') order by p.proname`);
  expect(functions.map((row) => row.proname)).toEqual(["newsletter_click", "newsletter_click_links_store", "newsletter_click_report", "newsletter_click_target", "newsletter_delivery_authorize", "newsletter_form_counts_clicks", "newsletter_purge_clicks"]);
  for (const row of functions) {
    expect(row.prosecdef, row.proname).toBe(true);
    expect(row.config, row.proname).toContain("search_path=pg_catalog, pg_temp");
    expect(row.pub, row.proname).toBe(false);
    expect(row.body, row.proname).not.toMatch(/role_id\s*(IN|=|<>)/i);
  }
  const byName = Object.fromEntries(functions.map((row) => [row.proname, row]));
  for (const name of ["newsletter_click", "newsletter_click_target", "newsletter_click_report", "newsletter_form_counts_clicks"]) expect(byName[name], name).toMatchObject({ app: true, worker: false });
  for (const name of ["newsletter_click_links_store", "newsletter_purge_clicks", "newsletter_delivery_authorize"]) expect(byName[name], name).toMatchObject({ app: false, worker: true });
  expect(byName.newsletter_click_report.body).toContain("access_role");
  // The application role cannot read or write click rows even inside its own ministry, nor pretend to be a definer.
  await expect(withTenant(fixture.db, people.owner, people.tenant, "newsletter:analytics", async (tx) => {
    await tx.execute(sql`select set_config('app.nl_send_tenant', ${people.tenant}, true)`);
    return tx.execute(sql`select * from public.newsletter_clicks`);
  })).rejects.toHaveProperty("cause.code", "42501");
});

it("is off by default: links stay as written and the footer says nothing about clicks", async () => {
  expect(await newsletterClickSettings(fixture.db, people.owner, people.tenant)).toEqual({ clickTracking: false, since: null, version: 0, canEdit: true });
  const { messages } = await send("Before counting");
  for (const message of messages) {
    expect(message.html).toContain(`href="${links.a}"`);
    expect(message.html).toContain(`href="${links.b}"`);
    expect(message.html).not.toContain("/api/newsletter/link");
    expect(message.text).not.toContain("/api/newsletter/link");
    expect(message.html).not.toContain("counts link clicks");
  }
  expect((await fixture.admin.query("select count(*)::int as n from newsletter_click_links")).rows[0].n).toBe(0);
});

it("lets only the owner turn counting on; admins read it; members, viewers and other ministries cannot", async () => {
  expect(await newsletterClickSettings(fixture.db, people.admin, people.tenant)).toMatchObject({ clickTracking: false, canEdit: false });
  await expect(saveNewsletterClickSettings(fixture.db, people.admin, people.tenant, { clickTracking: true, version: 0 })).rejects.toMatchObject({ status: 404 });
  for (const actor of [people.member, people.viewer]) {
    await expect(newsletterClickSettings(fixture.db, actor, people.tenant)).rejects.toMatchObject({ status: 404 });
    await expect(saveNewsletterClickSettings(fixture.db, actor, people.tenant, { clickTracking: true, version: 0 })).rejects.toMatchObject({ status: 404 });
  }
  await expect(saveNewsletterClickSettings(fixture.db, people.outsider, people.tenant, { clickTracking: true, version: 0 })).rejects.toMatchObject({ status: 404 });
  // The row-level policy refuses an admin's direct write too.
  await expect(withTenant(fixture.db, people.admin, people.tenant, "newsletter:campaigns", (tx) =>
    tx.execute(sql`insert into public.newsletter_settings(tenant_id,click_tracking,version) values (${people.tenant}::uuid,true,1)`))).rejects.toHaveProperty("cause.code", "42501");
  const saved = await saveNewsletterClickSettings(fixture.db, people.owner, people.tenant, { clickTracking: true, version: 0 });
  expect(saved).toMatchObject({ clickTracking: true, version: 1 });
  expect(saved.since).not.toBeNull();
  await expect(saveNewsletterClickSettings(fixture.db, people.owner, people.tenant, { clickTracking: true, version: 0 })).rejects.toMatchObject({ status: 409 });
  // The other ministry is untouched.
  expect(await newsletterClickSettings(fixture.db, people.outsider, people.other)).toMatchObject({ clickTracking: false, version: 0 });
});

it("rewrites content links (never the unsubscribe link) and redirects to the frozen URL, counting once per delivery and link", async () => {
  const { id, messages } = await send("Advent letter");
  const perRecipient = new Map<string, Map<string, string>>();
  for (const message of messages) {
    expect(message.html).not.toContain(`href="${links.a}"`);
    expect(message.html).not.toContain(`href="${links.b}"`);
    expect(message.html).toContain("/api/newsletter/unsubscribe?token=");
    expect(message.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/newsletter\.example\.test\/api\/newsletter\/unsubscribe\?token=/);
    expect(message.html).toContain("This ministry counts link clicks in its emails, as totals only.");
    expect(message.text).toContain("This ministry counts link clicks in its emails, as totals only.");
    const tokens = [...new Set(tracked(message.html))];
    expect(tokens).toHaveLength(3);
    // The token carries references only: never the address or the destination.
    for (const token of tokens) {
      expect(Buffer.from(token.split(".")[0], "base64url").toString("latin1")).not.toMatch(/example\.invalid|ministry|https/);
      expect(token).not.toContain(message.to);
    }
    const map = new Map<string, string>();
    for (const token of tokens) {
      const response = await click(token, "HEAD");
      map.set(response.headers.get("location")!, token);
    }
    perRecipient.set(message.to, map);
  }
  fullTokens.set(id, new Map([...perRecipient].map(([to, map]) => [to, map.get(links.a)!])));
  // HEAD requests (link scanners) redirect without counting.
  expect(await clickRows()).toEqual([]);
  const { rows: stored } = await fixture.admin.query("select link_index, url from newsletter_click_links where campaign_id=$1 order by link_index", [id]);
  expect(stored).toEqual([{ link_index: 0, url: links.a }, { link_index: 1, url: links.c }, { link_index: 2, url: links.b }]);

  const subscriptionsBefore = (await fixture.admin.query("select subscriber_id, list_id, state, version from newsletter_subscriptions order by subscriber_id")).rows;
  const consentsBefore = (await fixture.admin.query("select count(*)::int as n from contact_consents")).rows[0].n;
  // Six people open link A, five open link B, two open link C.
  for (const [index, to] of recipients.entries()) {
    const map = perRecipient.get(to)!;
    const response = await click(map.get(links.a)!);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(links.a);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    if (index < 5) expect((await click(map.get(links.b)!)).headers.get("location")).toBe(links.b);
    if (index < 2) expect((await click(map.get(links.c)!)).headers.get("location")).toBe(links.c);
  }
  expect(await clickRows()).toHaveLength(13);
  // The same GET again is idempotent and never changes a subscription or a consent.
  for (const to of recipients) expect((await click(perRecipient.get(to)!.get(links.a)!)).status).toBe(302);
  expect(await clickRows()).toHaveLength(13);
  expect((await fixture.admin.query("select subscriber_id, list_id, state, version from newsletter_subscriptions order by subscriber_id")).rows).toEqual(subscriptionsBefore);
  expect((await fixture.admin.query("select count(*)::int as n from contact_consents")).rows[0].n).toBe(consentsBefore);
});

it("never redirects to a URL from the request: tampered, foreign-key and unknown links go to the neutral page", async () => {
  const [campaignId, map] = [...fullTokens][0];
  const token = [...map.values()][0];
  const neutral = `${origin}/newsletter/link`;
  const before = (await clickRows()).length;
  const [payload, signature] = token.split(".");
  const flipped = payload.slice(0, 10) + (payload[10] === "A" ? "B" : "A") + payload.slice(11);
  for (const bad of [`${flipped}.${signature}`, `${payload}.${signature.slice(0, -1)}${signature.at(-1) === "A" ? "B" : "A"}`, "garbage", "",
    encodeURIComponent("https://evil.example.invalid/")]) {
    const response = await click(bad);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(neutral);
  }
  const reference = verifyClickToken(Buffer.from(tokenKey, "hex"), token)!;
  expect(reference.campaign).toBe(campaignId);
  // A token signed with another key, or a correctly signed token for a link the revision does not have.
  expect((await click(signClickToken(randomBytes(32), reference))).headers.get("location")).toBe(neutral);
  expect((await click(signClickToken(Buffer.from(tokenKey, "hex"), { ...reference, link: 7 }))).headers.get("location")).toBe(neutral);
  expect((await click(signClickToken(Buffer.from(tokenKey, "hex"), { ...reference, tenant: people.other }))).headers.get("location")).toBe(neutral);
  // A correctly signed token naming a delivery that does not exist still redirects but counts nothing.
  expect((await click(signClickToken(Buffer.from(tokenKey, "hex"), { ...reference, delivery: randomUUID() }))).headers.get("location")).toBe(links.a);
  expect((await clickRows()).length).toBe(before);
});

it("reports totals, the UTC day and top links only, withholding small groups, for owners and admins only", async () => {
  const [campaignId] = [...fullTokens][0];
  const overview = await newsletterAnalyticsOverview(fixture.db, people.owner, people.tenant, 30);
  expect(overview.clicks.counting).toBe(true);
  expect(overview.clicks.total).toBe(13);
  const today = new Date().toISOString().slice(0, 10);
  expect(overview.clicks.days.find((day) => day.day === today)?.clicks).toBe(13);
  expect(overview.campaigns.find((row) => row.id === campaignId)?.clicks).toBe(13);
  const detail = await newsletterCampaignAnalytics(fixture.db, people.admin, people.tenant, campaignId);
  expect(detail.clicks?.total).toBe(13);
  // Link C (2 clicks) is a small group, and leaving only it out would let it be subtracted, so the smallest shown link (B) is left out too.
  expect(detail.clicks?.links).toEqual([{ url: links.a, clicks: 6 }]);
  const text = JSON.stringify([overview, detail]);
  for (const email of recipients) expect(text).not.toContain(email);
  expect(text).not.toMatch(/delivery|subscriber|contact/i);
  for (const actor of [people.member, people.viewer, people.outsider]) {
    await expect(newsletterAnalyticsOverview(fixture.db, actor, people.tenant, 30)).rejects.toMatchObject({ status: 404 });
    await expect(newsletterCampaignAnalytics(fixture.db, actor, people.tenant, campaignId)).rejects.toMatchObject({ status: 404 });
  }
  // The definer itself refuses a member and another ministry.
  const range = { from: today, until: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) };
  await expect(withTenant(fixture.db, people.member, people.tenant, "newsletter:read", (tx) =>
    tx.execute(sql`select public.newsletter_click_report(${people.tenant}::uuid,null,${range.from}::date,${range.until}::date)`))).rejects.toHaveProperty("cause.code", "42501");
  await expect(withTenant(fixture.db, people.owner, people.tenant, "newsletter:analytics", (tx) =>
    tx.execute(sql`select public.newsletter_click_report(${people.other}::uuid,null,${range.from}::date,${range.until}::date)`))).rejects.toHaveProperty("cause.code", "42501");
  // The other ministry sees none of it.
  const elsewhere = await newsletterAnalyticsOverview(fixture.db, people.outsider, people.other, 30);
  expect(elsewhere.clicks).toMatchObject({ counting: false, total: 0 });
  // The definer leaves no setting behind.
  const flags = await withTenant(fixture.db, people.owner, people.tenant, "newsletter:analytics", async (tx) => {
    await tx.execute(sql`select public.newsletter_click_report(${people.tenant}::uuid,null,${range.from}::date,${range.until}::date)`);
    await tx.execute(sql`select public.newsletter_click(${people.tenant}::uuid,${campaignId}::uuid,1,${randomUUID()}::uuid,0)`);
    return (await tx.execute<{ send: string | null }>(sql`select current_setting('app.nl_send_tenant', true) as send`)).rows[0];
  });
  expect(flags.send ?? "").toBe("");
});

it("withholds a small day, the period total and that campaign's row, and every click of a campaign sent to fewer than 5", async () => {
  const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const client = await fixture.admin.connect();
  try {
    const small = await seedCampaign(client, { tenant: people.tenant, user: people.owner, name: "Small day", days: [{ day, accepted: 6 }] });
    const tiny = await seedCampaign(client, { tenant: people.tenant, user: people.owner, name: "Tiny list", days: [{ day, accepted: 3 }] });
    for (const [campaign, count] of [[small, 3], [tiny, 6]] as const) {
      await client.query("insert into newsletter_click_links(tenant_id,campaign_id,revision,link_index,url) values($1,$2,1,0,$3)", [people.tenant, campaign, links.a]);
      for (let index = 0; index < count; index++) await client.query("insert into newsletter_clicks(tenant_id,campaign_id,revision,delivery_id,link_index,clicked_at) values($1,$2,1,$3,0,$4::timestamptz)",
        [people.tenant, campaign, randomUUID(), `${day}T12:00:00Z`]);
    }
    const overview = await newsletterAnalyticsOverview(fixture.db, people.owner, people.tenant, 30);
    expect(overview.clicks.total).toBeNull();
    expect(overview.clicks.days.find((row) => row.day === day)?.clicks).toBeNull();
    expect(overview.campaigns.find((row) => row.id === small)?.clicks).toBeNull();
    expect(overview.campaigns.find((row) => row.id === tiny)?.clicks).toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    expect(overview.clicks.days.find((row) => row.day === today)?.clicks).toBe(13);
    const detail = await newsletterCampaignAnalytics(fixture.db, people.owner, people.tenant, tiny);
    expect(detail.clicks).toMatchObject({ total: null, links: [] });
  } finally {
    await client.query("delete from newsletter_clicks where tenant_id=$1 and clicked_at<now()-interval '1 day'", [people.tenant]);
    client.release();
  }
});

it("never lets a campaign's link totals reveal a withheld day: top links count only shown days", async () => {
  // Review regression: one campaign to 6 people; 10 clicks on one day (5 per link), then 3 clicks on one link the next day. Before the fix the
  // links read 8 and 5 while every day was withheld, so the hidden figures could be recovered.
  const shownDay = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10), hiddenDay = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
  const client = await fixture.admin.connect();
  let campaign = "";
  try {
    campaign = await seedCampaign(client, { tenant: people.tenant, user: people.owner, name: "Two days", days: [{ day: shownDay, accepted: 6 }] });
    for (const [index, url] of [links.a, links.b].entries()) await client.query("insert into newsletter_click_links(tenant_id,campaign_id,revision,link_index,url) values($1,$2,1,$3,$4)", [people.tenant, campaign, index, url]);
    const add = (link: number, day: string, count: number) => Promise.all(Array.from({ length: count }, () => client.query(
      "insert into newsletter_clicks(tenant_id,campaign_id,revision,delivery_id,link_index,clicked_at) values($1,$2,1,$3,$4,$5::timestamptz)", [people.tenant, campaign, randomUUID(), link, `${day}T12:00:00Z`])));
    await add(0, shownDay, 5); await add(1, shownDay, 5); await add(0, hiddenDay, 3);
    const { clicks } = await newsletterCampaignAnalytics(fixture.db, people.owner, people.tenant, campaign);
    expect(clicks!.total).toBeNull();
    // A small day withholds every day of that campaign (the differencing rule), so no link may show a figure either.
    expect(clicks!.days.find((row) => row.day === hiddenDay)?.clicks).toBeNull();
    expect(clicks!.days.find((row) => row.day === shownDay)?.clicks).toBeNull();
    const shownDays = clicks!.days.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
    const linkTotal = clicks!.links.reduce((sum, link) => sum + link.clicks, 0);
    expect(linkTotal).toBeLessThanOrEqual(shownDays);
    expect(clicks!.links).toEqual([]);
  } finally {
    if (campaign) await client.query("delete from newsletter_clicks where campaign_id=$1", [campaign]);
    client.release();
  }
});

it("rolls click rows older than 90 days into anonymous counts and deletes them, from the worker only", async () => {
  expect(await purgeNewsletterClicks(fixture.workerPool, workerEnv)).toBeNull();
  expect(await purgeNewsletterClicks(fixture.workerPool, { ...retention, NODE_ENV: "production" })).toBeNull();
  await expect(purgeNewsletterClicks(fixture.pool, retention)).rejects.toThrow("WORKER_ROLE_REQUIRED");
  await expect(purgeNewsletterClicks(fixture.workerPool, retention, 5001)).rejects.toHaveProperty("code", "22023");
  await expect(fixture.pool.query("select public.newsletter_purge_clicks(10)")).rejects.toHaveProperty("code", "42501");
  const old = new Date(Date.now() - 91 * 86_400_000);
  await fixture.admin.query("update newsletter_clicks set clicked_at=$1 where link_index=0", [old]);
  expect(await purgeNewsletterClicks(fixture.workerPool, retention, 4)).toEqual({ purged: 4 });
  expect(await purgeNewsletterClicks(fixture.workerPool, retention)).toEqual({ purged: 2 });
  expect(await purgeNewsletterClicks(fixture.workerPool, retention)).toEqual({ purged: 0 });
  expect((await fixture.admin.query("select count(*)::int as n from newsletter_clicks where link_index=0")).rows[0].n).toBe(0);
  const { rows: counts } = await fixture.admin.query("select day::text, link_index, count::int from newsletter_click_counts");
  expect(counts).toEqual([{ day: old.toISOString().slice(0, 10), link_index: 0, count: 6 }]);
  expect(Object.keys((await fixture.admin.query("select * from newsletter_click_counts")).rows[0]).sort()).toEqual(["campaign_id", "count", "day", "link_index", "revision", "tenant_id"]);
  // The rolled-up figures are still reported for a window that covers that day.
  const from = old.toISOString().slice(0, 10), until = new Date(old.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const report = await withTenant(fixture.db, people.owner, people.tenant, "newsletter:analytics", async (tx) =>
    (await tx.execute<{ r: { total: number } }>(sql`select public.newsletter_click_report(${people.tenant}::uuid,null,${from}::date,${until}::date) as r`)).rows[0].r);
  expect(Number(report.total)).toBe(6);
});

it("stops rewriting and counting as soon as the owner turns it off, and does not count a campaign frozen while it was off", async () => {
  const [, map] = [...fullTokens][0];
  await fixture.admin.query("delete from newsletter_clicks");
  await setClicks(false);
  const { id, messages } = await send("After counting");
  for (const message of messages) {
    expect(message.html).toContain(`href="${links.a}"`);
    expect(message.html).not.toContain("/api/newsletter/link");
    expect(message.html).not.toContain("counts link clicks");
  }
  expect((await fixture.admin.query("select count(*)::int as n from newsletter_click_links where campaign_id=$1", [id])).rows[0].n).toBe(0);
  // Links already sent keep working but count nothing while it is off.
  const token = [...map.values()][0];
  expect((await click(token)).headers.get("location")).toBe(links.a);
  expect(await clickRows()).toEqual([]);
  // Turned on again later: the earlier campaign was frozen before this new start, so it is still not counted.
  await setClicks(true);
  expect((await click(token)).headers.get("location")).toBe(links.a);
  expect(await clickRows()).toEqual([]);
});

it("tells a hosted sign-up form's visitors when the ministry counts link clicks", async () => {
  const { id } = await createNewsletterSignupFormDraft(fixture.db, people.admin, people.tenant, { listIds: [list] });
  const { definition } = await getCrmForm(fixture.db, people.admin, people.tenant, id);
  const slug = `nlclk-${Date.now().toString(36)}`;
  await transitionCrmForm(fixture.db, people.admin, people.tenant, id, { action: "publish", slug, revision: definition.revision });
  const manifest = async () => (await (await formGET(new Request(`${origin}/f/${slug}`, { headers: { "x-forwarded-for": "198.51.100.7" } }), { params: Promise.resolve({ slug }) })).json()) as { clicksCounted?: boolean; newsletter?: unknown };
  expect(await manifest()).toMatchObject({ clicksCounted: true, newsletter: expect.any(Object) });
  await setClicks(false);
  expect((await manifest()).clicksCounted).toBe(false);
});
