import { Compass, Footprints, Globe, HandHeart, HandHelping, BookOpen, House, LifeBuoy, Megaphone, Music, Shapes, Sparkles, Users, type LucideIcon } from "lucide-react";
import { defineStatusTones } from "./status-tone";
import { discoverCategories, discoverSorts, discoverTypes, type DiscoverType, type ReviewState } from "./discover-taxonomy";

// Pure helpers for the Discover screens (public, owner and staff). No Node imports: client components use this file. Rules live in src/lib/discover.ts and the server.

export type DiscoverCategory = typeof discoverCategories[number];
export type DiscoverSort = typeof discoverSorts[number];
/** The search the page URL carries. Every field is optional; an absent one means "any". */
export type DiscoverFilters = { q?: string; type?: DiscoverType; category?: DiscoverCategory; language?: string; free?: boolean; sort: DiscoverSort };

export const categoryIcons: Record<DiscoverCategory, LucideIcon> = {
  discipleship: Footprints, prayer: HandHeart, worship: Music, bible_study: BookOpen, outreach: Megaphone, missions: Globe, youth: Sparkles, family: House,
  leadership: Users, service: HandHelping, recovery: LifeBuoy, other: Shapes,
};
export const typeIcons: Record<DiscoverType, LucideIcon> = { community: Users, course: BookOpen, product: Compass };

/** Languages offered in the pickers (ISO 639 codes the server accepts). The label comes from Intl in the viewer's locale. */
export const discoverLanguages = ["en", "es", "pt", "fr", "de", "it", "ro", "ru", "uk", "pl", "ar", "hi", "zh", "ko", "ja", "id", "sw", "tl"] as const;
export function languageName(code: string, locale = "en") {
  try { return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code; } catch { return code; }
}

export const reviewTone = defineStatusTones({ not_requested: "neutral", pending: "pending", approved: "success", rejected: "danger", suspended: "warning" } satisfies Record<ReviewState, "neutral" | "pending" | "success" | "danger" | "warning">);

const languagePattern = /^[a-z]{2,3}$/;
type RawParams = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
/** Lenient page-URL parse: an unknown or malformed value is dropped (the page never answers 422 to a hand-edited link). */
export function parseFilters(params: RawParams): DiscoverFilters {
  const q = one(params.q)?.trim().slice(0, 80), type = one(params.type), category = one(params.category), language = one(params.language), free = one(params.free), sort = one(params.sort);
  return {
    ...(q ? { q } : {}),
    ...(discoverTypes.includes(type as DiscoverType) ? { type: type as DiscoverType } : {}),
    ...(discoverCategories.includes(category as DiscoverCategory) ? { category: category as DiscoverCategory } : {}),
    ...(language && languagePattern.test(language) ? { language } : {}),
    ...(free === "1" ? { free: true } : free === "0" ? { free: false } : {}),
    sort: discoverSorts.includes(sort as DiscoverSort) ? (sort as DiscoverSort) : "relevance",
  };
}
/** Query string for the page URL or the API: defaults (relevance sort) are left out so a clean URL stays clean. */
export function filtersToParams(filters: DiscoverFilters, cursor?: string | null) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.type) params.set("type", filters.type);
  if (filters.category) params.set("category", filters.category);
  if (filters.language) params.set("language", filters.language);
  if (filters.free !== undefined) params.set("free", filters.free ? "1" : "0");
  if (filters.sort !== "relevance") params.set("sort", filters.sort);
  if (cursor) params.set("cursor", cursor);
  return params;
}
/** How many filters besides the search, type and sort are active (the badge on the filter button). */
export const activeFilterCount = (filters: DiscoverFilters) => (filters.category ? 1 : 0) + (filters.language ? 1 : 0) + (filters.free !== undefined ? 1 : 0);
export const hasAnyFilter = (filters: DiscoverFilters) => Boolean(filters.q || filters.type) || activeFilterCount(filters) > 0;

/** Public page of a listing. Only communities have a public route today; courses and products open the quick look (see docs/acceptance/discover-screens.md P8). */
export const publicHref = (card: { type: DiscoverType; slug: string }) => (card.type === "community" ? `/communities/${card.slug}` : null);

/** One item in the ministry's own Discover view (`GET /api/workspaces/:id/discover/listings`). */
export type OwnListing = {
  type: DiscoverType; id: string; name: string; published: boolean; optIn: boolean; optInManagedBy: "community_settings" | "listing";
  category: string | null; language: string | null; review: { state: ReviewState; reason: string | null }; listed: boolean; version: number;
};
