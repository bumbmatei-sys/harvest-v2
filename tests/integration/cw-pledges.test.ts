import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "../../src/db/schema";
import { testDatabase } from "../database";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { changeMemberAccess } from "../../src/server/access";
import { createCampaign } from "../../src/server/campaigns";
import { createContact } from "../../src/server/contacts";
import { withTenant } from "../../src/server/tenancy";
import {
  campaignFundraising, correctGift, createFundraising, fundraisingEnabled, getFundraising, listFundraising, listGifts, listPledges, recordGift, recordPledge,
  updateFundraising, updatePledge,
} from "../../src/server/fundraising";

// Fundraising pledge campaigns, F1 + staff F3: tenant-safe model, money invariants, append-only ledger, permissions and audit.
// Runs under a restricted (non-superuser) migration owner, so the policies are exercised exactly as production would apply them.
vi.mock("server-only", () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, outreach: string, budgetCampaign: string;
// Input refusals are ZodErrors, which the route layer answers with 400.
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number; name?: string }) => error.status ?? (error.name === "ZodError" ? 400 : 500));
const key = () => randomUUID();
const asApp = (user: string, tenant: string, query: ReturnType<typeof sql>) => withTenant(f.db, user, tenant, "workspace:read", (tx) => tx.execute(query));

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  vi.stubEnv("NODE_ENV", "test");
  await f.db.insert(users).values(["p-owner", "p-admin", "p-member", "p-viewer", "p-collab", "p-other"].map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenantA = (await createWorkspace(f.db, "p-owner", "Pledges A")).tenantId;
  tenantB = (await createWorkspace(f.db, "p-other", "Pledges B")).tenantId;
  for (const [user, role] of [["p-admin", "admin"], ["p-member", "member"], ["p-viewer", "viewer"], ["p-collab", "member"]] as const) await putMember(f.db, "p-owner", tenantA, `${user}@example.test`, role);
  await changeMemberAccess(f.db, "p-owner", tenantA, { userId: "p-collab", role: "collaborator", grants: { giving: "manage" } });
  outreach = (await createCampaign(f.db, "p-owner", tenantA, { name: "Outreach", type: "conference" }, key())).id;
  budgetCampaign = (await createCampaign(f.db, "p-owner", tenantA, { name: "Budgeted", type: "mission_trip" }, key())).id;
  await f.admin.query(`insert into campaign_drafts (tenant_id, created_by, client_key, campaign_id, budget, outreach) values ($1, 'p-owner', 'pledge-test', $2, $3, '{}'::jsonb)`,
    [tenantA, budgetCampaign, JSON.stringify({ currency: "EUR", estimatedBudgetMinor: null, fundraisingEnabled: true, fundraisingGoalMinor: 2500000, onlineDonations: false })]);
});
afterAll(async () => { await f?.close(); });

describe("fundraising campaigns", () => {
  it("is off in production", () => {
    expect(fundraisingEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(fundraisingEnabled({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(false);
    expect(fundraisingEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("creates idempotently, takes the goal from the campaign budget settings and allows one live fundraiser per campaign", async () => {
    const k = key();
    const made = await createFundraising(f.db, "p-owner", tenantA, { title: "Building fund", goalCents: "1000000", currency: "USD" }, k);
    expect(made).toMatchObject({ title: "Building fund", status: "draft", goalCents: "1000000", currency: "USD", version: 1, campaignId: null });
    expect((await createFundraising(f.db, "p-owner", tenantA, { title: "Building fund", goalCents: "1000000", currency: "USD" }, k)).id).toBe(made.id);
    expect(await status(createFundraising(f.db, "p-owner", tenantA, { title: "Changed", goalCents: "1000000", currency: "USD" }, k))).toBe(409);
    // CW-09: goal and currency come from step 6 when they are left out.
    const fromBudget = await createFundraising(f.db, "p-admin", tenantA, { title: "Trip", campaignId: budgetCampaign }, key());
    expect(fromBudget).toMatchObject({ goalCents: "2500000", currency: "EUR", campaignId: budgetCampaign, campaignName: "Budgeted" });
    expect(await status(createFundraising(f.db, "p-admin", tenantA, { title: "Second", campaignId: budgetCampaign }, key()))).toBe(409);
    // A campaign without budget settings needs a goal; another ministry's campaign is unknown.
    expect(await status(createFundraising(f.db, "p-owner", tenantA, { title: "No goal", campaignId: outreach }, key()))).toBe(400);
    expect(await status(createFundraising(f.db, "p-other", tenantB, { title: "Foreign", campaignId: outreach, goalCents: "100", currency: "USD" }, key()))).toBe(404);
    // Bounds: no zero, no fractions, no float strings, no unsupported or three-decimal currencies.
    for (const bad of [{ goalCents: "0" }, { goalCents: "12.5" }, { goalCents: "1e5" }, { goalCents: "10000000000001" }, { currency: "JPY" }, { currency: "KWD" }]) {
      expect(await status(createFundraising(f.db, "p-owner", tenantA, { title: "Bad", goalCents: "100", currency: "USD", ...bad }, key())), JSON.stringify(bad)).toBe(400);
    }
    const shown = await campaignFundraising(f.db, "p-owner", tenantA, budgetCampaign);
    expect(shown.fundraising?.id).toBe(fromBudget.id);
    expect(shown.fundraising?.totals).toEqual({ raisedCents: "0", giftCount: 0, pledgedCents: "0", pledgeCount: 0 });
    expect(await campaignFundraising(f.db, "p-owner", tenantA, outreach)).toEqual({ fundraising: null, defaults: null });
  });

  it("follows draft, open, closed, archived with versions, no reopening, and audits without amounts", async () => {
    const made = await createFundraising(f.db, "p-owner", tenantA, { title: "Lifecycle", goalCents: "5000", currency: "GBP" }, key());
    const edited = await updateFundraising(f.db, "p-owner", tenantA, made.id, { version: 1, goalCents: "7500", title: "Lifecycle fund" });
    expect(edited).toMatchObject({ goalCents: "7500", title: "Lifecycle fund", version: 2 });
    expect(await status(updateFundraising(f.db, "p-owner", tenantA, made.id, { version: 1, title: "Stale" }))).toBe(409);
    expect(await status(updateFundraising(f.db, "p-owner", tenantA, made.id, { version: 2, action: "close" }))).toBe(409);
    expect((await updateFundraising(f.db, "p-owner", tenantA, made.id, { version: 2, action: "open" })).status).toBe("published");
    expect((await updateFundraising(f.db, "p-owner", tenantA, made.id, { version: 3, action: "close" })).status).toBe("closed");
    expect(await status(updateFundraising(f.db, "p-owner", tenantA, made.id, { version: 4, action: "open" }))).toBe(409);
    expect((await updateFundraising(f.db, "p-owner", tenantA, made.id, { version: 4, action: "archive" })).status).toBe("archived");
    expect(await status(updateFundraising(f.db, "p-owner", tenantA, made.id, { version: 5, title: "Late" }))).toBe(409);
    const { rows } = await f.admin.query("select action, metadata from audit_logs where tenant_id = $1 and target_id = $2 order by created_at, id", [tenantA, made.id]);
    expect(rows.map((row) => row.action)).toEqual(["fundraising.create", "fundraising.update", "fundraising.open", "fundraising.close", "fundraising.archive"]);
    expect(rows[1].metadata).toEqual({ version: "2", fields: "title,goal" });
    expect(JSON.stringify(rows)).not.toMatch(/7500|5000/);
    // The database refuses an illegal transition even from direct SQL.
    await expect(asApp("p-owner", tenantA, sql`update fundraising_campaigns set status = 'published', version = version + 1 where id = ${made.id}`)).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("records pledges as intentions and only confirmed gifts as raised, per currency, with exact totals", async () => {
    const fund = await createFundraising(f.db, "p-owner", tenantA, { title: "Totals", goalCents: "100000", currency: "USD" }, key());
    const contact = await createContact(f.db, "p-owner", tenantA, { name: "Synthetic Donor", email: `donor-${randomUUID().slice(0, 8)}@example.test` });
    const k = key();
    const pledge = await recordPledge(f.db, "p-admin", tenantA, fund.id, { amountCents: "50000", supporterName: "Synthetic Supporter", supporterContact: "s@example.test", expectedOn: "2026-12-31" }, k);
    expect(pledge).toMatchObject({ amountCents: "50000", currency: "USD", status: "pending", version: 1 });
    expect((await recordPledge(f.db, "p-admin", tenantA, fund.id, { amountCents: "50000", supporterName: "Synthetic Supporter", supporterContact: "s@example.test", expectedOn: "2026-12-31" }, k)).id).toBe(pledge.id);
    await recordPledge(f.db, "p-owner", tenantA, fund.id, { amountCents: "1000", contactId: contact.id }, key());
    expect((await getFundraising(f.db, "p-owner", tenantA, fund.id)).totals).toEqual({ raisedCents: "0", giftCount: 0, pledgedCents: "51000", pledgeCount: 2 });
    const accepted = await updatePledge(f.db, "p-owner", tenantA, fund.id, pledge.id, { version: 1, action: "accept" });
    expect(accepted.status).toBe("accepted");
    expect(await status(updatePledge(f.db, "p-owner", tenantA, fund.id, pledge.id, { version: 1, action: "cancel" }))).toBe(409);

    // Gifts: one against the pledge, one with a named supporter, one with a CRM contact.
    const giftKey = key();
    const gift = await recordGift(f.db, "p-admin", tenantA, fund.id, { amountCents: "20000", giftDate: "2026-11-20", pledgeId: pledge.id, methodLabel: "Bank transfer", confirmed: true }, giftKey);
    expect((await recordGift(f.db, "p-admin", tenantA, fund.id, { amountCents: "20000", giftDate: "2026-11-20", pledgeId: pledge.id, methodLabel: "Bank transfer", confirmed: true }, giftKey)).id).toBe(gift.id);
    expect(await status(recordGift(f.db, "p-admin", tenantA, fund.id, { amountCents: "99", giftDate: "2026-11-20", confirmed: true }, giftKey))).toBe(409);
    await recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "333", giftDate: "2026-11-21", supporterName: "Cash donor", methodLabel: "Cash", confirmed: true }, key());
    await recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "1", giftDate: "2026-11-22", contactId: contact.id, confirmed: true }, key());
    // The confirmation statement is required; card or account numbers are refused in free text.
    expect(await status(recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "100", giftDate: "2026-11-20" }, key()))).toBe(400);
    expect(await status(recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "100", giftDate: "2026-11-20", reference: "4111 1111 1111 1111", confirmed: true }, key()))).toBe(400);
    expect(await status(recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "100", giftDate: "2026-11-20", methodLabel: "IBAN DE89370400440532013000", confirmed: true }, key()))).toBe(400);

    expect((await getFundraising(f.db, "p-owner", tenantA, fund.id)).totals).toEqual({ raisedCents: "20334", giftCount: 3, pledgedCents: "51000", pledgeCount: 2 });
    const pledges = await listPledges(f.db, "p-owner", tenantA, fund.id);
    expect(pledges.find((row) => row.id === pledge.id)?.giftedCents).toBe("20000");
    const gifts = await listGifts(f.db, "p-owner", tenantA, fund.id);
    expect(gifts.map((row) => [row.amountCents, row.supporterName, row.kind])).toEqual([["1", null, "gift"], ["333", "Cash donor", "gift"], ["20000", "Synthetic Supporter", "gift"]]);
    expect(gifts[0].contactId).toBe(contact.id);
    expect(gifts[2]).toMatchObject({ confirmedBy: "p-admin", confirmedByName: "p-admin", methodLabel: "Bank transfer", reversed: false });

    // Currency is fixed once anything is recorded.
    const current = await getFundraising(f.db, "p-owner", tenantA, fund.id);
    expect(await status(updateFundraising(f.db, "p-owner", tenantA, fund.id, { version: current.version, currency: "EUR" }))).toBe(409);
    // Pledges and gifts audit ids only.
    const { rows } = await f.admin.query("select action, metadata::text as m from audit_logs where tenant_id = $1 and (action like 'giving.%') order by created_at", [tenantA]);
    expect(rows.map((row) => row.action)).toEqual(expect.arrayContaining(["giving.pledge.record", "giving.pledge.accept", "giving.gift.confirm", "giving.donors.read"]));
    expect(rows.map((row) => row.m).join(" ")).not.toMatch(/Synthetic|Cash donor|20000|Bank/);
  });

  it("corrects by appending an exact reversal and an optional replacement; never twice, never by editing", async () => {
    const fund = await createFundraising(f.db, "p-owner", tenantA, { title: "Corrections", goalCents: "100000", currency: "CAD" }, key());
    const gift = await recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "5000", giftDate: "2026-11-01", supporterName: "Named", confirmed: true }, key());
    const k = key();
    const fixed = await correctGift(f.db, "p-admin", tenantA, fund.id, gift.id, { reason: "wrong_amount", replacementCents: "4500", replacementDate: "2026-11-01", confirmed: true }, k);
    expect(fixed.replacementId).toBeTruthy();
    expect(await correctGift(f.db, "p-admin", tenantA, fund.id, gift.id, { reason: "wrong_amount", replacementCents: "4500", replacementDate: "2026-11-01", confirmed: true }, k)).toEqual(fixed);
    expect(await status(correctGift(f.db, "p-admin", tenantA, fund.id, gift.id, { reason: "other", confirmed: true }, key()))).toBe(409);
    expect(await status(correctGift(f.db, "p-admin", tenantA, fund.id, fixed.reversalId, { reason: "other", confirmed: true }, key()))).toBe(409);
    expect((await getFundraising(f.db, "p-owner", tenantA, fund.id)).totals).toMatchObject({ raisedCents: "4500", giftCount: 1 });
    const gifts = await listGifts(f.db, "p-owner", tenantA, fund.id);
    expect(gifts.find((row) => row.id === gift.id)?.reversed).toBe(true);
    expect(gifts.find((row) => row.id === fixed.replacementId)).toMatchObject({ amountCents: "4500", supporterName: "Named", correctionOf: gift.id });
    expect(gifts.find((row) => row.id === fixed.reversalId)).toMatchObject({ amountCents: "-5000", kind: "reversal", reason: "wrong_amount" });
    // The replacement is itself a gift and can be reversed in turn.
    await correctGift(f.db, "p-owner", tenantA, fund.id, fixed.replacementId!, { reason: "entered_in_error", confirmed: true }, key());
    expect((await getFundraising(f.db, "p-owner", tenantA, fund.id)).totals).toMatchObject({ raisedCents: "0", giftCount: 0 });

    // Concurrent corrections of one gift: exactly one wins.
    const other = await recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "700", giftDate: "2026-11-02", confirmed: true }, key());
    const results = await Promise.all([1, 2, 3].map(() => status(correctGift(f.db, "p-owner", tenantA, fund.id, other.id, { reason: "other", confirmed: true }, key()))));
    expect(results.sort()).toEqual([200, 409, 409]);

    // Direct SQL as the app: no update, delete or forged reversal; even the migration owner cannot edit or delete.
    for (const query of [sql`update giving_ledger_entries set amount_cents = 1 where id = ${gift.id}`, sql`delete from giving_ledger_entries where id = ${gift.id}`]) {
      await expect(asApp("p-owner", tenantA, query)).rejects.toMatchObject({ cause: { code: "42501" } });
    }
    const forged = await recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "900", giftDate: "2026-11-03", confirmed: true }, key());
    await expect(asApp("p-owner", tenantA, sql`insert into giving_ledger_entries (tenant_id, fundraising_id, amount_cents, currency, kind, correction_of, reason, gift_date, confirmed_by, idempotency_key, fingerprint)
      values (${tenantA}, ${fund.id}, -100, 'CAD', 'reversal', ${forged.id}, 'other', '2026-11-03', 'p-owner', ${key()}, 'x')`)).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(asApp("p-owner", tenantA, sql`insert into giving_ledger_entries (tenant_id, fundraising_id, amount_cents, currency, kind, gift_date, confirmed_by, idempotency_key, fingerprint)
      values (${tenantA}, ${fund.id}, 100, 'CAD', 'gift', '2026-11-03', 'p-admin', ${key()}, 'x')`)).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(asApp("p-owner", tenantA, sql`insert into giving_ledger_entries (tenant_id, fundraising_id, amount_cents, currency, kind, gift_date, confirmed_by, idempotency_key, fingerprint)
      values (${tenantA}, ${fund.id}, 100, 'USD', 'gift', '2026-11-03', 'p-owner', ${key()}, 'x')`)).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(f.admin.query("update giving_ledger_entries set amount_cents = 1 where id = $1", [gift.id])).rejects.toThrow(/append-only/);
    await expect(f.admin.query("delete from giving_ledger_entries where id = $1", [gift.id])).rejects.toThrow(/append-only/);
  });

  it("keeps closed and archived campaigns honest", async () => {
    const fund = await createFundraising(f.db, "p-owner", tenantA, { title: "Closing", goalCents: "1000", currency: "AUD" }, key());
    await updateFundraising(f.db, "p-owner", tenantA, fund.id, { version: 1, action: "open" });
    await updateFundraising(f.db, "p-owner", tenantA, fund.id, { version: 2, action: "close" });
    expect(await status(recordPledge(f.db, "p-owner", tenantA, fund.id, { amountCents: "100" }, key()))).toBe(409);
    const late = await recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "100", giftDate: "2026-11-25", confirmed: true }, key());
    await updateFundraising(f.db, "p-owner", tenantA, fund.id, { version: 3, action: "archive" });
    expect(await status(recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "100", giftDate: "2026-11-25", confirmed: true }, key()))).toBe(409);
    // Corrections stay possible after archiving.
    expect(await status(correctGift(f.db, "p-owner", tenantA, fund.id, late.id, { reason: "entered_in_error", confirmed: true }, key()))).toBe(200);
  });

  it("limits donor data and gifts to owners and admins; Giving collaborators see campaign settings only; other ministries see nothing", async () => {
    const fund = await createFundraising(f.db, "p-owner", tenantA, { title: "Private", goalCents: "1000", currency: "USD" }, key());
    await recordPledge(f.db, "p-owner", tenantA, fund.id, { amountCents: "100", supporterName: "Hidden Person" }, key());
    await recordGift(f.db, "p-owner", tenantA, fund.id, { amountCents: "100", giftDate: "2026-11-25", confirmed: true }, key());
    for (const user of ["p-member", "p-viewer"]) {
      expect(await status(listFundraising(f.db, user, tenantA)), user).toBe(403);
      expect(await status(getFundraising(f.db, user, tenantA, fund.id)), user).toBe(403);
    }
    for (const user of ["p-member", "p-viewer", "p-collab"]) {
      expect(await status(listPledges(f.db, user, tenantA, fund.id)), user).toBe(403);
      expect(await status(listGifts(f.db, user, tenantA, fund.id)), user).toBe(403);
      expect(await status(recordGift(f.db, user, tenantA, fund.id, { amountCents: "1", giftDate: "2026-11-25", confirmed: true }, key())), user).toBe(403);
      expect(await status(recordPledge(f.db, user, tenantA, fund.id, { amountCents: "1" }, key())), user).toBe(403);
    }
    // A Giving collaborator manages campaign settings and sees no totals; the database agrees (no ledger or pledge rows for them).
    const seen = await getFundraising(f.db, "p-collab", tenantA, fund.id);
    expect(seen.totals).toBeNull();
    expect((await listFundraising(f.db, "p-collab", tenantA)).every((row) => row.totals === null)).toBe(true);
    expect((await updateFundraising(f.db, "p-collab", tenantA, fund.id, { version: 1, title: "Private fund" })).title).toBe("Private fund");
    for (const table of ["giving_ledger_entries", "fundraising_pledges", "giving_contact_links"]) {
      expect((await asApp("p-collab", tenantA, sql`select count(*)::int as n from ${sql.identifier(table)}`)).rows[0], table).toEqual({ n: 0 });
      expect((await asApp("p-member", tenantA, sql`select count(*)::int as n from ${sql.identifier(table)}`)).rows[0], table).toEqual({ n: 0 });
    }
    expect((await asApp("p-member", tenantA, sql`select count(*)::int as n from fundraising_campaigns`)).rows[0]).toEqual({ n: 0 });
    // Another ministry: unknown ids, nothing readable.
    expect(await status(getFundraising(f.db, "p-other", tenantB, fund.id))).toBe(404);
    expect(await status(recordGift(f.db, "p-other", tenantB, fund.id, { amountCents: "1", giftDate: "2026-11-25", confirmed: true }, key()))).toBe(404);
    expect(await listFundraising(f.db, "p-other", tenantB)).toEqual([]);
    expect(await status(getFundraising(f.db, "p-other", tenantA, fund.id))).toBe(403);
    for (const table of ["fundraising_campaigns", "giving_ledger_entries", "fundraising_pledges"]) {
      expect((await asApp("p-other", tenantB, sql`select count(*)::int as n from ${sql.identifier(table)}`)).rows[0], table).toEqual({ n: 0 });
    }
  });

  it("forces row-level security and grants the app no update or delete on the ledger", async () => {
    const { rows } = await f.admin.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('fundraising_campaigns','fundraising_pledges','giving_ledger_entries','giving_contact_links') order by relname`);
    expect(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect(rows).toHaveLength(4);
    const grants = await f.admin.query(`select privilege_type from information_schema.role_table_grants where grantee = 'harvest_app' and table_name = 'giving_ledger_entries' order by 1`);
    expect(grants.rows.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);
    const publicGrants = await f.admin.query(`select count(*)::int as n from information_schema.role_table_grants where grantee = 'PUBLIC' and table_name in ('fundraising_campaigns','fundraising_pledges','giving_ledger_entries','giving_contact_links')`);
    expect(publicGrants.rows[0].n).toBe(0);
  });
});
