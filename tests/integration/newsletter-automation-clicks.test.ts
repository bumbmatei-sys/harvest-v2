import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { GET as clickGET, HEAD as clickHEAD } from "../../src/app/api/newsletter/link/route";
import { newBlock, newId, defaultBrand } from "../../src/lib/email/blocks";
import { readClickToken, signAutomationClickToken } from "../../src/lib/newsletter-click-token";
import { createContact, recordConsent } from "../../src/server/contacts";
import { addNewsletterSubscriber, createNewsletterAudience, createNewsletterList, setNewsletterSubscription } from "../../src/server/newsletter";
import { automationClicks, createAutomation, getAutomation, updateAutomation } from "../../src/server/newsletter-automations";
import { runNewsletterAutomations } from "../../src/server/newsletter-automations-worker";
import { FakeNewsletterProvider } from "../../src/server/newsletter-campaigns/fake-provider";
import { purgeNewsletterAutomationClicks } from "../../src/server/newsletter-campaigns/maintenance";
import { newsletterClickSettings, saveNewsletterClickSettings } from "../../src/server/newsletter-clicks";
import { withTenant } from "../../src/server/tenancy";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";

// Founder decision 27 Nov 2026: automation emails count link clicks under the campaign rules. Links are rewritten only while the ministry counts clicks;
// totals only per automation, step, day and link; groups under 5 withheld; owners and admins only; 90 days, then anonymous counts; no IP or device data.
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => fixture.db }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
let audience: string;
const origin = "http://localhost:3000";
const tokenKey = randomBytes(32).toString("hex");
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", HARVEST_NEWSLETTER_AUTOMATIONS: "1", HARVEST_NEWSLETTER_AUTOMATIONS_WORKER_ENABLED: "1", HARVEST_NEWSLETTER_TOKEN_KEY: tokenKey,
  HARVEST_NEWSLETTER_SUPPRESSION_KEYS: JSON.stringify([randomBytes(32).toString("hex")]) };
const retention = { ...env, HARVEST_NEWSLETTER_RETENTION_ENABLED: "1" };
const links = { give: "https://ministry.example.invalid/give", events: "https://ministry.example.invalid/events" };

beforeAll(async () => {
  fetchSpy = noNetwork();
  fixture = await testDatabase({ migrationOwner: true });
  people = await seedPeople(fixture, "nlac");
  audience = (await createNewsletterAudience(fixture.db, people.owner, people.tenant, { name: "Audience" })).id;
  vi.stubEnv("HARVEST_NEWSLETTER_AUTOMATIONS", "1");
  vi.stubEnv("HARVEST_NEWSLETTER_TOKEN_KEY", tokenKey);
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", env.HARVEST_NEWSLETTER_SUPPRESSION_KEYS!);
  vi.stubEnv("DATABASE_URL", fixture.appURL);
  vi.stubEnv("BETTER_AUTH_URL", origin);
}, 90_000);
afterAll(async () => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); } finally { fetchSpy?.mockRestore(); vi.unstubAllEnvs(); await fixture?.close(); }
});
// Each test starts with no unfinished runs from the others (the worker handles every due run).
beforeEach(async () => { await fixture.admin.query("update newsletter_automation_runs set state='stopped', stop_reason='automation_changed', finished_at=now(), lease=null, lease_until=null where state='active'"); });

const brand = { ...defaultBrand, address: "1 Main Street" };
const emailStep = (subject: string) => ({ id: newId(), type: "email" as const, subject, preheader: "", content: { version: 2 as const, brand, blocks: [
  newBlock("text", { text: "Hello {{firstName}}" }, newId()),
  { ...newBlock("giving", { heading: "Give", text: "Support the ministry", button: "Give" }, newId()), buttonUrl: links.give },
  { ...newBlock("event", { title: "Advent", date: "1 Dec", time: "10:00", location: "Hall", button: "Details" }, newId()), buttonUrl: links.events }] } });
const endStep = () => ({ id: newId(), type: "end" as const });
const setClicks = async (on: boolean) => {
  const current = await newsletterClickSettings(fixture.db, people.owner, people.tenant);
  if (current.clickTracking !== on) await saveNewsletterClickSettings(fixture.db, people.owner, people.tenant, { clickTracking: on, version: current.version });
};
/** A list automation with one email step, active, and `size` subscribers entered into it. */
async function automationWith(size: number, subject = "Welcome", emails = 1) {
  const list = (await createNewsletterList(fixture.db, people.owner, people.tenant, audience, { name: "List " + randomUUID().slice(0, 6) })).id;
  const steps = [...Array.from({ length: emails }, (_, index) => emailStep(index ? `${subject} ${index + 1}` : subject)), endStep()];
  const made = await createAutomation(fixture.db, people.owner, people.tenant, { name: "Welcome series", trigger: { type: "list", listId: list }, steps });
  await updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: (await getAutomation(fixture.db, people.owner, people.tenant, made.id)).version, state: "active" });
  for (let index = 0; index < size; index++) {
    const contact = await createContact(fixture.db, people.owner, people.tenant, { name: `Reader ${index}`, email: `nlac-${randomUUID()}@example.invalid` });
    await recordConsent(fixture.db, people.owner, people.tenant, contact.id, { purpose: "newsletter", channel: "email", status: "granted", source: "test", evidence: "Synthetic consent", noticeVersion: "notice-v1" });
    const subscriber = await addNewsletterSubscriber(fixture.db, people.owner, people.tenant, { contactId: contact.id });
    await setNewsletterSubscription(fixture.db, people.owner, people.tenant, list, subscriber.id, { state: "subscribed", version: 0 });
  }
  return made.id;
}
/** Runs the automations worker against the fake provider and returns the messages it was handed. */
async function tick() {
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
  await runNewsletterAutomations(fixture.workerPool, env, provider);
  return submit.mock.calls.map(([message]) => message);
}
const tracked = (html: string) => [...html.matchAll(/https:\/\/newsletter\.example\.test\/api\/newsletter\/link\?t=([A-Za-z0-9_.-]+)/g)].map((match) => match[1]);
const click = (token: string, method: "GET" | "HEAD" = "GET") => (method === "GET" ? clickGET : clickHEAD)(new Request(`${origin}/api/newsletter/link?t=${token}`, { method }));
const clickRows = async (automation: string) => (await fixture.admin.query("select * from newsletter_automation_clicks where automation_id=$1 order by clicked_at", [automation])).rows;
const report = (automation: string, actor = people.owner) => automationClicks(fixture.db, actor, people.tenant, automation);
const neutral = `${origin}/newsletter/link`;
let counted: { automation: string; tokens: string[][] };

it("creates forced-RLS tables with no IP, user agent, device or person columns, and pinned definers reached only through their roles", async () => {
  const tables = ["newsletter_automation_click_links", "newsletter_automation_clicks", "newsletter_automation_click_counts"];
  const { rows: rls } = await fixture.admin.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) order by relname", [tables]);
  expect(rls).toHaveLength(3);
  for (const row of rls) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  const { rows: columns } = await fixture.admin.query("select column_name from information_schema.columns where table_name = any($1)", [tables]);
  expect(columns.length).toBeGreaterThan(10);
  for (const { column_name } of columns) expect(column_name).not.toMatch(/ip|agent|device|address|email|subscriber|contact|run|referrer|header/i);
  for (const table of tables) {
    const { rows: [grant] } = await fixture.admin.query(`select has_table_privilege('harvest_app',$1,'select') as app_select, has_table_privilege('harvest_app',$1,'insert') as app_insert,
      has_table_privilege('harvest_worker',$1,'select') as worker_select, has_table_privilege('public',$1,'select') as public_select`, [table]);
    expect(grant, table).toEqual({ app_select: false, app_insert: false, worker_select: false, public_select: false });
  }
  const { rows: functions } = await fixture.admin.query(`select p.proname, p.prosecdef, p.proconfig::text as config, pg_get_functiondef(p.oid) as body,
    has_function_privilege('harvest_app',p.oid,'execute') as app, has_function_privilege('harvest_worker',p.oid,'execute') as worker, has_function_privilege('public',p.oid,'execute') as pub
    from pg_proc p where p.proname like 'newsletter%automation_click%' or p.proname='newsletter_purge_automation_clicks' order by p.proname`);
  expect(functions.map((row) => row.proname)).toEqual(["newsletter_automation_click", "newsletter_automation_click_links_store", "newsletter_automation_click_report",
    "newsletter_automation_click_target", "newsletter_purge_automation_clicks"]);
  for (const row of functions) {
    expect(row.prosecdef, row.proname).toBe(true);
    expect(row.config, row.proname).toContain("search_path=pg_catalog, pg_temp");
    expect(row.pub, row.proname).toBe(false);
    expect(row.body, row.proname).not.toMatch(/role_id\s*(IN|=|<>)|pg_settings/i);
  }
  const byName = Object.fromEntries(functions.map((row) => [row.proname, row]));
  for (const name of ["newsletter_automation_click", "newsletter_automation_click_target", "newsletter_automation_click_report"]) expect(byName[name], name).toMatchObject({ app: true, worker: false });
  for (const name of ["newsletter_automation_click_links_store", "newsletter_purge_automation_clicks"]) expect(byName[name], name).toMatchObject({ app: false, worker: true });
  expect(byName.newsletter_automation_click_report.body).toContain("access_role");
  await expect(fixture.pool.query("select public.newsletter_automation_click_links_store($1,$2,$3,'{}')", [people.tenant, randomUUID(), randomUUID()])).rejects.toHaveProperty("code", "42501");
  await expect(withTenant(fixture.db, people.owner, people.tenant, "newsletter:analytics", async (tx) => {
    await tx.execute(sql`select set_config('app.nl_send_tenant', ${people.tenant}, true)`);
    return tx.execute(sql`select * from public.newsletter_automation_clicks`);
  })).rejects.toHaveProperty("cause.code", "42501");
});

it("leaves automation links as written, with no footer line and nothing stored, while the ministry does not count clicks", async () => {
  await setClicks(false);
  const automation = await automationWith(5);
  const messages = await tick();
  expect(messages).toHaveLength(5);
  for (const message of messages) {
    expect(message.html).toContain(`href="${links.give}"`);
    expect(message.html).not.toContain("/api/newsletter/link");
    expect(message.html).not.toContain("counts link clicks");
  }
  expect((await fixture.admin.query("select count(*)::int as n from newsletter_automation_click_links where automation_id=$1", [automation])).rows[0].n).toBe(0);
  expect(await report(automation)).toMatchObject({ counting: false, total: 0, steps: [], links: [] });
});

it("rewrites content links only while counting is on, and counts one click per email and link through the redirect", async () => {
  await setClicks(true);
  const automation = await automationWith(6, "Welcome");
  const messages = await tick();
  expect(messages).toHaveLength(6);
  const tokens = messages.map((message) => {
    expect(message.html).not.toContain(`href="${links.give}"`);
    expect(message.html).toContain("/api/newsletter/unsubscribe");
    expect(message.html).toContain("This ministry counts link clicks in its emails, as totals only.");
    const found = tracked(message.html);
    expect(new Set(found).size).toBeGreaterThanOrEqual(2);
    return [...new Set(found)];
  });
  const { rows: stored } = await fixture.admin.query("select link_index, url from newsletter_automation_click_links where automation_id=$1 order by link_index", [automation]);
  expect(stored).toEqual([{ link_index: 0, url: links.give }, { link_index: 1, url: links.events }]);
  // A token carries only references; the step comes from the database.
  const first = readClickToken(Buffer.from(tokenKey, "hex"), tokens[0][0]);
  expect(first).toMatchObject({ kind: "automation", reference: { tenant: people.tenant, automation, link: 0 } });
  // HEAD redirects without counting; GET counts once per email and link.
  const head = await click(tokens[0][0], "HEAD");
  expect(head.status).toBe(302);
  expect(head.headers.get("location")).toBe(links.give);
  expect(await clickRows(automation)).toEqual([]);
  for (const own of tokens) for (const token of own) expect((await click(token)).headers.get("location")).toMatch(/^https:\/\/ministry\.example\.invalid\//);
  expect((await click(tokens[0][0])).headers.get("location")).toBe(links.give);
  const rows = await clickRows(automation);
  expect(rows).toHaveLength(12);
  expect(Object.keys(rows[0]).sort()).toEqual(["attempt_id", "automation_id", "clicked_at", "link_index", "step_index", "tenant_id"]);
  expect(new Set(rows.map((row) => row.step_index))).toEqual(new Set([0]));
  // Forged, foreign-key, unknown-link and other-ministry tokens go to the neutral page and count nothing.
  const reference = first!.kind === "automation" ? first!.reference : null;
  expect((await click(signAutomationClickToken(randomBytes(32), reference!))).headers.get("location")).toBe(neutral);
  expect((await click(signAutomationClickToken(Buffer.from(tokenKey, "hex"), { ...reference!, link: 9 }))).headers.get("location")).toBe(neutral);
  expect((await click(signAutomationClickToken(Buffer.from(tokenKey, "hex"), { ...reference!, tenant: people.other }))).headers.get("location")).toBe(neutral);
  expect((await click(signAutomationClickToken(Buffer.from(tokenKey, "hex"), { ...reference!, attempt: randomUUID() }))).headers.get("location")).toBe(links.give);
  expect(await clickRows(automation)).toHaveLength(12);
  counted = { automation, tokens };
});

it("reports totals per step, day and link to owners and admins only", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const owner = await report(counted.automation);
  expect(owner).toMatchObject({ counting: true, total: 12, steps: [{ step: 0, clicks: 12 }] });
  expect(owner.days.find((day) => day.day === today)?.clicks).toBe(12);
  expect(owner.links).toEqual([{ url: links.events, clicks: 6 }, { url: links.give, clicks: 6 }]);
  expect(await report(counted.automation, people.admin)).toEqual(owner);
  for (const who of [people.member, people.viewer, people.outsider]) await expect(report(counted.automation, who)).rejects.toMatchObject({ status: expect.any(Number) });
  await expect(withTenant(fixture.db, people.member, people.tenant, "newsletter:read", (tx) => tx.execute(sql`select public.newsletter_automation_click_report(${people.tenant}::uuid,${counted.automation}::uuid,current_date,current_date+1)`)))
    .rejects.toBeTruthy();
  // Another ministry's owner cannot read this automation, even naming it directly.
  await expect(automationClicks(fixture.db, people.outsider, people.other, counted.automation)).rejects.toMatchObject({ status: 404 });
});

it("withholds every group under 5: a small step, its day and the total, and small links", async () => {
  // Three people: the step's emails reached fewer than 5, so nothing about it is shown, even with 6 clicks.
  const small = await automationWith(3, "Small");
  const messages = await tick();
  expect(messages).toHaveLength(3);
  for (const message of messages) for (const token of new Set(tracked(message.html))) await click(token);
  expect(await clickRows(small)).toHaveLength(6);
  const hidden = await report(small);
  expect(hidden).toMatchObject({ total: null, steps: [{ step: 0, clicks: null }], links: [] });
  expect(hidden.days.find((day) => day.clicks !== 0 && day.clicks !== null)).toBeUndefined();
  // Six people but only 4 clicks on one day: the step-day is under 5, so the day, the total and the step are withheld, and both links (2 each).
  const few = await automationWith(6, "Few");
  const sent = await tick();
  const fewTokens = sent.slice(0, 2).flatMap((message) => [...new Set(tracked(message.html))]);
  for (const token of fewTokens) await click(token);
  expect(await report(few)).toMatchObject({ total: null, steps: [{ step: 0, clicks: null }], links: [] });
});

it("never lets link totals reveal a withheld step or day: links count only shown steps", async () => {
  // Reviewer's case: two steps reaching 5 people each; step 0 has 10 clicks yesterday, step 1 has 3 clicks today, all on one link.
  const automation = await automationWith(5, "Two", 2);
  const first = await tick(), second = await tick();
  expect([first.length, second.length]).toEqual([5, 5]);
  for (const message of first) for (const token of new Set(tracked(message.html))) await click(token);
  await fixture.admin.query("update newsletter_automation_clicks set clicked_at=clicked_at-interval '1 day' where automation_id=$1", [automation]);
  for (const message of second.slice(0, 3)) await click(tracked(message.html)[0]);
  const rows = await clickRows(automation);
  expect(rows.filter((row) => row.step_index === 0)).toHaveLength(10);
  expect(rows.filter((row) => row.step_index === 1)).toHaveLength(3);
  const result = await report(automation);
  expect(result.steps).toEqual([{ step: 0, clicks: 10 }, { step: 1, clicks: null }]);
  expect(result.total).toBeNull();
  const shownSteps = result.steps.reduce((sum, step) => sum + (step.clicks ?? 0), 0);
  const shownDays = result.days.reduce((sum, day) => sum + (day.clicks ?? 0), 0);
  const linkTotal = result.links.reduce((sum, link) => sum + link.clicks, 0);
  expect(linkTotal).toBeLessThanOrEqual(shownSteps);
  expect(linkTotal).toBeLessThanOrEqual(shownDays);
  for (const link of result.links) expect(link.clicks).toBe(5);
});

it("stops rewriting and counting as soon as counting is turned off, and does not count earlier emails when it is turned on again", async () => {
  await fixture.admin.query("delete from newsletter_automation_clicks where automation_id=$1", [counted.automation]);
  await setClicks(false);
  expect((await click(counted.tokens[1][0])).headers.get("location")).toBe(links.give);
  expect(await clickRows(counted.automation)).toEqual([]);
  await setClicks(true);
  expect((await click(counted.tokens[1][0])).headers.get("location")).toBe(links.give);
  expect(await clickRows(counted.automation)).toEqual([]);
});

it("rolls click rows older than 90 days into anonymous counts and deletes them, from the worker only", async () => {
  const automation = await automationWith(5, "Old");
  for (const message of await tick()) for (const token of new Set(tracked(message.html))) await click(token);
  expect(await clickRows(automation)).toHaveLength(10);
  expect(await purgeNewsletterAutomationClicks(fixture.workerPool, env)).toBeNull();
  expect(await purgeNewsletterAutomationClicks(fixture.workerPool, { ...retention, NODE_ENV: "production" })).toBeNull();
  await expect(purgeNewsletterAutomationClicks(fixture.pool, retention)).rejects.toThrow("WORKER_ROLE_REQUIRED");
  await expect(purgeNewsletterAutomationClicks(fixture.workerPool, retention, 5001)).rejects.toHaveProperty("code", "22023");
  await expect(fixture.pool.query("select public.newsletter_purge_automation_clicks(10)")).rejects.toHaveProperty("code", "42501");
  const old = new Date(Date.now() - 91 * 86_400_000);
  await fixture.admin.query("update newsletter_automation_clicks set clicked_at=$1 where automation_id=$2", [old, automation]);
  expect(await purgeNewsletterAutomationClicks(fixture.workerPool, retention, 6)).toEqual({ purged: 6 });
  expect(await purgeNewsletterAutomationClicks(fixture.workerPool, retention)).toEqual({ purged: 4 });
  expect(await purgeNewsletterAutomationClicks(fixture.workerPool, retention)).toEqual({ purged: 0 });
  expect(await clickRows(automation)).toEqual([]);
  const { rows: counts } = await fixture.admin.query("select step_index, day::text, link_index, count::int from newsletter_automation_click_counts where automation_id=$1 order by link_index", [automation]);
  const day = old.toISOString().slice(0, 10);
  expect(counts).toEqual([{ step_index: 0, day, link_index: 0, count: 5 }, { step_index: 0, day, link_index: 1, count: 5 }]);
  expect(Object.keys((await fixture.admin.query("select * from newsletter_automation_click_counts limit 1")).rows[0]).sort()).toEqual(["automation_id", "count", "day", "link_index", "step_index", "tenant_id"]);
  // The rolled-up figures are still reported for a window that covers that day.
  const from = day, until = new Date(old.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const rolled = await withTenant(fixture.db, people.owner, people.tenant, "newsletter:analytics", async (tx) =>
    (await tx.execute<{ r: { total: number; steps: { step: number; clicks: number }[] } }>(sql`select public.newsletter_automation_click_report(${people.tenant}::uuid,${automation}::uuid,${from}::date,${until}::date) as r`)).rows[0].r);
  expect(Number(rolled.total)).toBe(10);
  expect(rolled.steps.map((step) => ({ step: step.step, clicks: Number(step.clicks) }))).toEqual([{ step: 0, clicks: 10 }]);
});
