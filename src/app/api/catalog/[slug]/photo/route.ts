import { getDb } from "@/db/client";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { landingPhoto } from "@/server/catalog-landing";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
/** The public landing's about-the-creator photo: a short redirect to a one-minute signed address. Unpublished, missing and unavailable all answer the same 404. */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const gone = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!freeCatalogEnabled()) return gone();
  const { slug } = await context.params;
  try {
    const file = await landingPhoto(getDb(), slug);
    if (!file) return gone();
    const url = await getStorage().presignDownload(file.key, file.name, { inlineImage: file.mime });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  } catch { return gone(); }
}
