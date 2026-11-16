import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { WizardLayout } from "../../src/components/wizard-layout";

// Drive the real event closures before a React state commit: two clicks from the same rendered frame.
// Refs retain their normal object semantics; visual rendering and translations are covered by form-parts.
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, vi.fn()], useEffect: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
function clickHandlers(node: ReactNode): (() => void)[] {
  if (Array.isArray(node)) return node.flatMap(clickHandlers);
  if (!isValidElement(node)) return [];
  const props = (node as ReactElement<{ onClick?: () => void; children?: ReactNode }>).props;
  return [...(props.onClick ? [props.onClick] : []), ...clickHandlers(props.children)];
}
function deferred() {
  let resolve!: (value?: never) => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function frame(onFinish: () => Promise<void>, validate?: () => Promise<boolean>, onStepChange = vi.fn()) {
  return clickHandlers(WizardLayout({ steps: [{ id: "a", label: "Details" }, { id: "b", label: "Review" }], current: "b", stepsLabel: "Steps", onStepChange, onFinish, validate, children: "Body" }));
}
describe("WizardLayout Finish pending guard", () => {
  it("suppresses a fast double click without busy and holds the guard through the entire save", async () => {
    const save = deferred(), onFinish = vi.fn(() => save.promise), onStepChange = vi.fn(), [back, finish] = frame(onFinish, undefined, onStepChange);
    finish(); finish(); back();
    expect(onFinish).toHaveBeenCalledTimes(1); expect(onStepChange).not.toHaveBeenCalled();
    await flush(); finish(); expect(onFinish).toHaveBeenCalledTimes(1);
    save.resolve(); await flush(); finish(); expect(onFinish).toHaveBeenCalledTimes(2);
  });
  it("holds the same guard across validation and save, with no validation-to-save gap", async () => {
    let allow!: (ok: boolean) => void;
    const validation = new Promise<boolean>((resolve) => { allow = resolve; });
    const save = deferred(), validate = vi.fn(() => validation), onFinish = vi.fn(() => save.promise), [, finish] = frame(onFinish, validate);
    finish(); finish(); expect(validate).toHaveBeenCalledTimes(1); expect(onFinish).not.toHaveBeenCalled();
    allow(true); await flush(); finish();
    expect(validate).toHaveBeenCalledTimes(1); expect(onFinish).toHaveBeenCalledTimes(1);
    save.resolve(); await flush();
  });
  it("allows retry after validation refuses the step", async () => {
    const validate = vi.fn(async () => false), onFinish = vi.fn(async () => {}), [, finish] = frame(onFinish, validate);
    finish(); await flush(); finish(); await flush();
    expect(validate).toHaveBeenCalledTimes(2); expect(onFinish).not.toHaveBeenCalled();
  });
});
