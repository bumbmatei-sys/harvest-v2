// C12a: pure moderation rules shared by the server, the UI and (mirrored) the SQL definers.
export const reportReasons = ["spam", "harassment", "inappropriate", "other"] as const;
export type ReportReason = typeof reportReasons[number];
export const reportTargets = ["post", "comment", "member"] as const;
export type ReportTarget = typeof reportTargets[number];
export const muteDays = [1, 7, 30] as const;
export const memberActions = ["mute", "unmute", "ban", "unban"] as const;
export type MemberAction = typeof memberActions[number];
export const moderationLimits = { note: 500, bannedWords: 100, bannedWord: 40 } as const;

/** Host rank: owner 3, admin 2, moderator 1, everyone else 0. */
export function communityRank(role: string): number {
  return role === "owner" ? 3 : role === "admin" ? 2 : role === "moderator" ? 1 : 0;
}

/** A host may act on a member only with a strictly higher rank, never on the owner and never on themselves. */
export function canActOn(actorRole: string, targetRole: string, sameUser = false): boolean {
  if (sameUser || targetRole === "owner") return false;
  const actor = communityRank(actorRole);
  return actor > 0 && actor > communityRank(targetRole);
}

/** Trim, lower-case, de-duplicate and cap the banned-words list. Throws on an invalid entry. */
export function normaliseBannedWords(words: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of words) {
    const word = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!word) continue;
    if (word.length > moderationLimits.bannedWord) throw new RangeError();
    if (!out.includes(word)) out.push(word);
  }
  if (out.length > moderationLimits.bannedWords) throw new RangeError();
  return out;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word, case-insensitive match (letters and digits form words). Mirrors `community_banned_word_match` in SQL. */
export function matchesBannedWord(text: string, words: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return words.some((word) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(word)}($|[^\\p{L}\\p{N}])`, "u").test(haystack));
}
