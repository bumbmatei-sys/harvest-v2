export const roleIds = ["owner", "admin", "member", "viewer"] as const;
export type Role = typeof roleIds[number];
export type Permission = "workspace:read" | "members:write" | "roles:write";
export function can(role: string, permission: Permission): boolean {
  if (permission === "workspace:read") return roleIds.includes(role as Role);
  return role === "owner" || role === "admin";
}
export class AccessError extends Error {
  constructor(public status: 401 | 403 | 404 | 409, message: string) { super(message); }
}
export function requirePermission(role: string, permission: Permission) {
  if (!can(role, permission)) throw new AccessError(403, "You do not have permission to do that.");
}
