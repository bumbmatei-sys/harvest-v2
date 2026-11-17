// Pure community role → capability rules (ADR 0013 §5). Server code checks capabilities, never role names.
export const communityRoles = ["owner", "admin", "moderator", "contributor", "member"] as const;
export type CommunityRole = typeof communityRoles[number];
export type CommunityCapability = "community:read" | "community:post" | "community:moderate"
  | "community:live:view" | "community:live:manage" | "community:live:moderate"
  | "chat:read" | "chat:post" | "chat:manage_channels" | "chat:moderate" | "chat:restore"
  | "community:manage_members" | "community:manage_settings" | "community:finance";
/** Roles that run the community; they keep access without a separate grant while their membership is active. */
export const communityStaffRoles: readonly CommunityRole[] = ["owner", "admin", "moderator", "contributor"];

export function communityCan(role: string, capability: CommunityCapability): boolean {
  switch (capability) {
    case "chat:read": case "chat:post": case "community:live:view": case "community:read": case "community:post": return (communityRoles as readonly string[]).includes(role);
    case "chat:moderate": case "community:live:moderate": case "community:moderate": case "community:manage_members": return role === "owner" || role === "admin" || role === "moderator";
    case "chat:restore": case "chat:manage_channels": case "community:live:manage": case "community:manage_settings": return role === "owner" || role === "admin";
    // Finance is owner-only until a billing-manager delegation exists.
    case "community:finance": return role === "owner";
  }
}
