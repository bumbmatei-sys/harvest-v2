// Per-feature access: the areas an account owner can give someone, the levels, which capability belongs to which area, and the role token.
// Pure (type-only import of Permission), so server code, navigation and client components share one source of truth.
// The database side is ONE function, public.access_role(tenant, user, area, role, read), which maps a stored role plus these grants to
// the role every module check already understands. `docs/acceptance/feature-access-server.md` is the checklist.
import type { Permission } from "./permissions";

/** The founder's list (25 Nov). Code says "area" because `feature` already means an activation flag in the navigation registry. */
export const accessAreas = ["crm", "giving", "campaigns", "communities", "catalog", "social", "newsletter", "website", "office", "connect", "settings", "volunteers"] as const;
export type AccessArea = typeof accessAreas[number];
export const accessLevels = ["view", "manage"] as const;
export type AccessLevel = typeof accessLevels[number];
export type AccessGrants = Partial<Record<AccessArea, AccessLevel>>;

/** `workspace` is open to every role (it only reads the account itself); `owner_admin` is never grantable through an area. */
type AreaOf = AccessArea | "workspace" | "owner_admin";
export const permissionArea = {
  "workspace:read": "workspace",
  "members:write": "owner_admin", "roles:write": "owner_admin",
  // Privacy-sensitive: owner/admin only, whatever an area says (open question 1 in the checklist).
  "contacts:erase": "owner_admin", "contacts:attest_consent": "owner_admin", "crm:export_sensitive": "owner_admin", "webhooks:manage": "owner_admin",
  "contacts:merge": "owner_admin", "connect:privacy": "owner_admin", "social:approvals_settings": "owner_admin",
  "contacts:read": "crm", "contacts:write": "crm", "companies:read": "crm", "companies:write": "crm", "opportunities:read": "crm", "opportunities:write": "crm",
  "tasks:read": "crm", "tasks:write": "crm", "notes:read": "crm", "notes:write": "crm", "crm:fields_write": "crm", "crm:pipelines_write": "crm",
  "crm:import": "crm", "crm:export": "crm", "crm:forms_manage": "crm", "crm:reports": "crm", "crm:reports_export": "crm",
  "crm:read_diagnostics": "crm", "contacts:sources_read": "crm", "contacts:record_withdrawal": "crm", "jobs:read": "crm", "jobs:operate": "crm",
  "campaigns:read": "campaigns", "campaigns:write": "campaigns", "campaigns:activate": "campaigns",
  "communities:read": "communities", "communities:manage": "communities",
  "community:live:view": "communities", "community:live:manage": "communities", "community:live:moderate": "communities",
  "catalog:manage": "catalog", "catalog:read": "catalog",
  "ads:manage": "social", "social:approvals": "social", "social:connect": "social", "social:schedule": "social", "social:analytics": "social",
  "social:auto_dm": "social", "social:inbox": "social", "social:reply": "social", "social:assign": "social", "social:saved_replies": "social",
  "newsletter:read": "newsletter", "newsletter:manage": "newsletter", "newsletter:campaigns": "newsletter", "newsletter:delivery": "newsletter", "newsletter:analytics": "owner_admin",
  "bio:manage": "website", "blog:manage": "website",
  "giving:manage": "giving",
  "office:connect": "office", "office:mail": "office", "office:calendar": "office", "office:files": "office", "docs:read": "office", "docs:write": "office", "docs:manage": "office",
  "connect:publish": "connect", "followup:manage": "connect", "followup:work": "connect",
  "settings:write": "settings",
  "volunteers:participate": "volunteers", "volunteers:manage": "volunteers",
  "payments:finance": "owner_admin", "payments:manage": "owner_admin",
  // Giving: a collaborator with Giving can run campaign settings; supporter details, pledges and gifts are owner/admin only (a separate decision).
  "fundraising:read": "giving", "fundraising:manage": "giving", "fundraising:publish": "giving",
  "giving:record": "owner_admin", "giving:correct": "owner_admin", "giving:read_donors": "owner_admin",
} as const satisfies Record<Permission, AreaOf>;

export const everyPermission = Object.keys(permissionArea) as Permission[];
export function permissionAreaOf(permission: Permission): AreaOf { return permissionArea[permission]; }

const separator = ";";
export type RoleToken = { role: string; grants: AccessGrants };
/** `collaborator;crm=manage;social=view`. Any other role id passes through unchanged. Unknown areas and levels are dropped (fail closed). */
export function roleToken(role: string, grants: AccessGrants): string {
  if (role !== "collaborator") return role;
  const parts = accessAreas.filter((area) => grants[area]).map((area) => `${area}=${grants[area]}`);
  return [role, ...parts].join(separator);
}
export function parseRoleToken(value: string): RoleToken {
  if (!value.startsWith("collaborator")) return { role: value, grants: {} };
  const [role, ...parts] = value.split(separator);
  if (role !== "collaborator") return { role: value, grants: {} };
  const grants: AccessGrants = {};
  for (const part of parts) {
    const [area, level] = part.split("=");
    if ((accessAreas as readonly string[]).includes(area) && (accessLevels as readonly string[]).includes(level)) grants[area as AccessArea] = level as AccessLevel;
  }
  return { role, grants };
}

/**
 * Capability for a collaborator. `manage` is the area's administrator (every capability of the area except the owner/admin-only ones),
 * `view` the read-only capabilities, no grant nothing. `legacy` is the original role rule, passed in so this file never imports it.
 */
export function collaboratorCan(grants: AccessGrants, permission: Permission, legacy: (role: string, permission: Permission) => boolean): boolean {
  const area = permissionArea[permission] as AreaOf | undefined;
  if (area === "workspace") return true;
  if (!area || area === "owner_admin") return false;
  const level = grants[area];
  if (level === "manage") return legacy("admin", permission);
  // `view` is the original viewer rule: the read capabilities of CRM, campaigns, the communities list and docs. The other modules have no read-only tier yet.
  if (level === "view") return legacy("viewer", permission);
  return false;
}

/** The areas a person can reach at all, for navigation and for showing what an invitation grants. */
export function grantedAreas(grants: AccessGrants): AccessArea[] { return accessAreas.filter((area) => grants[area]); }
/** A grant set that is a subset of what `holder` holds; the server uses it to refuse granting more than one holds. */
export function withinGrants(wanted: AccessGrants, holder: "owner" | "admin" | AccessGrants): boolean {
  if (holder === "owner" || holder === "admin") return true;
  return accessAreas.every((area) => !wanted[area] || (holder[area] === "manage" || holder[area] === wanted[area]));
}

/** The role a module check should see for this capability: `admin` for manage, `viewer` for view, `guest` for nothing (mirrors public.access_role). */
export function effectiveRoleFor(grants: AccessGrants, permission: Permission): string {
  const area = permissionArea[permission] as AreaOf;
  if (area === "workspace") return "viewer";
  if (area === "owner_admin") return "guest";
  const level = grants[area];
  return level === "manage" ? "admin" : level === "view" ? "viewer" : "guest";
}

/** Only scoped roles need an explicit grant. Legacy capabilities are checked separately. */
export function hasFeatureGrant(access: string, feature: AccessArea, level: AccessLevel): boolean {
  const { role, grants } = parseRoleToken(access);
  if (role === "viewer") return level === "view";
  if (role !== "collaborator") return role === "owner" || role === "admin" || role === "member";
  return grants[feature] === "manage" || (level === "view" && grants[feature] === "view");
}
