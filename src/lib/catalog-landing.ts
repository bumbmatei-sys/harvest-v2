import { z } from "zod";
import { sanitizeDocContent, type DocContent } from "./docs";

// Product and course landing page ("Sales page"): limits, the owner input schema and pure helpers shared by the server, the editor and the tests.
export const landingLimits = { subtitle: 160, included: 12, includedItem: 120, aboutHeading: 120, aboutBody: 1500, faq: 12, question: 160, answer: 1000,
  ctaQuote: 280, ctaLabel: 40, review: 1000, priceMin: 100, priceMax: 10_000_000, bodyBytes: 65_536 } as const;
export const landingCurrencies = ["USD", "EUR", "GBP"] as const;
export type LandingCurrency = typeof landingCurrencies[number];
/** "People have it" below this is shown as "Fewer than 5" (the shared small-group rule). */
export const smallGroup = 5;

const plain = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const line = (max: number) => z.string().trim().max(max).refine((value) => plain(value) && !/[\r\n]/.test(value));
const text = (max: number) => z.string().trim().max(max).refine(plain);
const iso = z.iso.datetime({ offset: true });

export const landingInput = z.object({
  version: z.number().int().min(0).max(2_147_483_646),
  subtitle: line(landingLimits.subtitle).default(""),
  body: z.unknown().nullable().default(null),
  included: z.array(line(landingLimits.includedItem).pipe(z.string().min(1))).max(landingLimits.included).default([]),
  aboutHeading: line(landingLimits.aboutHeading).default(""),
  aboutBody: text(landingLimits.aboutBody).default(""),
  aboutPhotoId: z.uuid().nullable().default(null),
  faq: z.array(z.object({ question: line(landingLimits.question).pipe(z.string().min(1)), answer: text(landingLimits.answer).pipe(z.string().min(1)) }).strict())
    .max(landingLimits.faq).default([]),
  ctaQuote: text(landingLimits.ctaQuote).default(""),
  ctaLabel: line(landingLimits.ctaLabel).default(""),
  price: z.object({ cents: z.number().int().min(landingLimits.priceMin).max(landingLimits.priceMax), currency: z.enum(landingCurrencies) }).strict().nullable().default(null),
  sale: z.object({ cents: z.number().int().min(1), startsAt: iso, endsAt: iso }).strict().nullable().default(null),
}).strict();
export type LandingInput = z.infer<typeof landingInput>;

/** Why a sale is refused, or null: it needs a price, a lower amount and an end after its start and in the future. */
export function saleProblem(input: Pick<LandingInput, "price" | "sale">, now: number): "needsPrice" | "notLower" | "endBeforeStart" | "ended" | null {
  if (!input.sale) return null;
  if (!input.price) return "needsPrice";
  if (input.sale.cents >= input.price.cents) return "notLower";
  const start = Date.parse(input.sale.startsAt), end = Date.parse(input.sale.endsAt);
  if (!(end > start)) return "endBeforeStart";
  if (end <= now) return "ended";
  return null;
}

/** The long sales text: the native blog article's block JSON, sanitised by the same Docs rules (no pictures, mentions or sub-pages here). */
export function landingBody(input: unknown): DocContent | null {
  if (input === null || input === undefined) return null;
  const clean = sanitizeDocContent(input);
  return new TextEncoder().encode(JSON.stringify(clean)).length > landingLimits.bodyBytes ? null : clean;
}

export type LandingPrice = { currency: LandingCurrency; cents: number; oldCents: number | null; saleEndsAt: string | null };
export function catalogCardPrice(price: LandingPrice | null, freeLabel = "Free") {
  return { price, paid: price !== null, priceLabel: price ? formatMoney(price.cents, price.currency) : freeLabel };
}
export type LandingReview = { name: string; rating: number; body: string; updatedAt: string };
/** What public.catalog_landing returns for a public item. */
export type PublicLanding = {
  slug: string; title: string; summary: string; kind: "course" | "download"; host: string;
  subtitle: string; body: DocContent | null; included: string[];
  about: { heading: string; body: string; photo: boolean };
  faq: { question: string; answer: string }[]; cta: { quote: string; label: string };
  price: LandingPrice | null;
  stats: { people: number | null; modules: number; lessons: number; files: number };
  reviews: LandingReview[]; rating: { average: number | null; count: number };
  viewer: { signedIn: boolean; canReview: boolean; review: { rating: number; body: string; hidden: boolean } | null };
};

/** A price in the viewer's locale ("$29", "€12.50"). */
export function formatMoney(cents: number, currency: string, locale = "en") {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
/** Major units typed by the owner ("29", "12.50") to cents, or null when it is not a valid amount. */
export function toCents(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,6}(?:[.,]\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed.replace(",", ".")) * 100);
}
export const centsToInput = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2));
