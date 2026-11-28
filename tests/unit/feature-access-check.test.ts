import { expect, it } from "vitest";
import { canAccessFeature, featureAccessFor } from "../../src/server/feature-access";

it("binds the grant to the verified ministry and keeps manage above view", () => {
  const member = { tenantId: "ministry", access: "collaborator;crm=view;campaigns=manage" };
  expect(canAccessFeature("ministry", member, "crm", "view")).toBe(true);
  expect(canAccessFeature("ministry", member, "crm", "manage")).toBe(false);
  expect(canAccessFeature("ministry", member, "campaigns", "view")).toBe(true);
  expect(canAccessFeature("ministry", member, "social", "view")).toBe(false);
  expect(canAccessFeature("elsewhere", { ...member, access: "owner" }, "crm", "manage")).toBe(false);
  expect(canAccessFeature("ministry", { ...member, access: "admin" }, "social", "manage")).toBe(true);
  expect(canAccessFeature("ministry", { ...member, access: "guest" }, "crm", "view")).toBe(false);
  expect(featureAccessFor("campaigns:write")).toEqual({ key: "campaigns", level: "manage" });
  expect(featureAccessFor("contacts:erase")).toBeNull();
});

it("filters catalog entries for a collaborator without the catalog grant", async () => {
  const { resolveModeNavigation } = await import("../../src/lib/navigation");
  const request = { tenantId: "ministry", pathname: "/", mode: "public" as const, features: ["catalog", "social"] as const };
  const ids = (role: string) => resolveModeNavigation({ ...request, role }).groups.flatMap((group) => group.items.map((item) => item.id));
  expect(ids("collaborator;social=manage")).toContain("planner");
  expect(ids("collaborator;social=manage")).not.toContain("courses");
  expect(ids("collaborator;catalog=view")).toEqual(expect.arrayContaining(["courses", "products"]));
  expect(ids("guest")).toEqual([]);
});
