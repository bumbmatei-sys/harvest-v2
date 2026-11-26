// Fundraising pledge campaigns: shared input rules and display helpers (pure, client-safe). Record keeping only: Harvest moves no money.
// Money is integer cents carried as decimal strings at the API so no value passes through a float; one currency per campaign, no conversion.
import { z } from "zod";
import { defineStatusTones } from "./status-tone";

/** Two-decimal ISO currencies only, so "cents" is exact. Others need a reviewed minor-unit design first. Mirrors the database check. */
export const fundraisingCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "ZAR", "BRL", "MXN", "INR", "PHP", "KES", "NGN", "GHS", "RON"] as const;
export type FundraisingCurrency = typeof fundraisingCurrencies[number];
export const fundraisingStatuses = ["draft", "published", "closed", "archived"] as const;
export type FundraisingStatus = typeof fundraisingStatuses[number];
export const pledgeStatuses = ["pending", "accepted", "cancelled"] as const;
export type PledgeStatus = typeof pledgeStatuses[number];
export const correctionReasons = ["entered_in_error", "wrong_amount", "wrong_campaign", "other"] as const;
export type CorrectionReason = typeof correctionReasons[number];
export const MAX_CENTS = 1_000_000_000_000n;

/** Positive integer cents as a string ("12550" is 125.50), at most 1e12. */
export const centsInput = z.string().regex(/^[1-9][0-9]{0,12}$/).refine((value) => /^[1-9][0-9]{0,12}$/.test(value) && BigInt(value) <= MAX_CENTS, "AMOUNT_TOO_LARGE");
/** Client retry key. The `replacement.` prefix is reserved for keys the server derives for correction replacements. */
export const idempotencyKeyInput = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/).refine((value) => !value.startsWith("replacement."), "RESERVED_KEY");
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => value || null);
const optionalDate = z.iso.date().nullish().transform((value) => value ?? null);
/** A long digit run looks like a card or account number; references and methods must never hold one. */
export const looksLikeAccountNumber = (value: string | null) => value !== null && /\d(?:[\s-]?\d){11,}/.test(value);
const noAccountNumber = (value: string | null) => !looksLikeAccountNumber(value);

export const fundraisingCreateInput = z.object({
  title: z.string().trim().min(1).max(200),
  summary: optionalText(2000),
  /** Optional outreach campaign this fundraiser belongs to. Its budget settings supply the goal and currency when they are left out. */
  campaignId: z.uuid().nullish().transform((value) => value ?? null),
  goalCents: centsInput.nullish().transform((value) => value ?? null),
  currency: z.enum(fundraisingCurrencies).nullish().transform((value) => value ?? null),
}).strict();
export const fundraisingUpdateInput = z.object({
  version: z.number().int().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  summary: optionalText(2000).optional(),
  goalCents: centsInput.optional(),
  currency: z.enum(fundraisingCurrencies).optional(),
  /** open = published (nothing public yet), close, archive. */
  action: z.enum(["open", "close", "archive"]).optional(),
}).strict();
export const pledgeCreateInput = z.object({
  amountCents: centsInput,
  supporterName: optionalText(120),
  supporterContact: optionalText(200),
  contactId: z.uuid().nullish().transform((value) => value ?? null),
  expectedOn: optionalDate,
}).strict();
export const pledgeUpdateInput = z.object({ version: z.number().int().min(1), action: z.enum(["accept", "cancel"]) }).strict();
export const giftCreateInput = z.object({
  amountCents: centsInput,
  giftDate: z.iso.date(),
  pledgeId: z.uuid().nullish().transform((value) => value ?? null),
  supporterName: optionalText(120),
  contactId: z.uuid().nullish().transform((value) => value ?? null),
  methodLabel: optionalText(80).refine(noAccountNumber, "ACCOUNT_NUMBER"),
  reference: optionalText(120).refine(noAccountNumber, "ACCOUNT_NUMBER"),
  /** The person recording states the ministry confirmed this gift outside Harvest. */
  confirmed: z.literal(true),
}).strict();
export const giftCorrectionInput = z.object({
  reason: z.enum(correctionReasons),
  /** A replacement gift with the right amount; omit to only reverse the original. */
  replacementCents: centsInput.nullish().transform((value) => value ?? null),
  replacementDate: optionalDate,
  confirmed: z.literal(true),
}).strict().refine((value) => value.replacementCents === null || value.replacementDate !== null, { path: ["replacementDate"], message: "DATE_REQUIRED" });

export const fundraisingTone = defineStatusTones<FundraisingStatus>({ draft: "neutral", published: "success", closed: "warning", archived: "pending" });
export const pledgeTone = defineStatusTones<PledgeStatus>({ pending: "pending", accepted: "info", cancelled: "neutral" });

/** Typed text ("125", "125.5", "125.50") to a cents string, or null when it is not a valid positive amount. */
export function parseCents(text: string): string | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return cents >= 1n && cents <= MAX_CENTS ? cents.toString() : null;
}
/** Cents string to the plain text a person types ("12550" -> "125.50"). */
export function centsText(cents: string): string {
  const value = BigInt(cents), sign = value < 0n ? "-" : "", abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}
/** Localised money for display. Bounded to 1e12 cents, so the number conversion is exact. */
export function formatCents(cents: string, currency: string, locale = "en"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(BigInt(cents)) / 100);
}
/** Whole-percent progress of confirmed gifts toward the goal; never clamped in the data, capped at 100 only for the bar. */
export function progressPercent(raisedCents: string, goalCents: string): number {
  const raised = BigInt(raisedCents), goal = BigInt(goalCents);
  if (goal <= 0n || raised <= 0n) return 0;
  return Number((raised * 100n) / goal);
}

export type FundraisingTotals = { raisedCents: string; giftCount: number; pledgedCents: string; pledgeCount: number };
export type FundraisingRow = {
  id: string; campaignId: string | null; campaignName: string | null; title: string; summary: string | null; status: FundraisingStatus;
  goalCents: string; currency: FundraisingCurrency; version: number; createdAt: string; updatedAt: string;
  /** Owners and admins only; null for anyone who may not see giving records. */
  totals: FundraisingTotals | null;
};
export type PledgeRow = {
  id: string; amountCents: string; currency: string; status: PledgeStatus; supporterName: string | null; supporterContact: string | null;
  contactId: string | null; expectedOn: string | null; version: number; createdAt: string; giftedCents: string;
};
export type GiftRow = {
  id: string; kind: "gift" | "reversal"; amountCents: string; currency: string; giftDate: string; pledgeId: string | null; correctionOf: string | null;
  reason: CorrectionReason | null; methodLabel: string | null; reference: string | null; supporterName: string | null; contactId: string | null;
  confirmedBy: string; confirmedByName: string; confirmedAt: string; reversed: boolean;
};
