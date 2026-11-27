import { bioRoute } from "@/server/link-in-bio-route";
import { getBioGalleryUrl } from "@/server/link-in-bio-photo";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string; fileId: string };
// The owner's preview of one gallery picture (a one-minute signed address).
export const GET = bioRoute<Params>(({ db, user, params }) => getBioGalleryUrl(db, user, params.tenantId, params.fileId, getStorage), false);
