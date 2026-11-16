import { describe, expect, it } from "vitest";
import { checkSonnerBoundary, checkSources, inspectSonnerBoundary, inspectSource } from "../../scripts/source-guards";

describe("source guard regressions", () => {
  it.each([
    '<Button>Save</Button>', '<Input placeholder="Email" />', '<Button aria-label={ok ? "Save" : "Retry"} />',
    '<p>{`Hello ${name}`}</p>', '<p>{name ?? "Unknown"}</p>', 'setError("Could not save.")',
    'notify.success("Saved")', 'notify.error(t("failed"), { description: "Try again" })', 'toast.info(`Hello ${name}`)',
    'notify.success(t("x"), { action: { label: "Undo", onClick } })', 'toast.error(t("x"), { cancel: { label: "Cancel", onClick } })', 'notify.info(t("x"), { ...extra })',
  ])("rejects untranslated copy: %s", (source) => {
    expect(inspectSource(source).some((v) => v.rule === "i18n")).toBe(true);
  });
  it.each(['<p className="text-white" />', '<p className="dark:hover:bg-amber-500/80" />', '<p style={{color: "#fff"}} />', 'const color = "rgb(1 2 3)"', '<p className="border-t-slate-200" />'])
    ("rejects literal colors: %s", (source) => expect(inspectSource(source).some((v) => v.rule === "color")).toBe(true));
  it("allows catalogue toasts", () => {
    expect(inspectSource('notify.success(t("saved"), { description: t("help"), action: { label: t("undo"), onClick: undo } })')).toEqual([]);
  });
  it("allows catalogue action labels", () => {
    expect(inspectSource('notify.success(t("x"), { action: { label: t("undo"), onClick: undo }, description })')).toEqual([]);
  });
  it("confines the toast library to the adapter and helper", () => {
    const code = 'import { toast } from "sonner"; toast.warning(t("x"));';
    expect(inspectSonnerBoundary("src/components/foo.tsx", code)).toHaveLength(1);
    expect(inspectSonnerBoundary("scripts/foo.ts", 'import("sonner")')).toHaveLength(1);
    for (const file of ["src/lib/toast.ts", "src/components/ui/sonner.tsx"]) expect(inspectSonnerBoundary(file, code)).toEqual([]);
    expect(checkSonnerBoundary()).toEqual([]);
  });
  it("allows semantic tokens, translated copy and machine values", () => {
    expect(inspectSource('<Button className="bg-primary text-primary-foreground" aria-label={t("save")}>{t("save")}</Button>')).toEqual([]);
    expect(inspectSource('<p aria-current={active ? "page" : undefined}>{format.number(total)}</p>')).toEqual([]);
  });
  it("checks all application and shadcn source files", () => expect(checkSources()).toEqual([]));
});
