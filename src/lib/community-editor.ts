// Pure community-editor rules shared by the editor UI and the server (ADR 0013, C04).
export const communityEditorSteps = ["offer", "basics", "joining", "channels", "messages", "people", "products", "page", "publish"] as const;
export type CommunityEditorStep = typeof communityEditorSteps[number];
/** Steps whose slices have not shipped yet; shown disabled with "Coming soon". Products opens when the editor gets the C13/C16 shelf (free catalogue gate). */
export const comingSoonSteps: readonly CommunityEditorStep[] = ["messages", "products", "page"];

export type PublishFields = { name: string; visibility: string; allowOpen: boolean; allowApply: boolean; allowInvite: boolean; allowEntitlement: boolean };
export type ChecklistItem = { key: "name" | "admission" | "visibility"; done: boolean };

export function publishChecklist(c: PublishFields): ChecklistItem[] {
  return [
    { key: "name", done: c.name.trim().length > 0 },
    { key: "admission", done: c.allowOpen || c.allowApply || c.allowInvite || c.allowEntitlement },
    { key: "visibility", done: ["listed", "unlisted", "hidden"].includes(c.visibility) },
  ];
}
export const readyToPublish = (c: PublishFields) => publishChecklist(c).every((item) => item.done);

/** Which step lists a missing checklist item, so the Publish step can link to it. */
export const checklistStep = (key: ChecklistItem["key"]): CommunityEditorStep => key === "name" ? "basics" : "joining";
/** Steps that still need the owner's input: Basics without a name, Joining without a way to join, Publish while anything is missing. */
export function stepNeedsAttention(id: CommunityEditorStep, checklist: readonly ChecklistItem[], published: boolean): boolean {
  if (id === "basics") return checklist.some((item) => item.key === "name" && !item.done);
  if (id === "joining") return checklist.some((item) => item.key !== "name" && !item.done);
  if (id === "publish") return !published && checklist.some((item) => !item.done);
  return false;
}

/** Suggests a community address from its name until the person edits the address themselves. */
export const suggestSlug = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");

/** The address pattern the server and database enforce (2 to 48 characters, no leading or trailing hyphen). */
export const communitySlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
/**
 * Whether the address still follows the title. A draft follows its title until the owner edits the address (or it already differs from what
 * the title would give); a published community's address never follows it.
 */
export const slugFollowsName = (c: { slug: string; name: string; status: string; firstPublishedAt?: Date | string | null }) => !communityAddressLocked(c) && c.slug === suggestSlug(c.name);
/** The address is locked for good once the community has ever been published (0128 marker), unpublished since or not. */
export const communityAddressLocked = (c: { status: string; firstPublishedAt?: Date | string | null }) => c.status === "published" || c.firstPublishedAt != null;
/** The address after a title change: the suggestion when the address follows the title and the suggestion is a valid address, otherwise unchanged. */
export function nextSlug(current: string, name: string, follows: boolean) {
  const suggestion = suggestSlug(name);
  return follows && communitySlugPattern.test(suggestion) ? suggestion : current;
}
