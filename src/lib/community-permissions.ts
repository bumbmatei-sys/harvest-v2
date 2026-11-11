// Pure community role → capability rules (ADR 0013 §5). Server code checks capabilities, never role names.
export const communityRoles = ["owner", "admin", "moderator", "contributor", "member"] as const;
export type CommunityRole = typeof communityRoles[number];
export type CommunityCapability = "community:read" | "community:post" | "community:moderate"
  | "community:manage_members" | "community:manage_settings" | "community:finance";
/** Roles that run the community; they keep access without a separate grant while their membership is active. */
export const communityStaffRoles: readonly CommunityRole[] = ["owner", "admin", "moderator", "contributor"];

export function communityCan(role: string, capability: CommunityCapability): boolean {
  switch (capability) {
    case "community:read": case "community:post": return (communityRoles as readonly string[]).includes(role);
    case "community:moderate": case "community:manage_members": return role === "owner" || role === "admin" || role === "moderator";
    case "community:manage_settings": return role === "owner" || role === "admin";
    // Finance is owner-only until a billing-manager delegation exists.
    case "community:finance": return role === "owner";
  }
}
