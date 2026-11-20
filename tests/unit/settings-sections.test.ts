import { describe, expect, it } from "vitest";
import { openSection, resolveSettingsSections, settingsGroups, settingsSectionIds, settingsViewer, type SettingsViewer } from "../../src/lib/settings-sections";

const viewer = (role: string | undefined, over: { hasMinistry?: boolean; features?: SettingsViewer["features"]; communities?: boolean } = {}) =>
  settingsViewer({ role, hasMinistry: over.hasMinistry ?? true, features: over.features ?? ["social"], settings: { communities: over.communities === false ? undefined : [] } });
const ids = (v: SettingsViewer) => resolveSettingsSections(v).map((section) => section.id);

describe("settings sections by role", () => {
  it.each(["owner", "admin"])("shows You and Ministry to %s", (role) => {
    expect(ids(viewer(role))).toEqual(["profile", "account", "ministry", "connections", "crm"]);
  });
  it.each(["member", "viewer"])("shows only You to %s", (role) => {
    expect(ids(viewer(role))).toEqual(["profile", "account"]);
  });
  it("shows only You when no ministry is open (the profile page, the ministry list)", () => {
    expect(ids(viewer("owner", { hasMinistry: false }))).toEqual(["profile", "account"]);
    expect(ids(viewer(undefined, { hasMinistry: false }))).toEqual(["profile", "account"]);
  });
  it("hides Profile while the member-profile routes are off, and Connections while Social is off", () => {
    expect(ids(viewer("owner", { communities: false }))).not.toContain("profile");
    expect(ids(viewer("owner", { features: [] }))).toEqual(["profile", "account", "ministry", "crm"]);
  });
  it("lists no section that has no screen yet (Privacy and data, Billing)", () => {
    expect(settingsSectionIds).toEqual(["profile", "account", "ministry", "connections", "crm"]);
    expect(settingsGroups).toEqual(["you", "ministry"]);
  });
  it("gives every section its own icon and puts the groups in order", () => {
    const sections = resolveSettingsSections(viewer("owner"));
    expect(new Set(sections.map((section) => section.icon)).size).toBe(sections.length);
    expect(sections.map((section) => section.group)).toEqual(["you", "you", "ministry", "ministry", "ministry"]);
  });
});

describe("deep link", () => {
  const sections = resolveSettingsSections(viewer("member"));
  it("stays closed without a settings parameter", () => { expect(openSection(null, sections)).toBeNull(); });
  it("opens the named section the viewer may see", () => { expect(openSection("account", sections)).toBe("account"); });
  it("falls back to the first available section for an unknown or forbidden one", () => {
    expect(openSection("connections", sections)).toBe("profile");
    expect(openSection("", sections)).toBe("profile");
    expect(openSection("nope", sections)).toBe("profile");
  });
});
