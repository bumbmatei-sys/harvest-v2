import { describe, expect, it } from "vitest";
import { can, requirePermission } from "../../src/server/permissions";
import { payments } from "../../src/server/payments";
describe("workspace permission matrix", () => {
  it.each(["owner", "admin"])("permits %s to manage members and roles", (role) => {
    expect(can(role, "members:write")).toBe(true); expect(can(role, "roles:write")).toBe(true);
  });
  it.each(["member", "viewer"])("permits %s to read but prevents sensitive writes", (role) => {
    expect(can(role, "workspace:read")).toBe(true); expect(() => requirePermission(role, "members:write")).toThrow();
  });
  it("fails closed for unknown roles", () => { expect(can("superadmin", "workspace:read")).toBe(false); });
  it("keeps payment integration unavailable", async () => { await expect(payments.createCheckout({ tenantId: "test", priceId: "test", returnUrl: "https://example.test" })).rejects.toThrow("not available"); });
});
import { can as libCan, roleIds as libRoleIds } from "../../src/lib/permissions";
import { roleIds } from "../../src/server/permissions";
describe("shared permission rules", () => {
  it("server and client use the same rule function and roles", () => {
    expect(can).toBe(libCan);
    expect(roleIds).toBe(libRoleIds);
  });
  it("keeps imports for writers only", () => {
    expect(["owner", "admin", "member", "viewer"].map((role) => libCan(role, "crm:import"))).toEqual([true, true, true, false]);
  });
});

describe("social provider permissions", () => {
  const keys = ["social:connect", "social:schedule", "social:inbox"] as const;
  it("are owner/admin only, and unknown roles are denied", () => {
    for (const key of keys) {
      expect(["owner", "admin", "member", "viewer"].map((role) => libCan(role, key)), key).toEqual([true, true, false, false]);
      for (const role of ["superadmin", "", "OWNER", "guest"]) expect(libCan(role, key), `${role} ${key}`).toBe(false);
    }
  });
});
