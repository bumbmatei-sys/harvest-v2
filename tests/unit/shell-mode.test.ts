import { describe, expect, it } from "vitest";
import { availableModes, displayMode, modeForShortcut, modeStorageKey, parseMode, readStoredMode, writeStoredMode } from "../../src/lib/shell-mode";
import { shellModesEnabled } from "../../src/server/shell-modes";

const keys = (code: string, extra: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, code, ...extra });

describe("shell mode choice", () => {
  it("accepts only known modes", () => {
    expect(["operations", "public", "assistant"].map(parseMode)).toEqual(["operations", "public", "assistant"]);
    expect([parseMode("admin"), parseMode(null), parseMode(3)]).toEqual([null, null, null]);
  });
  it("round-trips through storage and ignores bad or missing values", () => {
    const data = new Map<string, string>(); const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(readStoredMode(store)).toBeNull();
    writeStoredMode("public", store);
    expect(data.get(modeStorageKey)).toBe("public");
    expect(readStoredMode(store)).toBe("public");
    data.set(modeStorageKey, "nonsense");
    expect(readStoredMode(store)).toBeNull();
  });
  it("never throws when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readStoredMode(blocked)).toBeNull();
    expect(() => writeStoredMode("public", blocked)).not.toThrow();
  });
});

describe("shortcuts", () => {
  it.each([["Digit1", "operations"], ["Digit2", "public"], ["Digit3", "assistant"]])("Ctrl+Alt+%s and Cmd+Alt selects %s", (code, mode) => {
    expect(modeForShortcut(keys(code))).toBe(mode);
    expect(modeForShortcut(keys(code, { ctrlKey: false, metaKey: true }))).toBe(mode);
  });
  it("ignores AltGraph, which types characters on Windows layouts", () => {
    expect(modeForShortcut({ ...keys("Digit2"), getModifierState: (key: string) => key === "AltGraph" })).toBeNull();
    expect(modeForShortcut({ ...keys("Digit2"), getModifierState: () => false })).toBe("public");
  });
  it("ignores text-entry targets and the active element", () => {
    expect(modeForShortcut({ ...keys("Digit2"), target: { tagName: "INPUT" } })).toBeNull();
    expect(modeForShortcut({ ...keys("Digit2"), target: { tagName: "textarea" } })).toBeNull();
    expect(modeForShortcut({ ...keys("Digit2"), target: { tagName: "SELECT" } })).toBeNull();
    expect(modeForShortcut({ ...keys("Digit2"), target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
    expect(modeForShortcut({ ...keys("Digit2"), target: { tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "textbox" : null) } })).toBeNull();
    expect(modeForShortcut(keys("Digit2"), { tagName: "TEXTAREA" })).toBeNull();
    expect(modeForShortcut({ ...keys("Digit2"), target: { tagName: "BUTTON" } })).toBe("public");
  });
  it("ignores other combinations", () => {
    expect(modeForShortcut(keys("Digit4"))).toBeNull();
    expect(modeForShortcut(keys("Digit1", { altKey: false }))).toBeNull();
    expect(modeForShortcut(keys("Digit1", { ctrlKey: false }))).toBeNull();
    expect(modeForShortcut(keys("Digit1", { shiftKey: true }))).toBeNull();
    expect(modeForShortcut(keys("KeyB"))).toBeNull();
  });
});

describe("displayed mode", () => {
  const available = availableModes({ operations: true, public: true, assistant: false });
  it("lists available modes in switcher order", () => { expect(available).toEqual(["operations", "public"]); });
  it("uses the derived mode without a peek", () => { expect(displayMode({ derived: "public", peek: null, pathname: "/a", available })).toBe("public"); });
  it("lets a peek override the page's own mode on that page only", () => {
    expect(displayMode({ derived: "operations", peek: { mode: "public", pathname: "/a" }, pathname: "/a", available })).toBe("public");
    expect(displayMode({ derived: "operations", peek: { mode: "public", pathname: "/a" }, pathname: "/b", available })).toBe("operations");
  });
  it("never shows a mode without visible entries", () => {
    expect(displayMode({ derived: "assistant", peek: null, pathname: "/a", available })).toBe("operations");
    expect(displayMode({ derived: "operations", peek: { mode: "assistant", pathname: "/a" }, pathname: "/a", available })).toBe("operations");
  });
});

describe("shell modes flag", () => {
  it("is on outside production, off in production until enabled, and can be forced off", () => {
    expect(shellModesEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(shellModesEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(shellModesEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(shellModesEnabled({ NODE_ENV: "production", HARVEST_SHELL_MODES: "enabled" })).toBe(true);
    expect(shellModesEnabled({ NODE_ENV: "development", HARVEST_SHELL_MODES: "disabled" })).toBe(false);
    expect(shellModesEnabled({ NODE_ENV: "production", HARVEST_SHELL_MODES: "disabled" })).toBe(false);
  });
});
