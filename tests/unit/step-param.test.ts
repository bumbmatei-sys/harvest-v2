import { describe, expect, it } from "vitest";
import { resolveStepParam, stepParam, withStepParam } from "../../src/lib/step-param";

const steps = [{ id: "basics" }, { id: "joining" }, { id: "pricing", disabled: true }, { id: "publish" }];

describe("?step= deep links", () => {
  it("uses the step parameter name", () => expect(stepParam).toBe("step"));
  it("leaves the editor alone without a value", () => {
    expect(resolveStepParam(steps, null)).toEqual({ kind: "none" });
    expect(resolveStepParam(steps, undefined)).toEqual({ kind: "none" });
    expect(resolveStepParam(steps, "")).toEqual({ kind: "none" });
  });
  it("opens a known step that is not locked, including the first one", () => {
    expect(resolveStepParam(steps, "joining")).toEqual({ kind: "open", id: "joining" });
    expect(resolveStepParam(steps, "basics")).toEqual({ kind: "open", id: "basics" });
    expect(resolveStepParam(steps, "publish")).toEqual({ kind: "open", id: "publish" });
  });
  it("falls back for a locked step", () => expect(resolveStepParam(steps, "pricing")).toEqual({ kind: "fallback" }));
  it("falls back for an unknown, differently cased, padded or oversized value", () => {
    for (const raw of ["nope", "Joining", " joining", "joining ", "joining/x", "__proto__", "toString", "x".repeat(65)]) expect(resolveStepParam(steps, raw)).toEqual({ kind: "fallback" });
  });
  it("falls back when the editor has no steps", () => expect(resolveStepParam([], "basics")).toEqual({ kind: "fallback" }));
  it("sets, replaces and removes the parameter and keeps the rest of the address", () => {
    const base = "https://harvest.test/workspaces/t/communities/c/edit";
    expect(withStepParam(base, "joining")).toBe(`${base}?step=joining`);
    expect(withStepParam(`${base}?step=basics&tab=2#top`, "publish")).toBe(`${base}?step=publish&tab=2#top`);
    expect(withStepParam(`${base}?tab=2&step=basics`, null)).toBe(`${base}?tab=2`);
    expect(withStepParam(base, null)).toBe(base);
  });
  it("encodes ids so they cannot add parameters", () => {
    expect(new URL(withStepParam("https://harvest.test/e", "a&b=c")).searchParams.get("step")).toBe("a&b=c");
  });
});
