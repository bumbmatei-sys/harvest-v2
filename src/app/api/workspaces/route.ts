import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { createWorkspace, listWorkspaces } from "@/server/workspaces";
import { audiences } from "@/lib/audience";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return Response.json(await listWorkspaces(getDb(), await verifiedUser(request))); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request);
    const { name, audience, timeZone } = z.object({ name: z.string().trim().min(1).max(100), audience: z.enum(audiences), timeZone: z.string().max(64).optional() }).strict().parse(await request.json());
    return Response.json(await createWorkspace(getDb(), userId, name, audience, timeZone), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
