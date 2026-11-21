import { catalogRoute } from "@/server/free-catalog-route";
import { catalogDownload } from "@/server/free-catalog";
import { getFileStorage } from "@/server/storage";

export const GET = catalogRoute<{ slug: string; fileId: string }>((db, user, { slug, fileId }) =>
  catalogDownload(db, user, slug, fileId, () => getFileStorage(user)), "read");
