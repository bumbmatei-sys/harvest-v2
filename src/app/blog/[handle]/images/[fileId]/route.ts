import { getDb } from "@/db/client";
import { blogEnabled } from "@/server/blog-mode";
import { publicBlogImage } from "@/server/blog";
import { throttlePublicRead } from "@/server/public-read-limit";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** A picture of a published article: a short redirect to a one-minute signed address. Unknown, unpublished and unavailable all answer the same 404. */
export async function GET(request: Request, context: { params: Promise<{ handle: string; fileId: string }> }) {
  if (!blogEnabled()) return notFound();
  const limited = await throttlePublicRead(request, "blog");
  if (limited) return limited;
  const { handle, fileId } = await context.params;
  try {
    const file = await publicBlogImage(getDb(), handle, fileId);
    if (!file) return notFound();
    const url = await getStorage().presignDownload(file.key, file.name, { inlineImage: file.mime as "image/jpeg" | "image/png" | "image/webp" });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  } catch { return notFound(); }
}
