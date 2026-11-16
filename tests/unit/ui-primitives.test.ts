import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

vi.mock("sonner", () => {
  const call = vi.fn();
  const toast = Object.assign(call, { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() });
  return { toast, Toaster: () => null };
});
import { toast } from "sonner";
import { notify } from "../../src/lib/toast";
import { Spinner } from "../../src/components/ui/spinner";
import { ScrollArea } from "../../src/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "../../src/components/ui/toggle-group";
import { Kbd, KbdGroup } from "../../src/components/ui/kbd";
import { sheetSideClasses } from "../../src/components/ui/sheet";

const render = (element: ReactElement) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, children: element }));

describe("spinner", () => {
  it("is an announced status with the catalogue label and stops rotating under reduced motion", () => {
    const html = render(h(Spinner));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading"');
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("size-4");
  });
  it("supports sizes, a custom label and a decorative mode that is hidden from assistive technology", () => {
    const large = render(h(Spinner, { size: "lg", label: "Saving" }));
    expect(large).toContain("size-6");
    expect(large).toContain('aria-label="Saving"');
    expect(render(h(Spinner, { size: "sm" }))).toContain("size-3");
    const decorative = render(h(Spinner, { decorative: true }));
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('role="status"');
    expect(decorative).not.toContain("aria-label");
  });
});

describe("toggle group", () => {
  const items = [h(ToggleGroupItem, { key: "a", value: "a", "aria-label": "A" }), h(ToggleGroupItem, { key: "b", value: "b", "aria-label": "B" })];
  it("single mode is a radio group with one pressed item and 44px phone targets", () => {
    const html = render(h(ToggleGroup, { type: "single", defaultValue: "a", "aria-label": "Mode" }, ...items));
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Mode"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("h-11");
    expect(html).toContain("min-w-11");
    expect(html).toContain("lg:h-9");
  });
  it("multiple mode uses pressed buttons, and the group variant reaches the items", () => {
    const html = render(h(ToggleGroup, { type: "multiple", variant: "outline", defaultValue: ["a", "b"] }, ...items));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain('data-variant="outline"');
  });
});

describe("kbd and scroll area", () => {
  it("renders semantic keys", () => {
    const html = render(h(KbdGroup, null, h(Kbd, null, "Ctrl"), h(Kbd, null, "K")));
    expect(html).toContain("<kbd");
    expect(html.match(/<kbd/g)).toHaveLength(2);
  });
  it("renders a viewport with caller-provided accessibility props", () => {
    const html = render(h(ScrollArea, { className: "h-20", viewportProps: { tabIndex: 0, role: "region", "aria-label": "List" } }, h("p", null, "Row")));
    expect(html).toContain('data-slot="scroll-area-viewport"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="List"');
  });
});

describe("bottom sheet", () => {
  it("adds a height cap, rounded top and safe-area padding to the bottom side only", () => {
    expect(sheetSideClasses.bottom).toContain("max-h-[85dvh]");
    expect(sheetSideClasses.bottom).toContain("rounded-t-xl");
    expect(sheetSideClasses.bottom).toContain("env(safe-area-inset-bottom)");
    for (const side of ["right", "left", "top"] as const) expect(sheetSideClasses[side]).not.toContain("safe-area");
  });
  it("keeps the existing side classes", () => {
    expect(sheetSideClasses.right).toContain("inset-y-0 right-0");
    expect(sheetSideClasses.left).toContain("inset-y-0 left-0");
    expect(sheetSideClasses.top).toContain("inset-x-0 top-0");
  });
});

describe("notify helper", () => {
  beforeEach(() => vi.clearAllMocks());
  it("maps each kind to the matching toast and passes the title through", () => {
    notify.success("Saved"); notify.error("Failed"); notify.info("Heads up");
    expect(toast.success).toHaveBeenCalledWith("Saved", {});
    expect(toast.error).toHaveBeenCalledWith("Failed", {});
    expect(toast.info).toHaveBeenCalledWith("Heads up", {});
  });
  it("passes description, id, duration and a single action", () => {
    const onClick = vi.fn();
    notify.success("Removed", { description: "One item", id: "x", duration: 9000, action: { label: "Undo", onClick } });
    expect(toast.success).toHaveBeenCalledWith("Removed", { description: "One item", id: "x", duration: 9000, action: { label: "Undo", onClick } });
  });
  it("dismisses by id or all", () => {
    notify.dismiss("x"); notify.dismiss();
    expect(toast.dismiss).toHaveBeenNthCalledWith(1, "x");
    expect(toast.dismiss).toHaveBeenNthCalledWith(2, undefined);
  });
});

describe("catalogue strings", () => {
  it("defines the spinner and toaster labels", () => {
    expect(messages.ComponentsUiSpinner.loading).toBeTruthy();
    expect(messages.ComponentsUiToaster.notifications).toBeTruthy();
    expect(messages.ComponentsUiToaster.close).toBeTruthy();
  });
});
