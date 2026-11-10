import { message } from "../i18n/messages";
import { can, type Permission } from "../lib/permissions";
export { can, roleIds, type Permission, type Role } from "../lib/permissions";
export class AccessError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 429, message: string, public details?: Record<string, string | number>) { super(message); }
}
export function requirePermission(role: string, permission: Permission) {
  if (!can(role, permission)) throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
}
