import { bioRoute } from "@/server/link-in-bio-route";
import { createBioPhotoUpload } from "@/server/link-in-bio-photo";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const POST = bioRoute<Params>(({ db, user, params, body }) => createBioPhotoUpload(db, user, params.tenantId, body, getStorage, "cover"), true);
