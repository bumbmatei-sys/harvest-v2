import { NextResponse, type NextRequest } from "next/server";

// A path hint for server-rendered appearance only. Domain services still verify membership.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("x-harvest-workspace");
  const candidate = request.nextUrl.pathname.match(/^\/workspaces\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
  if (candidate) headers.set("x-harvest-workspace", candidate);
  return NextResponse.next({ request: { headers } });
}
export const config = { matcher: ["/", "/sign-in", "/workspaces/:path*", "/c/:path*", "/s/:path*", "/resources/start/:path*"] };
