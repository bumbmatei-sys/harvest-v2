import { readConfirmationSink } from "@/server/newsletter-confirmation";
export const runtime = "nodejs";
// Synthetic test mode only (a disposable local test database): the fake sink for hosted sign-up confirmations. Everywhere else this is a 404.
export function GET(request: Request) {
  const to = new URL(request.url).searchParams.get("to") ?? "";
  const messages = /^[^\s@]+@example\.test$/.test(to) ? readConfirmationSink(to) : null;
  if (!messages) return new Response(null, { status: 404 });
  return Response.json({ messages }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
