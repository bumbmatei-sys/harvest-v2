import { getDb } from "@/db/client";
import { publicBioPhoto } from "@/server/link-in-bio";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
/** The published page's profile photo: a short redirect to a one-minute signed address. Unpublished, missing and unavailable all answer the same 404. */
export async function GET(_request: Request, context: { params: Promise<{ handle: string }> }) {
  const { handle } = await context.params;
  try {
    const file = await publicBioPhoto(getDb(), handle, "cover");
    if (!file) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const url = await getStorage().presignDownload(file.key, file.name, { inlineImage: file.mime });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
}
