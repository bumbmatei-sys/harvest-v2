import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { users } from "../../src/db/schema";
import { createNewsletterAudience, createNewsletterList } from "../../src/server/newsletter";
import { dispatchCampaign, reviewCampaign, writeCampaign } from "../../src/server/newsletter-campaigns/campaigns";
import { createIdentity, deleteIdentity, updateIdentity } from "../../src/server/newsletter-campaigns/identities";
import { addDomain, reissueDomain, removeDomain, saveMailingAddress, senderSetup, verifyDomain } from "../../src/server/newsletter-campaigns/sender-setup";
import { syntheticMailboxCode, syntheticMailboxSink } from "../../src/server/newsletter-campaigns/synthetic-mailbox";
import { createWorkspace } from "../../src/server/workspaces";
import { withTenant } from "../../src/server/tenancy";
import { testDatabase } from "../database";

const owner = "sender-owner", admin = "sender-admin", member = "sender-member", viewer = "sender-viewer", otherOwner = "sender-other";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, other: string;
const dispatch = { mode: "now" } as const;

beforeAll(async () => {
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", JSON.stringify([randomBytes(32).toString("hex")]));
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected_network"));
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, admin, member, viewer, otherOwner].map(id => ({ id, name: id, email: id + "@example.test" })));
  tenant = (await createWorkspace(fixture.db, owner, "Sender ministry", "church")).tenantId;
  other = (await createWorkspace(fixture.db, otherOwner, "Other ministry", "church")).tenantId;
  for (const [user, role] of [[admin, "admin"], [member, "member"], [viewer, "viewer"]]) {
    await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,$3)", [tenant, user, role]);
  }
}, 60_000);
afterAll(async () => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await fixture?.close(); });

const setup = (user = owner, workspace = tenant) => senderSetup(fixture.db, user, workspace);

it("shows nothing to members, viewers and other ministries; owners and admins manage", async () => {
  for (const user of [member, viewer]) {
    await expect(setup(user)).rejects.toMatchObject({ status: 404 });
    await expect(addDomain(fixture.db, user, tenant, { domain: "blocked.example.test" })).rejects.toMatchObject({ status: 404 });
    await expect(saveMailingAddress(fixture.db, user, tenant, { address: "x" })).rejects.toMatchObject({ status: 404 });
  }
  await expect(setup(otherOwner, tenant)).rejects.toMatchObject({ status: 404 });
  expect((await setup(admin)).identities).toEqual([]);
  expect(await setup()).toMatchObject({ domains: [], identities: [], sending: "off", readiness: { ready: false, domain: false, sender: false, replyTo: false, mailingAddress: false, unsubscribe: true } });
});

it("keeps ministries apart and never accepts a foreign domain id", async () => {
  const mine = await addDomain(fixture.db, owner, tenant, { domain: "iso.example.test" });
  expect((await setup(otherOwner, other)).domains).toEqual([]);
  await expect(verifyDomain(fixture.db, otherOwner, other, mine.id)).rejects.toMatchObject({ status: 404 });
  await expect(addDomain(fixture.db, owner, tenant, { domain: "iso.example.test" })).rejects.toMatchObject({ status: 409 });
  await expect(addDomain(fixture.db, owner, tenant, { domain: "not a domain" })).rejects.toThrow();
});

it("reports pending, verified and failed honestly from the provider answer, and stores no credentials", async () => {
  const added = await addDomain(fixture.db, owner, tenant, { domain: "news.example.test" });
  expect(added).toMatchObject({ status: "pending", checkedAt: null });
  expect(added.records.map(record => record.purpose)).toEqual(["ownership", "dkim", "spf", "bounce", "dmarc"]);
  expect(JSON.stringify(added)).not.toMatch(/secret|password|api[_-]?key/i);
  const verified = await verifyDomain(fixture.db, owner, tenant, added.id);
  expect(verified).toMatchObject({ status: "verified", checks: { ownership: true, spf: true, dkim: true, bounce: true, dmarc: true } });
  expect(verified.checkedAt).toBeTruthy();
  // A domain the provider cannot confirm is "failed", never assumed verified.
  const real = await addDomain(fixture.db, owner, tenant, { domain: "church.example.org" });
  const failed = await verifyDomain(fixture.db, owner, tenant, real.id);
  expect(failed).toMatchObject({ status: "failed", checks: { ownership: false, spf: false, dkim: false, bounce: false, dmarc: false } });
  // An incomplete provider answer is failed as well.
  const partial = await addDomain(fixture.db, owner, tenant, { domain: "partial.example.test" });
  expect(await verifyDomain(fixture.db, owner, tenant, partial.id, { domain: async () => ({ ownership: true, spf: true, dkim: false, bounce: true, dmarc: true }) }))
    .toMatchObject({ status: "failed", checks: { dkim: false, ownership: true } });
  // The provider's check is the only thing that ever sets the flags: a stale version is refused.
  const stale = await addDomain(fixture.db, owner, tenant, { domain: "stale.example.test" });
  await expect(verifyDomain(fixture.db, owner, tenant, stale.id, { domain: async () => { await fixture.admin.query("update newsletter_connections set version=version+1 where id=$1", [stale.id]); return null; } }))
    .rejects.toMatchObject({ status: 409 });
});

it("confirms a sender mailbox with the synthetic mailbox and lists statuses", async () => {
  const sink = syntheticMailboxSink(tenant);
  const sender = await createIdentity(fixture.db, owner, tenant, { address: "hello@news.example.test", purpose: "sender" }, sink);
  const reply = await createIdentity(fixture.db, owner, tenant, { address: "replies@outlook.com", purpose: "reply-to" }, sink);
  let listed = await setup();
  expect(listed.identities.find(row => row.id === sender.identity.id)).toMatchObject({ status: "pending", confirmationPending: true, domain: "news.example.test" });
  expect(JSON.stringify(listed)).not.toContain("confirmation_digest");
  expect(await syntheticMailboxCode(fixture.db, owner, tenant, sender.identity.id)).toMatchObject({ code: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
  await expect(syntheticMailboxCode(fixture.db, otherOwner, other, sender.identity.id)).rejects.toMatchObject({ status: 404 });
  for (const row of [sender, reply]) {
    const { code } = await syntheticMailboxCode(fixture.db, owner, tenant, row.identity.id);
    await updateIdentity(fixture.db, owner, tenant, row.identity.id, { action: "confirm", code, version: 1 }, sink);
  }
  listed = await setup();
  expect(listed.identities.find(row => row.id === sender.identity.id)?.status).toBe("verified");
  expect(listed.identities.find(row => row.id === reply.identity.id)?.status).toBe("verified");
  // Sender on a domain that failed its check is failed, not verified.
  const bad = await createIdentity(fixture.db, owner, tenant, { address: "hi@church.example.org", purpose: "sender" }, sink);
  const { code } = await syntheticMailboxCode(fixture.db, owner, tenant, bad.identity.id);
  await updateIdentity(fixture.db, owner, tenant, bad.identity.id, { action: "confirm", code, version: 1 }, sink);
  expect((await setup()).identities.find(row => row.id === bad.identity.id)?.status).toBe("failed");
  // Turning an address off is reflected and reversible.
  await updateIdentity(fixture.db, owner, tenant, reply.identity.id, { enabled: false, version: 2 });
  expect((await setup()).readiness.replyTo).toBe(false);
  await updateIdentity(fixture.db, owner, tenant, reply.identity.id, { enabled: true, version: 3 });
  expect((await setup()).readiness).toMatchObject({ domain: true, sender: true, replyTo: true, mailingAddress: false, ready: false });
});

it("requires a mailing address at review and at send, then accepts it", async () => {
  const audience = (await createNewsletterAudience(fixture.db, owner, tenant, { name: "Audience" })).id;
  const list = (await createNewsletterList(fixture.db, owner, tenant, audience, { name: "List" })).id;
  const { identities } = await setup();
  const senderId = identities.find(row => row.address === "hello@news.example.test")!.id, replyToId = identities.find(row => row.address === "replies@outlook.com")!.id;
  const legacy = [{ type: "richText", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] } }];
  const draft = await writeCampaign(fixture.db, owner, tenant, { name: "C", subject: "S", content: legacy, senderId, replyToId, selection: { listIds: [list], segmentIds: [] } });
  const refused = await reviewCampaign(fixture.db, owner, tenant, draft.id, { version: 1, dispatch }).catch((error: unknown) => error);
  expect(refused).toMatchObject({ status: 409, details: { code: "MAILING_ADDRESS_REQUIRED" } });
  expect((await setup()).readiness.mailingAddress).toBe(false);
  expect(await saveMailingAddress(fixture.db, owner, tenant, { address: "  1 Main Street, Example City  " })).toEqual({ address: "1 Main Street, Example City", version: 1 });
  await expect(saveMailingAddress(fixture.db, owner, tenant, { address: "x", version: 9 })).rejects.toMatchObject({ status: 409 });
  const reviewed = await reviewCampaign(fixture.db, owner, tenant, draft.id, { version: 1, dispatch });
  expect(reviewed.token).toBeTruthy();
  // Clearing the address after review blocks the send itself.
  expect(await saveMailingAddress(fixture.db, owner, tenant, { address: "", version: 1 })).toMatchObject({ address: "" });
  await expect(dispatchCampaign(fixture.db, owner, tenant, draft.id, { dispatch, token: reviewed.token, version: reviewed.version }, "now"))
    .rejects.toMatchObject({ status: 409, details: { code: "MAILING_ADDRESS_REQUIRED" } });
  await saveMailingAddress(fixture.db, owner, tenant, { address: "1 Main Street", version: 2 });
  expect((await setup()).readiness).toMatchObject({ mailingAddress: true, ready: true });
});

it("exposes the verification function only to the application role, and only for the caller's own ministry and role", async () => {
  const [target] = (await setup()).domains;
  const call = (user: string, workspace: string, ministry = workspace) => withTenant(fixture.db, user, workspace, "workspace:read", tx =>
    tx.execute(sql`select public.newsletter_verify_domain(${ministry}::uuid,${target.id}::uuid,${target.version}::integer,true,true,true,true,true)`));
  await expect(call(member, tenant)).rejects.toThrow();
  await expect(call(otherOwner, other, tenant)).rejects.toThrow();
  const privileges = await fixture.admin.query(`select has_function_privilege('harvest_app','public.newsletter_verify_domain(uuid,uuid,integer,boolean,boolean,boolean,boolean,boolean)','execute') as app,
    has_function_privilege('public','public.newsletter_verify_domain(uuid,uuid,integer,boolean,boolean,boolean,boolean,boolean)','execute') as pub`);
  expect(privileges.rows[0]).toEqual({ app: true, pub: false });
  const { rows: [meta] } = await fixture.admin.query("select prosecdef, proconfig from pg_proc where proname='newsletter_verify_domain'");
  expect(meta.prosecdef).toBe(true); expect(meta.proconfig).toContain("search_path=pg_catalog, pg_temp");
  // The application role has no direct write on the flags.
  await expect(fixture.pool.query("update newsletter_connections set ownership=true")).rejects.toThrow();
});

it("reports a stale version when the domain changes after the caller's read, instead of recording a check", async () => {
  const added = await addDomain(fixture.db, owner, tenant, { domain: "race.example.test" });
  const rival = new Client({ connectionString: fixture.admin.options.connectionString });
  await rival.connect();
  try {
    await rival.query("begin");
    await rival.query("select pg_advisory_xact_lock(hashtextextended('race.example.test',0))");
    // The provider answer is already in hand (version read earlier); the call now waits behind the rival's lock.
    const call = verifyDomain(fixture.db, owner, tenant, added.id, { domain: async () => ({ ownership: true, spf: true, dkim: true, bounce: true, dmarc: true }) });
    const settled = call.then(() => "done", (error: unknown) => error);
    await new Promise(resolve => setTimeout(resolve, 500));
    await rival.query("update newsletter_connections set version=version+1 where id=$1", [added.id]);
    await rival.query("commit");
    expect(await settled).toMatchObject({ status: 409 });
  } finally { await rival.end(); }
  const [row] = (await fixture.admin.query("select checked_at, ownership from newsletter_connections where id=$1", [added.id])).rows;
  expect(row).toEqual({ checked_at: null, ownership: false });
  expect((await senderSetup(fixture.db, owner, tenant)).domains.find(domain => domain.id === added.id)?.status).toBe("pending");
});

const identityNamed = async (address: string) => (await setup()).identities.find(row => row.address === address)!;
const domainNamed = async (name: string) => (await setup()).domains.find(row => row.domain === name)!;

it("sets a display name on a sender only, validates it, bumps the version and refuses a stale one", async () => {
  const sender = await identityNamed("hello@news.example.test"), reply = await identityNamed("replies@outlook.com");
  expect(sender.displayName).toBeNull();
  const named = await updateIdentity(fixture.db, owner, tenant, sender.id, { version: sender.version, displayName: "  Grace Church  " });
  expect(named.identity).toMatchObject({ displayName: "Grace Church", version: sender.version + 1 });
  await expect(updateIdentity(fixture.db, owner, tenant, sender.id, { version: sender.version, displayName: "Late" })).rejects.toMatchObject({ status: 409 });
  for (const bad of ["Grace <x@y.test>", 'Say "hi"', "a@b", "line\nbreak", "x".repeat(81)]) {
    await expect(updateIdentity(fixture.db, owner, tenant, sender.id, { version: sender.version + 1, displayName: bad })).rejects.toThrow();
  }
  await expect(updateIdentity(fixture.db, owner, tenant, reply.id, { version: reply.version, displayName: "Nope" })).rejects.toMatchObject({ status: 409 });
  for (const user of [member, viewer]) await expect(updateIdentity(fixture.db, user, tenant, sender.id, { version: sender.version + 1, displayName: "X" })).rejects.toMatchObject({ status: 404 });
  await expect(updateIdentity(fixture.db, otherOwner, other, sender.id, { version: sender.version + 1, displayName: "X" })).rejects.toMatchObject({ status: 404 });
  const cleared = await updateIdentity(fixture.db, owner, tenant, sender.id, { version: sender.version + 1, displayName: "" });
  expect(cleared.identity.displayName).toBeNull();
  // The database refuses the same bad values even when written directly.
  await expect(fixture.admin.query("update newsletter_identities set display_name='a@b' where id=$1", [sender.id])).rejects.toThrow();
});

it("deletes an unused address for real and refuses one that any campaign revision names", async () => {
  const unused = await identityNamed("hi@church.example.org"), used = await identityNamed("hello@news.example.test"), reply = await identityNamed("replies@outlook.com");
  expect(unused.inUse).toBe(false);
  expect([used.inUse, reply.inUse]).toEqual([true, true]);
  for (const row of [used, reply]) {
    await expect(deleteIdentity(fixture.db, owner, tenant, row.id, { version: row.version })).rejects.toMatchObject({ status: 409, details: { code: "IDENTITY_IN_USE" } });
  }
  expect((await fixture.admin.query("select count(*)::int as n from newsletter_identities where id=any($1)", [[used.id, reply.id]])).rows[0].n).toBe(2);
  await expect(deleteIdentity(fixture.db, owner, tenant, unused.id, { version: unused.version + 5 })).rejects.toMatchObject({ status: 409 });
  for (const user of [member, viewer]) await expect(deleteIdentity(fixture.db, user, tenant, unused.id, { version: unused.version })).rejects.toMatchObject({ status: 404 });
  await expect(deleteIdentity(fixture.db, otherOwner, other, unused.id, { version: unused.version })).rejects.toMatchObject({ status: 404 });
  await expect(deleteIdentity(fixture.db, owner, tenant, unused.id, { version: unused.version, extra: 1 })).rejects.toThrow();
  expect(await deleteIdentity(fixture.db, admin, tenant, unused.id, { version: unused.version })).toEqual({ deleted: true });
  expect((await setup()).identities.some(row => row.id === unused.id)).toBe(false);
  await expect(deleteIdentity(fixture.db, owner, tenant, unused.id, { version: unused.version })).rejects.toMatchObject({ status: 404 });
  expect((await fixture.admin.query("select count(*)::int as n from audit_logs where tenant_id=$1 and action='newsletter.identity.delete'", [tenant])).rows[0].n).toBe(1);
});

it("removes a domain only when no sender uses it, and re-issues records with every check reset", async () => {
  const withSender = await domainNamed("news.example.test"), empty = await domainNamed("church.example.org");
  expect([withSender.senderCount, empty.senderCount]).toEqual([1, 0]);
  await expect(removeDomain(fixture.db, owner, tenant, withSender.id, { version: withSender.version })).rejects.toMatchObject({ status: 409, details: { code: "DOMAIN_HAS_SENDERS" } });
  await expect(removeDomain(fixture.db, owner, tenant, empty.id, { version: empty.version + 3 })).rejects.toMatchObject({ status: 409 });
  for (const user of [member, viewer]) await expect(removeDomain(fixture.db, user, tenant, empty.id, { version: empty.version })).rejects.toMatchObject({ status: 404 });
  await expect(removeDomain(fixture.db, otherOwner, other, empty.id, { version: empty.version })).rejects.toMatchObject({ status: 404 });
  expect(await removeDomain(fixture.db, owner, tenant, empty.id, { version: empty.version })).toEqual({ removed: true });
  expect((await setup()).domains.some(row => row.id === empty.id)).toBe(false);
  // The same domain can be added again with fresh records.
  expect(await addDomain(fixture.db, owner, tenant, { domain: "church.example.org" })).toMatchObject({ status: "pending" });

  // Re-issue: new ownership value, every check false, never checked, version up, and the sender on it is no longer verified.
  expect(withSender.status).toBe("verified");
  const fresh = await reissueDomain(fixture.db, owner, tenant, withSender.id, { version: withSender.version });
  expect(fresh).toMatchObject({ status: "pending", checkedAt: null, version: withSender.version + 1, checks: { ownership: false, spf: false, dkim: false, bounce: false, dmarc: false } });
  expect(fresh.records.map(record => record.purpose)).toEqual(["ownership", "dkim", "spf", "bounce", "dmarc"]);
  expect(fresh.records.find(record => record.purpose === "ownership")?.value).not.toBe(withSender.records.find(record => record.purpose === "ownership")?.value);
  const after = await setup();
  expect(after.identities.find(row => row.address === "hello@news.example.test")?.status).toBe("pending");
  expect(after.readiness).toMatchObject({ domain: false, sender: false });
  await expect(reissueDomain(fixture.db, owner, tenant, withSender.id, { version: withSender.version })).rejects.toMatchObject({ status: 409 });
  for (const user of [member, viewer]) await expect(reissueDomain(fixture.db, user, tenant, withSender.id, { version: fresh.version })).rejects.toMatchObject({ status: 404 });
  await expect(reissueDomain(fixture.db, otherOwner, other, withSender.id, { version: fresh.version })).rejects.toMatchObject({ status: 404 });
  // Verification still comes only from the provider answer.
  expect(await verifyDomain(fixture.db, owner, tenant, withSender.id)).toMatchObject({ status: "verified" });
});

it("exposes delete, remove and re-issue only to the application role, for the caller's own ministry and delivery role", async () => {
  const target = await domainNamed("news.example.test"), sender = await identityNamed("hello@news.example.test");
  const calls = (ministry: string) => [
    sql`select public.newsletter_delete_identity(${ministry}::uuid,${sender.id}::uuid,${sender.version}::integer)`,
    sql`select public.newsletter_remove_domain(${ministry}::uuid,${target.id}::uuid,${target.version}::integer)`,
    sql`select public.newsletter_reissue_domain(${ministry}::uuid,${target.id}::uuid,${target.version}::integer,'[{"purpose":"ownership"}]'::jsonb)`];
  for (const index of [0, 1, 2]) {
    await expect(withTenant(fixture.db, member, tenant, "workspace:read", tx => tx.execute(calls(tenant)[index]))).rejects.toThrow();
    await expect(withTenant(fixture.db, otherOwner, other, "workspace:read", tx => tx.execute(calls(tenant)[index]))).rejects.toThrow();
  }
  const privileges = (await fixture.admin.query(`select p.proname, has_function_privilege('public', p.oid, 'EXECUTE') as public_exec, has_function_privilege('harvest_app', p.oid, 'EXECUTE') as app_exec
    from pg_proc p where p.proname in ('newsletter_delete_identity','newsletter_remove_domain','newsletter_reissue_domain') order by 1`)).rows;
  expect(privileges).toEqual([
    { proname: "newsletter_delete_identity", public_exec: false, app_exec: true },
    { proname: "newsletter_reissue_domain", public_exec: false, app_exec: true },
    { proname: "newsletter_remove_domain", public_exec: false, app_exec: true }]);
  // The sender and the domain survived every refused call.
  expect((await identityNamed("hello@news.example.test")).id).toBe(sender.id);
});
