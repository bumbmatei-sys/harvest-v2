import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { putMember } from "@/server/workspaces";
import { roleIds } from "@/server/permissions";
export async function PUT(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request);
    const tenantId = z.uuid().parse((await context.params).tenantId);
    const input = z.object({ email: z.email().toLowerCase(), role: z.enum(roleIds) }).strict().parse(await request.json());
    return Response.json(await putMember(getDb(), userId, tenantId, input.email, input.role));
  } catch (error) { return errorResponse(error); }
}
