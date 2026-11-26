import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { changeMemberAccess } from "../../src/server/access";
import { withTenant } from "../../src/server/tenancy";
import { createCampaign } from "../../src/server/campaigns";
import { getCampaignOverview } from "../../src/server/campaign-overview";
import { getChecklist } from "../../src/server/campaign-checklist";
import { createFundraising, recordGift } from "../../src/server/fundraising";
import {
  createBudgetLine, createExpense, deleteBudgetLine, deleteExpense, getCampaignBudget, updateBudgetLine, updateExpense,
} from "../../src/server/campaign-budget";

// Campaign budgets (PRD "What Happens After Clicking Finish?", item 4): budget lines and expenses, planned vs spent, and the dashboard's budget and
// funding figures. Runs under a restricted (non-superuser) migration owner, so the policies are exercised as production applies them.
vi.mock("server-only", () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, eur: string, plain: string, yen: string;
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number; name?: string }) => error.status ?? (error.name === "ZodError" ? 400 : 500));
const asApp = (user: string, tenant: string, query: ReturnType<typeof sql>) => withTenant(f.db, user, tenant, "workspace:read", (tx) => tx.execute(query));
const draftFor = (campaign: string, currency: string, client: string) => f.admin.query(
  `insert into campaign_drafts (tenant_id, created_by, client_key, campaign_id, budget, outreach) values ($1, 'b-owner', $2, $3, $4, '{}'::jsonb)`,
  [tenantA, client, campaign, JSON.stringify({ currency, estimatedBudgetMinor: 500000, fundraisingEnabled: true, fundraisingGoalMinor: 100000, onlineDonations: false })]);

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  vi.stubEnv("NODE_ENV", "test");
  await f.db.insert(users).values(["b-owner", "b-admin", "b-member", "b-viewer", "b-collab", "b-outsider", "b-other"].map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenantA = (await createWorkspace(f.db, "b-owner", "Budget A")).tenantId;
  tenantB = (await createWorkspace(f.db, "b-other", "Budget B")).tenantId;
  for (const [user, role] of [["b-admin", "admin"], ["b-member", "member"], ["b-viewer", "viewer"], ["b-collab", "member"]] as const) await putMember(f.db, "b-owner", tenantA, `${user}@example.test`, role);
  await changeMemberAccess(f.db, "b-owner", tenantA, { userId: "b-collab", role: "collaborator", grants: { campaigns: "manage" } });
  eur = (await createCampaign(f.db, "b-owner", tenantA, { name: "Crusade", type: "conference" }, randomUUID())).id;
  plain = (await createCampaign(f.db, "b-owner", tenantA, { name: "Plain", type: "local_outreach" }, randomUUID())).id;
  yen = (await createCampaign(f.db, "b-owner", tenantA, { name: "Yen", type: "local_outreach" }, randomUUID())).id;
  await draftFor(eur, "EUR", "budget-eur");
  await draftFor(yen, "JPY", "budget-yen");
});
afterAll(async () => { await f?.close(); });

describe("database shape", () => {
  it("forces RLS, limits grants to the editable columns, uses access_role, and has only the pinned totals definer", async () => {
    const rls = await f.admin.query("select relname, relrowsecurity as r, relforcerowsecurity as fr from pg_class where relname in ('campaign_budget_lines','campaign_expenses') order by relname");
    expect(rls.rows).toEqual(["campaign_budget_lines", "campaign_expenses"].map((relname) => ({ relname, r: true, fr: true })));
    const grants = await f.admin.query(`select has_table_privilege('harvest_app','campaign_budget_lines','UPDATE') as line_update, has_table_privilege('harvest_app','campaign_expenses','UPDATE') as expense_update,
      has_table_privilege('harvest_app','campaign_expenses','DELETE') as expense_delete, has_table_privilege('public','campaign_expenses','SELECT') as public_read,
      has_table_privilege('harvest_app','campaign_budget_lines','TRUNCATE') as truncate`);
    expect(grants.rows).toEqual([{ line_update: false, expense_update: false, expense_delete: true, public_read: false, truncate: false }]);
    const columns = await f.admin.query("select table_name, column_name from information_schema.column_privileges where grantee='harvest_app' and table_name in ('campaign_budget_lines','campaign_expenses') and privilege_type='UPDATE' order by 1, 2");
    expect(columns.rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
      "campaign_budget_lines.planned_cents", "campaign_budget_lines.updated_at", "campaign_budget_lines.version",
      ...["amount_cents", "category", "description", "payee", "reference", "spent_on", "updated_at", "version"].map((column) => `campaign_expenses.${column}`),
    ]);
    // One definer: the totals entry point, with search_path pinned, executable by the application role only, owned by the restricted migration owner.
    const definers = await f.admin.query(`select p.proname, p.proconfig, pg_get_userbyid(p.proowner) as owner, r.rolsuper, r.rolbypassrls,
      has_function_privilege('public', p.oid, 'EXECUTE') as public_exec, has_function_privilege('harvest_app', p.oid, 'EXECUTE') as app_exec
      from pg_proc p join pg_roles r on r.oid = p.proowner where p.prosecdef and (p.prosrc ilike '%campaign_expenses%' or p.prosrc ilike '%campaign_budget%')`);
    expect(definers.rows).toEqual([expect.objectContaining({ proname: "campaign_budget_totals", proconfig: ["search_path=pg_catalog, pg_temp"], rolsuper: false, rolbypassrls: false, public_exec: false, app_exec: true })]);
    const inner = await f.admin.query("select has_function_privilege('harvest_app', 'public.campaign_budget_totals_scoped(uuid, uuid)', 'EXECUTE') as app, has_function_privilege('public', 'public.campaign_budget_totals_scoped(uuid, uuid)', 'EXECUTE') as pub");
    expect(inner.rows).toEqual([{ app: false, pub: false }]);
    const policies = await f.admin.query("select policyname, roles::text[] as roles, coalesce(qual, '') || coalesce(with_check, '') as body from pg_policies where tablename in ('campaign_budget_lines','campaign_expenses')");
    expect(policies.rows.length).toBe(10);
    for (const row of policies.rows) {
      if (row.roles.includes("harvest_app")) expect(row.body, row.policyname).toMatch(/access_role/);
      else expect(row.body, row.policyname).toMatch(/app\.campaign_budget_tenant/);
    }
    // Individual expenses: owners and admins only, in the database.
    const read = policies.rows.find((row) => row.policyname === "campaign_expenses_read");
    expect(read?.body).toMatch(/'owner'::text, 'admin'::text\]/);
    expect(read?.body).not.toMatch(/'member'|'viewer'/);
    const types = await f.admin.query("select table_name, column_name, data_type from information_schema.columns where table_name in ('campaign_budget_lines','campaign_expenses') and column_name like '%cents' order by 1");
    expect(types.rows.map((row) => row.data_type)).toEqual(["bigint", "bigint"]);
  });
});

describe("budget lines and expenses", () => {
  it("records planned and spent per category in the campaign's currency, with remaining and unplanned spending", async () => {
    const empty = await getCampaignBudget(f.db, "b-owner", tenantA, eur);
    expect(empty).toMatchObject({ currency: "EUR", manage: true, lines: [], categories: [], expenses: [], totals: { plannedCents: "0", spentCents: "0", remainingCents: "0", expenseCount: 0 } });
    const venue = await createBudgetLine(f.db, "b-owner", tenantA, eur, { category: "venue", plannedCents: "250000" });
    await createBudgetLine(f.db, "b-admin", tenantA, eur, { category: "marketing_media", plannedCents: "0" });
    expect(await status(createBudgetLine(f.db, "b-owner", tenantA, eur, { category: "venue", plannedCents: "1" }))).toBe(409); // one line per category
    await createExpense(f.db, "b-admin", tenantA, eur, { spentOn: "2027-04-01", amountCents: "100050", category: "venue", description: "Deposit", payee: "Hall Ltd", reference: "INV-7" });
    await createExpense(f.db, "b-owner", tenantA, eur, { spentOn: "2027-04-02", amountCents: "2000", category: "hospitality_food", description: "Water" });
    const view = await getCampaignBudget(f.db, "b-owner", tenantA, eur);
    expect(view.categories).toEqual([
      { category: "venue", plannedCents: "250000", spentCents: "100050", remainingCents: "149950", planned: true },
      { category: "marketing_media", plannedCents: "0", spentCents: "0", remainingCents: "0", planned: true },
      { category: "hospitality_food", plannedCents: "0", spentCents: "2000", remainingCents: "-2000", planned: false },
    ]);
    expect(view.totals).toEqual({ plannedCents: "250000", spentCents: "102050", remainingCents: "147950", expenseCount: 2 });
    expect(view.lines.map((line) => line.category)).toEqual(["venue", "marketing_media"]);
    expect(view.expenses?.[0]).toMatchObject({ spentOn: "2027-04-02", description: "Water", payee: null, reference: null, recordedByName: "b-owner" });
    expect(view.expenses?.[1]).toMatchObject({ amountCents: "100050", payee: "Hall Ltd", reference: "INV-7", recordedByName: "b-admin", version: 1 });
    const rows = await f.admin.query("select distinct currency from campaign_budget_lines where campaign_id = $1 union select distinct currency from campaign_expenses where campaign_id = $1", [eur]);
    expect(rows.rows).toEqual([{ currency: "EUR" }]);
    expect(venue.id).toBeTruthy();
  });

  it("checks money bounds and input", async () => {
    for (const body of [
      { spentOn: "2027-04-01", amountCents: "0", category: "venue", description: "Zero" },
      { spentOn: "2027-04-01", amountCents: "-5", category: "venue", description: "Negative" },
      { spentOn: "2027-04-01", amountCents: "1000000000001", category: "venue", description: "Too much" },
      { spentOn: "2027-04-01", amountCents: "12.5", category: "venue", description: "Not cents" },
      { spentOn: "2027-04-01", amountCents: 100, category: "venue", description: "A number" },
      { spentOn: "2027-04-01", amountCents: "100", category: "jets", description: "Unknown category" },
      { spentOn: "2027-04-01", amountCents: "100", category: "venue", description: "  " },
      { spentOn: "2027-04-01", amountCents: "100", category: "venue", description: "Card", reference: "4111 1111 1111 1111" },
      { spentOn: "2027-04-01", amountCents: "100", category: "venue", description: "Extra", currency: "USD" },
    ]) expect(await status(createExpense(f.db, "b-owner", tenantA, eur, body)), JSON.stringify(body)).toBe(400);
    expect(await status(createBudgetLine(f.db, "b-owner", tenantA, eur, { category: "travel_transport", plannedCents: "1000000000001" }))).toBe(400);
    const top = await createBudgetLine(f.db, "b-owner", tenantA, plain, { category: "other", plannedCents: "1000000000000" });
    expect(top.totals.plannedCents).toBe("1000000000000");
    await createExpense(f.db, "b-owner", tenantA, plain, { spentOn: "2027-01-01", amountCents: "1000000000000", category: "other", description: "Max" });
    const big = await createExpense(f.db, "b-owner", tenantA, plain, { spentOn: "2027-01-02", amountCents: "1000000000000", category: "other", description: "Max again" });
    expect(big.totals).toMatchObject({ spentCents: "2000000000000", remainingCents: "-1000000000000" }); // sums stay exact past one row's bound
    // The database refuses out-of-range values even without the server.
    await expect(f.admin.query("insert into campaign_expenses (tenant_id, campaign_id, spent_on, category, amount_cents, currency, description, recorded_by) values ($1, $2, '2027-01-01', 'other', 0, 'USD', 'x', 'b-owner')", [tenantA, plain]))
      .rejects.toMatchObject({ code: "23514" });
  });

  it("uses one currency per campaign: the wizard's budget currency, USD without a draft, and nothing for an unsupported one", async () => {
    expect((await getCampaignBudget(f.db, "b-owner", tenantA, plain)).currency).toBe("USD");
    const unsupported = await getCampaignBudget(f.db, "b-owner", tenantA, yen);
    expect(unsupported).toMatchObject({ currency: null, manage: false });
    expect(await status(createBudgetLine(f.db, "b-owner", tenantA, yen, { category: "venue", plannedCents: "100" }))).toBe(409);
    expect(await status(createExpense(f.db, "b-owner", tenantA, yen, { spentOn: "2027-01-01", amountCents: "100", category: "venue", description: "No" }))).toBe(409);
    // A row in another currency (written around the server) blocks further writes instead of mixing currencies.
    await f.admin.query("insert into campaign_budget_lines (tenant_id, campaign_id, category, planned_cents, currency, created_by) values ($1, $2, 'accommodation', 5, 'GBP', 'b-owner')", [tenantA, plain]);
    expect(await status(createExpense(f.db, "b-owner", tenantA, plain, { spentOn: "2027-01-01", amountCents: "100", category: "other", description: "Mixed" }))).toBe(409);
    await f.admin.query("delete from campaign_budget_lines where campaign_id = $1 and currency = 'GBP'", [plain]);
  });

  it("edits and removes with a version check, and audits ids and field names only", async () => {
    let view = await getCampaignBudget(f.db, "b-owner", tenantA, eur);
    const venue = view.lines.find((line) => line.category === "venue")!, deposit = view.expenses!.find((expense) => expense.description === "Deposit")!;
    view = await updateBudgetLine(f.db, "b-admin", tenantA, eur, venue.id, { version: venue.version, plannedCents: "300000" });
    expect(view.lines.find((line) => line.id === venue.id)).toMatchObject({ plannedCents: "300000", version: 2 });
    expect(await status(updateBudgetLine(f.db, "b-owner", tenantA, eur, venue.id, { version: 1, plannedCents: "1" }))).toBe(409);
    view = await updateExpense(f.db, "b-owner", tenantA, eur, deposit.id, { version: 1, amountCents: "120000", payee: null, description: "Hall deposit" });
    expect(view.expenses!.find((expense) => expense.id === deposit.id)).toMatchObject({ amountCents: "120000", payee: null, reference: "INV-7", description: "Hall deposit", version: 2 });
    expect(await status(updateExpense(f.db, "b-admin", tenantA, eur, deposit.id, { version: 1, description: "Stale" }))).toBe(409);
    expect(await status(deleteExpense(f.db, "b-admin", tenantA, eur, deposit.id, { version: 1 }))).toBe(409);
    expect(await status(updateExpense(f.db, "b-owner", tenantA, eur, randomUUID(), { version: 1, description: "Missing" }))).toBe(404);
    expect(await status(updateExpense(f.db, "b-owner", tenantA, plain, deposit.id, { version: 2, description: "Wrong campaign" }))).toBe(404);
    view = await deleteExpense(f.db, "b-admin", tenantA, eur, deposit.id, { version: 2 });
    expect(view.expenses!.map((expense) => expense.id)).not.toContain(deposit.id);
    const media = view.lines.find((line) => line.category === "marketing_media")!;
    view = await deleteBudgetLine(f.db, "b-owner", tenantA, eur, media.id, { version: media.version });
    expect(view.lines.map((line) => line.category)).toEqual(["venue"]);
    const audits = await f.admin.query("select action, metadata from audit_logs where tenant_id = $1 and action like 'campaign.%' and (action like 'campaign.expense.%' or action like 'campaign.budget_line.%') order by created_at", [tenantA]);
    expect(new Set(audits.rows.map((row) => row.action))).toEqual(new Set(["campaign.budget_line.create", "campaign.budget_line.update", "campaign.budget_line.delete", "campaign.expense.create", "campaign.expense.update", "campaign.expense.delete"]));
    const text = JSON.stringify(audits.rows);
    for (const secret of ["Hall", "INV-7", "Deposit", "Water", "120000", "300000", "100050"]) expect(text).not.toContain(secret);
    expect(audits.rows.find((row) => row.action === "campaign.expense.update")?.metadata).toMatchObject({ fields: "amountCents,description,payee" });
  });
});

describe("access", () => {
  it("lets owners, admins and campaign managers change the budget; members and viewers read totals only; other ministries see nothing", async () => {
    for (const user of ["b-member", "b-viewer"]) {
      const view = await getCampaignBudget(f.db, user, tenantA, eur);
      expect(view.manage, user).toBe(false);
      expect(view.expenses, user).toBeNull();
      expect(view.totals.spentCents, user).toBe("2000");
      expect(JSON.stringify(view), user).not.toMatch(/INV-7|Hall|Water/);
    }
    for (const user of ["b-member", "b-viewer"]) {
      expect(await status(createBudgetLine(f.db, user, tenantA, eur, { category: "administration", plannedCents: "100" })), user).toBe(403);
      expect(await status(createExpense(f.db, user, tenantA, eur, { spentOn: "2027-01-01", amountCents: "100", category: "venue", description: "No" })), user).toBe(403);
    }
    const venue = (await getCampaignBudget(f.db, "b-owner", tenantA, eur)).lines[0];
    expect(await status(updateBudgetLine(f.db, "b-member", tenantA, eur, venue.id, { version: venue.version, plannedCents: "1" }))).toBe(403);
    expect(await status(deleteBudgetLine(f.db, "b-member", tenantA, eur, venue.id, { version: venue.version }))).toBe(403);
    // A collaborator with the campaigns area at "manage" counts as an admin for campaigns.
    const collab = await createExpense(f.db, "b-collab", tenantA, eur, { spentOn: "2027-04-03", amountCents: "500", category: "other", description: "Tape" });
    expect(collab.manage).toBe(true);
    expect(await status(getCampaignBudget(f.db, "b-outsider", tenantA, eur))).toBe(403);
    expect(await status(getCampaignBudget(f.db, "b-other", tenantB, eur))).toBe(404);
    expect(await status(createExpense(f.db, "b-other", tenantB, eur, { spentOn: "2027-01-01", amountCents: "100", category: "venue", description: "No" }))).toBe(404);
  });

  it("enforces the same rules in the database for the application role", async () => {
    for (const [user, query] of [
      ["b-member", sql`insert into campaign_expenses (tenant_id, campaign_id, spent_on, category, amount_cents, currency, description, recorded_by) values (${tenantA}, ${eur}, '2027-01-01', 'other', 1, 'EUR', 'x', 'b-member')`],
      ["b-viewer", sql`insert into campaign_budget_lines (tenant_id, campaign_id, category, planned_cents, currency, created_by) values (${tenantA}, ${eur}, 'administration', 1, 'EUR', 'b-viewer')`],
      ["b-admin", sql`insert into campaign_expenses (tenant_id, campaign_id, spent_on, category, amount_cents, currency, description, recorded_by) values (${tenantA}, ${eur}, '2027-01-01', 'other', 1, 'EUR', 'x', 'b-owner')`],
      ["b-admin", sql`update campaign_expenses set recorded_by = 'b-admin'`],
      ["b-admin", sql`update campaign_budget_lines set category = 'other'`],
      ["b-admin", sql`update campaign_expenses set currency = 'USD'`],
    ] as const) await expect(asApp(user, tenantA, query), user).rejects.toMatchObject({ cause: { code: "42501" } });
    for (const user of ["b-member", "b-viewer"]) {
      expect(((await asApp(user, tenantA, sql`delete from campaign_expenses where campaign_id = ${eur}`)).rowCount ?? 0), user).toBe(0);
      expect(((await asApp(user, tenantA, sql`update campaign_budget_lines set planned_cents = 1 where campaign_id = ${eur}`)).rowCount ?? 0), user).toBe(0);
    }
    const foreign = await asApp("b-other", tenantB, sql`select (select count(*) from campaign_expenses)::int as e, (select count(*) from campaign_budget_lines)::int as l`);
    expect(foreign.rows[0]).toEqual({ e: 0, l: 0 });
    // Members and viewers read no expense row directly, even with the definer's flag set beforehand; the manager still reads rows.
    for (const user of ["b-member", "b-viewer"]) {
      const direct = await asApp(user, tenantA, sql`select set_config('app.campaign_budget_tenant', ${tenantA}, true), (select count(*)::int from campaign_expenses where campaign_id = ${eur}) as n`);
      expect(direct.rows[0].n, user).toBe(0);
    }
    expect((await asApp("b-admin", tenantA, sql`select count(*)::int as n from campaign_expenses where campaign_id = ${eur}`)).rows[0].n).toBeGreaterThan(0);
  });

  it("returns totals only from the definer, to campaign readers of that ministry, and puts the session flags back", async () => {
    const totals = (user: string, tenant: string, campaign: string) => asApp(user, tenant, sql`select public.campaign_budget_totals(${tenant}::uuid, ${campaign}::uuid) as r`).then((result) => result.rows[0].r as { outcome: string; totals?: unknown; categories: Record<string, unknown>[] });
    const manager = await getCampaignBudget(f.db, "b-owner", tenantA, eur);
    for (const user of ["b-member", "b-viewer", "b-owner"]) {
      const result = await totals(user, tenantA, eur);
      expect(result.outcome, user).toBe("ok");
      expect(result.totals, user).toEqual(manager.totals);
      expect(JSON.stringify(result), user).not.toMatch(/Tape|Water|INV-7|b-collab|b-owner/); // no description, reference or recorder
      expect(Object.keys(result.categories[0]).sort(), user).toEqual(["category", "expenseCount", "planned", "plannedCents", "remainingCents", "spentCents"]);
    }
    // Unknown campaign, another ministry's campaign, or a ministry other than the caller's: refused.
    expect((await totals("b-member", tenantA, randomUUID())).outcome).toBe("not_found");
    expect((await totals("b-other", tenantB, eur)).outcome).toBe("not_found");
    expect(((await asApp("b-member", tenantA, sql`select public.campaign_budget_totals(${tenantB}::uuid, ${eur}::uuid) as r`)).rows[0].r as { outcome: string }).outcome).toBe("not_found");
    expect(await status(totals("b-outsider", tenantA, eur))).toBe(403); // not a member: withTenant refuses before the definer runs
    // Flags the app set beforehand are cleared for the call and put back afterwards; the definer leaves its own flag empty.
    const flags = await asApp("b-member", tenantA, sql`select set_config('app.giving_definer', 'on', true), public.campaign_budget_totals(${tenantA}::uuid, ${eur}::uuid) as r,
      current_setting('app.giving_definer', true) as giving, current_setting('app.campaign_budget_tenant', true) as own, current_setting('app.tenant_id', true) as tenant`);
    expect(flags.rows[0]).toMatchObject({ giving: "on", own: "", tenant: tenantA });
    // The application role cannot call the inner function.
    await expect(asApp("b-owner", tenantA, sql`select public.campaign_budget_totals_scoped(${tenantA}::uuid, ${eur}::uuid)`)).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("makes an archived campaign's budget read-only", async () => {
    const gone = (await createCampaign(f.db, "b-owner", tenantA, { name: "Archived", type: "local_outreach" }, randomUUID())).id;
    await createBudgetLine(f.db, "b-owner", tenantA, gone, { category: "venue", plannedCents: "100" });
    await f.admin.query("update campaigns set archived_at = now() where id = $1", [gone]);
    expect((await getCampaignBudget(f.db, "b-owner", tenantA, gone)).totals.plannedCents).toBe("100");
    expect(await status(createExpense(f.db, "b-owner", tenantA, gone, { spentOn: "2027-01-01", amountCents: "100", category: "venue", description: "No" }))).toBe(404);
  });
});

describe("dashboard and checklist", () => {
  it("shows budget spent of planned, ticks Define budget once a line exists, and keeps funding unavailable without a fundraiser", async () => {
    const fresh = (await createCampaign(f.db, "b-owner", tenantA, { name: "Fresh", type: "local_outreach" }, randomUUID())).id;
    let overview = await getCampaignOverview(f.db, "b-owner", tenantA, fresh);
    expect(overview.budget).toBeNull();
    expect(overview.funding).toBeNull();
    expect(overview.unavailable).toEqual(["funding"]);
    expect((await getChecklist(f.db, "b-owner", tenantA, fresh)).find((item) => item.item === "define_budget")).toMatchObject({ done: false, automatic: false });
    await createBudgetLine(f.db, "b-owner", tenantA, fresh, { category: "venue", plannedCents: "40000" });
    await createExpense(f.db, "b-owner", tenantA, fresh, { spentOn: "2027-01-01", amountCents: "10000", category: "venue", description: "Deposit" });
    overview = await getCampaignOverview(f.db, "b-member", tenantA, fresh);
    expect(overview.budget).toEqual({ currency: "USD", plannedCents: "40000", spentCents: "10000", remainingCents: "30000", expenseCount: 1, lines: 1 });
    expect((await getChecklist(f.db, "b-member", tenantA, fresh)).find((item) => item.item === "define_budget")).toMatchObject({ done: true, automatic: true });
  });

  it("shows funding raised of goal from the linked fundraiser to owners and admins only", async () => {
    const fundraiser = await createFundraising(f.db, "b-owner", tenantA, { title: "Crusade fund", campaignId: eur }, randomUUID());
    await recordGift(f.db, "b-admin", tenantA, fundraiser.id, { amountCents: "25000", giftDate: "2027-03-01", confirmed: true }, randomUUID());
    for (const user of ["b-owner", "b-admin"]) {
      const overview = await getCampaignOverview(f.db, user, tenantA, eur);
      expect(overview.funding, user).toEqual({ currency: "EUR", goalCents: "100000", raisedCents: "25000" });
      expect(overview.unavailable, user).toEqual([]);
    }
    // Members can open the dashboard but may not see raised totals: funding stays unavailable, never zero.
    const member = await getCampaignOverview(f.db, "b-member", tenantA, eur);
    expect(member.funding).toBeNull();
    expect(member.unavailable).toEqual(["funding"]);
    expect(member.budget?.currency).toBe("EUR");
    // Off where fundraising is off.
    vi.stubEnv("NODE_ENV", "production");
    try { expect((await getCampaignOverview(f.db, "b-owner", tenantA, eur)).funding).toBeNull(); } finally { vi.stubEnv("NODE_ENV", "test"); }
  });
});
