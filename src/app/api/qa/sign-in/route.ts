import { qaShortcutSignIn } from "@/server/qa-shortcut";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// QA-2 test sign-in shortcut. 404 everywhere except a preview or local test server with the preview token.
async function handle(request: Request) {
  try { return await qaShortcutSignIn(request); } catch {
    console.error("qa_shortcut_failed");
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
export { handle as GET, handle as POST };
