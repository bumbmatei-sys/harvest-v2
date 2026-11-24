import { docsRoute } from "@/server/docs-route";
import { listNotifications, markNotificationsRead } from "@/server/docs-notify";

type Params = { tenantId: string };
export const GET = docsRoute<Params>(({ db, user, params }) => listNotifications(db, user, params.tenantId), false);
export const POST = docsRoute<Params>(({ db, user, params, body }) => markNotificationsRead(db, user, params.tenantId, body), true);
