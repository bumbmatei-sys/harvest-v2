import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { changeMemberAccess, listMemberAccess } from "@/server/access";
export async function GET(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try { const userId = await verifiedUser(request); return Response.json(await listMemberAccess(getDb(), userId, z.uuid().parse((await context.params).tenantId))); } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request);
    return Response.json(await changeMemberAccess(getDb(), userId, z.uuid().parse((await context.params).tenantId), await request.json()));
  } catch (error) { return errorResponse(error); }
}
