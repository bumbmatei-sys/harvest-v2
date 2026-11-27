import { legacyRedirect } from "@/lib/site-address";
import { NextResponse, type NextRequest } from "next/server";

// A path hint for server-rendered appearance only. Domain services still verify membership.
export function proxy(request: NextRequest) {
  const legacy = legacyRedirect(request);
  if (legacy) return legacy;
  const headers = new Headers(request.headers);
  headers.delete("x-harvest-workspace");
  const candidate = request.nextUrl.pathname.match(/^\/workspaces\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
  if (candidate) headers.set("x-harvest-workspace", candidate);
  const response = NextResponse.next({ request: { headers } });
  if (/^\/(?:c|s|subscribe|give)\//.test(request.nextUrl.pathname) || /^\/(?:connect|account|newsletter\/confirm|newsletter\/link|communities\/unsubscribe)(?:\/|$)/.test(request.nextUrl.pathname)) { response.headers.set("Cache-Control", "private, no-store"); response.headers.set("Referrer-Policy", "no-referrer"); }
  return response;
}
// Public pages and API reads also need legacy-origin redirects. The redirect helper handles the callback exceptions.
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
