import { expect, it } from "vitest";
import { communityCanJoin, communityFieldTargets, communityPreviewData, communityPreviewFields, createDebouncer, fieldForControl, isCommunityField, resolvePreviewSpace, type CommunityDraft } from "../../src/lib/editor-preview";

const draft: CommunityDraft = { name: "  Grace Bible Study ", tagline: "  ", description: " Weekly study\nand prayer ", rulesList: [" Be kind ", "  ", "No spam"],
  joinQuestions: [{ id: "q1", type: "short", label: "  Why join? ", required: true }, { id: "q2", type: "choice", label: "  ", required: false, options: ["a"] }, { id: "q3", type: "choice", label: "Pick", required: false, options: [" a ", " ", "b"] }],
  allowOpen: false, allowApply: true, allowInvite: true, allowEntitlement: false, welcomeMessage: " Welcome! ", introCategoryId: null };

it("maps the draft to what the editor would send: trimmed text, blank rules and unlabeled questions dropped", () => {
  const data = communityPreviewData(draft, "Grace Church");
  expect(data).toMatchObject({ name: "Grace Bible Study", tagline: null, description: "Weekly study\nand prayer", rulesList: ["Be kind", "No spam"], hostName: "Grace Church", welcomeMessage: "Welcome!", hasIntro: false });
  expect(data.questions.map((q) => q.label)).toEqual(["Why join?", "Pick"]);
  expect(data.questions[1].options).toEqual(["a", "b"]);
  expect(communityPreviewData({ ...draft, introCategoryId: "cat" }, "h").hasIntro).toBe(true);
});
it("uses the public page's join rule: invitation, open or application; invite-only drafts show the closed state", () => {
  expect(communityCanJoin({ allowOpen: false, allowApply: false })).toBe(false);
  expect(communityCanJoin({ allowOpen: true, allowApply: false })).toBe(true);
  expect(communityCanJoin({ allowOpen: false, allowApply: true })).toBe(true);
  expect(communityCanJoin({ invited: true, allowOpen: false, allowApply: false })).toBe(true);
  expect(communityPreviewData({ ...draft, allowApply: false, allowInvite: true }, "h").canJoin).toBe(false);
  expect(communityPreviewData(draft, "h")).toMatchObject({ canJoin: true, apply: true });
});
it("maps every preview field to a step and a control, and a control back to its field", () => {
  for (const [field, { step, target }] of Object.entries(communityFieldTargets)) {
    expect(step).toBeTruthy(); expect(target).toMatch(/^community-/);
    expect(fieldForControl(target)).toBe(field);
    expect(isCommunityField(field)).toBe(true);
  }
  expect(communityFieldTargets.rules.step).toBe("joining");
  expect(communityFieldTargets.welcome.step).toBe("people");
  expect(fieldForControl("community-allowApply")).toBe("admission");
  expect(fieldForControl("community-address")).toBeNull();
  expect(isCommunityField("nope")).toBe(false); expect(isCommunityField(null)).toBe(false);
});
it("lists the fields each visitor and member variant shows", () => {
  expect(communityPreviewFields("page", "visitor")).toEqual(["name", "tagline", "description", "rules", "admission"]);
  expect(communityPreviewFields("page", "member")).toEqual(communityPreviewFields("page", "visitor"));
  expect(communityPreviewFields("welcome", "visitor")).toEqual(["questions", "rules", "admission"]);
  expect(communityPreviewFields("welcome", "member")).toEqual(["welcome", "rules"]);
});
it("space rule: column from 1280px; below 1600px the preview and the pane never both open (most recent wins); both from 1600px", () => {
  const both = { previewOpen: true, paneOpen: true };
  for (const width of [1100, 1279, 1280, 1440, 1599]) {
    expect(resolvePreviewSpace({ width, ...both, lastOpened: "pane" })).toMatchObject({ previewOpen: false, paneOpen: true, exclusive: true });
    expect(resolvePreviewSpace({ width, ...both, lastOpened: "preview" })).toMatchObject({ previewOpen: true, paneOpen: false });
    expect(resolvePreviewSpace({ width, ...both, lastOpened: null })).toMatchObject({ previewOpen: true, paneOpen: false });
  }
  expect(resolvePreviewSpace({ width: 1600, ...both, lastOpened: "pane" })).toMatchObject({ previewOpen: true, paneOpen: true, exclusive: false });
  expect(resolvePreviewSpace({ width: 1280, previewOpen: true, paneOpen: false, lastOpened: "preview" })).toMatchObject({ presentation: "column", previewOpen: true, paneOpen: false });
  expect(resolvePreviewSpace({ width: 1279, previewOpen: true, paneOpen: false, lastOpened: "preview" }).presentation).toBe("sheet");
  expect(resolvePreviewSpace({ width: 1440, previewOpen: false, paneOpen: true, lastOpened: "pane" })).toMatchObject({ previewOpen: false, paneOpen: true });
});
it("debounces to the last value and can be cancelled", () => {
  let now = 0; const queue: { at: number; fn: () => void; id: number }[] = []; let next = 1;
  const timers = { set: (fn: () => void, ms: number) => { const id = next++; queue.push({ at: now + ms, fn, id }); return id; }, clear: (id: unknown) => { const i = queue.findIndex((q) => q.id === id); if (i >= 0) queue.splice(i, 1); } };
  const advance = (ms: number) => { now += ms; for (const q of queue.filter((entry) => entry.at <= now)) { queue.splice(queue.indexOf(q), 1); q.fn(); } };
  const seen: string[] = [], debounce = createDebouncer<string>((v) => seen.push(v), 150, timers);
  debounce.push("a"); advance(100); debounce.push("ab"); advance(100); expect(seen).toEqual([]); advance(60); expect(seen).toEqual(["ab"]);
  debounce.push("abc"); debounce.cancel(); advance(500); expect(seen).toEqual(["ab"]);
});
