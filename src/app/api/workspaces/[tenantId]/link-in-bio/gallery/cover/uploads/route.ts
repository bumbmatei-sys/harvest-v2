import { bioRoute } from "@/server/link-in-bio-route";
import { createBioPhotoUpload } from "@/server/link-in-bio-photo";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string };
// A gallery picture: the same private upload as the profile photo, kind gallery (at most 60 live per page, checked in the database).
export const POST = bioRoute<Params>(({ db, user, params, body }) => createBioPhotoUpload(db, user, params.tenantId, body, getStorage, "gallery"), true);
