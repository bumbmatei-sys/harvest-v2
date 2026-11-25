import { createHash } from "node:crypto";
import { z } from "zod";
import { audiences } from "./audience";

// Unified Discover (communities, courses, products). Pure rules shared by the server and, later, the screens. The listing is a read projection of the canonical record: nothing here
// owns a community, course or product, and no member, enrolment, payment or application data is ever part of it.
import { discoverCategories, discoverSorts, discoverTypes, maxDiscoverOffset, reportReasons, type DiscoverType } from "./discover-taxonomy";
export * from "./discover-taxonomy";
/** Stored in listing controls (course and product opt-in); a community's opt-in stays its own canonical column. */
export const language = z.string().regex(/^[a-z]{2,3}$/);
export const category = z.enum(discoverCategories);

export const searchInput = z.object({
  q: z.string().trim().max(80).optional(), type: z.enum(discoverTypes).optional(), category: category.optional(), language: language.optional(),
  audience: z.enum(audiences).optional(), free: z.boolean().optional(), sort: z.enum(discoverSorts).default("relevance"), cursor: z.string().max(40).optional(),
}).strict();
export type SearchInput = z.infer<typeof searchInput>;
/** Cursor is an opaque page offset, bounded so a deep scan cannot be used to enumerate the directory. */
export const encodeCursor = (offset: number) => Buffer.from(String(offset)).toString("base64url");
export function decodeCursor(cursor: string | undefined) {
  if (!cursor) return 0;
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const n = Number(text);
  if (!/^\d{1,4}$/.test(text) || encodeCursor(n) !== cursor || n > maxDiscoverOffset) throw new Error("INVALID_CURSOR");
  return n;
}
export const listingMetadata = z.object({ category: category.nullable().optional(), language: language.nullable().optional() }).strict();
export const reportInput = z.object({ type: z.enum(discoverTypes), id: z.uuid(), reason: z.enum(reportReasons), note: z.string().trim().max(500).refine(v => v.isWellFormed() && !v.includes("\u0000")).optional() }).strict();
export const decisionInput = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }).strict(),
  z.object({ decision: z.literal("reject"), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ decision: z.literal("suspend"), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ decision: z.literal("reinstate") }).strict(),
]);

/** The fields a reviewer approved. Any change to one of them is material: an approved listing returns to review, a rejected one is resubmitted. Timestamps and counters are not part of it. */
export function materialHash(f: { type: DiscoverType; name: string; summary: string | null; category: string | null; language: string | null; free: boolean; host: string; audience: string | null }) {
  return createHash("sha256").update(JSON.stringify([f.type, f.name, f.summary ?? "", f.category ?? "", f.language ?? "", f.free, f.host, f.audience ?? ""])).digest("hex");
}
export const searchText = (parts: (string | null | undefined)[]) => parts.map(p => p ?? "").join(" ").toLowerCase().replace(/\s+/g, " ").trim();
export const publicSummary = (value: string | null | undefined) => (value ?? "").trim().slice(0, 280) || null;
