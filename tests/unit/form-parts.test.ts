import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { Resolver } from "react-hook-form";
import messages from "../../messages/en.json";
import { adjacentStep, stepIndex, stepProgress, stepStates } from "../../src/lib/stepper";
import { harvestFormResolver, splitFailure } from "../../src/lib/form";
import { coveredByBar, isKeyboardOpen, saveBarStatus } from "../../src/lib/sticky-save-bar";
import { Stepper } from "../../src/components/stepper";
import { FormSection } from "../../src/components/form-section";
import { StickySaveBar } from "../../src/components/sticky-save-bar";
import { WizardLayout } from "../../src/components/wizard-layout";

const render = (element: ReactElement) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, children: element }));
const steps = [{ id: "a", label: "Details" }, { id: "b", label: "Audience" }, { id: "c", label: "Review" }];

describe("step helpers", () => {
  it("finds the current index and treats earlier steps as done only in a linear wizard", () => {
    expect(stepIndex(steps, "b")).toBe(1);
    expect(stepStates(steps, "b", true)).toEqual([{ state: "done", done: true }, { state: "active", done: false }, { state: "upcoming", done: false }]);
    expect(stepStates(steps, "b", false).map((item) => item.state)).toEqual(["upcoming", "active", "upcoming"]);
  });
  it("honours explicit done flags, including on the current step", () => {
    const flagged = [{ id: "a", done: true }, { id: "b", done: true }, { id: "c" }];
    expect(stepStates(flagged, "b", false)).toEqual([{ state: "done", done: true }, { state: "active", done: true }, { state: "upcoming", done: false }]);
    expect(stepStates(steps, "missing", true).every((item) => item.state === "upcoming")).toBe(true);
  });
  it("counts progress through the current step", () => {
    expect(stepProgress(0, 4)).toBe(25); expect(stepProgress(1, 4)).toBe(50); expect(stepProgress(3, 4)).toBe(100);
    expect(stepProgress(-1, 4)).toBe(0); expect(stepProgress(0, 0)).toBe(0);
  });
  it("moves to the next or previous enabled step and stops at the ends", () => {
    const withDisabled = [{ id: "a" }, { id: "b", disabled: true }, { id: "c" }];
    expect(adjacentStep(withDisabled, "a", 1)).toBe("c"); expect(adjacentStep(withDisabled, "c", -1)).toBe("a");
    expect(adjacentStep(withDisabled, "a", -1)).toBeNull(); expect(adjacentStep(withDisabled, "c", 1)).toBeNull();
  });
});

describe("form failure mapping", () => {
  it("preserves distinct schema input and output types in the resolver", () => {
    const schema = z.object({ count: z.string().transform(Number) });
    const resolver = harvestFormResolver(schema);
    expectTypeOf(resolver).toEqualTypeOf<Resolver<{ count: string }, unknown, { count: number }>>();
  });
  it("maps known fields, takes the first message of a list and keeps the form message", () => {
    expect(splitFailure({ message: "Not saved", fields: { name: ["Taken", "Other"], audience: "Pick one" } }, ["name", "audience"]))
      .toEqual({ fields: { name: "Taken", audience: "Pick one" }, form: "Not saved" });
  });
  it("never drops a message for a field the form does not have", () => {
    expect(splitFailure({ fields: { secret: "Something is wrong" } }, ["name"])).toEqual({ fields: {}, form: "Something is wrong" });
    expect(splitFailure({ message: "Top", fields: { secret: "Hidden" } }, ["name"]).form).toBe("Top");
    expect(splitFailure({ fields: { name: "  " } }, ["name"])).toEqual({ fields: {}, form: null });
    expect(splitFailure({}, ["name"])).toEqual({ fields: {}, form: null });
  });
  it("works with the zod 4 resolver: messages come from the schema", async () => {
    const schema = z.object({ name: z.string().trim().min(1, "Enter a ministry name."), audience: z.enum(["church"]).nullable().refine((value) => value !== null, "Choose a ministry type.") });
    const bad = await harvestFormResolver(schema)({ name: " ", audience: null }, undefined, { fields: {}, shouldUseNativeValidation: false });
    expect(Object.keys(bad.errors)).toEqual(["name", "audience"]); expect(bad.errors.name?.message).toBe("Enter a ministry name.");
    const good = await harvestFormResolver(schema)({ name: " Grace ", audience: "church" }, undefined, { fields: {}, shouldUseNativeValidation: false });
    expect(good.errors).toEqual({}); expect(good.values).toEqual({ name: "Grace", audience: "church" });
  });
});

describe("save bar helpers", () => {
  it("detects the keyboard from a much shorter visual viewport", () => {
    expect(isKeyboardOpen(800, 790)).toBe(false); expect(isKeyboardOpen(800, 480)).toBe(true); expect(isKeyboardOpen(800, 640, 100)).toBe(true);
  });
  it("announces saving over unsaved, and nothing for a clean form", () => {
    expect(saveBarStatus(false, false)).toBeNull(); expect(saveBarStatus(true, false)).toBe("unsaved"); expect(saveBarStatus(true, true)).toBe("saving"); expect(saveBarStatus(false, true)).toBe("saving");
  });
  it("scrolls a control that sits under the bar", () => {
    expect(coveredByBar({ bottom: 700 }, { top: 650 })).toBe(true); expect(coveredByBar({ bottom: 500 }, { top: 650 })).toBe(false); expect(coveredByBar({ bottom: 645 }, { top: 650 })).toBe(true);
  });
});

describe("Stepper", () => {
  it("wizard layout: a named ordered list, aria-current on the current step, states as text, and a compact phone summary", () => {
    const html = render(h(Stepper, { steps, current: "b", label: "Create steps" }));
    expect(html).toContain('<ol aria-label="Create steps"');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('<li aria-current="step"');
    for (const text of ["Completed", "Current step", "Upcoming"]) expect(html).toContain(`<span class="sr-only">${text}</span>`);
    expect(html).toContain("Step 2 of 3"); expect(html).toContain('role="progressbar"'); expect(html).toContain('aria-valuenow="67"'); expect(html).toContain("md:hidden");
    expect(html).toContain("hidden md:flex"); expect(html).toContain("motion-reduce:transition-none");
  });
  it("keeps the full list on phones with compact=never", () => {
    const html = render(h(Stepper, { steps, current: "a", label: "Create steps", compact: "never" }));
    expect(html).not.toContain("Step 1 of 3"); expect(html).not.toContain("hidden md:flex"); expect(html).not.toContain('role="progressbar"');
  });
  it("nav layout: a named navigation of buttons with 44px phone targets, disabled steps and badges", () => {
    const html = render(h(Stepper, { layout: "nav", steps: [{ id: "a", label: "Basics", done: true }, { id: "b", label: "Joining" }, { id: "c", label: "Messages", disabled: true, badge: "Soon" }], current: "b", label: "Setup", onSelect: () => undefined }));
    expect(html).toContain('<nav aria-label="Setup"'); expect(html.match(/<button/g)).toHaveLength(3);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1); expect(html).toContain('aria-disabled="true"'); expect(html).toContain("min-h-11"); expect(html).toContain("Soon");
    expect(html).toContain("Completed");
  });
});

describe("FormSection", () => {
  it("is a region named by its heading, with an optional description wired to it", () => {
    const html = render(h(FormSection, { title: "Details", description: "One line.", children: h("input", { "aria-label": "x" }) }));
    expect(html).toMatch(/<section[^>]*aria-labelledby="([^"]+)-title"/); expect(html).toContain("<h3"); expect(html).toContain("One line."); expect(html).toMatch(/aria-describedby="[^"]+-description"/);
    expect(render(h(FormSection, { title: "Details", children: "x" }))).not.toContain("aria-describedby");
  });
  it("fieldset: the legend is the first child, always stacked", () => {
    const html = render(h(FormSection, { as: "fieldset", title: "Visibility", layout: "split", children: "x" }));
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>Visibility<\/legend>/); expect(html).not.toContain("lg:grid-cols");
  });
  it("split layout and actions render on a section", () => {
    const html = render(h(FormSection, { title: "T", layout: "split", divided: true, actions: h("button", null, "Act"), children: "x" }));
    expect(html).toContain("lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"); expect(html).toContain("border-t"); expect(html).toContain("Act");
  });
});

describe("StickySaveBar", () => {
  const bar = (props: Partial<Parameters<typeof StickySaveBar>[0]> = {}) => render(h(StickySaveBar, { dirty: false, onDiscard: () => undefined, guard: false, ...props }));
  it("renders only the live region while clean", () => {
    const html = bar();
    expect(html).not.toContain('data-slot="sticky-save-bar"'); expect(html).toContain('role="status"'); expect(html).toContain('aria-live="polite"');
  });
  it("shows Save and Discard with safe-area padding while dirty, and announces it", () => {
    const html = bar({ dirty: true, onSave: () => undefined });
    expect(html).toContain('data-slot="sticky-save-bar"'); expect(html).toContain("sticky bottom-2"); expect(html).toContain("env(safe-area-inset-bottom)");
    expect(html).toContain(">Save<"); expect(html).toContain(">Discard<"); expect(html).toContain('class="sr-only">Unsaved changes</p>');
  });
  it("busy: Save is aria-disabled with the saving label, and Discard is blocked", () => {
    const html = bar({ dirty: true, busy: true, savingLabel: "Saving draft" });
    expect(html).toContain("Saving draft"); expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(2); expect(html).toContain('class="sr-only">Saving…</p>');
  });
  it("a form id makes Save a submit button for that form, and labels can be replaced", () => {
    const html = bar({ dirty: true, form: "settings", saveLabel: "Save draft" });
    expect(html).toContain('type="submit"'); expect(html).toContain('form="settings"'); expect(html).toContain("Save draft");
  });
  it("stays visible while busy even when no longer dirty", () => { expect(bar({ dirty: false, busy: true })).toContain('data-slot="sticky-save-bar"'); });
});

describe("WizardLayout", () => {
  const wizard = (props: Partial<Parameters<typeof WizardLayout>[0]> = {}) => render(h(WizardLayout, { steps, current: "a", stepsLabel: "Steps", onStepChange: () => undefined, children: h("p", null, "Body"), ...props }));
  it("first step: heading, stepper, content and Next only", () => {
    const html = wizard();
    expect(html).toContain('data-slot="wizard-heading"'); expect(html).toContain('tabindex="-1"'); expect(html).toContain(">Details</h2>"); expect(html).toContain("Body");
    expect(html).toContain('aria-label="Steps"'); expect(html).toContain(">Next<"); expect(html).not.toContain(">Back<"); expect(html).not.toContain(">Finish<");
  });
  it("middle step has Back and Next; the last has Back and Finish only with onFinish", () => {
    expect(wizard({ current: "b" })).toContain(">Back<");
    const last = wizard({ current: "c", onFinish: () => undefined });
    expect(last).toContain(">Finish<"); expect(last).not.toContain(">Next<");
    expect(wizard({ current: "c" })).not.toContain(">Finish<");
  });
  it("can hide its stepper, replace labels and show an error alert", () => {
    const html = wizard({ stepper: false, current: "b", backLabel: "Previous", nextLabel: "Continue", error: "Fix this" });
    expect(html).not.toContain('data-slot="stepper"'); expect(html).toContain(">Previous<"); expect(html).toContain(">Continue<"); expect(html).toContain('role="alert"'); expect(html).toContain("Fix this");
  });
  it("busy shows the working label and aria-disabled on the primary button", () => {
    const html = wizard({ busy: true });
    expect(html).toContain("Please wait…"); expect(html).toContain('aria-disabled="true"');
  });
});
