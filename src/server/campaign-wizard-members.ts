import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { users, workspaceMembers } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { withTenant } from "./tenancy";

export type WizardMember = { id: string; name: string; role: string };

/**
 * Names for the campaign wizard screens: the people a draft can place in a department (owner, admin and member roles; the picker never offers a viewer)
 * and, for the draft list and read-only views, who started a draft. Only people who can start a campaign or who manage the ministry get the list; a viewer
 * gets none. Read-only, under the same tenant context and membership policy as the other member lists; it touches no draft and exposes no email address
 * unless the person has no name.
 */
export async function listWizardMembers(db: Database, userId: string, workspace: string): Promise<WizardMember[]> {
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const rows = await tx.select({ id: users.id, name: users.name, email: users.email, role: workspaceMembers.roleId }).from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId)).where(eq(workspaceMembers.tenantId, tenantId)).orderBy(asc(users.name), asc(users.id));
    return rows.map((row) => ({ id: row.id, name: row.name.trim() || row.email, role: row.role }));
  });
}
