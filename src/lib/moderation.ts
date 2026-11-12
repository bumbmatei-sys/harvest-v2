// C12a: pure moderation rules shared by the server, the UI and (mirrored) the SQL definers.
export const reportReasons = ["spam", "harassment", "inappropriate", "other"] as const;
export type ReportReason = typeof reportReasons[number];
export const reportTargets = ["post", "comment", "member"] as const;
export type ReportTarget = typeof reportTargets[number];
export const muteDays = [1, 7, 30] as const;
export const memberActions = ["mute", "unmute", "ban", "unban"] as const;
export type MemberAction = typeof memberActions[number];
export const moderationLimits = { note: 500, bannedWords: 100, bannedWord: 40, warning: 500, appeal: 1000, appealReply: 500 } as const;
export const appealDecisions = ["approve", "decline"] as const;
export type AppealDecision = typeof appealDecisions[number];
/** Previous versions kept per post or reply. */
export const revisionCap = 50;

/** C12b: a trimmed reason or message of 1..max characters, or null. Mirrors the SQL length checks. */
export function validReason(value: string, max: number): string | null {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : null;
}

/** Any host may decline an appeal; approving is an unban, so only owners and admins. */
export function canDecideAppeal(role: string, decision: AppealDecision): boolean {
  return communityRank(role) >= (decision === "approve" ? 2 : 1);
}

/** One appeal per ban: allowed while banned and when none was sent since the ban. */
export function canAppeal(input: { banned: boolean; bannedAt: Date; lastAppealAt: Date | null }): boolean {
  return input.banned && (input.lastAppealAt === null || input.lastAppealAt < input.bannedAt);
}

/** An edit leaves a revision only when the content really changed. Mirrors the post and reply definers. */
export function shouldRecordRevision(previous: { title?: string; body: unknown; bodyText?: string }, next: { title?: string; body: unknown; bodyText?: string }): boolean {
  return previous.title !== next.title || previous.bodyText !== next.bodyText || JSON.stringify(previous.body) !== JSON.stringify(next.body);
}

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
