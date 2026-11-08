import { z } from "zod";
import { publicCodePattern } from "./connect-links";

// Deliberately narrow ASCII DNS grammar shared with 0030. No credentials, IP literals,
// encoded hosts, single-label names, trailing dots, backslashes or control characters.
export const landingUrlPattern = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::[0-9]{1,5})?(?:[/?#][^\s\\]*)?$/i;
export function safeLandingUrl(value: string): boolean {
  if (!value.isWellFormed() || value.length > 2048 || !landingUrlPattern.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !/(^|\.)(localhost|local|internal)$/.test(url.hostname)
      && (!url.port || Number(url.port) > 0);
  } catch { return false; }
}
const plain = (max: number) => z.string().max(max).refine((s) => s.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s));
export const landingCard = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resource"), resourceId: z.enum(["first-reading", "common-questions", "keep-exploring"]) }).strict(),
  z.object({ kind: z.literal("external"), category: z.enum(["community", "course", "product"]), title: plain(120).min(1).refine((s) => s.trim().length > 0),
    description: plain(300), url: z.string().refine(safeLandingUrl), price: z.enum(["free", "paid"]) }).strict()
    .refine((card) => card.category !== "community" || card.price === "free"),
]);
export const landingDefinition = z.object({ heading: plain(120), message: plain(600), cards: z.array(landingCard).max(8) }).strict();
export type LandingDefinition = z.infer<typeof landingDefinition>;
export type LandingCard = LandingDefinition["cards"][number];
export const emptyLanding: LandingDefinition = { heading: "", message: "", cards: [] };
/** JSONB reorders object keys; dirty detection compares content and card order. */
export function sameLandingDefinition(a: LandingDefinition, b: LandingDefinition) {
  const key = (d: LandingDefinition) => JSON.stringify([d.heading, d.message, d.cards.map(c => c.kind === "resource"
    ? [c.kind, c.resourceId] : [c.kind, c.category, c.title, c.description, c.url, c.price])]);
  return key(a) === key(b);
}
export const landingExpectation = z.object({ expectedRevision: z.number().int().min(0).max(2147483646), expectedCode: z.string().regex(publicCodePattern) }).strict();
export const saveLandingInput = landingExpectation.extend({ definition: landingDefinition }).strict();
