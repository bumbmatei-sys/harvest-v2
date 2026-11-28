import { hasFeatureGrant, permissionAreaOf, type AccessLevel } from "../lib/access-areas";
import { can, type Permission } from "../lib/permissions";
import type { NavEntry } from "../lib/navigation";

// The navigation registry's access keys are distinct from its deployment flags.
type Feature = NonNullable<NavEntry["area"]>;
type VerifiedMembership = { tenantId: string; access: string };

export function canAccessFeature(workspace: string, user: VerifiedMembership, feature: Feature, level: AccessLevel) {
  return workspace.toLowerCase() === user.tenantId && hasFeatureGrant(user.access, feature, level);
}

export function featureAccessFor(permission: Permission): { key: Feature; level: AccessLevel } | null {
  const key = permissionAreaOf(permission);
  switch (key) {
    case "crm":
    case "campaigns":
    case "communities":
    case "newsletter":
    case "social":
      return { key, level: can("viewer", permission) ? "view" : "manage" };
    default:
      return null;
  }
}
