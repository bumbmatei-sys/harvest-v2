import { platformResponse } from "@/server/platform/http";
import { staffQueue } from "@/server/platform/staff";
export const runtime = "nodejs";
// Harvest staff only: the Discover review queue. Hard-off, fresh sign-in, active staff role.
export function GET(request: Request) {
  return platformResponse(request, false, (db, user) => staffQueue(db, user, new URL(request.url).searchParams.get("state") ?? undefined));
}
