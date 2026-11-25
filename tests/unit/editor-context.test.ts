import { describe, expect, it } from "vitest";
import { editorContextKey, editorStepState, editorStepViews, stepMarkClass, stepMarkKind, stepPosition, type EditorContextData } from "@/lib/editor-context";
import { checklistStep, communityEditorSteps, publishChecklist, stepNeedsAttention } from "@/lib/community-editor";

const steps = [
  { id: "a", label: "A", state: "done" as const }, { id: "b", label: "B", state: "attention" as const },
  { id: "c", label: "C", state: "todo" as const }, { id: "d", label: "D", state: "disabled" as const, badge: "Soon" },
];

describe("editor step state", () => {
  it("disabled wins over done, done over attention, otherwise not started", () => {
    expect(editorStepState({ disabled: true, done: true, attention: true })).toBe("disabled");
    expect(editorStepState({ done: true, attention: true })).toBe("done");
    expect(editorStepState({ attention: true })).toBe("attention");
    expect(editorStepState({})).toBe("todo");
  });
  it("numbers every step, marks the current one and keeps disabled steps in order", () => {
    const views = editorStepViews(steps, "b");
    expect(views.map((v) => v.number)).toEqual([1, 2, 3, 4]);
    expect(views.map((v) => v.current)).toEqual([false, true, false, false]);
    expect(views.map((v) => v.selectable)).toEqual([true, true, true, false]);
    expect(views[3].badge).toBe("Soon");
  });
  it("reports Step n of m over all listed steps, and null for an unknown step", () => {
    expect(stepPosition(steps, "c")).toEqual({ current: 3, total: 4, label: "C" });
    expect(stepPosition(steps, "zzz")).toBeNull();
    expect(stepPosition([], "a")).toBeNull();
  });
});

describe("editor context registration data", () => {
  const data: EditorContextData = { title: "Grace", typeLabel: "Community", status: { kind: "draft", label: "Draft" }, back: { href: "/x", label: "Communities" }, steps, current: "a", stepsLabel: "Setup",
    openPage: { href: "/communities/grace", label: "Open page" }, dirty: false };
  it("is plain data: it survives a JSON round trip unchanged and has no functions", () => {
    expect(JSON.parse(editorContextKey(data))).toEqual(data);
    expect(editorContextKey(data)).not.toContain("function");
  });
  it("changes key when what the sidebar shows changes, and only then", () => {
    expect(editorContextKey({ ...data })).toBe(editorContextKey(data));
    expect(editorContextKey({ ...data, current: "b" })).not.toBe(editorContextKey(data));
    expect(editorContextKey({ ...data, dirty: true })).not.toBe(editorContextKey(data));
    expect(editorContextKey({ ...data, steps: steps.map((s) => ({ ...s })) })).toBe(editorContextKey(data));
  });
});

describe("community step attention", () => {
  const ok = { name: "Grace", visibility: "listed", allowOpen: true, allowApply: false, allowInvite: false, allowEntitlement: false };
  it("flags Basics without a name and Joining without a way to join", () => {
    expect(stepNeedsAttention("basics", publishChecklist({ ...ok, name: " " }), false)).toBe(true);
    expect(stepNeedsAttention("basics", publishChecklist(ok), false)).toBe(false);
    expect(stepNeedsAttention("joining", publishChecklist({ ...ok, allowOpen: false }), false)).toBe(true);
    expect(stepNeedsAttention("joining", publishChecklist(ok), false)).toBe(false);
  });
  it("flags Publish while anything is missing, never once published, and never the other steps", () => {
    expect(stepNeedsAttention("publish", publishChecklist({ ...ok, allowOpen: false }), false)).toBe(true);
    expect(stepNeedsAttention("publish", publishChecklist({ ...ok, allowOpen: false }), true)).toBe(false);
    expect(stepNeedsAttention("publish", publishChecklist(ok), false)).toBe(false);
    for (const id of communityEditorSteps.filter((s) => !["basics", "joining", "publish"].includes(s))) expect(stepNeedsAttention(id, publishChecklist({ ...ok, name: "", allowOpen: false }), false)).toBe(false);
  });
  it("links each missing item to the step that fixes it", () => {
    expect(checklistStep("name")).toBe("basics");
    expect(checklistStep("admission")).toBe("joining");
    expect(checklistStep("visibility")).toBe("joining");
  });
});

describe("step marker (state to icon and colour)", () => {
  it("draws a finished step as the green check, whether or not it is the current step", () => {
    expect(stepMarkKind({ state: "done", current: false })).toBe("done");
    expect(stepMarkKind({ state: "done", current: true })).toBe("done");
    expect(stepMarkClass.done).toContain("text-step-done");
    expect(stepMarkClass.done).toContain("border-step-done");
  });
  it("keeps the current step the filled primary circle and a step that needs input the alert mark", () => {
    expect(stepMarkKind({ state: "todo", current: true })).toBe("current");
    expect(stepMarkKind({ state: "attention", current: true })).toBe("attention");
    expect(stepMarkKind({ state: "attention", current: false })).toBe("attention");
    expect(stepMarkKind({ state: "todo", current: false })).toBe("todo");
    expect(stepMarkKind({ state: "disabled", current: false })).toBe("todo");
    expect(stepMarkKind({ state: "disabled", current: true })).toBe("todo");
  });
  it("only a done step is green", () => {
    for (const kind of ["attention", "current", "todo"] as const) expect(stepMarkClass[kind]).not.toContain("step-done");
  });
});
