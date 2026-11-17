import type { Question } from "@/lib/questions";

// Editor preview (shell slice 3b): pure rules shared by the live preview, the editor and the tests. No React here.

/** Width at which the preview becomes a permanent column, and the width below which the preview and the assistant pane never both open. */
export const previewColumnMinWidth = 1280;
export const previewPaneTogetherMinWidth = 1600;
export type PreviewViewer = "visitor" | "member";
export type PreviewDevice = "phone" | "desktop";

export type SpaceInput = { width: number; previewOpen: boolean; paneOpen: boolean; lastOpened: "preview" | "pane" | null };
export type SpaceResult = { previewOpen: boolean; paneOpen: boolean; presentation: "column" | "sheet"; exclusive: boolean };
/**
 * Space rule (spec section 10a): the preview is a column from 1280px and a toggle/sheet below. Below 1600px the preview and the assistant
 * pane never both open: the one opened most recently wins, the other closes. From 1600px both may be open side by side. The pane does not
 * exist yet; the pane slice uses this helper so the rule is decided in one place.
 */
export function resolvePreviewSpace({ width, previewOpen, paneOpen, lastOpened }: SpaceInput): SpaceResult {
  const exclusive = width < previewPaneTogetherMinWidth;
  const presentation = width >= previewColumnMinWidth ? "column" : "sheet";
  if (!exclusive || !(previewOpen && paneOpen)) return { previewOpen, paneOpen, presentation, exclusive };
  return lastOpened === "pane" ? { previewOpen: false, paneOpen: true, presentation, exclusive } : { previewOpen: true, paneOpen: false, presentation, exclusive };
}

/** A trailing debounce with cancel; the preview uses it so typing does not re-render the frame on every keystroke. */
export function createDebouncer<T>(apply: (value: T) => void, wait: number, timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) }) {
  let pending: unknown = null;
  return {
    push(value: T) { if (pending !== null) timers.clear(pending); pending = timers.set(() => { pending = null; apply(value); }, wait); },
    cancel() { if (pending !== null) { timers.clear(pending); pending = null; } },
  };
}

// ---- Community: draft form state -> plain preview data ----
export type CommunityDraft = {
  name: string; tagline: string | null; description: string | null; rulesList: string[];
  joinQuestions: Question[];
  allowOpen: boolean; allowApply: boolean; allowInvite: boolean; allowEntitlement: boolean;
  welcomeMessage: string | null; introCategoryId: string | null;
};
export type CommunityPreviewData = {
  name: string; tagline: string | null; description: string | null; rulesList: string[];
  questions: CommunityDraft["joinQuestions"]; hostName: string;
  canJoin: boolean; apply: boolean; welcomeMessage: string | null; hasIntro: boolean;
};
/** The same rule the public page uses: an invitation, open joining or an application makes the join button available. */
export const communityCanJoin = (c: { invited?: boolean; allowOpen: boolean; allowApply: boolean }) => Boolean(c.invited) || c.allowOpen || c.allowApply;
const text = (value: string | null) => { const trimmed = value?.trim(); return trimmed ? trimmed : null; };
/** What the editor sends is what the preview shows: trimmed text, blank rules and blank question labels dropped. Never reads anything but the draft. */
export function communityPreviewData(draft: CommunityDraft, hostName: string): CommunityPreviewData {
  return {
    name: draft.name.trim(), tagline: text(draft.tagline), description: text(draft.description),
    rulesList: draft.rulesList.map((rule) => rule.trim()).filter(Boolean),
    questions: draft.joinQuestions.map((q) => ({ ...q, label: q.label.trim(), ...(q.options ? { options: q.options.map((o) => o.trim()).filter(Boolean) } : {}) })).filter((q) => q.label),
    hostName, canJoin: communityCanJoin(draft), apply: draft.allowApply, welcomeMessage: text(draft.welcomeMessage), hasIntro: Boolean(draft.introCategoryId),
  };
}

export type CommunityPreviewTab = "page" | "welcome";
export type CommunityField = "name" | "tagline" | "description" | "rules" | "questions" | "admission" | "welcome";
/** Where each preview element lives in the editor: the step that shows it and the id of the control to focus. */
export const communityFieldTargets: Record<CommunityField, { step: string; target: string }> = {
  name: { step: "basics", target: "community-name" },
  tagline: { step: "basics", target: "community-tagline" },
  description: { step: "basics", target: "community-description" },
  rules: { step: "joining", target: "community-rules-on" },
  questions: { step: "joining", target: "community-questions-on" },
  admission: { step: "joining", target: "community-allowOpen" },
  welcome: { step: "people", target: "community-welcome" },
};
/** Fields present in each preview variant, in reading order: they feed the keyboard "Edit this" list and the highlight map. */
export function communityPreviewFields(tab: CommunityPreviewTab, viewer: PreviewViewer): CommunityField[] {
  if (tab === "page") return ["name", "tagline", "description", "rules", "admission"];
  return viewer === "member" ? ["welcome", "rules"] : ["questions", "rules", "admission"];
}
export const isCommunityField = (value: string | null | undefined): value is CommunityField => Boolean(value) && value! in communityFieldTargets;
/** The preview element for a focused form control, so focusing a field highlights it in the preview. Null for controls that are not shown. */
export function fieldForControl(id: string): CommunityField | null {
  for (const field of Object.keys(communityFieldTargets) as CommunityField[]) if (communityFieldTargets[field].target === id) return field;
  if (id.startsWith("community-allow")) return "admission";
  return null;
}
