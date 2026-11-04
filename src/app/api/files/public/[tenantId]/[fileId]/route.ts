import { getDb } from "@/db/client";
import { errorResponse } from "@/server/http";
import { publicDownload } from "@/server/files/service";
import { getStorage } from "@/server/storage";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ tenantId: string; fileId: string }> }) {
  try {
    const { tenantId, fileId } = await context.params;
    return new Response(null, { status: 302, headers: { Location: await publicDownload(getDb(), getStorage(), tenantId, fileId),
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    } });
  } catch (error) { return errorResponse(error); }
}
