import { bioRoute } from "@/server/link-in-bio-route";
import { checkBioHandle } from "@/server/link-in-bio";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const GET = bioRoute<Params>(({ db, user, params, request }) => checkBioHandle(db, user, params.tenantId, new URL(request.url).searchParams.get("handle") ?? ""), false);
