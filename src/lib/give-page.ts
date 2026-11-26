// Public fundraising page (/give/<slug>): shared input rules and the public view shape (pure, client-safe). Record keeping only: Harvest moves no money.
import { z } from "zod";
import type { FundraisingCurrency } from "./fundraising";

/** Lowercase letters, digits and inner hyphens, 3 to 48 characters (the community slug rule). Mirrors the database check. */
export const giveSlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
/** Words that could read as a Harvest page or confuse visitors. Mirrors the database check (a unit test keeps the two in step). */
export const giveReservedSlugs = ["new", "create", "edit", "settings", "admin", "api", "account", "give", "giving", "donate", "report", "cover", "search",
  "discover", "harvest", "login", "signup", "help", "support", "about", "terms", "privacy", "official", "staff", "null", "undefined"] as const;
export const giveLimits = { description: 5000, slugMin: 3, slugMax: 48 } as const;
/** The smallest number of distinct identified supporters before a public total is shown (the platform small-group minimum, connect_retention_policy). */
export const giveSmallGroupMin = 5;

export type GiveSlugProblem = "format" | "reserved";
export function giveSlugProblem(slug: string): GiveSlugProblem | null {
  if (!giveSlugPattern.test(slug)) return "format";
  return (giveReservedSlugs as readonly string[]).includes(slug) ? "reserved" : null;
}
/** A slug suggestion from a title: lowercase ASCII, hyphens, trimmed to the limit. May still be reserved or taken. */
export function suggestGiveSlug(title: string): string {
  const base = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, giveLimits.slugMax).replace(/-+$/, "");
  return base.length >= giveLimits.slugMin ? base : "";
}

// Control characters other than line breaks and tabs are refused; CRLF becomes LF.
const controlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const giveSlugInput = z.string().trim().toLowerCase().refine((value) => giveSlugProblem(value) === null, "INVALID_SLUG");
export const giveDescriptionInput = z.string().transform((value) => value.replace(/\r\n?/g, "\n").trim()).pipe(z.string().max(giveLimits.description))
  .refine((value) => !controlCharacters.test(value), "INVALID_TEXT").transform((value) => value || null);
export const givePageInput = z.object({
  slug: giveSlugInput,
  description: giveDescriptionInput.nullish().transform((value) => value ?? null),
  showAmount: z.boolean(),
  /** The page's current version; omitted when the page is first saved. */
  version: z.number().int().min(1).max(2147483646).optional(),
}).strict();

export type GivePageSettings = { slug: string; description: string | null; coverFileId: string | null; showAmount: boolean; version: number };

/**
 * What a visitor sees. `amount` is null when the owner switched the amount off. `raisedCents` is null while fewer than five distinct identified supporters
 * gave (small-group suppression): the goal shows, the raised figure and the percentage do not.
 */
export type GivePublicView = {
  slug: string; title: string; description: string | null; ministry: string; hasCover: boolean;
  amount: { currency: FundraisingCurrency; goalCents: string; raisedCents: string | null } | null;
};
const digits = z.string().regex(/^-?[0-9]{1,16}$/);
const publicShape = z.object({
  slug: z.string(), title: z.string(), description: z.string().nullable(), ministry: z.string(), hasCover: z.boolean(),
  amount: z.object({ currency: z.string(), goalCents: digits, raisedCents: digits.nullable() }).strict().nullable(),
}).strict();
/** Parses the definer's answer; anything unexpected is treated as no page. */
export function parseGivePublicView(raw: unknown): GivePublicView | null {
  const parsed = publicShape.safeParse(raw);
  return parsed.success ? (parsed.data as GivePublicView) : null;
}
/** The public path of a give page. */
export const givePath = (slug: string) => `/give/${slug}`;
