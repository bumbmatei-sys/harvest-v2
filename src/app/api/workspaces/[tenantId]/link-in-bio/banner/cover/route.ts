import { bioRoute } from "@/server/link-in-bio-route";
import { getBioPhotoUrl, setBioPhoto } from "@/server/link-in-bio-photo";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const GET = bioRoute<Params>(({ db, user, params }) => getBioPhotoUrl(db, user, params.tenantId, getStorage, "cover"), false);
export const PUT = bioRoute<Params>(({ db, user, params, body }) => setBioPhoto(db, user, params.tenantId, body, "cover"), true);
