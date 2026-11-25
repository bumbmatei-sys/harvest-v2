import { message } from "../i18n/messages";
import { and, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { workspaceMembers } from "../db/schema";
import { AccessError, requirePermission, type Permission } from "./permissions";

// userId must come from Better Auth's verified server session, never request data.
export async function withUser<T>(db: Database, userId: string, run: (tx: Transaction) => Promise<T>) {
  if (!userId) throw new AccessError(401, message("Errors.signInToContinue"));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return run(tx);
  });
}
/** In the browser-test server only (HARVEST_E2E_MOCK_EMAIL), a 403 says which check refused, so an intermittent denial is diagnosable from the test's own assertion. Never set in production. */
const e2eReason = (reason: string) => process.env.HARVEST_E2E_MOCK_EMAIL === "1" ? { reason } : undefined;
export async function withTenant<T>(db: Database, userId: string, workspaceHint: string, permission: Permission,
  run: (tx: Transaction, tenantId: string, role: string) => Promise<T>) {
  return withUser(db, userId, async (tx) => {
    const [membership] = await tx.select().from(workspaceMembers).where(and(
      eq(workspaceMembers.userId, userId), eq(workspaceMembers.tenantId, workspaceHint),
    ));
    if (!membership) throw new AccessError(403, message("Errors.workspaceAccessDenied"), e2eReason("no_membership"));
    requirePermission(membership.roleId, permission);
    // Parameterized set_config(..., true) is SET LOCAL and resets on commit/rollback.
    await tx.execute(sql`select set_config('app.tenant_id', ${membership.tenantId}, true)`);
    const [locked] = await tx.select().from(workspaceMembers).where(and(
      eq(workspaceMembers.userId, userId), eq(workspaceMembers.tenantId, membership.tenantId),
    )).for("share");
    if (!locked) throw new AccessError(403, message("Errors.workspaceAccessDenied"), e2eReason("membership_lock"));
    requirePermission(locked.roleId, permission);
    return run(tx, locked.tenantId, locked.roleId);
  });
}
