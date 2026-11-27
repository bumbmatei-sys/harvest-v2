import { getDb } from "@/db/client";
import { publicBioGalleryPhoto } from "@/server/link-in-bio";
import { getStorage } from "@/server/storage";
import { throttlePublicRead } from "@/server/public-read-limit";

export const runtime = "nodejs";
/** A gallery picture of a published page: a short redirect to a one-minute signed address. Anything else answers the same 404. Rate limited per visitor. */
export async function GET(request: Request, context: { params: Promise<{ handle: string; fileId: string }> }) {
  const limited = await throttlePublicRead(request, "bio-photo");
  if (limited) return limited;
  const { handle, fileId } = await context.params;
  try {
    const file = await publicBioGalleryPhoto(getDb(), handle, fileId);
    if (!file) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const url = await getStorage().presignDownload(file.key, file.name, { inlineImage: file.mime });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
}
