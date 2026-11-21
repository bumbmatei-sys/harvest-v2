import { message } from "../../../../i18n/messages";
import { getAuth } from "@/server/auth-instance";
import { workerSettings } from "@/server/worker-settings";
import { errorResponse } from "@/server/http";
import { assertQaSignInSafe } from "@/server/qa-sign-in-gate";
export const runtime = "nodejs";
// Explicitly expose only the OTP sign-in and session lifecycle endpoints.
const allowed = new Set(["POST /email-otp/send-verification-otp", "POST /sign-in/email-otp", "POST /sign-out", "GET /get-session"]);
async function handle(request: Request) {
  try { if (!workerSettings.getStore()) assertQaSignInSafe(process.env); } catch { return new Response(null, { status: 503 }); }
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
  if (!allowed.has(`${request.method} ${path}`)) return Response.json({ error: message("AppApiAuthRoute.notFound") }, { status: 404 });
  try { return await getAuth().handler(request); } catch (error) { return errorResponse(error); }
}
export { handle as GET, handle as POST };
