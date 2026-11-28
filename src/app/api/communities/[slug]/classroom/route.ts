import { communityRoute } from "@/server/community-route";
import { communityShelf } from "@/server/community-shelf";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { workerSettings } from "@/server/worker-settings";

type Params = { slug: string };

const readClassroom = communityRoute<Params>(async ({ db, user, params }) => {
  const shelf = await communityShelf(db, user, params.slug, "course");
  return shelf ? { items: shelf.items } : new Response(null, { status: 404 });
}, { write: false });

export function GET(request: Request, context: { params: Promise<Params> }) {
  if (!freeCatalogEnabled(workerSettings.getStore()?.features)) return new Response(null, { status: 404 });
  return readClassroom(request, context);
}
