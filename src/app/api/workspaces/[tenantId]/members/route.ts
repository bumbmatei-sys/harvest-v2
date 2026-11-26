import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users, workspaceMembers } from "@/db/schema";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { accessChangeSchema, changeMemberAccess, directAddAllowed } from "@/server/access";
import { putMember } from "@/server/workspaces";
import { withTenant } from "@/server/tenancy";
import { AccessError } from "@/server/permissions";
import { message } from "@/i18n/messages";
// Role and area changes for an existing member go through the audited database function. People who are not yet members join by invitation
// (POST /invitations, accepted by the invitee). Direct add is refused outside the non-production test gate (directAddAllowed).
export async function PUT(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request);
    const tenantId = z.uuid().parse((await context.params).tenantId);
    const input = accessChangeSchema.omit({ userId: true }).extend({ email: z.email().toLowerCase() }).strict().parse(await request.json());
    const [target] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (!target) throw new AccessError(404, message("Errors.askThisPersonToSignInBeforeAdding"));
    const existing = await withTenant(getDb(), userId, tenantId, "members:write", async (tx) => (await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.tenantId, tenantId), eq(workspaceMembers.userId, target.id))))[0]);
    if (existing) return Response.json(await changeMemberAccess(getDb(), userId, tenantId, { userId: target.id, role: input.role, grants: input.grants, canManageAdmins: input.canManageAdmins }));
    // New people join by invitation only; the direct add exists for browser fixtures outside production.
    if (!directAddAllowed() || input.role === "collaborator" || input.role === "guest" || input.role === "owner") throw new AccessError(409, message("Errors.checkTheSuppliedDetails"));
    return Response.json(await putMember(getDb(), userId, tenantId, input.email, input.role));
  } catch (error) { return errorResponse(error); }
}
