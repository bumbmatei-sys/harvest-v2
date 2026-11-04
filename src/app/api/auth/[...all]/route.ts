import { getAuth } from "@/server/auth-instance";
import { errorResponse } from "@/server/http";
export const runtime = "nodejs";
// Explicitly expose only the OTP sign-in and session lifecycle endpoints.
const allowed = new Set(["POST /email-otp/send-verification-otp", "POST /sign-in/email-otp", "POST /sign-out", "GET /get-session"]);
async function handle(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
  if (!allowed.has(`${request.method} ${path}`)) return Response.json({ error: "Not found" }, { status: 404 });
  try { return await getAuth().handler(request); } catch (error) { return errorResponse(error); }
}
export { handle as GET, handle as POST };
