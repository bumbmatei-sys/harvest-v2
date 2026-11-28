import { communityShelf } from "@/server/community-shelf";
import { catalogRoute } from "@/server/free-catalog-route";

export const GET = catalogRoute<{ slug: string }>(async (db, user, { slug }) => {
  const shelf = await communityShelf(db, user, slug, "course");
  return shelf ? { items: shelf.items } : new Response(null, { status: 404 });
}, "read");
