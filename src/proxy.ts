import { NextResponse, type NextRequest } from "next/server";

// A path hint for server-rendered appearance only. Domain services still verify membership.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("x-harvest-workspace");
  const candidate = request.nextUrl.pathname.match(/^\/workspaces\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
  if (candidate) headers.set("x-harvest-workspace", candidate);
  const response = NextResponse.next({ request: { headers } });
  if (/^\/(?:c|s)\//.test(request.nextUrl.pathname) || request.nextUrl.pathname === "/connect/rights") { response.headers.set("Cache-Control", "private, no-store"); response.headers.set("Referrer-Policy", "no-referrer"); }
  return response;
}
export const config = { matcher: ["/", "/sign-in", "/workspaces/:path*", "/c/:path*", "/s/:path*", "/connect/rights", "/resources/start/:path*"] };
