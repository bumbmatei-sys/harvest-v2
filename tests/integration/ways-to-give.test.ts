import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { emptyBioDefinition, type BioDefinition } from "../../src/lib/link-in-bio";
import { getBioPage, getPublicBio, saveBioDraft, transitionBioPage, bioChoices } from "../../src/server/link-in-bio";
import { respondToBioGivingReport } from "../../src/server/link-in-bio-public";
import { staffGivingReports, staffGivingStanding, staffResolveGivingReport } from "../../src/server/platform/giving";
import { users } from "../../src/db/schema";
import { createGivingMethod, deleteGivingMethod, givingStandingFor, listGivingMethods, publicGivingMethodsFor, reorderGivingMethods, updateGivingMethod } from "../../src/server/ways-to-give";
import { withTenant } from "../../src/server/tenancy";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";

// CW-10 Ways to give: owner/admin management, row security, audit without account numbers, and the public reads (link in bio and the embeddable list).
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => fixture.db }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
const db = () => fixture.db;
const status = (promise: Promise<unknown>) => promise.then(() => 200, (e: { status?: number; name?: string }) => e.status ?? (e.name === "ZodError" ? 400 : 500));
const iban = "GB82WEST12345698765432";
const bank = { kind: "bank_transfer", label: "Bank transfer", iban: "gb82 west 1234 5698 7654 32", bic: "WESTGB2L", accountHolder: "Grace Church", note: "Gift", enabled: true };
const paypal = { kind: "paypal", label: "PayPal", url: "https://paypal.me/gracechurch", enabled: true };
const zelle = { kind: "zelle", label: "Zelle", handle: "give@example.org", enabled: false };

beforeAll(async () => {
  fetchSpy = noNetwork();
  fixture = await testDatabase({ migrationOwner: true });
  people = await seedPeople(fixture, "give");
  await fixture.db.insert(users).values(["give-staff", "give-reviewer"].map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  await fixture.admin.query("select public.platform_staff_grant('give-staff', 'admin', 'ops@harvest')");
  await fixture.admin.query("select public.platform_staff_grant('give-reviewer', 'reviewer', 'ops@harvest')");
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("BETTER_AUTH_SECRET", "t".repeat(40));
}, 180_000);
afterAll(async () => { vi.unstubAllEnvs(); fetchSpy?.mockRestore(); await fixture?.close(); });
const origin = "http://localhost:3000";
const report = (handle: string, body: unknown, ip = "203.0.113.20", extra: Record<string, string> = {}) => respondToBioGivingReport(new Request(`${origin}/l/${handle}/report`,
  { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": ip, ...extra }, body: JSON.stringify(body) }), { params: Promise.resolve({ handle }) });

describe("managing ways to give", () => {
  it("lets owners and admins add methods and nobody else", async () => {
    const first = await createGivingMethod(db(), people.owner, people.tenant, bank);
    expect(first).toMatchObject({ kind: "bank_transfer", iban, bic: "WESTGB2L", position: 0, version: 1, enabled: true, url: null });
    const second = await createGivingMethod(db(), people.admin, people.tenant, paypal);
    expect(second.position).toBe(1);
    await createGivingMethod(db(), people.owner, people.tenant, zelle);
    for (const who of [people.member, people.viewer, people.outsider]) {
      expect(await status(createGivingMethod(db(), who, people.tenant, paypal))).toBe(403);
      expect(await status(listGivingMethods(db(), who, people.tenant))).toBe(403);
    }
    expect((await listGivingMethods(db(), people.admin, people.tenant)).map((m) => m.kind)).toEqual(["bank_transfer", "paypal", "zelle"]);
    expect(await listGivingMethods(db(), people.outsider, people.other)).toEqual([]);
  });

  it("refuses invalid details on the server and in the database", async () => {
    expect(await status(createGivingMethod(db(), people.owner, people.tenant, { ...bank, iban: "GB82WEST12345698765431" }))).toBe(400);
    expect(await status(createGivingMethod(db(), people.owner, people.tenant, { ...paypal, url: "https://paypal.me.evil.example/x" }))).toBe(400);
    expect(await status(createGivingMethod(db(), people.owner, people.tenant, { ...paypal, url: "http://paypal.me/x" }))).toBe(400);
    expect(await status(createGivingMethod(db(), people.owner, people.tenant, { kind: "venmo", label: "Venmo", enabled: true }))).toBe(400);
    const raw = (columns: string, values: string) => fixture.admin.query(`insert into giving_methods (tenant_id, position, kind, label, created_by, ${columns}) values ($1, 9, $2, 'x', $3, ${values})`, [people.tenant, columns.startsWith("iban") ? "bank_transfer" : "givebutter", people.owner]).then(() => "ok", (e: { code?: string }) => e.code);
    expect(await raw("iban, account_holder", "'GB82WEST12345698765431', 'A'")).toBe("23514");
    expect(await raw("url", "'javascript:alert(1)'")).toBe("23514");
    expect(await raw("url", "'https://user@example.org/'")).toBe("23514");
    expect(await raw("url, handle", "'https://example.org/', '@x'")).toBe("23514");
    // There is no free "any link" kind any more.
    expect(await fixture.admin.query("insert into giving_methods (tenant_id, position, kind, label, created_by, url) values ($1, 9, 'other', 'x', $2, 'https://example.org/')", [people.tenant, people.owner]).then(() => "ok", (e: { code?: string }) => e.code)).toBe("23514");
    expect(await status(createGivingMethod(db(), people.owner, people.tenant, { kind: "other", label: "Any", url: "https://example.org", enabled: true }))).toBe(400);
  });

  it("updates with a version check, reorders, deletes and audits without account details", async () => {
    const [bankRow, paypalRow, zelleRow] = await listGivingMethods(db(), people.owner, people.tenant);
    const updated = await updateGivingMethod(db(), people.owner, people.tenant, zelleRow.id, { version: 1, method: { ...zelle, enabled: true } });
    expect(updated).toMatchObject({ enabled: true, version: 2 });
    expect(await status(updateGivingMethod(db(), people.owner, people.tenant, zelleRow.id, { version: 1, method: zelle }))).toBe(409);
    expect(await status(updateGivingMethod(db(), people.member, people.tenant, zelleRow.id, { version: 2, method: zelle }))).toBe(403);
    expect(await status(updateGivingMethod(db(), people.outsider, people.other, zelleRow.id, { version: 2, method: zelle }))).toBe(404);
    const order = await reorderGivingMethods(db(), people.admin, people.tenant, { ids: [paypalRow.id, zelleRow.id, bankRow.id] });
    expect(order.map((m) => [m.kind, m.position])).toEqual([["paypal", 0], ["zelle", 1], ["bank_transfer", 2]]);
    expect(await status(reorderGivingMethods(db(), people.admin, people.tenant, { ids: [paypalRow.id, zelleRow.id] }))).toBe(409);
    const extra = await createGivingMethod(db(), people.owner, people.tenant, { kind: "givebutter", label: "Online", url: "https://givebutter.com/grace", enabled: true });
    expect(await status(deleteGivingMethod(db(), people.member, people.tenant, extra.id))).toBe(403);
    expect(await deleteGivingMethod(db(), people.owner, people.tenant, extra.id)).toEqual({ id: extra.id });
    expect(await status(deleteGivingMethod(db(), people.owner, people.tenant, extra.id))).toBe(404);
    const audit = (await fixture.admin.query("select action, metadata from audit_logs where tenant_id=$1 and action like 'giving.method.%' order by created_at", [people.tenant])).rows;
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(["giving.method.create", "giving.method.update", "giving.method.reorder", "giving.method.delete"]));
    expect(JSON.stringify(audit)).not.toContain(iban); expect(JSON.stringify(audit)).not.toContain("give@example.org");
    expect(audit.find((row) => row.action === "giving.method.update")?.metadata).toMatchObject({ fields: "enabled" });
  });

  it("keeps the table closed to other roles, other ministries and the public setting", async () => {
    const count = (user: string, tenant: string, setting = "") => withTenant(db(), user, tenant, "workspace:read", async (tx) => {
      if (setting) await tx.execute(sql`select set_config('app.giving_public_tenant', ${setting}, true)`);
      return Number((await tx.execute(sql`select count(*)::int n from giving_methods`)).rows[0].n);
    });
    expect(await count(people.owner, people.tenant)).toBe(3);
    expect(await count(people.member, people.tenant)).toBe(0);
    expect(await count(people.viewer, people.tenant, people.tenant)).toBe(0);
    expect(await count(people.outsider, people.other, people.tenant)).toBe(0);
    expect(await status(withTenant(db(), people.member, people.tenant, "workspace:read", (tx) => tx.execute(sql`update giving_methods set enabled = false`)))).toBe(200);
    expect((await listGivingMethods(db(), people.owner, people.tenant)).every((m) => m.enabled)).toBe(true);
  });
});

describe("public display", () => {
  it("shows only enabled methods, in order, with an allow-listed shape", async () => {
    const [first] = await listGivingMethods(db(), people.owner, people.tenant);
    await updateGivingMethod(db(), people.owner, people.tenant, first.id, { version: first.version, method: { ...paypal, enabled: false } });
    const shown = await publicGivingMethodsFor(db(), people.tenant);
    expect(shown.map((m) => m.kind)).toEqual(["zelle", "bank_transfer"]);
    expect(Object.keys(shown[1]).sort()).toEqual(["accountHolder", "bic", "handle", "iban", "id", "kind", "label", "note", "url"]);
    expect(await publicGivingMethodsFor(db(), people.other)).toEqual([]);
    expect(await publicGivingMethodsFor(db(), people.tenant, { NODE_ENV: "production" })).toEqual([]);
  });

  it("adds a Ways to give block to the published link in bio, and nowhere it is hidden or unpublished", async () => {
    let page = await getBioPage(db(), people.owner, people.tenant);
    const giving = { type: "giving" as const, id: "givegive", hidden: false, tab: "home" as const, title: "Give" };
    const def = (blocks: BioDefinition["blocks"]): BioDefinition => ({ ...emptyBioDefinition("Grace"), blocks });
    page = await saveBioDraft(db(), people.owner, people.tenant, { version: page.version, handle: "give-church", definition: def([giving]) });
    expect((await bioChoices(db(), people.owner, people.tenant)).giving?.map((m) => m.kind)).toEqual(["zelle", "bank_transfer"]);
    expect(await getPublicBio(db(), "give-church")).toBeNull();
    page = await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version: page.version });
    const view = (await getPublicBio(db(), "give-church"))!;
    const block = view.tabs.flatMap((t) => t.blocks).find((b) => b.type === "giving");
    expect(block).toMatchObject({ type: "giving", title: "Give" });
    expect(block?.type === "giving" && block.methods.map((m) => m.kind)).toEqual(["zelle", "bank_transfer"]);
    // A hidden block reaches nobody, even through the database function directly.
    page = await saveBioDraft(db(), people.owner, people.tenant, { version: page.version, definition: def([{ ...giving, hidden: true }, { type: "link", id: "linklink", hidden: false, tab: "home", label: "Site", url: "https://example.org", icon: null }]) });
    page = await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version: page.version });
    expect(JSON.stringify(await getPublicBio(db(), "give-church"))).not.toContain(iban);
    expect((await fixture.db.execute<{ r: unknown }>(sql`select public.bio_public_giving('give-church') r`)).rows[0].r).toBeNull();
    // With every method switched off the block is left out.
    page = await saveBioDraft(db(), people.owner, people.tenant, { version: page.version, definition: def([giving, { type: "link", id: "linklink", hidden: false, tab: "home", label: "Site", url: "https://example.org", icon: null }]) });
    page = await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version: page.version });
    for (const method of await listGivingMethods(db(), people.owner, people.tenant)) {
      const input = { kind: method.kind, label: method.label, url: method.url, handle: method.handle, iban: method.iban, bic: method.bic, accountHolder: method.accountHolder, note: method.note, enabled: false };
      await updateGivingMethod(db(), people.owner, people.tenant, method.id, { version: method.version, method: input });
    }
    expect((await getPublicBio(db(), "give-church"))!.tabs.flatMap((t) => t.blocks).map((b) => b.type)).toEqual(["link"]);
    await transitionBioPage(db(), people.owner, people.tenant, { action: "unpublish", version: page.version });
    expect((await fixture.db.execute<{ r: unknown }>(sql`select public.bio_public_giving('give-church') r`)).rows[0].r).toBeNull();
  });
});

describe("reports and Harvest staff takedown", () => {
  const giving = { type: "giving" as const, id: "givegive", hidden: false, tab: "home" as const, title: "Give" };
  it("lets any visitor report a page that shows Ways to give, rate limited and with no visitor identity stored", async () => {
    // Re-enable a method and publish the page with the block.
    for (const method of await listGivingMethods(db(), people.owner, people.tenant)) {
      await updateGivingMethod(db(), people.owner, people.tenant, method.id, { version: method.version, method: { kind: method.kind, label: method.label, url: method.url, handle: method.handle, iban: method.iban, bic: method.bic, accountHolder: method.accountHolder, note: method.note, enabled: true } });
    }
    let page = await getBioPage(db(), people.owner, people.tenant);
    page = await saveBioDraft(db(), people.owner, people.tenant, { version: page.version, definition: { ...emptyBioDefinition("Grace"), blocks: [giving] } });
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version: page.version });
    expect((await report("give-church", { reason: "impersonation", note: "Not the real church" })).status).toBe(200);
    expect((await report("give-church", { reason: "spam" })).status).toBe(400);
    expect((await report("give-church", { reason: "scam", note: "x", email: "a@b.c" })).status).toBe(400);
    expect((await report("no-such-page", { reason: "scam" })).status).toBe(404);
    expect((await report("give-church", { reason: "scam" }, "203.0.113.20", { origin: "https://evil.example" })).status).toBe(404);
    // The honeypot is accepted and dropped.
    expect((await report("give-church", { reason: "scam", website: "http://spam" }, "203.0.113.21")).status).toBe(200);
    // Three a minute per visitor.
    expect((await report("give-church", { reason: "scam" })).status).toBe(200);
    expect((await report("give-church", { reason: "other" })).status).toBe(200);
    expect((await report("give-church", { reason: "other" })).status).toBe(429);
    const rows = (await fixture.admin.query("select * from giving_reports where tenant_id=$1 order by created_at", [people.tenant])).rows;
    expect(rows.map((r) => r.reason)).toEqual(["impersonation", "scam", "other"]);
    expect(Object.keys(rows[0]).sort()).toEqual(["created_at", "id", "note", "page", "reason", "ref", "resolved_at", "resolved_by", "status", "tenant_id"]);
    expect(JSON.stringify(rows)).not.toContain("203.0.113");
    // The app role cannot read or write reports directly.
    expect(await status(withTenant(db(), people.owner, people.tenant, "workspace:read", (tx) => tx.execute(sql`select count(*) from giving_reports`)))).toBe(500);
  });

  it("lets Harvest staff list and resolve reports, and nobody else", async () => {
    expect(await status(staffGivingReports(db(), people.owner, "open"))).toBe(404);
    const { reports } = await staffGivingReports(db(), "give-reviewer", "open");
    expect(reports.length).toBe(3);
    expect(reports[0]).toMatchObject({ tenantId: people.tenant, ministry: "give ministry", page: "bio", ref: "give-church", status: "open", hidden: false });
    expect(await staffResolveGivingReport(db(), "give-reviewer", reports[0].id, { status: "dismissed" })).toEqual({ resolved: true });
    expect(await status(staffResolveGivingReport(db(), "give-reviewer", reports[0].id, { status: "reviewed" }))).toBe(404);
    expect(await status(staffResolveGivingReport(db(), people.admin, reports[1].id, { status: "reviewed" }))).toBe(404);
    expect((await staffGivingReports(db(), "give-staff", "dismissed")).reports.map((r) => r.id)).toEqual([reports[0].id]);
  });

  it("hides a ministry's public giving details at once, shows the owner why, and restores them; audited", async () => {
    expect((await publicGivingMethodsFor(db(), people.tenant)).length).toBeGreaterThan(0);
    expect(await status(staffGivingStanding(db(), people.owner, people.tenant, { hidden: true, reason: "x" }))).toBe(404);
    expect(await status(staffGivingStanding(db(), "give-staff", people.tenant, { hidden: true }))).toBe(400);
    expect(await staffGivingStanding(db(), "give-reviewer", people.tenant, { hidden: true, reason: "Reported as impersonation" })).toEqual({ hidden: true });
    expect(await publicGivingMethodsFor(db(), people.tenant)).toEqual([]);
    expect((await getPublicBio(db(), "give-church"))!.tabs.flatMap((t) => t.blocks).some((b) => b.type === "giving")).toBe(false);
    expect((await bioChoices(db(), people.owner, people.tenant)).giving).toEqual([]);
    expect(await givingStandingFor(db(), people.owner, people.tenant)).toMatchObject({ hidden: true, reason: "Reported as impersonation" });
    expect(await status(givingStandingFor(db(), people.member, people.tenant))).toBe(403);
    // The owner keeps managing the list, and cannot lift the takedown.
    expect((await listGivingMethods(db(), people.owner, people.tenant)).length).toBeGreaterThan(0);
    expect(await status(withTenant(db(), people.owner, people.tenant, "workspace:read", (tx) => tx.execute(sql`update giving_standing set hidden = false`)))).toBe(500);
    expect((await staffGivingReports(db(), "give-staff", "open")).reports.every((r) => r.hidden)).toBe(true);
    expect(await staffGivingStanding(db(), "give-staff", people.tenant, { hidden: false })).toEqual({ hidden: false });
    expect((await publicGivingMethodsFor(db(), people.tenant)).length).toBeGreaterThan(0);
    expect(await givingStandingFor(db(), people.owner, people.tenant)).toMatchObject({ hidden: false, reason: null });
    const audit = (await fixture.admin.query("select actor_id, action, tenant_id from platform_staff_audit where action like 'giving.%' order by created_at")).rows;
    expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(["giving.reports", "giving.report.dismissed", "giving.standing.hide", "giving.standing.restore"]));
    expect(audit.find((r) => r.action === "giving.standing.hide")).toMatchObject({ actor_id: "give-reviewer", tenant_id: people.tenant });
  });
});
