import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GET } from "../../src/app/f/[slug]/route";
import { POST } from "../../src/app/f/[slug]/submit/route";
import { GET as sinkGET } from "../../src/app/api/newsletter/confirmation-sink/route";
import { blankDocument } from "../../src/lib/email/templates";
import { NEWSLETTER_BLOCK_IDS } from "../../src/lib/newsletter-signup";
import { newId, newBlock, defaultBrand } from "../../src/lib/email/blocks";
import { transitionCrmForm } from "../../src/server/crm-form-publication";
import { createCrmForm, getCrmForm, saveCrmForm } from "../../src/server/crm-forms";
import { createContact, eraseContact, recordConsent } from "../../src/server/contacts";
import { mergeContacts } from "../../src/server/crm-merge";
import { addNewsletterSubscriber, createNewsletterAudience, createNewsletterList, setNewsletterSubscription, updateNewsletterSubscriber } from "../../src/server/newsletter";
import { createNewsletterSignupFormDraft } from "../../src/server/newsletter-forms";
import { confirmNewsletterSignup } from "../../src/server/newsletter-public";
import { createAutomation, getAutomation, getRunLog, listAutomationRuns, listAutomations, updateAutomation } from "../../src/server/newsletter-automations";
import { runNewsletterAutomations } from "../../src/server/newsletter-automations-worker";
import { FakeNewsletterProvider } from "../../src/server/newsletter-campaigns/fake-provider";
import { withTenant } from "../../src/server/tenancy";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => fixture.db }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
let audience: string, foreignList: string;
const origin = "http://localhost:3000";
const pepper = randomBytes(32).toString("hex");
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", HARVEST_NEWSLETTER_AUTOMATIONS: "1", HARVEST_NEWSLETTER_AUTOMATIONS_WORKER_ENABLED: "1", HARVEST_NEWSLETTER_TOKEN_KEY: "72".repeat(32),
  HARVEST_NEWSLETTER_SUPPRESSION_KEYS: JSON.stringify([pepper]) };

beforeAll(async () => {
  fetchSpy = noNetwork();
  fixture = await testDatabase({ migrationOwner: true });
  people = await seedPeople(fixture, "nla");
  audience = (await createNewsletterAudience(fixture.db, people.owner, people.tenant, { name: "Audience" })).id;
  const foreignAudience = (await createNewsletterAudience(fixture.db, people.outsider, people.other, { name: "Other" })).id;
  foreignList = (await createNewsletterList(fixture.db, people.outsider, people.other, foreignAudience, { name: "Other list" })).id;
  vi.stubEnv("HARVEST_NEWSLETTER_AUTOMATIONS", "1");
  vi.stubEnv("HARVEST_CRM_FORMS", "synthetic");
  vi.stubEnv("HARVEST_CRM_FORMS_TEST_KEY", "5a".repeat(32));
  vi.stubEnv("HARVEST_NEWSLETTER_TOKEN_KEY", env.HARVEST_NEWSLETTER_TOKEN_KEY!);
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", env.HARVEST_NEWSLETTER_SUPPRESSION_KEYS!);
  vi.stubEnv("DATABASE_URL", fixture.appURL);
  vi.stubEnv("BETTER_AUTH_URL", origin);
}, 90_000);
afterAll(async () => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); } finally { fetchSpy?.mockRestore(); vi.unstubAllEnvs(); await fixture?.close(); }
});

const brand = { ...defaultBrand, address: "1 Main Street" };
const emailStep = (subject = "Welcome") => ({ id: newId(), type: "email" as const, subject, preheader: "", content: { version: 2 as const, brand, blocks: [newBlock("text", { text: "Hello {{firstName}}" }, newId())] } });
const waitStep = (amount = 1, unit: "hours" | "days" = "days") => ({ id: newId(), type: "wait" as const, amount, unit });
const endStep = () => ({ id: newId(), type: "end" as const });
const makeList = async () => (await createNewsletterList(fixture.db, people.owner, people.tenant, audience, { name: "List " + randomUUID().slice(0, 4) })).id;
const create = (trigger: { type: "list"; listId: string } | { type: "form"; formId: string }, steps = [emailStep(), waitStep(), emailStep("Second"), endStep()]) =>
  createAutomation(fixture.db, people.owner, people.tenant, { name: "Welcome series", trigger, steps });
const activate = async (id: string) => updateAutomation(fixture.db, people.owner, people.tenant, id, { version: (await getAutomation(fixture.db, people.owner, people.tenant, id)).version, state: "active" });
function consent(contactId: string, status: "granted" | "withdrawn") {
  return recordConsent(fixture.db, people.owner, people.tenant, contactId, { purpose: "newsletter", channel: "email", status, source: "test", evidence: "Synthetic consent", noticeVersion: "notice-v1" });
}
async function subscribe(list: string, grant = true) {
  const email = `${randomUUID()}@example.test`;
  const contact = await createContact(fixture.db, people.owner, people.tenant, { name: "Taylor Example", email });
  if (grant) await consent(contact.id, "granted");
  const subscriber = await addNewsletterSubscriber(fixture.db, people.owner, people.tenant, { contactId: contact.id });
  await setNewsletterSubscription(fixture.db, people.owner, people.tenant, list, subscriber.id, { state: grant ? "subscribed" : "unsubscribed", version: 0 });
  return { contactId: contact.id, subscriberId: subscriber.id, email };
}
const runs = async (automation: string) => (await fixture.admin.query("select * from newsletter_automation_runs where automation_id=$1 order by started_at", [automation])).rows;
const log = async (run: string) => (await fixture.admin.query("select step_index, step_type, outcome, reason from newsletter_automation_log where run_id=$1 order by at, id", [run])).rows;
const outcomes = async (run: string) => (await log(run)).map((row) => `${row.step_type}:${row.outcome}${row.reason ? ":" + row.reason : ""}`);
const tick = (provider = new FakeNewsletterProvider()) => runNewsletterAutomations(fixture.workerPool, env, provider);
// Each test starts with no unfinished runs from the others (the worker handles every due run of the ministry).
import { beforeEach } from "vitest";
beforeEach(async () => { await fixture.admin.query("update newsletter_automation_runs set state='stopped', stop_reason='automation_changed', finished_at=now(), lease=null, lease_until=null where state='active'"); });
const due = (automation: string) => fixture.admin.query("update newsletter_automation_runs set next_run_at=now() - interval '1 second' where automation_id=$1 and state='active'", [automation]);

it("is hard-off without the flag, and only owners and admins of the ministry can use it", async () => {
  const list = await makeList();
  vi.stubEnv("HARVEST_NEWSLETTER_AUTOMATIONS", "");
  await expect(listAutomations(fixture.db, people.owner, people.tenant)).rejects.toMatchObject({ status: 404 });
  expect(await runNewsletterAutomations(fixture.workerPool, { ...env, HARVEST_NEWSLETTER_AUTOMATIONS: "" }, new FakeNewsletterProvider())).toBeNull();
  vi.stubEnv("HARVEST_NEWSLETTER_AUTOMATIONS", "1");
  expect(await runNewsletterAutomations(fixture.workerPool, { ...env, NODE_ENV: "production" }, new FakeNewsletterProvider())).toBeNull();
  const made = await create({ type: "list", listId: list });
  for (const who of [people.member, people.viewer, people.outsider]) {
    await expect(listAutomations(fixture.db, who, people.tenant)).rejects.toMatchObject({ status: 404 });
    await expect(createAutomation(fixture.db, who, people.tenant, { name: "x", trigger: { type: "list", listId: list } })).rejects.toMatchObject({ status: 404 });
    await expect(getAutomation(fixture.db, who, people.tenant, made.id)).rejects.toMatchObject({ status: 404 });
  }
  expect((await listAutomations(fixture.db, people.admin, people.tenant)).items.map((item) => item.id)).toContain(made.id);
  await expect(getAutomation(fixture.db, people.outsider, people.other, made.id)).rejects.toMatchObject({ status: 404 });
  expect((await listAutomations(fixture.db, people.outsider, people.other)).items).toEqual([]);
  await expect(create({ type: "list", listId: foreignList })).rejects.toMatchObject({ status: 400 });
});

it("keeps runs and the log out of the application role's reach, and the worker functions out of everyone else's", async () => {
  const list = await makeList(), made = await activate((await create({ type: "list", listId: list })).id);
  const person = await subscribe(list);
  const [run] = await runs(made.id);
  expect(run).toBeTruthy();
  for (const statement of ["insert into newsletter_automation_runs(tenant_id,automation_id,contact_id,list_id) values($1,$2,$3,$4)",
    "update newsletter_automation_runs set state='completed', finished_at=now()", "delete from newsletter_automation_runs", "update newsletter_automation_log set outcome='sent'", "delete from newsletter_automation_log"]) {
    await expect(withTenant(fixture.db, people.owner, people.tenant, "newsletter:campaigns", (tx) => tx.execute({ sql: statement, params: [people.tenant, made.id, person.contactId, list], queryChunks: [] } as never)).catch((error) => { throw error; })).rejects.toBeTruthy();
  }
  for (const pool of [fixture.pool, fixture.admin]) {
    await expect(pool.query("select public.newsletter_automation_tick(1,10)")).rejects.toHaveProperty("code", "42501");
    await expect(pool.query("select public.newsletter_automation_finish($1,$2,$3,'accepted','x')", [people.tenant, run.id, randomUUID()])).rejects.toHaveProperty("code", "42501");
  }
  await expect(fixture.workerPool.query("select * from newsletter_automation_runs")).rejects.toHaveProperty("code", "42501");
  expect(await withTenant(fixture.db, people.owner, people.tenant, "newsletter:campaigns", async (tx) => (await tx.execute(`select count(*)::int as n from newsletter_automation_runs` as never)).rows[0])).toMatchObject({ n: 1 });
  expect(await withTenant(fixture.db, people.member, people.tenant, "workspace:read", async (tx) => (await tx.execute(`select count(*)::int as n from newsletter_automation_runs` as never)).rows[0])).toMatchObject({ n: 0 });
  expect(await withTenant(fixture.db, people.outsider, people.other, "newsletter:campaigns", async (tx) => (await tx.execute(`select count(*)::int as n from newsletter_automation_runs` as never)).rows[0])).toMatchObject({ n: 0 });
});

it("validates steps and the edit rules (pause to edit, an email step to activate, locked trigger)", async () => {
  const list = await makeList();
  await expect(create({ type: "list", listId: list }, [{ id: "abcd", type: "wait", amount: 0, unit: "days" }] as never)).rejects.toBeTruthy();
  await expect(create({ type: "list", listId: list }, [{ id: "abcd", type: "wait", amount: 61, unit: "days" }] as never)).rejects.toBeTruthy();
  await expect(create({ type: "list", listId: list }, [endStep(), emailStep()])).rejects.toBeTruthy();
  await expect(create({ type: "list", listId: list }, Array.from({ length: 13 }, () => waitStep()))).rejects.toBeTruthy();
  await expect(create({ type: "list", listId: list }, [{ ...emailStep(), extra: 1 }] as never)).rejects.toBeTruthy();
  const noEmail = await create({ type: "list", listId: list }, [waitStep()]);
  await expect(updateAutomation(fixture.db, people.owner, people.tenant, noEmail.id, { version: noEmail.version, state: "active" })).rejects.toMatchObject({ status: 400 });
  const made = await create({ type: "list", listId: list });
  const live = await activate(made.id);
  await expect(updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: live.version, steps: [emailStep("Changed")] })).rejects.toMatchObject({ status: 409 });
  await expect(updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: 1, name: "stale" })).rejects.toMatchObject({ status: 409 });
  const paused = await updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: live.version, state: "paused" });
  const edited = await updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: paused.version, steps: [emailStep("Changed"), endStep()] });
  expect(edited.steps).toHaveLength(2);
  // Once someone has been entered, the trigger cannot move.
  const back = await updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: edited.version, state: "active" });
  await subscribe(list);
  const stopped = await updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: back.version, state: "paused" });
  await expect(updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: stopped.version, trigger: { type: "list", listId: await makeList() } })).rejects.toMatchObject({ status: 409 });
});

it("enters people who join the list while the automation is active, once each, and nobody without a grant", async () => {
  const list = await makeList(), made = await create({ type: "list", listId: list });
  await subscribe(list);
  expect(await runs(made.id)).toHaveLength(0);
  await activate(made.id);
  const first = await subscribe(list);
  const declined = await subscribe(list, false);
  const rows = await runs(made.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ contact_id: first.contactId, state: "active", step_index: 0 });
  expect(await outcomes(rows[0].id)).toEqual(["enter:entered"]);
  expect(declined.contactId).not.toBe(first.contactId);
  const paused = await updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: (await getAutomation(fixture.db, people.owner, people.tenant, made.id)).version, state: "paused" });
  await subscribe(list);
  expect(await runs(made.id)).toHaveLength(1);
  expect(paused.state).toBe("paused");
});

it("sends each email step through the synthetic provider in order, waits, and completes with a log per contact", async () => {
  const list = await makeList(), made = await activate((await create({ type: "list", listId: list })).id);
  const person = await subscribe(list);
  const provider = new FakeNewsletterProvider();
  const submit = vi.spyOn(provider, "submit");
  expect(await tick(provider)).toMatchObject({ claimed: 1, sent: 1, stopped: 0 });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0][0]).toMatchObject({ to: person.email, subject: "Welcome" });
  expect(submit.mock.calls[0][0].html).toContain("Hello Taylor");
  expect(submit.mock.calls[0][0].headers["List-Unsubscribe"]).toContain("/api/newsletter/unsubscribe?token=");
  // Next tick reaches the wait, which holds the run for a day.
  expect(await tick(provider)).toMatchObject({ claimed: 0 });
  const [afterWait] = await runs(made.id);
  expect(afterWait.step_index).toBe(2);
  expect(new Date(afterWait.next_run_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  expect(await tick(provider)).toMatchObject({ claimed: 0 });
  expect(submit).toHaveBeenCalledTimes(1);
  await due(made.id);
  expect(await tick(provider)).toMatchObject({ claimed: 1, sent: 1 });
  expect(submit.mock.calls[1][0]).toMatchObject({ subject: "Second" });
  await tick(provider);
  const [finished] = await runs(made.id);
  expect(finished).toMatchObject({ state: "completed", stop_reason: null });
  expect(await outcomes(finished.id)).toEqual(["enter:entered", "email:sent", "wait:waiting:1 days", "email:sent", "end:completed"]);
  // The owner reads the same story through the API.
  const list1 = await listAutomationRuns(fixture.db, people.owner, people.tenant, made.id, {});
  expect(list1.items).toHaveLength(1);
  expect(list1.items[0]).toMatchObject({ name: "Taylor Example", state: "completed" });
  const story = await getRunLog(fixture.db, people.owner, people.tenant, made.id, finished.id);
  expect(story.items.map((item) => item.outcome)).toEqual(["entered", "sent", "waiting", "sent", "completed"]);
  await expect(getRunLog(fixture.db, people.admin, people.other, made.id, finished.id)).rejects.toMatchObject({ status: 404 });
  expect((await listAutomations(fixture.db, people.owner, people.tenant)).items.find((item) => item.id === made.id)).toMatchObject({ running: 0, completed: 1, stopped: 0 });
});

it("pauses a running automation without losing its place, and does not send while paused", async () => {
  const list = await makeList(), made = await activate((await create({ type: "list", listId: list })).id);
  await subscribe(list);
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
  const paused = await updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: (await getAutomation(fixture.db, people.owner, people.tenant, made.id)).version, state: "paused" });
  expect(await tick(provider)).toMatchObject({ claimed: 0 });
  expect(submit).not.toHaveBeenCalled();
  await updateAutomation(fixture.db, people.owner, people.tenant, made.id, { version: paused.version, state: "active" });
  expect(await tick(provider)).toMatchObject({ claimed: 1, sent: 1 });
});

it("stops runs the moment consent is withdrawn, the person unsubscribes or is suppressed, and never sends the next step", async () => {
  const list = await makeList(), made = await activate((await create({ type: "list", listId: list })).id);
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
  const withdrawn = await subscribe(list), unsub = await subscribe(list), blocked = await subscribe(list);
  await tick(provider); await tick(provider);
  expect(submit).toHaveBeenCalledTimes(3);
  await consent(withdrawn.contactId, "withdrawn");
  await setNewsletterSubscription(fixture.db, people.owner, people.tenant, list, unsub.subscriberId, { state: "unsubscribed", version: 1 });
  await updateNewsletterSubscriber(fixture.db, people.owner, people.tenant, blocked.subscriberId, { version: 1, suppressed: true });
  const byContact = Object.fromEntries((await runs(made.id)).map((row) => [row.contact_id, row]));
  expect(byContact[withdrawn.contactId]).toMatchObject({ state: "stopped", stop_reason: "consent_withdrawn" });
  expect(byContact[unsub.contactId]).toMatchObject({ state: "stopped", stop_reason: "unsubscribed" });
  expect(byContact[blocked.contactId]).toMatchObject({ state: "stopped", stop_reason: "suppressed" });
  expect((await outcomes(byContact[withdrawn.contactId].id)).at(-1)).toBe("stopped:stopped:consent_withdrawn");
  await due(made.id);
  await tick(provider);
  expect(submit).toHaveBeenCalledTimes(3);
});

it("re-checks consent in the database at the send itself, even when nothing stopped the run earlier", async () => {
  const list = await makeList(), made = await activate((await create({ type: "list", listId: list })).id);
  const person = await subscribe(list);
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
  // Take the stopping triggers out of the picture: only the send-time check is left.
  const stoppers: [string, string][] = [["contact_consents", "newsletter_automation_on_withdrawal"], ["newsletter_subscriptions", "newsletter_automation_on_subscription"], ["newsletter_subscribers", "newsletter_automation_on_suppressed"]];
  for (const [table, name] of stoppers) await fixture.admin.query(`alter table ${table} disable trigger ${name}`);
  try {
    await consent(person.contactId, "withdrawn");
    expect((await runs(made.id))[0].state).toBe("active");
    expect(await tick(provider)).toMatchObject({ claimed: 1, sent: 0, stopped: 1 });
  } finally { for (const [table, name] of stoppers) await fixture.admin.query(`alter table ${table} enable trigger ${name}`); }
  expect(submit).not.toHaveBeenCalled();
  const [row] = await runs(made.id);
  // The withdrawal also moved the subscription, so the check may name either; both stop the run before anything is sent.
  expect(row.state).toBe("stopped");
  expect(["consent_withdrawn", "unsubscribed"]).toContain(row.stop_reason);
  expect(await outcomes(row.id)).toEqual(["enter:entered", `stopped:stopped:${row.stop_reason}`]);
  expect((await fixture.admin.query("select public.newsletter_consent_allowed($1,$2,(select id from contact_consents where contact_id=$2 and purpose='newsletter' order by recorded_at desc, id desc limit 1)) as ok", [people.tenant, person.contactId])).rows[0].ok).toBe(false);
});

it("stops with a reason when an image is no longer ready, and records a lost attempt as unknown without sending it again", async () => {
  const list = await makeList();
  const draft = await create({ type: "list", listId: list }, [emailStep()]);
  const withImage = { ...emailStep(), content: { version: 2 as const, brand, blocks: [{ ...newBlock("image", {}, newId()), fileId: randomUUID(), alt: "x" }] } };
  await expect(updateAutomation(fixture.db, people.owner, people.tenant, draft.id, { version: draft.version, steps: [withImage] })).rejects.toMatchObject({ status: 409 });
  // Written behind the application's back (an image that was ready when saved and has since gone): the send-time check still holds.
  await fixture.admin.query("update newsletter_automations set steps=$2::jsonb, state='active' where id=$1", [draft.id, JSON.stringify([withImage])]);
  const person = await subscribe(list);
  expect(await tick()).toMatchObject({ claimed: 1, sent: 0, stopped: 1 });
  const [row] = await runs(draft.id);
  expect(row).toMatchObject({ contact_id: person.contactId, state: "stopped", stop_reason: "image_unavailable" });

  const second = await activate((await create({ type: "list", listId: list }, [emailStep(), emailStep("Two")])).id);
  const other = await subscribe(list);
  const [target] = await runs(second.id);
  expect(target.contact_id).toBe(other.contactId);
  const attempt = randomUUID();
  await fixture.admin.query("update newsletter_automation_runs set attempt_id=$2, lease=gen_random_uuid(), lease_until=now()-interval '1 second' where id=$1", [target.id, attempt]);
  await fixture.admin.query("insert into newsletter_automation_log(tenant_id,run_id,step_index,step_type,outcome,attempt_id) values($1,$2,0,'email','unknown',$3)", [people.tenant, target.id, attempt]);
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
  await tick(provider);
  expect(await outcomes(target.id)).toContain("email:unknown:worker_lost");
  // The lost step is not sent again; the run moved on to the next email.
  expect(submit.mock.calls.map(([m]) => m.subject)).toEqual(["Two"]);
});

it("records an exception thrown by the provider as unknown, not failed, and never sends that step again", async () => {
  const list = await makeList();
  const made = await activate((await create({ type: "list", listId: list }, [emailStep("Only"), emailStep("After")])).id);
  const person = await subscribe(list);
  const [row] = await runs(made.id);
  expect(row.contact_id).toBe(person.contactId);
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit").mockRejectedValueOnce(new Error("socket hang up"));
  expect(await tick(provider)).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
  expect((await outcomes(row.id)).filter((o) => o.startsWith("email"))).toEqual(["email:unknown"]);
  // The run moved on; the unknown step is not retried.
  expect(submit).toHaveBeenCalledTimes(1);
  await due(made.id);
  await tick(provider);
  expect(submit.mock.calls.map(([m]) => m.subject)).toEqual(["Only", "After"]);
});

it("stops only the run with a malformed wait step and carries on with the rest of the batch", async () => {
  const list = await makeList();
  const bad = await create({ type: "list", listId: list }, [waitStep(), emailStep("Never"), endStep()]);
  // Written behind the application's back (a wait whose amount cannot be read), then activated.
  await fixture.admin.query("update newsletter_automations set steps=jsonb_set(steps,'{0,amount}','\"lots\"'), state='active' where id=$1", [bad.id]);
  // A wait with no amount at all raises explicitly instead of computing NULL seconds.
  const missing = await create({ type: "list", listId: list }, [waitStep(), emailStep("Never"), endStep()]);
  await fixture.admin.query("update newsletter_automations set steps=steps #- '{0,amount}', state='active' where id=$1", [missing.id]);
  // A wait with no unit must not fall through to days.
  const noUnit = await create({ type: "list", listId: list }, [waitStep(), emailStep("Never"), endStep()]);
  await fixture.admin.query("update newsletter_automations set steps=steps #- '{0,unit}', state='active' where id=$1", [noUnit.id]);
  const good = await activate((await create({ type: "list", listId: list }, [emailStep("Fine"), endStep()])).id);
  const person = await subscribe(list);
  const provider = new FakeNewsletterProvider(), submit = vi.spyOn(provider, "submit");
  expect(await tick(provider)).toMatchObject({ claimed: 1, sent: 1 });
  const [noUnitRun] = await runs(noUnit.id);
  expect(noUnitRun).toMatchObject({ state: "stopped", stop_reason: "invalid_step" });
  const [missingRun] = await runs(missing.id);
  expect(missingRun).toMatchObject({ state: "stopped", stop_reason: "invalid_step" });
  const [badRun] = await runs(bad.id), [goodRun] = await runs(good.id);
  expect(badRun).toMatchObject({ contact_id: person.contactId, state: "stopped", stop_reason: "invalid_step" });
  expect(await outcomes(badRun.id)).toEqual(["enter:entered", "stopped:stopped:invalid_step"]);
  expect(submit.mock.calls.map(([m]) => m.subject)).toEqual(["Fine"]);
  expect(await outcomes(goodRun.id)).toContain("email:sent");
});

it("erases a person's runs and log with them, and a merged-away person's too, while others keep theirs", async () => {
  const list = await makeList(), made = await activate((await create({ type: "list", listId: list })).id);
  const keep = await subscribe(list), gone = await subscribe(list), merged = await subscribe(list);
  expect(await runs(made.id)).toHaveLength(3);
  await eraseContact(fixture.db, people.admin, people.tenant, gone.contactId);
  const target = await createContact(fixture.db, people.admin, people.tenant, { name: "Merge target", email: `${randomUUID()}@example.test` });
  const { rows: [source] } = await fixture.admin.query("select version from contacts where id=$1", [merged.contactId]);
  await mergeContacts(fixture.db, people.admin, people.tenant, target.id, { sourceId: merged.contactId, targetVersion: target.version, sourceVersion: source.version });
  const left = await runs(made.id);
  expect(left.map((row) => row.contact_id)).toEqual([keep.contactId]);
  expect((await fixture.admin.query("select count(*)::int as n from newsletter_automation_log where run_id not in (select id from newsletter_automation_runs)")).rows[0].n).toBe(0);
  expect(await outcomes(left[0].id)).toEqual(["enter:entered"]);
});

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
let visitors = 0;
const fresh = () => `198.53.${(visitors >> 8) & 255}.${visitors++ & 255}`;
it("enters people who confirm a sign-up form, only for automations that start from that form", async () => {
  const lists = [await makeList(), await makeList()];
  const { id: formId } = await createNewsletterSignupFormDraft(fixture.db, people.admin, people.tenant, { listIds: lists });
  const { definition } = await getCrmForm(fixture.db, people.admin, people.tenant, formId);
  definition.settings.spamCheck = false;
  await saveCrmForm(fixture.db, people.admin, people.tenant, formId, { definition, revision: definition.revision });
  const at = `nla-${Date.now().toString(36)}`;
  const { definition: ready } = await getCrmForm(fixture.db, people.admin, people.tenant, formId);
  await transitionCrmForm(fixture.db, people.admin, people.tenant, formId, { action: "publish", slug: at, revision: ready.revision });
  const fromForm = await activate((await create({ type: "form", formId })).id);
  const otherForm = await activate((await create({ type: "list", listId: await makeList() })).id);
  const email = `nla-${randomUUID()}@example.test`;
  const shown = await GET(new Request(`${origin}/f/${at}`, { headers: { "x-forwarded-for": fresh() } }), ctx(at));
  const manifest = await shown.json() as { proof: string };
  const posted = await POST(new Request(`${origin}/f/${at}/submit`, { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": fresh() },
    body: JSON.stringify({ proof: manifest.proof, answers: { [NEWSLETTER_BLOCK_IDS.email]: email, consent0: "yes" } }) }), ctx(at));
  expect(posted.status).toBe(200);
  expect(await runs(fromForm.id)).toHaveLength(0);
  const message = (await (sinkGET(new Request(`${origin}/api/newsletter/confirmation-sink?to=${encodeURIComponent(email)}`)).json()) as { messages: { path: string }[] }).messages[0];
  const query = new URL(message.path, origin).searchParams;
  await confirmNewsletterSignup(fixture.db, { email: query.get("email")!, token: query.get("token")! });
  const entered = await runs(fromForm.id);
  expect(entered).toHaveLength(1);
  expect(lists).toContain(entered[0].list_id);
  expect(await runs(otherForm.id)).toHaveLength(0);
  void createCrmForm; void blankDocument;
});
