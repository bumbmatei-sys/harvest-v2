import { describe, expect, it } from "vitest";
import { checkSources, inspectSource } from "../../scripts/source-guards";

describe("source guard regressions", () => {
  it.each([
    '<Button>Save</Button>', '<Input placeholder="Email" />', '<Button aria-label={ok ? "Save" : "Retry"} />',
    '<p>{`Hello ${name}`}</p>', '<p>{name ?? "Unknown"}</p>', 'setError("Could not save.")',
  ])("rejects untranslated copy: %s", (source) => {
    expect(inspectSource(source).some((v) => v.rule === "i18n")).toBe(true);
  });
  it.each(['<p className="text-white" />', '<p className="dark:hover:bg-amber-500/80" />', '<p style={{color: "#fff"}} />', 'const color = "rgb(1 2 3)"', '<p className="border-t-slate-200" />'])
    ("rejects literal colors: %s", (source) => expect(inspectSource(source).some((v) => v.rule === "color")).toBe(true));
  it("allows semantic tokens, translated copy and machine values", () => {
    expect(inspectSource('<Button className="bg-primary text-primary-foreground" aria-label={t("save")}>{t("save")}</Button>')).toEqual([]);
    expect(inspectSource('<p aria-current={active ? "page" : undefined}>{format.number(total)}</p>')).toEqual([]);
  });
  it("checks all application and shadcn source files", () => expect(checkSources()).toEqual([]));
});
