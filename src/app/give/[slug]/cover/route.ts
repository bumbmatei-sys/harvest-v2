import { getDb } from "@/db/client";
import { publicGiveCover } from "@/server/give-page";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
/** The public page's cover: a short redirect to a one-minute signed address. Unknown, not public and unavailable all answer the same 404. */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const file = await publicGiveCover(getDb(), slug);
    if (!file) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const url = await getStorage().presignDownload(file.key, file.name, { inlineImage: file.mime });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
}
