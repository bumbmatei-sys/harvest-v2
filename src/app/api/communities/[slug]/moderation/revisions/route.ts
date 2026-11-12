import { editHistory } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
// C12b: hosts read the previous versions of a post or reply (?targetType=post|comment&targetId=...). Members never do.
export const GET = communityRoute<{ slug: string }>(async ({ db, user, params, request }) => {
  const query = new URL(request.url).searchParams;
  return (await editHistory(db, user, params.slug, { targetType: query.get("targetType"), targetId: query.get("targetId") })).versions;
}, { write: false });
