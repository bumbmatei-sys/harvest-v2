import { getDb } from "@/db/client";
import { setChurchDirectoryOptIn } from "@/server/church-directory";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";

export async function PUT(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request);
    const { tenantId } = await params;
    return Response.json(await setChurchDirectoryOptIn(getDb(), user, tenantId, await request.json()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return errorResponse(error); }
}
