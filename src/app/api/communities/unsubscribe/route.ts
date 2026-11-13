import { getDb } from "@/db/client";
import { requiredEnv } from "@/lib/env";
import { communitiesEnabled } from "@/server/communities-mode";
import { unsubscribeByToken } from "@/server/community-email";
export const runtime = "nodejs";

// C15b one-click unsubscribe (RFC 8058): a mail client POSTs here with no session and no Origin, so the signed token is
// the only credential. The token comes from the query string (the List-Unsubscribe URL) or a JSON body (the confirmation page).
// The answer is always the same, so nobody can learn whether a token was valid.
export async function POST(request: Request) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  let token = url.searchParams.get("token");
  if (!token && request.headers.get("content-type")?.includes("application/json")) {
    token = await request.json().then((b: unknown) => (b && typeof b === "object" && typeof (b as { token?: unknown }).token === "string" ? (b as { token: string }).token : null)).catch(() => null);
  }
  try { if (token) await unsubscribeByToken(getDb(), requiredEnv("BETTER_AUTH_SECRET"), token); } catch { console.error("community_unsubscribe_failed"); }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
