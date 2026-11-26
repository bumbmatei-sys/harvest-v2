import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, campaignBudgetLines, campaignDrafts, campaignExpenses, campaigns, users } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import {
  budgetCurrencyOf, budgetLineCreateInput, budgetLineUpdateInput, budgetTotals, budgetVersionInput, expenseCreateInput, expenseUpdateInput, MAX_EXPENSES_PER_CAMPAIGN,
  type BudgetCategory, type BudgetTotals, type CampaignBudgetView,
} from "../lib/campaign-budget";
import type { FundraisingCurrency } from "../lib/fundraising";
import { message, type MessageKey } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

/**
 * Campaign budgets (PRD "What Happens After Clicking Finish?", item 4; launch scope rows 2 and 3): budget lines (planned per category) and expenses
 * (spent), in the campaign's one budget currency. Record keeping only: no money moves and no payment provider is involved. Everyone who can read
 * campaigns reads the totals; owners and admins see the individual expenses and add, change and remove lines and expenses (version-checked).
 * Audit rows carry ids and field names only, never amounts, descriptions, payees or references.
 */
const managers = ["owner", "admin"];
const fail = (status: 400 | 404 | 409, key: MessageKey) => new AccessError(status, message(key));
const sqlState = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? sqlState(error.cause) : undefined;
};
async function mapped<T>(work: Promise<T>, conflict: MessageKey): Promise<T> {
  try { return await work; } catch (error) {
    const code = sqlState(error);
    if (code === "23505" || code === "23514" || code === "23503") throw fail(409, conflict);
    throw error;
  }
}
const audit = (tx: Transaction, tenantId: string, userId: string, action: string, target: string, metadata: Record<string, string>) =>
  tx.insert(auditLogs).values({ tenantId, actorId: userId, action, targetId: target, metadata });

/** The campaign (not found when unknown; archived ones are read-only) and its budget currency. */
async function campaignOf(tx: Transaction, tenantId: string, campaignId: string, writing: boolean) {
  const [campaign] = await tx.select({ archivedAt: campaigns.archivedAt }).from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId)));
  if (!campaign || (writing && campaign.archivedAt)) throw fail(404, "Campaigns.notFound");
  const [draft] = await tx.select({ budget: campaignDrafts.budget }).from(campaignDrafts).where(and(eq(campaignDrafts.tenantId, tenantId), eq(campaignDrafts.campaignId, campaignId)));
  return budgetCurrencyOf(draft ? draft.budget.currency : null);
}

/** Writes need a supported currency, and every row already recorded must be in it (one currency per campaign). */
async function writableCurrency(tx: Transaction, tenantId: string, campaignId: string): Promise<FundraisingCurrency> {
  const currency = await campaignOf(tx, tenantId, campaignId, true);
  if (!currency) throw fail(409, "CampaignBudget.currencyUnsupported");
  const other = (table: typeof campaignBudgetLines | typeof campaignExpenses) => tx.select({ id: table.id }).from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.campaignId, campaignId), ne(table.currency, currency))).limit(1);
  if ((await other(campaignBudgetLines)).length || (await other(campaignExpenses)).length) throw fail(409, "CampaignBudget.currencyMismatch");
  return currency;
}

/** Planned and spent totals for the campaign (all readers). */
async function totalsOf(tx: Transaction, tenantId: string, campaignId: string) {
  const lines = await tx.select({ id: campaignBudgetLines.id, category: campaignBudgetLines.category, plannedCents: sql<string>`${campaignBudgetLines.plannedCents}::text`, version: campaignBudgetLines.version })
    .from(campaignBudgetLines).where(and(eq(campaignBudgetLines.tenantId, tenantId), eq(campaignBudgetLines.campaignId, campaignId)));
  const spent = await tx.select({ category: campaignExpenses.category, cents: sql<string>`coalesce(sum(${campaignExpenses.amountCents}), 0)::text`, count: sql<number>`count(*)::int` })
    .from(campaignExpenses).where(and(eq(campaignExpenses.tenantId, tenantId), eq(campaignExpenses.campaignId, campaignId))).groupBy(campaignExpenses.category);
  const typed = lines.map((line) => ({ ...line, category: line.category as BudgetCategory }));
  return { lines: typed, ...budgetTotals(typed, spent.map((row) => ({ ...row, category: row.category as BudgetCategory }))) };
}

async function viewOf(tx: Transaction, tenantId: string, campaignId: string, manage: boolean): Promise<CampaignBudgetView> {
  const currency = await campaignOf(tx, tenantId, campaignId, false);
  const { lines, categories, totals } = await totalsOf(tx, tenantId, campaignId);
  const order = new Map(lines.map((line) => [line.category, line]));
  const expenses = manage ? (await tx.select({
    id: campaignExpenses.id, spentOn: campaignExpenses.spentOn, amountCents: sql<string>`${campaignExpenses.amountCents}::text`, category: campaignExpenses.category,
    description: campaignExpenses.description, payee: campaignExpenses.payee, reference: campaignExpenses.reference, recordedByName: users.name,
    version: campaignExpenses.version, createdAt: campaignExpenses.createdAt,
  }).from(campaignExpenses).innerJoin(users, eq(users.id, campaignExpenses.recordedBy))
    .where(and(eq(campaignExpenses.tenantId, tenantId), eq(campaignExpenses.campaignId, campaignId)))
    .orderBy(desc(campaignExpenses.spentOn), desc(campaignExpenses.createdAt), asc(campaignExpenses.id)))
    .map((row) => ({ ...row, category: row.category as BudgetCategory, recordedByName: row.recordedByName.trim(), createdAt: row.createdAt.toISOString() })) : null;
  return { currency, manage: manage && currency !== null, lines: categories.filter((entry) => entry.planned).map((entry) => order.get(entry.category)!), categories, totals, expenses };
}

/** Totals only, for the campaign dashboard and the setup checklist. Null when the campaign has neither a budget line nor an expense. */
export async function budgetSummaryOf(tx: Transaction, tenantId: string, campaignId: string): Promise<(BudgetTotals & { currency: string; lines: number }) | null> {
  const { lines, totals } = await totalsOf(tx, tenantId, campaignId);
  if (!lines.length && !totals.expenseCount) return null;
  // Rows exist only in the campaign's supported budget currency (writes check it), so the currency is known here.
  return { ...totals, currency: (await campaignOf(tx, tenantId, campaignId, false)) ?? "USD", lines: lines.length };
}

export async function getCampaignBudget(db: Database, userId: string, workspace: string, campaign: string) {
  const id = uuidInput.parse(campaign);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:read", (tx, tenantId, role) => viewOf(tx, tenantId, id, managers.includes(role)));
}

/** Owners and admins only, whatever the caller's campaign permission: budgets are finance records. */
function asManager<T>(db: Database, userId: string, workspace: string, run: (tx: Transaction, tenantId: string) => Promise<T>) {
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", (tx, tenantId, role) => {
    if (!managers.includes(role)) throw new AccessError(403, message("CampaignBudget.managersOnly"));
    return run(tx, tenantId);
  });
}

export async function createBudgetLine(db: Database, userId: string, workspace: string, campaign: string, raw: unknown) {
  const id = uuidInput.parse(campaign), input = budgetLineCreateInput.parse(raw);
  return asManager(db, userId, workspace, async (tx, tenantId) => {
    const currency = await writableCurrency(tx, tenantId, id);
    const [row] = await mapped(tx.insert(campaignBudgetLines).values({ tenantId, campaignId: id, category: input.category, plannedCents: BigInt(input.plannedCents), currency, createdBy: userId })
      .returning({ id: campaignBudgetLines.id }), "CampaignBudget.lineExists");
    await audit(tx, tenantId, userId, "campaign.budget_line.create", row.id, { campaign: id, category: input.category });
    return { id: row.id, ...(await viewOf(tx, tenantId, id, true)) };
  });
}

export async function updateBudgetLine(db: Database, userId: string, workspace: string, campaign: string, line: string, raw: unknown) {
  const id = uuidInput.parse(campaign), lineId = uuidInput.parse(line), input = budgetLineUpdateInput.parse(raw);
  return asManager(db, userId, workspace, async (tx, tenantId) => {
    await writableCurrency(tx, tenantId, id);
    const [current] = await tx.select({ version: campaignBudgetLines.version }).from(campaignBudgetLines)
      .where(and(eq(campaignBudgetLines.tenantId, tenantId), eq(campaignBudgetLines.campaignId, id), eq(campaignBudgetLines.id, lineId)));
    if (!current) throw fail(404, "CampaignBudget.lineNotFound");
    if (current.version !== input.version) throw fail(409, "CampaignBudget.versionConflict");
    const [row] = await tx.update(campaignBudgetLines).set({ plannedCents: BigInt(input.plannedCents), version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(campaignBudgetLines.tenantId, tenantId), eq(campaignBudgetLines.id, lineId), eq(campaignBudgetLines.version, input.version))).returning({ id: campaignBudgetLines.id });
    if (!row) throw fail(409, "CampaignBudget.versionConflict");
    await audit(tx, tenantId, userId, "campaign.budget_line.update", lineId, { campaign: id, fields: "plannedCents" });
    return viewOf(tx, tenantId, id, true);
  });
}

/** Removes a budget line. Expenses in that category stay and show as unplanned spending. */
export async function deleteBudgetLine(db: Database, userId: string, workspace: string, campaign: string, line: string, raw: unknown) {
  const id = uuidInput.parse(campaign), lineId = uuidInput.parse(line), { version } = budgetVersionInput.parse(raw);
  return asManager(db, userId, workspace, async (tx, tenantId) => {
    await campaignOf(tx, tenantId, id, true);
    const [current] = await tx.select({ version: campaignBudgetLines.version }).from(campaignBudgetLines)
      .where(and(eq(campaignBudgetLines.tenantId, tenantId), eq(campaignBudgetLines.campaignId, id), eq(campaignBudgetLines.id, lineId)));
    if (!current) throw fail(404, "CampaignBudget.lineNotFound");
    const [row] = await tx.delete(campaignBudgetLines).where(and(eq(campaignBudgetLines.tenantId, tenantId), eq(campaignBudgetLines.id, lineId), eq(campaignBudgetLines.version, version)))
      .returning({ id: campaignBudgetLines.id });
    if (!row) throw fail(409, "CampaignBudget.versionConflict");
    await audit(tx, tenantId, userId, "campaign.budget_line.delete", lineId, { campaign: id });
    return viewOf(tx, tenantId, id, true);
  });
}

export async function createExpense(db: Database, userId: string, workspace: string, campaign: string, raw: unknown) {
  const id = uuidInput.parse(campaign), input = expenseCreateInput.parse(raw);
  return asManager(db, userId, workspace, async (tx, tenantId) => {
    const currency = await writableCurrency(tx, tenantId, id);
    const [{ total }] = await tx.select({ total: count() }).from(campaignExpenses).where(and(eq(campaignExpenses.tenantId, tenantId), eq(campaignExpenses.campaignId, id)));
    if (total >= MAX_EXPENSES_PER_CAMPAIGN) throw fail(409, "CampaignBudget.tooManyExpenses");
    const [row] = await mapped(tx.insert(campaignExpenses).values({
      tenantId, campaignId: id, spentOn: input.spentOn, category: input.category, amountCents: BigInt(input.amountCents), currency,
      description: input.description, payee: input.payee, reference: input.reference, recordedBy: userId,
    }).returning({ id: campaignExpenses.id }), "CampaignBudget.conflict");
    await audit(tx, tenantId, userId, "campaign.expense.create", row.id, { campaign: id, category: input.category });
    return { id: row.id, ...(await viewOf(tx, tenantId, id, true)) };
  });
}

export async function updateExpense(db: Database, userId: string, workspace: string, campaign: string, expense: string, raw: unknown) {
  const id = uuidInput.parse(campaign), expenseId = uuidInput.parse(expense), input = expenseUpdateInput.parse(raw);
  return asManager(db, userId, workspace, async (tx, tenantId) => {
    await writableCurrency(tx, tenantId, id);
    const [current] = await tx.select({ version: campaignExpenses.version }).from(campaignExpenses)
      .where(and(eq(campaignExpenses.tenantId, tenantId), eq(campaignExpenses.campaignId, id), eq(campaignExpenses.id, expenseId)));
    if (!current) throw fail(404, "CampaignBudget.expenseNotFound");
    if (current.version !== input.version) throw fail(409, "CampaignBudget.versionConflict");
    const { version, amountCents, ...rest } = input;
    const [row] = await mapped(tx.update(campaignExpenses).set({ ...rest, ...(amountCents !== undefined ? { amountCents: BigInt(amountCents) } : {}), version: version + 1, updatedAt: new Date() })
      .where(and(eq(campaignExpenses.tenantId, tenantId), eq(campaignExpenses.id, expenseId), eq(campaignExpenses.version, version))).returning({ id: campaignExpenses.id }), "CampaignBudget.conflict");
    if (!row) throw fail(409, "CampaignBudget.versionConflict");
    await audit(tx, tenantId, userId, "campaign.expense.update", expenseId, { campaign: id, fields: Object.keys(input).filter((key) => key !== "version").sort().join(",") });
    return viewOf(tx, tenantId, id, true);
  });
}

export async function deleteExpense(db: Database, userId: string, workspace: string, campaign: string, expense: string, raw: unknown) {
  const id = uuidInput.parse(campaign), expenseId = uuidInput.parse(expense), { version } = budgetVersionInput.parse(raw);
  return asManager(db, userId, workspace, async (tx, tenantId) => {
    await campaignOf(tx, tenantId, id, true);
    const [current] = await tx.select({ version: campaignExpenses.version }).from(campaignExpenses)
      .where(and(eq(campaignExpenses.tenantId, tenantId), eq(campaignExpenses.campaignId, id), eq(campaignExpenses.id, expenseId)));
    if (!current) throw fail(404, "CampaignBudget.expenseNotFound");
    const [row] = await tx.delete(campaignExpenses).where(and(eq(campaignExpenses.tenantId, tenantId), eq(campaignExpenses.id, expenseId), eq(campaignExpenses.version, version)))
      .returning({ id: campaignExpenses.id });
    if (!row) throw fail(409, "CampaignBudget.versionConflict");
    await audit(tx, tenantId, userId, "campaign.expense.delete", expenseId, { campaign: id });
    return viewOf(tx, tenantId, id, true);
  });
}

/** Whether the campaign has at least one budget line (the "Define budget" checklist item ticks itself then). */
export async function hasBudgetLine(tx: Transaction, tenantId: string, campaignId: string) {
  const rows = await tx.select({ id: campaignBudgetLines.id }).from(campaignBudgetLines)
    .where(and(eq(campaignBudgetLines.tenantId, tenantId), eq(campaignBudgetLines.campaignId, campaignId))).limit(1);
  return rows.length > 0;
}
