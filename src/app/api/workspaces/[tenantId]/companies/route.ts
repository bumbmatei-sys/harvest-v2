import { getDb } from "@/db/client";
import { companyQuery } from "@/lib/crm-input";
import { createCompany, listCompanies } from "@/server/companies";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ tenantId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await verifiedUser(request), { tenantId } = await context.params;
    const query = companyQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await listCompanies(getDb(), user, tenantId, query), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { tenantId } = await context.params;
    return Response.json(await createCompany(getDb(), user, tenantId, await request.json()), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
