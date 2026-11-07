import { getDb } from "@/db/client";
import { exportConnectLink } from "@/server/connect-export";
import { errorResponse, verifiedUser } from "@/server/http";

export const runtime = "nodejs";

// PNG / SVG / PDF of a link's QR code and short URL (organizers; drafts allowed for testing).
export async function GET(request: Request, context: { params: Promise<{ tenantId: string; campaignId: string; linkId: string }> }) {
  try {
    const user = await verifiedUser(request), { tenantId, campaignId, linkId } = await context.params;
    const url = new URL(request.url);
    const file = await exportConnectLink(getDb(), user, tenantId, campaignId, linkId, { format: url.searchParams.get("format"), palette: url.searchParams.get("palette") ?? undefined });
    return new Response(new Uint8Array(file.body), { headers: { "Content-Type": file.contentType, "Content-Disposition": file.disposition,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
