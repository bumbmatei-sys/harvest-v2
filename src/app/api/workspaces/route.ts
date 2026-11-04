import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { createWorkspace, listWorkspaces } from "@/server/workspaces";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return Response.json(await listWorkspaces(getDb(), await verifiedUser(request))); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request);
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(await request.json());
    return Response.json(await createWorkspace(getDb(), userId, name), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
