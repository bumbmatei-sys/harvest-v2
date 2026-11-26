import { e2eReason } from "./e2e-diagnostics";
import { message } from "../i18n/messages";
import { and, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { workspaceMemberAccess, workspaceMembers } from "../db/schema";
import { effectiveRoleFor, roleToken, type AccessGrants } from "../lib/access-areas";
import { AccessError, requirePermission, type Permission } from "./permissions";

// Explicit columns: withTenant also runs against databases mid-upgrade, before can_manage_admins exists.
const member = { tenantId: workspaceMembers.tenantId, userId: workspaceMembers.userId, roleId: workspaceMembers.roleId };
// userId must come from Better Auth's verified server session, never request data.
export async function withUser<T>(db: Database, userId: string, run: (tx: Transaction) => Promise<T>) {
  if (!userId) throw new AccessError(401, message("Errors.signInToContinue"));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return run(tx);
  });
}
export async function withTenant<T>(db: Database, userId: string, workspaceHint: string, permission: Permission,
  run: (tx: Transaction, tenantId: string, role: string, access: string) => Promise<T>) {
  return withUser(db, userId, async (tx) => {
    const [membership] = await tx.select(member).from(workspaceMembers).where(and(
      eq(workspaceMembers.userId, userId), eq(workspaceMembers.tenantId, workspaceHint),
    ));
    if (!membership) throw new AccessError(403, message("Errors.workspaceAccessDenied"), e2eReason("no_membership"));
    if (membership.roleId !== "collaborator") requirePermission(membership.roleId, permission);
    // Parameterized set_config(..., true) is SET LOCAL and resets on commit/rollback.
    await tx.execute(sql`select set_config('app.tenant_id', ${membership.tenantId}, true)`);
    const [locked] = await tx.select(member).from(workspaceMembers).where(and(
      eq(workspaceMembers.userId, userId), eq(workspaceMembers.tenantId, membership.tenantId),
    )).for("share");
    if (!locked) throw new AccessError(403, message("Errors.workspaceAccessDenied"), e2eReason("membership_lock"));
    // A collaborator's grants are read inside the locked transaction. `access` is the role token (carries the grants); `role` is the role effective for this
    // capability, so callbacks that compare roles see what the database checks see (admin for manage, viewer for view).
    let access: string = locked.roleId, effective: string = locked.roleId;
    if (locked.roleId === "collaborator") {
      const rows = await tx.select().from(workspaceMemberAccess).where(and(eq(workspaceMemberAccess.tenantId, locked.tenantId), eq(workspaceMemberAccess.userId, userId)));
      const grants: AccessGrants = {}; for (const row of rows) grants[row.area] = row.level;
      access = roleToken("collaborator", grants); effective = effectiveRoleFor(grants, permission);
    }
    requirePermission(access, permission);
    return run(tx, locked.tenantId, effective, access);
  });
}
