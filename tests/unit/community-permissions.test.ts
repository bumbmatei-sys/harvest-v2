import { expect, it } from "vitest";
import { communityCan, communityRoles } from "../../src/lib/community-permissions";
import { can } from "../../src/lib/permissions";

it("gives every community role read and post, and nobody outside the roles", () => {
  for (const role of communityRoles) { expect(communityCan(role, "community:read")).toBe(true); expect(communityCan(role, "community:post")).toBe(true); }
  expect(communityCan("guest", "community:read")).toBe(false);
});
it("limits moderation to owner, admin and moderator, settings to owner and admin, finance to owner", () => {
  expect(communityRoles.filter((r) => communityCan(r, "community:moderate"))).toEqual(["owner", "admin", "moderator"]);
  expect(communityRoles.filter((r) => communityCan(r, "community:manage_members"))).toEqual(["owner", "admin", "moderator"]);
  expect(communityRoles.filter((r) => communityCan(r, "community:manage_settings"))).toEqual(["owner", "admin"]);
  expect(communityRoles.filter((r) => communityCan(r, "community:finance"))).toEqual(["owner"]);
});
it("lets every ministry role read its communities and only owners/admins manage them", () => {
  expect(["owner", "admin", "member", "viewer"].map((r) => can(r, "communities:read"))).toEqual([true, true, true, true]);
  expect(["owner", "admin", "member", "viewer"].map((r) => can(r, "communities:manage"))).toEqual([true, true, false, false]);
});
