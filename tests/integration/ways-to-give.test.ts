import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { emptyBioDefinition, type BioDefinition } from "../../src/lib/link-in-bio";
import { getBioPage, getPublicBio, saveBioDraft, transitionBioPage, bioChoices } from "../../src/server/link-in-bio";
import { createGivingMethod, deleteGivingMethod, listGivingMethods, publicGivingMethodsFor, reorderGivingMethods, updateGivingMethod } from "../../src/server/ways-to-give";
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
}, 180_000);
afterAll(async () => { fetchSpy?.mockRestore(); await fixture?.close(); });

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
    const raw = (columns: string, values: string) => fixture.admin.query(`insert into giving_methods (tenant_id, position, kind, label, created_by, ${columns}) values ($1, 9, $2, 'x', $3, ${values})`, [people.tenant, columns.startsWith("iban") ? "bank_transfer" : "other", people.owner]).then(() => "ok", (e: { code?: string }) => e.code);
    expect(await raw("iban, account_holder", "'GB82WEST12345698765431', 'A'")).toBe("23514");
    expect(await raw("url", "'javascript:alert(1)'")).toBe("23514");
    expect(await raw("url", "'https://user@example.org/'")).toBe("23514");
    expect(await raw("url, handle", "'https://example.org/', '@x'")).toBe("23514");
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
    const extra = await createGivingMethod(db(), people.owner, people.tenant, { kind: "other", label: "Online", url: "https://give.example.org", enabled: true });
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
