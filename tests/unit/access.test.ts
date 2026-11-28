import { describe, expect, it } from "vitest";
import { can, legacyRules } from "../../src/lib/permissions";
import { everyPermission, parseRoleToken, permissionArea, roleToken, withinGrants } from "../../src/lib/access-areas";
import { resolveModeNavigation } from "../../src/lib/navigation";

// A frozen copy of the rules as they were before per-feature access. The new `can` must equal it for every legacy role and unknown role.
function frozen(role: string, p: string): boolean {
  const all = ["owner", "admin", "member", "viewer"];
  if (["communities:read", "workspace:read", "contacts:read", "companies:read", "opportunities:read", "tasks:read", "notes:read", "campaigns:read", "docs:read", "catalog:read"].includes(p)) return all.includes(role);
  if (p === "newsletter:read") return ["owner", "admin", "member"].includes(role);
  if (["followup:work", "contacts:record_withdrawal", "crm:reports", "docs:write", "contacts:write", "companies:write", "opportunities:write", "tasks:write", "notes:write", "campaigns:write", "crm:import", "crm:export"].includes(p)) return ["owner", "admin", "member"].includes(role);
  if (p === "social:approvals_settings") return role === "owner";
  return role === "owner" || role === "admin";
}
const addedPermissions = new Set(["volunteers:participate", "volunteers:manage", "payments:finance", "payments:manage"]);

describe("feature access, code capabilities", () => {
  it("keeps every legacy role and unknown role exactly as before", () => {
    for (const role of ["owner", "admin", "member", "viewer", "superadmin", "", "OWNER"]) for (const p of everyPermission.filter(p => !addedPermissions.has(p))) expect(can(role, p), `${role} ${p}`).toBe(frozen(role, p));
    expect(legacyRules("member", "crm:import")).toBe(true);
  });
  it("keeps volunteer participation and payout-account permissions distinct", () => {
    expect(can("member", "volunteers:participate")).toBe(true);
    expect(can("member", "volunteers:manage")).toBe(false);
    expect(can("admin", "volunteers:manage")).toBe(true);
    expect(can(roleToken("collaborator", { volunteers: "view" }), "volunteers:manage")).toBe(false);
    const coordinator = roleToken("collaborator", { volunteers: "manage" });
    expect(can(coordinator, "volunteers:manage")).toBe(true);
    expect(can(coordinator, "payments:finance")).toBe(false);
    expect(can("admin", "payments:finance")).toBe(true);
    expect(can("admin", "payments:manage")).toBe(false);
    expect(can("owner", "payments:manage")).toBe(true);
  });
  it("maps every permission to an area (exhaustive at compile time)", () => { expect(everyPermission.length).toBe(Object.keys(permissionArea).length); });
  it("collaborator with Social manage holds social and nothing else", () => {
    const r = roleToken("collaborator", { social: "manage" });
    for (const p of everyPermission) {
      const area = permissionArea[p];
      const expected = p === "workspace:read" || (area === "social" && p !== "social:approvals_settings");
      expect(can(r, p), p).toBe(expected);
    }
  });
  it("view is the read-only rule; no grant is nothing; owner/admin-only stays out of manage", () => {
    const view = roleToken("collaborator", { crm: "view" });
    expect(can(view, "contacts:read")).toBe(true); expect(can(view, "contacts:write")).toBe(false);
    const crm = roleToken("collaborator", { crm: "manage" });
    for (const p of ["contacts:erase", "contacts:attest_consent", "crm:export_sensitive", "webhooks:manage", "members:write", "roles:write", "contacts:merge"] as const) expect(can(crm, p), p).toBe(false);
    expect(can(crm, "contacts:write")).toBe(true); expect(can("collaborator", "contacts:read")).toBe(false);
  });
  it("guests and campaign guests hold workspace:read and docs:read only; tokens fail closed", () => {
    for (const role of ["guest", "campaign_guest"]) for (const p of everyPermission) expect(can(role, p)).toBe(p === "workspace:read" || p === "docs:read");
    expect(parseRoleToken("collaborator;crm=admin;bogus=manage;social=view").grants).toEqual({ social: "view" });
    expect(can("collaboratorX", "contacts:read")).toBe(false);
  });
  it("nobody grants more than they hold", () => {
    expect(withinGrants({ crm: "manage" }, { crm: "view" })).toBe(false);
    expect(withinGrants({ crm: "view" }, { crm: "manage" })).toBe(true);
    expect(withinGrants({ crm: "manage", social: "view" }, "admin")).toBe(true);
  });
  it("navigation hides what the viewer cannot reach", () => {
    const features = ["social", "newsletter", "office", "docs", "communities", "linkInBio", "events", "newsletterAutomations"] as const;
    const ids = (role: string) => [...resolveModeNavigation({ tenantId: "t", role, pathname: "/", mode: "public", features }).groups, ...resolveModeNavigation({ tenantId: "t", role, pathname: "/", mode: "operations", features }).groups].flatMap((g) => g.items.map((i) => i.id));
    const social = ids(roleToken("collaborator", { social: "manage" }));
    expect(social).toContain("planner"); expect(social).toContain("inbox");
    for (const hidden of ["people", "ministrySettings", "files", "crmReports", "newsletterCampaigns", "linkInBio", "mail", "documents"]) expect(social).not.toContain(hidden);
    expect(ids("guest")).toEqual(["documents"]); // shared docs only
    expect(ids("admin").length).toBeGreaterThan(ids(roleToken("collaborator", { social: "manage" })).length);
  });
});
