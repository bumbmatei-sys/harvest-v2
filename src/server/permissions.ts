import { message } from "../i18n/messages";
export const roleIds = ["owner", "admin", "member", "viewer"] as const;
export type Role = typeof roleIds[number];
export type Permission = "workspace:read" | "members:write" | "roles:write" | "contacts:read" | "contacts:write" | "settings:write" | "contacts:erase" | "jobs:read" | "jobs:operate" | "companies:read" | "companies:write" | "crm:fields_write" | "opportunities:read" | "opportunities:write" | "crm:pipelines_write" | "tasks:read" | "tasks:write" | "notes:read" | "notes:write";
export function can(role: string, permission: Permission): boolean {
  if (permission === "workspace:read" || permission === "contacts:read" || permission === "companies:read" || permission === "opportunities:read" || permission === "tasks:read" || permission === "notes:read") return roleIds.includes(role as Role);
  if (permission === "contacts:write" || permission === "companies:write" || permission === "opportunities:write" || permission === "tasks:write" || permission === "notes:write") return role === "owner" || role === "admin" || role === "member";
  return role === "owner" || role === "admin";
}
export class AccessError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409, message: string, public details?: Record<string, string | number>) { super(message); }
}
export function requirePermission(role: string, permission: Permission) {
  if (!can(role, permission)) throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
}
