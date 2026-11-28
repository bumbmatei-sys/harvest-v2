import { forumItemPicker } from "@/server/community-forum";
import { communityRoute } from "@/server/community-route";

export const runtime = "nodejs";
export const GET = communityRoute<{ slug: string }>(({ db, user, params, request }) => {
  const { searchParams } = new URL(request.url);
  return forumItemPicker(db, user, params.slug, {
    kind: searchParams.get("kind"),
    q: searchParams.get("q") ?? undefined,
    page: searchParams.get("page") ?? undefined,
  });
}, { write: false });
