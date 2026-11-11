import { communityFileUrl } from "@/server/community-files";
import { communityRoute } from "@/server/community-route";
import { getStorage } from "@/server/storage";
export const runtime = "nodejs";
// Readers of the community only; a short-lived signed URL, never cached.
export const GET = communityRoute<{ slug: string; fileId: string }>(async ({ db, user, params }) => {
  const url = await communityFileUrl(db, getStorage(), user, params.slug, params.fileId);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}, { write: false });
