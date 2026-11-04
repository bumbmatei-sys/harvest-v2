import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { actionForeground, contrastRatio, resolveBrandTheme, themeBootstrap } from "../../src/lib/theme";
import { contactInput } from "../../src/lib/contact-input";
import { can } from "../../src/server/permissions";
describe("appearance precedence and pre-paint script", () => {
  it.each([
    [null, null, "harvest"], [null, "studio", "studio"], ["harvest", "studio", "harvest"],
    ["studio", "harvest", "studio"], ["invalid", "studio", "studio"], ["invalid", "invalid", "harvest"],
  ])("resolves user %s and workspace %s", (user, workspace, expected) => {
    expect(resolveBrandTheme(user, workspace)).toBe(expected);
  });
  it.each([false, true])("initializes both axes before hydration with blocked storage = %s", (blocked) => {
    const root = { dataset: {} as Record<string, string>, classList: { toggle: () => {} } };
    runInNewContext(themeBootstrap("studio"), { document: { documentElement: root }, localStorage: { getItem: () => { if (blocked) throw new Error("blocked"); return null; } }, matchMedia: () => ({ matches: true }) });
    expect(root.dataset).toMatchObject({ workspaceTheme: "studio", brandTheme: "studio", theme: "dark" });
  });
  it("preserves the documented AA contrast at rest and hover", () => {
    expect(contrastRatio("#C9963A", "#2D2519")).toBeGreaterThan(5.6);
    expect(contrastRatio("#CEA04E", "#2D2519")).toBeGreaterThan(6.2);
    expect(actionForeground("#C9963A")).toBe("#2D2519");
    expect(actionForeground("#1A1A1A")).toBe("#FFFFFF");
    expect(() => contrastRatio("red", "#FFFFFF")).toThrow();
  });
});
describe("contact input and permissions", () => {
  it("normalizes identifiers without merging contacts", () => {
    expect(contactInput.parse({ name: " Person ", email: "Person@EXAMPLE.test", phone: "+49 (123) 456-7890" })).toMatchObject({ name: "Person", email: "person@example.test", phone: "+491234567890" });
    expect(contactInput.safeParse({ name: "Person", tenantId: "injected" }).success).toBe(false);
    expect(contactInput.safeParse({ name: "Person", phone: "12345" }).success).toBe(false);
    expect(contactInput.safeParse({ name: " " }).success).toBe(false);
  });
  it("permits member contact writes, viewer reads and admin settings", () => {
    expect(can("member", "contacts:write")).toBe(true);
    expect(can("viewer", "contacts:read")).toBe(true);
    expect(can("viewer", "contacts:write")).toBe(false);
    expect(can("member", "settings:write")).toBe(false);
    expect(can("admin", "settings:write")).toBe(true);
    expect(can("unknown", "contacts:read")).toBe(false);
  });
});
