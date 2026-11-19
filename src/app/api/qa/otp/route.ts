import { getDb } from "@/db/client";
import { qaOtpResponse } from "@/server/auth-otp-hooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await qaOtpResponse(request, getDb);
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  }
}
