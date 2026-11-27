import type { DiscoverFilters } from "./discover-ui";

// Discover shelves (Picks, New this week, Free to start) above the "All" grid. Pure rules, shared by the page and the unit tests.
/** Most cards one shelf shows. */
export const shelfSize = 8;
/** A shelf with fewer cards is not shown. */
export const shelfMinItems = 3;
/** Below this many listings in the view the shelves would only repeat the grid, so none is shown. */
export const shelfMinTotal = 12;
const week = 7 * 24 * 60 * 60 * 1000;

/** Shelves belong to the plain browse view only (a type chip is allowed): a search, a category, language or price filter, or a chosen sort shows the grid alone. */
export function shelvesAllowed(filters: DiscoverFilters, total: number) {
  return !filters.q && filters.sort === "relevance" && !filters.category && !filters.language && filters.free === undefined && total >= shelfMinTotal;
}

/** Keeps a shelf only when it has enough cards, capped at the shelf size. */
export function fillShelf<T>(items: readonly T[]): T[] {
  return items.length >= shelfMinItems ? items.slice(0, shelfSize) : [];
}

/** Listings whose last public change is within the past seven days, newest first (the server already sorts them). */
export function changedThisWeek<T extends { updatedAt: string }>(items: readonly T[], now = Date.now()): T[] {
  return items.filter((item) => now - new Date(item.updatedAt).getTime() <= week);
}

/** "Free to start" adds nothing when every listing in the view is free. */
export const freeShelfUseful = (freeTotal: number, total: number) => freeTotal < total;
