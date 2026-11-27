import { getDb } from "@/db/client";
import { bioPageQr } from "@/server/link-in-bio-qr";
import { throttlePublicRead } from "@/server/public-read-limit";

export const runtime = "nodejs";
/** The QR code of a published page, as SVG (shown in the share dialog) or PNG (`format=png`, `download=1` to save it). Rate limited per visitor. */
export async function GET(request: Request, context: { params: Promise<{ handle: string }> }) {
  const limited = await throttlePublicRead(request, "bio-qr");
  if (limited) return limited;
  const { handle } = await context.params, url = new URL(request.url);
  const format = url.searchParams.get("format") === "png" ? "png" : "svg";
  try {
    const result = await bioPageQr(getDb(), handle, format);
    if (!result) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(result.body, { headers: { "Content-Type": result.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      ...(url.searchParams.get("download") === "1" ? { "Content-Disposition": `attachment; filename="${handle}-qr.${format}"` } : {}) } });
  } catch { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
}
