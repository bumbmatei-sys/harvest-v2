/**
 * Link and draft rules of the member profile form. They mirror the server (`src/server/community-profile-details.ts` and the database check):
 * a label of 1 to 40 characters and an https address of at most 2048 characters with no spaces, backslashes, control characters or sign-in
 * details. The server stays the authority; this only lets the form say what is wrong before the request.
 */
export type ProfileLink = { label: string; url: string };
export type LinkIssue = "labelRequired" | "labelTooLong" | "urlRequired" | "urlNotHttps" | "urlInvalid";
export type RowIssues = { label?: LinkIssue; url?: LinkIssue };
export const maxProfileLinks = 3, maxLinkLabel = 40, maxLinkUrl = 2048;

/** Which problem an address has, or null when the server would accept it. */
export function urlIssue(raw: string): LinkIssue | null {
  const value = raw.trim();
  if (!value) return "urlRequired";
  if (!value.startsWith("https://")) return "urlNotHttps";
  if (value.length > maxLinkUrl || /[\s\\\u0000-\u001f\u007f]/.test(value)) return "urlInvalid";
  try {
    const parsed = new URL(value);
    const host = value.slice(8).split(/[/?#]/, 1)[0];
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && host.length > 0 && !host.includes("@") ? null : "urlInvalid";
  } catch { return "urlInvalid"; }
}

/** A row left completely empty is dropped on save rather than reported. */
export const isBlankLink = (link: ProfileLink) => !link.label.trim() && !link.url.trim();
export const cleanLinks = (links: readonly ProfileLink[]): ProfileLink[] => links.filter((link) => !isBlankLink(link)).map((link) => ({ label: link.label.trim(), url: link.url.trim() }));

/** Problems per row of the draft, in row order (blank rows have none). Empty array means every kept row is valid. */
export function linkIssues(links: readonly ProfileLink[]): RowIssues[] {
  return links.map((link) => {
    if (isBlankLink(link)) return {};
    const label = link.label.trim(), issues: RowIssues = {};
    if (!label) issues.label = "labelRequired"; else if (label.length > maxLinkLabel) issues.label = "labelTooLong";
    const url = urlIssue(link.url);
    if (url) issues.url = url;
    return issues;
  });
}
export const hasLinkIssues = (issues: readonly RowIssues[]) => issues.some((row) => row.label || row.url);

/** Moves the row at `from` by `step` places (-1 up, +1 down); out-of-range moves return the list unchanged. */
export function moveLink<T>(links: readonly T[], from: number, step: -1 | 1): T[] {
  const to = from + step, next = [...links];
  if (from < 0 || from >= links.length || to < 0 || to >= links.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export type ProfileVisibility = "members" | "unlisted" | "private";
export const profileVisibilities: readonly ProfileVisibility[] = ["members", "unlisted", "private"];
export type ProfileDraft = { displayName: string; bio: string; language: string; links: ProfileLink[]; visibility: ProfileVisibility };

/** What the server stores for a draft: trimmed text, empty as null, blank link rows removed. */
export function normalizeDraft(draft: ProfileDraft) {
  const text = (value: string) => value.trim() || null;
  return { displayName: text(draft.displayName), bio: text(draft.bio), language: text(draft.language), links: cleanLinks(draft.links), visibility: draft.visibility };
}
/** True when saving the draft would change what is stored. */
export function isDirty(saved: ProfileDraft, draft: ProfileDraft) {
  return JSON.stringify(normalizeDraft(saved)) !== JSON.stringify(normalizeDraft(draft));
}
