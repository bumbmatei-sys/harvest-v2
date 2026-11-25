// Pure Discover constants shared by the server rules (src/lib/discover.ts) and the screens. No Node imports: client components may use this file.
export const discoverTypes = ["community", "course", "product"] as const;
export type DiscoverType = typeof discoverTypes[number];
export const discoverCategories = ["discipleship", "prayer", "worship", "bible_study", "outreach", "missions", "youth", "family", "leadership", "service", "recovery", "other"] as const;
export const reviewStates = ["not_requested", "pending", "approved", "rejected", "suspended"] as const;
export type ReviewState = typeof reviewStates[number];
export const reportReasons = ["spam", "inappropriate", "misleading", "impersonation", "other"] as const;
export const discoverSorts = ["relevance", "newest", "name"] as const;
export const discoverPageSize = 24;
export const maxDiscoverOffset = 960;
