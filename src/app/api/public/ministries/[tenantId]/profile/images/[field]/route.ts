import { getDb } from "@/db/client";
import { errorResponse } from "@/server/http";
import { ministryProfileImage } from "@/server/ministry-profile";
import { getFileStorage } from "@/server/storage";

type Context = { params: Promise<{ tenantId: string; field: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const { tenantId, field } = await params;
    const target = await ministryProfileImage(getDb(), getFileStorage, tenantId, field);
    return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
