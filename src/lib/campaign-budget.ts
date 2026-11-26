import { z } from "zod";
import { centsInput, fundraisingCurrencies, looksLikeAccountNumber, MAX_CENTS, type FundraisingCurrency } from "./fundraising";

// Pure rules for campaign budgets (PRD "What Happens After Clicking Finish?", item 4: expense categories and budget tracking). Record keeping only:
// no money moves and no payment provider is involved. Money is integer cents carried as decimal strings, one currency per campaign, as in fundraising.

/** Expense categories, in display order. A campaign has at most one budget line per category; an expense may use any category. */
export const budgetCategories = [
  "venue", "equipment_production", "marketing_media", "printing_materials", "travel_transport", "accommodation", "hospitality_food",
  "volunteers_staff", "security_medical", "administration", "other",
] as const;
export type BudgetCategory = typeof budgetCategories[number];

export const MAX_EXPENSES_PER_CAMPAIGN = 1000;
/** Planned amounts may be zero (a category kept on the plan with nothing set aside yet). */
export const plannedCentsInput = z.string().regex(/^(0|[1-9][0-9]{0,12})$/).refine((value) => BigInt(value) <= MAX_CENTS, "AMOUNT_TOO_LARGE");

const version = z.number().int().min(1);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => value || null).refine((value) => !looksLikeAccountNumber(value), "ACCOUNT_NUMBER");

export const budgetLineCreateInput = z.object({ category: z.enum(budgetCategories), plannedCents: plannedCentsInput }).strict();
export const budgetLineUpdateInput = z.object({ version, plannedCents: plannedCentsInput }).strict();
export const expenseCreateInput = z.object({
  spentOn: z.iso.date(), amountCents: centsInput, category: z.enum(budgetCategories),
  description: z.string().trim().min(1).max(200),
  payee: optionalText(120), reference: optionalText(120),
}).strict();
/** A partial change. Leaving a field out keeps it; null clears payee or reference. */
export const expenseUpdateInput = z.object({
  version, spentOn: z.iso.date().optional(), amountCents: centsInput.optional(), category: z.enum(budgetCategories).optional(),
  description: z.string().trim().min(1).max(200).optional(), payee: optionalText(120).optional(), reference: optionalText(120).optional(),
}).strict();
export const budgetVersionInput = z.object({ version }).strict();

/** The currency a campaign budget uses: the wizard's budget currency when it is a two-decimal currency fundraising supports, USD without a wizard draft. */
export function budgetCurrencyOf(draftCurrency: string | null): FundraisingCurrency | null {
  if (draftCurrency === null) return "USD";
  return (fundraisingCurrencies as readonly string[]).includes(draftCurrency) ? draftCurrency as FundraisingCurrency : null;
}

export type BudgetLine = { id: string; category: BudgetCategory; plannedCents: string; version: number };
export type BudgetExpense = {
  id: string; spentOn: string; amountCents: string; category: BudgetCategory; description: string; payee: string | null; reference: string | null;
  recordedByName: string; version: number; createdAt: string;
};
export type BudgetCategoryTotal = { category: BudgetCategory; plannedCents: string; spentCents: string; remainingCents: string; planned: boolean };
export type BudgetTotals = { plannedCents: string; spentCents: string; remainingCents: string; expenseCount: number };
export type CampaignBudgetView = {
  /** Null when the campaign's budget currency is not one the budget supports (then nothing can be recorded). */
  currency: FundraisingCurrency | null;
  /** Owners and admins add, change and remove budget lines and expenses. */
  manage: boolean;
  lines: BudgetLine[];
  categories: BudgetCategoryTotal[];
  totals: BudgetTotals;
  /** The individual expenses (payee and reference included): owners and admins only. Null for everyone else, who see the totals. */
  expenses: BudgetExpense[] | null;
};

/**
 * Planned vs spent per category and overall. A category shows when it has a budget line or an expense; remaining may be negative (overspent).
 * Inputs are cents strings; sums stay in BigInt.
 */
export function budgetTotals(lines: { category: BudgetCategory; plannedCents: string }[], spent: { category: BudgetCategory; cents: string; count: number }[]) {
  const planned = new Map(lines.map((line) => [line.category, BigInt(line.plannedCents)]));
  const used = new Map(spent.map((row) => [row.category, BigInt(row.cents)]));
  const categories: BudgetCategoryTotal[] = budgetCategories.filter((key) => planned.has(key) || used.has(key)).map((category) => {
    const p = planned.get(category) ?? 0n, s = used.get(category) ?? 0n;
    return { category, plannedCents: p.toString(), spentCents: s.toString(), remainingCents: (p - s).toString(), planned: planned.has(category) };
  });
  const plannedTotal = [...planned.values()].reduce((a, b) => a + b, 0n), spentTotal = [...used.values()].reduce((a, b) => a + b, 0n);
  return { categories, totals: { plannedCents: plannedTotal.toString(), spentCents: spentTotal.toString(), remainingCents: (plannedTotal - spentTotal).toString(),
    expenseCount: spent.reduce((total, row) => total + row.count, 0) } };
}

/** Whole-percent share of the plan spent (may exceed 100); null with nothing planned. */
export function spentPercent(spentCents: string, plannedCents: string): number | null {
  const planned = BigInt(plannedCents);
  return planned > 0n ? Number((BigInt(spentCents) * 100n) / planned) : null;
}
