import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
import { can } from "@/server/permissions";
import { createView, listViews } from "@/server/crm-views";
import { getWorkspace } from "@/server/workspaces";
const objectType = (request: Request) => z.enum(["person", "company"]).parse(new URL(request.url).searchParams.get("object"));
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params, type = objectType(request);
    const workspace = await getWorkspace(getDb(), user, tenantId);
    return Response.json(await listViews(getDb(), user, tenantId, type, { writable: can(workspace.role, type === "person" ? "contacts:write" : "companies:write") }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await createView(getDb(), user, tenantId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
