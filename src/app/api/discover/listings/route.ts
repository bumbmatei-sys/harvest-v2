import { discoverResponse } from "@/server/discover/http";
import { searchDiscover } from "@/server/discover/public";

export const runtime = "nodejs";
// Public, sanitized, hard-off. Unified search across communities, courses and products.
export function GET(request: Request) {
  return discoverResponse(request, { write: false, session: false }, (db, _user, deps) => searchDiscover(db, new URL(request.url).searchParams, deps));
}
