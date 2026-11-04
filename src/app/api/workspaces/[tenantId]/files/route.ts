import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { createUpload, listFiles } from "@/server/files/service";
import { getStorage } from "@/server/storage";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const userId = await verifiedUser(request);
    return Response.json(await listFiles(getDb(), userId, z.uuid().parse((await context.params).tenantId)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request);
    const tenantId = z.uuid().parse((await context.params).tenantId);
    return Response.json(await createUpload(getDb(), getStorage(), userId, tenantId, await request.json()), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
