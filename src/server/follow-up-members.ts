import { and, asc, eq, notInArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { users, workspaceMembers } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { withTenant } from "./tenancy";

/**
 * Names for the follow-up screens: the members a case can be assigned to (owner, admin or member; never a viewer), shown only to the
 * roles that may assign. A member who is not an owner or admin gets an empty list and sees "you" for their own cases. Read-only, under
 * the same tenant context and membership policy as the CRM task assignee list; it touches no case.
 */
export async function listAssignableMembers(db: Database, userId: string, workspace: string): Promise<{ id: string; name: string }[]> {
  return withTenant(db, userId, uuidInput.parse(workspace), "followup:work", async (tx, tenantId, role) => {
    if (role !== "owner" && role !== "admin") return [];
    const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.tenantId, tenantId), notInArray(workspaceMembers.roleId, ["viewer", "guest", "campaign_guest"]))).orderBy(asc(users.name), asc(users.id));
    return rows.map((row) => ({ id: row.id, name: row.name || row.email }));
  });
}
