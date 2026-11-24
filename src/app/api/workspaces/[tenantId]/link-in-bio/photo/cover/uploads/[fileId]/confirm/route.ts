import { bioRoute } from "@/server/link-in-bio-route";
import { confirmBioPhotoUpload } from "@/server/link-in-bio-photo";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string; fileId: string };
export const POST = bioRoute<Params>(({ db, user, params }) => confirmBioPhotoUpload(db, user, params.tenantId, params.fileId, getStorage), true);
