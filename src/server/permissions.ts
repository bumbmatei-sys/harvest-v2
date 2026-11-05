import { message } from "../i18n/messages";
export const roleIds = ["owner", "admin", "member", "viewer"] as const;
export type Role = typeof roleIds[number];
export type Permission = "workspace:read" | "members:write" | "roles:write" | "contacts:read" | "contacts:write" | "settings:write" | "contacts:erase";
export function can(role: string, permission: Permission): boolean {
  if (permission === "workspace:read" || permission === "contacts:read") return roleIds.includes(role as Role);
  if (permission === "contacts:write") return role === "owner" || role === "admin" || role === "member";
  return role === "owner" || role === "admin";
}
export class AccessError extends Error {
  constructor(public status: 401 | 403 | 404 | 409, message: string) { super(message); }
}
export function requirePermission(role: string, permission: Permission) {
  if (!can(role, permission)) throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
}
