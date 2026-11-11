// Pure community-editor rules shared by the editor UI and the server (ADR 0013, C04).
export const communityEditorSteps = ["offer", "basics", "joining", "channels", "messages", "people", "products", "page", "publish"] as const;
export type CommunityEditorStep = typeof communityEditorSteps[number];
/** Steps whose slices have not shipped yet; shown disabled with "Coming soon". */
export const comingSoonSteps: readonly CommunityEditorStep[] = ["channels", "messages", "products", "page"];

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
