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
