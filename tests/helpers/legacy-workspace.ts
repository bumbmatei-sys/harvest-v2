import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../../src/db/client";
import { withUser } from "../../src/server/tenancy";

/**
 * createWorkspace as it was before migration 0091: no time_zone column in the insert or the returning list. Seeds that run before 0091 in an
 * upgrade test cannot use the current createWorkspace, which writes the column.
 */
export async function createLegacyWorkspace(db: Database, userId: string, name: string, audience: string | null = null) {
  return withUser(db, userId, async (tx) => {
    const tenantId = randomUUID();
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.execute(sql`insert into workspaces(tenant_id, name, audience, created_by) values (${tenantId}::uuid, ${name}, ${audience}, ${userId})`);
    await tx.execute(sql`insert into workspace_members(tenant_id, user_id, role_id) values (${tenantId}::uuid, ${userId}, 'owner')`);
    await tx.execute(sql`insert into audit_logs(tenant_id, actor_id, action, target_id) values (${tenantId}::uuid, ${userId}, 'workspace.create', ${tenantId})`);
    return { tenantId };
  });
}
