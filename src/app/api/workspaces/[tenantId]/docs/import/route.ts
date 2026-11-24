import { docsRoute } from "@/server/docs-route";
import { importAsNewDoc } from "@/server/docs-io";

export const POST = docsRoute<{ tenantId: string }>(({ db, user, params, body }) => importAsNewDoc(db, user, params.tenantId, body), true);
