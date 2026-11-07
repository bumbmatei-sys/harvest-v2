import { z } from "zod";
import { locales } from "../i18n/locale";
import type { responseLinkStatuses } from "./connect-data";

// HC-03: campaign QR / short-URL link contract shared by server, routes and UI.
export type LinkStatus = typeof responseLinkStatuses[number];
/** What an organizer sees: an expired published link is shown (and resolves) as expired. */
export type EffectiveLinkStatus = LinkStatus | "expired";
export const linkActions = ["publish", "disable", "archive", "rotate"] as const;
export type LinkAction = typeof linkActions[number];
export const linkOutcomes = ["published", "disabled", "archived", "rotated", "unchanged", "not_found", "stale", "campaign_archived",
  "form_not_published", "expiry_in_past", "invalid_transition", "invalid_action", "link_archived"] as const;
export type LinkOutcome = typeof linkOutcomes[number];
export const exportFormats = ["png", "svg", "pdf"] as const;
export type ExportFormat = typeof exportFormats[number];
export const qrPalettes = ["standard", "brand"] as const;
export type QrPalette = typeof qrPalettes[number];

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => value || null);
export const createLinkInput = z.object({
  label: optionalText(80),
  publicTitle: optionalText(120),
  locale: z.enum(locales).default("en"),
  formVersionId: z.uuid().nullish().transform((value) => value ?? null),
}).strict();
export type CreateLinkInput = z.input<typeof createLinkInput>;
export const linkActionInput = z.object({
  action: z.enum(linkActions),
  expiresAt: z.iso.datetime({ offset: true }).nullish().transform((value) => value ?? null),
  expectedCode: z.string().regex(/^[a-f0-9]{32}$/).nullish().transform((value) => value ?? null),
}).strict();
export const exportQuery = z.object({ format: z.enum(exportFormats), palette: z.enum(qrPalettes).default("standard") });

export const publicCodePattern = /^[a-f0-9]{32}$/;
export const shortCodePattern = /^[0-9A-HJKMNP-TV-Z]{12}$/;
/**
 * Normalizes typed short codes: case-insensitive, hyphens/spaces ignored, and the usual Crockford
 * look-alikes (O→0, I/L→1). Returns undefined for anything that cannot be a short code.
 */
export function normalizeShortCode(input: string): string | undefined {
  if (input.length > 40) return undefined;
  const value = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return shortCodePattern.test(value) ? value : undefined;
}
export function formatShortCode(code: string) {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}
export function effectiveStatus(status: LinkStatus, expiresAt: Date | string | null, now = new Date()): EffectiveLinkStatus {
  return status === "published" && expiresAt !== null && new Date(expiresAt) <= now ? "expired" : status;
}
/** Absolute public URLs. Paths carry only the opaque code: no tenant, campaign, person or secret. */
export function publicLinkUrls(origin: string, link: { publicCode: string; shortCode: string }) {
  const base = new URL(origin);
  const qr = new URL(`/c/${link.publicCode}`, base).toString();
  const short = new URL(`/s/${formatShortCode(link.shortCode)}`, base);
  return { qr, short: short.toString(), shortDisplay: `${short.host}${short.pathname}` };
}
