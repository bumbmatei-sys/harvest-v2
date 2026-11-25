import { discoverBody, discoverResponse } from "@/server/discover/http";
import { reportListing } from "@/server/discover/public";

export const runtime = "nodejs";
export function POST(request: Request) {
  return discoverResponse(request, { write: true, session: true }, async (db, user, deps) => reportListing(db, user, await discoverBody(request), deps), 201);
}
