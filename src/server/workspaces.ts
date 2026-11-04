import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditLogs, users, workspaceMembers, workspaces } from "../db/schema";
import { withTenant, withUser } from "./tenancy";
import { AccessError, type Role } from "./permissions";

export function createWorkspace(db: Database, userId: string, name: string) {
  return withUser(db, userId, async (tx) => {
    const tenantId = randomUUID();
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    const [workspace] = await tx.insert(workspaces).values({ tenantId, name, createdBy: userId }).returning();
    await tx.insert(workspaceMembers).values({ tenantId, userId, roleId: "owner" });
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "workspace.create", targetId: tenantId });
    return workspace;
  });
}
export async function listWorkspaces(db: Database, userId: string) {
  const memberships = await withUser(db, userId, (tx) => tx.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId)));
  return Promise.all(memberships.map((m) => withTenant(db, userId, m.tenantId, "workspace:read", async (tx, tenantId) => {
    const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.tenantId, tenantId));
    return { ...workspace, role: m.roleId };
  })));
}
export function putMember(db: Database, actorId: string, workspaceHint: string, email: string, roleId: Role) {
  return withTenant(db, actorId, workspaceHint, "members:write", async (tx, tenantId, actorRole) => {
    // Serialize role changes to preserve at least one owner, including concurrent requests.
    await tx.execute(sql`select tenant_id from workspaces where tenant_id = ${tenantId} for update`);
    const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!target) throw new AccessError(404, "Ask this person to sign in before adding them.");
    const [previous] = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.tenantId, tenantId), eq(workspaceMembers.userId, target.id)));
    if (actorRole !== "owner" && (roleId === "owner" || previous?.roleId === "owner")) throw new AccessError(403, "Only owners can change ownership.");
    if (previous?.roleId === "owner" && roleId !== "owner") {
      const owners = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.tenantId, tenantId), eq(workspaceMembers.roleId, "owner")));
      if (owners.length <= 1) throw new AccessError(409, "A workspace must keep at least one owner.");
    }
    await tx.insert(workspaceMembers).values({ tenantId, userId: target.id, roleId }).onConflictDoUpdate({ target: [workspaceMembers.tenantId, workspaceMembers.userId], set: { roleId } });
    await tx.insert(auditLogs).values({ tenantId, actorId, action: previous ? "member.role_change" : "member.add", targetId: target.id, metadata: { role: roleId, ...(previous ? { previousRole: previous.roleId } : {}) } });
    return { userId: target.id, roleId };
  });
}
