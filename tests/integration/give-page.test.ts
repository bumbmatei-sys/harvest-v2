import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "../../src/db/schema";
import { testDatabase } from "../database";
import { createContact } from "../../src/server/contacts";
import { createCampaign } from "../../src/server/campaigns";
import { correctGift, createFundraising, getFundraising, recordGift, recordPledge, updateFundraising } from "../../src/server/fundraising";
import { getGivePage, givePagePreview, publicGiveCover, publicGiveMethods, publicGivePage, saveGivePage, setGiveCover, submitGiveReport } from "../../src/server/give-page";
import { givePageEnabled } from "../../src/server/give-page-mode";
import { respondToGiveReport } from "../../src/server/give-page-public";
import { staffGivingStanding } from "../../src/server/platform/giving";
import { createGivingMethod } from "../../src/server/ways-to-give";
import { withTenant } from "../../src/server/tenancy";
import { giveReservedSlugs, giveSlugProblem } from "../../src/lib/give-page";
import { noNetwork, seedPeople } from "./social-layer-fixture";

// Public fundraising page (/give/<slug>, migration 0124): slug rules, the published-only definers and their allow-listed answers, small-group suppression,
// raised net of reversals, row security and grants, the report route's limits and the production guard. Restricted (non-superuser) migration owner.
vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => f.db }));
let f: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
const db = () => f.db;
const key = () => randomUUID();
const origin = "http://localhost:3000";
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number; name?: string }) => error.status ?? (error.name === "ZodError" ? 400 : 500));
const page = (slug: string, extra: Record<string, unknown> = {}) => ({ slug, description: "Help us bring\nChristmas meals to families.", showAmount: true, ...extra });
const report = (slug: string, body: unknown, ip = "203.0.113.40", extra: Record<string, string> = {}) => respondToGiveReport(new Request(`${origin}/give/${slug}/report`,
  { method: "POST", headers: { origin, "content-type": "application/json", "x-forwarded-for": ip, ...extra }, body: JSON.stringify(body) }), { params: Promise.resolve({ slug }) });
let fund: string, other: string;

async function newFund(user: string, tenant: string, title = "Christmas outreach", goalCents = "1000000") {
  return createFundraising(db(), user, tenant, { title, goalCents, currency: "USD" }, key());
}
async function open(user: string, tenant: string, id: string) {
  const row = await getFundraising(db(), user, tenant, id);
  return updateFundraising(db(), user, tenant, id, { version: row.version, action: "open" });
}
async function gift(id: string, cents: string, extra: Record<string, unknown> = {}) {
  return recordGift(db(), people.owner, people.tenant, id, { amountCents: cents, giftDate: "2026-11-20", confirmed: true, ...extra }, key());
}
const contact = async (n: number) => (await createContact(db(), people.owner, people.tenant, { name: `Synthetic Supporter ${n}`, email: `supporter-${n}-${randomUUID().slice(0, 6)}@example.test` })).id;

beforeAll(async () => {
  fetchSpy = noNetwork();
  f = await testDatabase({ migrationOwner: true });
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("BETTER_AUTH_SECRET", "t".repeat(40));
  people = await seedPeople(f, "givepage");
  await f.db.insert(users).values({ id: "givepage-staff", name: "staff", email: "givepage-staff@example.test", emailVerified: true });
  await f.admin.query("select public.platform_staff_grant('givepage-staff', 'admin', 'ops@harvest')");
  fund = (await newFund(people.owner, people.tenant)).id;
  other = (await newFund(people.outsider, people.other, "Other ministry fund")).id;
  await createGivingMethod(db(), people.owner, people.tenant, { kind: "paypal", label: "PayPal", url: "https://paypal.me/gracechurch", enabled: true });
  await createGivingMethod(db(), people.owner, people.tenant, { kind: "zelle", label: "Zelle", handle: "give@example.org", enabled: false });
}, 180_000);
afterAll(async () => { vi.unstubAllEnvs(); fetchSpy?.mockRestore(); await f?.close(); });

describe("production guard", () => {
  it("is off in production and the public reads answer nothing there", async () => {
    expect(givePageEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(givePageEnabled({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(false);
    expect(givePageEnabled({ NODE_ENV: "development", HARVEST_ENV: "production" })).toBe(false);
    expect(givePageEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(await publicGivePage(db(), "anything", { NODE_ENV: "production" })).toBeNull();
    expect(await publicGiveMethods(db(), "anything", { NODE_ENV: "production" })).toEqual([]);
    expect(await publicGiveCover(db(), "anything", { NODE_ENV: "production" })).toBeNull();
    expect(await submitGiveReport(db(), "anything", { reason: "scam" }, "a".repeat(64), { NODE_ENV: "production" })).toBe("not_found");
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(await status(getGivePage(db(), people.owner, people.tenant, fund))).toBe(404);
      expect((await report("anything", { reason: "scam" })).status).toBe(404);
    } finally { vi.stubEnv("NODE_ENV", "test"); }
  });
});

describe("slug rules", () => {
  it("validates format and reserved words in the app and the database", async () => {
    expect(giveSlugProblem("christmas-outreach")).toBeNull();
    for (const bad of ["ab", "-start", "end-", "Upper", "has space", "émoji", "x".repeat(49)]) expect(giveSlugProblem(bad), bad).toBe("format");
    for (const word of giveReservedSlugs) expect(giveSlugProblem(word), word).toBe("reserved");
    expect(await status(saveGivePage(db(), people.owner, people.tenant, fund, page("admin")))).toBe(400);
    expect(await status(saveGivePage(db(), people.owner, people.tenant, fund, page("a b")))).toBe(400);
    // The database keeps the same list (direct insert as the owner role bypasses nothing: the check constraint applies to every role).
    const raw = (slug: string) => f.admin.query("insert into fundraising_pages (tenant_id, fundraising_id, slug, created_by) values ($1, $2, $3, $4)", [people.tenant, fund, slug, people.owner])
      .then(() => "ok", (e: { code?: string }) => e.code);
    for (const word of giveReservedSlugs) expect(await raw(word), word).toBe("23514");
    expect(await raw("Bad-Case")).toBe("23514");
    expect(await status(saveGivePage(db(), people.owner, people.tenant, fund, page("ok-slug", { description: "x".repeat(5001) })))).toBe(400);
    expect(await status(saveGivePage(db(), people.owner, people.tenant, fund, page("ok-slug", { description: "bell\u0007" })))).toBe(400);
  });

  it("saves, normalises, audits, keeps slugs globally unique and fixes the slug once the fundraiser is open", async () => {
    const saved = await saveGivePage(db(), people.owner, people.tenant, fund, page("  Christmas-Outreach ", { description: "Line one\r\nLine two  " }));
    expect(saved).toMatchObject({ slug: "christmas-outreach", description: "Line one\nLine two", showAmount: true, version: 1, coverFileId: null });
    // Another ministry cannot take it (global), and a second fundraiser of the same ministry cannot either.
    expect(await status(saveGivePage(db(), people.outsider, people.other, other, page("christmas-outreach")))).toBe(409);
    const second = (await newFund(people.owner, people.tenant, "Second")).id;
    expect(await status(saveGivePage(db(), people.admin, people.tenant, second, page("christmas-outreach")))).toBe(409);
    // A stale or missing version on an existing page is refused.
    expect(await status(saveGivePage(db(), people.owner, people.tenant, fund, page("christmas-outreach")))).toBe(409);
    const renamed = await saveGivePage(db(), people.admin, people.tenant, fund, page("christmas-meals", { version: 1 }));
    expect(renamed).toMatchObject({ slug: "christmas-meals", version: 2 });
    await open(people.owner, people.tenant, fund);
    expect(await status(saveGivePage(db(), people.owner, people.tenant, fund, page("new-name-here", { version: 2 })))).toBe(409);
    // The database holds the same rule for any update.
    expect(await f.admin.query("update fundraising_pages set slug = 'sneaky-change', version = version + 1 where fundraising_id = $1", [fund]).then(() => "ok", (e: { code?: string }) => e.code)).toBe("23514");
    const described = await saveGivePage(db(), people.owner, people.tenant, fund, page("christmas-meals", { version: 2 }));
    expect(described.version).toBe(2); // Nothing changed: same answer, no new version.
    const audit = (await f.admin.query("select action, metadata from audit_logs where tenant_id = $1 and action like 'fundraising.page.%' order by created_at", [people.tenant])).rows;
    expect(audit.map((row) => row.action)).toEqual(["fundraising.page.create", "fundraising.page.update"]);
    expect(audit[1].metadata).toMatchObject({ fields: "slug,description", version: "2" });
    expect(JSON.stringify(audit)).not.toContain("Line one");
  });
});

describe("who can edit", () => {
  it("allows owners and admins only, and never another ministry", async () => {
    for (const who of [people.member, people.viewer]) {
      expect(await status(getGivePage(db(), who, people.tenant, fund))).toBe(403);
      expect(await status(saveGivePage(db(), who, people.tenant, fund, page("member-try", { version: 2 })))).toBe(403);
    }
    expect(await status(getGivePage(db(), people.outsider, people.tenant, fund))).toBe(403);
    expect(await status(saveGivePage(db(), people.outsider, people.other, fund, page("cross-try")))).toBe(404);
    expect(await status(setGiveCover(db(), people.outsider, { tenantId: people.other, fundraisingId: fund }, { fileId: null, version: 2 }))).toBe(404);
    // Direct SQL as the app role: other roles and ministries see and change nothing.
    const count = (user: string, tenant: string) => withTenant(db(), user, tenant, "workspace:read", async (tx) => Number((await tx.execute(sql`select count(*)::int n from fundraising_pages`)).rows[0].n));
    expect(await count(people.owner, people.tenant)).toBe(1);
    expect(await count(people.member, people.tenant)).toBe(0);
    expect(await count(people.outsider, people.other)).toBe(0);
    await withTenant(db(), people.member, people.tenant, "workspace:read", (tx) => tx.execute(sql`update fundraising_pages set show_amount = false, version = version + 1`));
    await withTenant(db(), people.outsider, people.other, "workspace:read", (tx) => tx.execute(sql`update fundraising_pages set show_amount = false, version = version + 1`));
    expect((await getGivePage(db(), people.owner, people.tenant, fund))?.showAmount).toBe(true);
  });

  it("forces row security, grants nothing to the public and keeps the definers narrow", async () => {
    const tables = (await f.admin.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('fundraising_pages', 'fundraising_files') order by relname")).rows;
    expect(tables).toEqual([{ relname: "fundraising_files", relrowsecurity: true, relforcerowsecurity: true }, { relname: "fundraising_pages", relrowsecurity: true, relforcerowsecurity: true }]);
    const grants = (await f.admin.query(`select table_name, privilege_type, grantee from information_schema.role_table_grants
      where table_name in ('fundraising_pages', 'fundraising_files') and grantee in ('PUBLIC', 'harvest_app', 'harvest_worker') order by 1, 2, 3`)).rows;
    expect(grants).toEqual([{ table_name: "fundraising_files", privilege_type: "INSERT", grantee: "harvest_app" }, { table_name: "fundraising_files", privilege_type: "SELECT", grantee: "harvest_app" },
      { table_name: "fundraising_pages", privilege_type: "INSERT", grantee: "harvest_app" }, { table_name: "fundraising_pages", privilege_type: "SELECT", grantee: "harvest_app" }]);
    const updatable = (await f.admin.query(`select table_name, column_name from information_schema.column_privileges where grantee = 'harvest_app' and privilege_type = 'UPDATE'
      and table_name in ('fundraising_pages', 'fundraising_files') order by 1, 2`)).rows.map((row) => `${row.table_name}.${row.column_name}`);
    expect(updatable).toEqual(["fundraising_files.retired_at", "fundraising_files.status", "fundraising_pages.cover_file_id", "fundraising_pages.description",
      "fundraising_pages.show_amount", "fundraising_pages.slug", "fundraising_pages.updated_at", "fundraising_pages.version"]);
    const functions = (await f.admin.query(`select p.proname, p.prosecdef, p.proconfig, has_function_privilege('harvest_app', p.oid, 'EXECUTE') app,
      exists (select from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') public
      from pg_proc p where p.proname like 'give\\_%' order by 1`)).rows;
    const byName = Object.fromEntries(functions.map((row) => [row.proname, row]));
    for (const name of ["give_public_page", "give_public_giving", "give_public_cover", "give_report_giving"]) {
      expect(byName[name], name).toMatchObject({ prosecdef: true, app: true, public: false });
      expect(byName[name].proconfig).toContain("search_path=pg_catalog, pg_temp");
    }
    for (const name of ["give_page_scoped", "give_scope_clear", "give_scope_restore"]) expect(byName[name], name).toMatchObject({ prosecdef: false, app: false, public: false });
    expect(byName.give_released_raised).toMatchObject({ prosecdef: false, app: true, public: false });
    // An anonymous-style role (no grant) cannot read the table at all.
    expect(await f.admin.query("select has_table_privilege('harvest_worker', 'fundraising_pages', 'SELECT') w").then((r) => r.rows[0].w, () => false)).toBe(false);
  });
});

describe("public page", () => {
  it("returns only allow-listed fields for a published page and the same nothing for draft, closed, hidden or unknown", async () => {
    const view = await publicGivePage(db(), "christmas-meals");
    expect(view).toEqual({ slug: "christmas-meals", title: "Christmas outreach", description: "Help us bring\nChristmas meals to families.", ministry: "givepage ministry",
      hasCover: false, amount: { currency: "USD", goalCents: "1000000", raisedCents: "0" } });
    const raw = (await f.db.execute(sql`select public.give_public_page('christmas-meals') r`)).rows[0].r as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["amount", "description", "hasCover", "ministry", "slug", "title"]);
    expect(Object.keys(raw.amount as object).sort()).toEqual(["currency", "goalCents", "raisedCents"]);
    // Ways to give: enabled methods only, allow-listed, the bio_public_giving shape.
    const methods = await publicGiveMethods(db(), "christmas-meals");
    expect(methods.map((m) => m.kind)).toEqual(["paypal"]);
    // Unknown and draft pages: nothing.
    expect(await publicGivePage(db(), "no-such-page")).toBeNull();
    const draft = (await newFund(people.owner, people.tenant, "Draft fund")).id;
    await saveGivePage(db(), people.owner, people.tenant, draft, page("draft-fund"));
    expect(await publicGivePage(db(), "draft-fund")).toBeNull();
    expect(await publicGiveMethods(db(), "draft-fund")).toEqual([]);
    expect((await f.db.execute(sql`select public.give_public_giving('draft-fund') r`)).rows[0].r).toBeNull();
    // Closed: nothing.
    const closing = (await newFund(people.owner, people.tenant, "Closing fund")).id;
    await saveGivePage(db(), people.owner, people.tenant, closing, page("closing-fund"));
    await open(people.owner, people.tenant, closing);
    expect(await publicGivePage(db(), "closing-fund")).not.toBeNull();
    const row = await getFundraising(db(), people.owner, people.tenant, closing);
    await updateFundraising(db(), people.owner, people.tenant, closing, { version: row.version, action: "close" });
    expect(await publicGivePage(db(), "closing-fund")).toBeNull();
    // Hidden by Harvest staff: nothing, then back.
    await staffGivingStanding(db(), "givepage-staff", people.tenant, { hidden: true, reason: "Reported" });
    expect(await publicGivePage(db(), "christmas-meals")).toBeNull();
    expect(await publicGiveMethods(db(), "christmas-meals")).toEqual([]);
    await staffGivingStanding(db(), "givepage-staff", people.tenant, { hidden: false });
    expect(await publicGivePage(db(), "christmas-meals")).not.toBeNull();
  });

  it("returns no amount when the owner switches it off", async () => {
    const current = (await getGivePage(db(), people.owner, people.tenant, fund))!;
    await saveGivePage(db(), people.owner, people.tenant, fund, page("christmas-meals", { showAmount: false, version: current.version }));
    const view = await publicGivePage(db(), "christmas-meals");
    expect(view?.amount).toBeNull();
    expect(JSON.stringify(await f.db.execute(sql`select public.give_public_page('christmas-meals') r`))).not.toContain("1000000");
    const again = (await getGivePage(db(), people.owner, people.tenant, fund))!;
    await saveGivePage(db(), people.owner, people.tenant, fund, page("christmas-meals", { showAmount: true, version: again.version }));
  });

  it("suppresses raised below five identified supporters and then equals recorded gifts net of reversals", async () => {
    const people4 = await Promise.all([1, 2, 3, 4].map(contact));
    for (const [i, id] of people4.entries()) await gift(fund, String(1000 * (i + 1)), { contactId: id });
    // Unknown supporters never count toward the cohort, and repeat gifts from one person are one supporter.
    await gift(fund, "500", { supporterName: "Cash at the door" });
    await gift(fund, "250");
    await gift(fund, "700", { contactId: people4[0] });
    const suppressed = await publicGivePage(db(), "christmas-meals");
    expect(suppressed?.amount).toEqual({ currency: "USD", goalCents: "1000000", raisedCents: null });
    // A fifth identified supporter, through a pledge.
    const fifth = await contact(5);
    const pledge = await recordPledge(db(), people.owner, people.tenant, fund, { amountCents: "9000", contactId: fifth }, key());
    const pledged = await gift(fund, "3000", { pledgeId: pledge.id });
    const staffTotal = async () => (await getFundraising(db(), people.owner, people.tenant, fund)).totals!.raisedCents;
    expect((await publicGivePage(db(), "christmas-meals"))?.amount?.raisedCents).toBe(await staffTotal());
    expect(await staffTotal()).toBe(String(1000 + 2000 + 3000 + 4000 + 500 + 250 + 700 + 3000));
    // Pledges never count; a reversal removes the gift; a replacement counts.
    await correctGift(db(), people.owner, people.tenant, fund, pledged.id, { reason: "wrong_amount", replacementCents: "2500", replacementDate: "2026-11-21", confirmed: true }, key());
    const [first] = (await f.admin.query("select id from giving_ledger_entries where fundraising_id = $1 and amount_cents = 250", [fund])).rows;
    await correctGift(db(), people.owner, people.tenant, fund, first.id, { reason: "entered_in_error", confirmed: true }, key());
    const net = (await f.admin.query("select sum(amount_cents)::text s from giving_ledger_entries where fundraising_id = $1", [fund])).rows[0].s;
    expect(net).toBe(String(1000 + 2000 + 3000 + 4000 + 500 + 700 + 2500));
    expect((await publicGivePage(db(), "christmas-meals"))?.amount?.raisedCents).toBe(net);
    expect(await staffTotal()).toBe(net);
    // No names, pledge or gift detail anywhere in the public answers.
    const everything = JSON.stringify([await f.db.execute(sql`select public.give_public_page('christmas-meals') r`), await f.db.execute(sql`select public.give_public_giving('christmas-meals') r`)]);
    for (const secret of ["Synthetic Supporter", "Cash at the door", "supporter-", pledge.id, pledged.id, "9000"]) expect(everything).not.toContain(secret);
    // The owner preview shows the same released figure.
    expect((await givePagePreview(db(), people.owner, people.tenant, fund))?.view.amount?.raisedCents).toBe(net);
  });

  it("leaves no app.* flag behind and ignores flags the app set beforehand", async () => {
    const flags = await withTenant(db(), people.member, people.tenant, "workspace:read", async (tx) => {
      // A preset flag must not widen what the definers read, and every setting is restored afterwards.
      await tx.execute(sql`select set_config('app.give_public_tenant', ${people.other}, true), set_config('app.give_public_fundraising', ${other}, true)`);
      await tx.execute(sql`select public.give_public_page('christmas-meals')`);
      await tx.execute(sql`select public.give_public_giving('christmas-meals')`);
      const names = ["app.give_public_tenant", "app.give_public_fundraising", "app.give_public_slug", "app.tenant_id", "app.user_id", "app.giving_public_tenant", "app.giving_definer"];
      return Promise.all(names.map(async (name) => [name, (await tx.execute(sql`select coalesce(current_setting(${name}, true), '') v`)).rows[0].v as string] as const));
    });
    const map = Object.fromEntries(flags);
    expect(map["app.give_public_tenant"]).toBe(people.other);
    expect(map["app.give_public_fundraising"]).toBe(other);
    expect(map["app.give_public_slug"] ?? "").toBe("");
    expect(map["app.tenant_id"]).toBe(people.tenant);
    expect(map["app.user_id"]).toBe(people.member);
    expect(map["app.giving_public_tenant"] ?? "").toBe("");
    expect(map["app.giving_definer"] ?? "").toBe("");
    // The app role cannot read pages or ledger rows through the definer flags (the policies are for the migration owner only).
    const leaked = await withTenant(db(), people.outsider, people.other, "workspace:read", async (tx) => {
      await tx.execute(sql`select set_config('app.give_public_slug', 'christmas-meals', true), set_config('app.give_public_tenant', ${people.tenant}, true), set_config('app.give_public_fundraising', ${fund}, true)`);
      return Number((await tx.execute(sql`select (select count(*) from fundraising_pages) + (select count(*) from giving_ledger_entries) n`)).rows[0].n);
    });
    expect(leaked).toBe(0);
  });
});

describe("report route", () => {
  it("records reports for a public page on the giving reports table, rate limited, and refuses everything else", async () => {
    expect((await report("christmas-meals", { reason: "impersonation", note: "Not the real ministry" })).status).toBe(200);
    expect((await report("christmas-meals", { reason: "spam" })).status).toBe(400);
    expect((await report("no-such-page", { reason: "scam" })).status).toBe(404);
    expect((await report("draft-fund", { reason: "scam" })).status).toBe(404);
    expect((await report("christmas-meals", { reason: "scam" }, "203.0.113.40", { origin: "https://evil.example" })).status).toBe(404);
    expect((await report("christmas-meals", { reason: "scam" }, "203.0.113.40", { "content-type": "text/plain" })).status).toBe(415);
    expect((await report("christmas-meals", { reason: "scam", website: "http://spam" }, "203.0.113.41")).status).toBe(200);
    // Three a minute per visitor and ministry.
    expect((await report("christmas-meals", { reason: "scam" })).status).toBe(200);
    expect((await report("christmas-meals", { reason: "other" })).status).toBe(200);
    const limited = await report("christmas-meals", { reason: "other" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(limited.headers.get("cache-control")).toBe("no-store");
    const rows = (await f.admin.query("select tenant_id, page, ref, reason, note from giving_reports where page = 'give' order by created_at")).rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ tenant_id: people.tenant, page: "give", ref: "christmas-meals", reason: "impersonation", note: "Not the real ministry" });
    // No visitor address is stored anywhere.
    expect(JSON.stringify(await f.admin.query("select * from giving_report_quotas"))).not.toContain("203.0.113.40");
  });
});

describe("entry resets of other owner definers (review of d3fb918)", () => {
  const giveFlags = ["app.give_public_slug", "app.give_public_tenant", "app.give_public_fundraising"];
  it("bio_scope_clear and community_definer_reset blank the give flags", async () => {
    const client = await f.admin.connect();
    try {
      await client.query("begin");
      const preset = () => client.query("select set_config('app.give_public_slug', 'christmas-meals', true), set_config('app.give_public_tenant', $1, true), set_config('app.give_public_fundraising', $2, true)", [people.tenant, fund]);
      const read = async () => (await client.query(`select ${giveFlags.map((flag, i) => `coalesce(current_setting('${flag}', true), '') f${i}`).join(", ")}`)).rows[0];
      await preset(); await client.query("select public.bio_scope_clear(false)");
      expect(Object.values(await read())).toEqual(["", "", ""]);
      await preset(); await client.query("select public.community_definer_reset()");
      expect(Object.values(await read())).toEqual(["", "", ""]);
    } finally { await client.query("rollback"); client.release(); }
  });

  it("bio, community and campaign budget definers called with preset flags return nothing extra and restore the flags", async () => {
    const campaign = (await createCampaign(db(), people.owner, people.tenant, { name: "Budget probe", type: "conference" }, key())).id;
    const results = await withTenant(db(), people.outsider, people.other, "workspace:read", async (tx) => {
      await tx.execute(sql`select set_config('app.give_public_slug', 'christmas-meals', true), set_config('app.give_public_tenant', ${people.tenant}, true),
        set_config('app.give_public_fundraising', ${fund}, true), set_config('app.campaign_budget_tenant', ${people.tenant}, true)`);
      const bio = (await tx.execute(sql`select public.bio_public_giving('no-such-handle') r`)).rows[0].r;
      const community = (await tx.execute(sql`select public.community_public('no-such-community', null) r`)).rows[0].r;
      const budget = (await tx.execute(sql`select public.campaign_budget_totals(${people.tenant}::uuid, ${campaign}::uuid) r`)).rows[0].r;
      const flags = (await tx.execute(sql`select coalesce(current_setting('app.give_public_tenant', true), '') g, coalesce(current_setting('app.campaign_budget_tenant', true), '') c`)).rows[0];
      // The app role still reads no give rows with the flags set.
      const rows = Number((await tx.execute(sql`select (select count(*) from fundraising_pages where tenant_id = ${people.tenant}) + (select count(*) from fundraising_campaigns where tenant_id = ${people.tenant})
        + (select count(*) from giving_ledger_entries where tenant_id = ${people.tenant}) n`)).rows[0].n);
      return { bio, community, budget, flags, rows };
    });
    expect(results.bio).toBeNull();
    expect(JSON.stringify(results.community ?? null)).not.toContain("christmas");
    expect(results.budget).toEqual({ outcome: "not_found" });
    // The community definers reset (blank) their flags on the way out rather than restoring them; blank is the safe direction. Budget restores.
    expect(results.flags.c).toBe(people.tenant);
    expect(["", people.tenant]).toContain(results.flags.g);
    expect(results.rows).toBe(0);
    // campaign_budget_totals no longer relies on pg_settings (which lists no custom settings) and clears the give flags by name.
    const source = (await f.admin.query("select prosrc from pg_proc where proname = 'campaign_budget_totals'")).rows[0].prosrc as string;
    expect(source).not.toContain("pg_settings");
    for (const flag of [...giveFlags, "app.campaign_budget_tenant", "app.community_definer_tenant", "app.giving_public_tenant"]) expect(source).toContain(`'${flag}'`);
    // An owner still gets their own totals.
    const own = await withTenant(db(), people.owner, people.tenant, "campaigns:read", async (tx) =>
      (await tx.execute(sql`select public.campaign_budget_totals(${people.tenant}::uuid, ${campaign}::uuid) r`)).rows[0].r as { outcome: string });
    expect(own.outcome).toBe("ok");
  });

  it("give_released_raised answers null to app callers who cannot manage giving records", async () => {
    const released = (user: string) => withTenant(db(), user, people.tenant, "workspace:read", async (tx) =>
      (await tx.execute(sql`select public.give_released_raised(${people.tenant}::uuid, ${fund}::uuid) r`)).rows[0].r);
    expect(await released(people.member)).toBeNull();
    expect(await released(people.viewer)).toBeNull();
    expect(await released(people.owner)).toMatch(/^[0-9]+$/);
  });
});

