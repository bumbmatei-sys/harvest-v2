import { siteAddresses } from "@/lib/site-address";
import { getDb } from "@/db/client";
import { getAuth } from "@/server/auth-instance";
import { accountDeletionBlockers, deleteMyAccount } from "@/server/account-deletion";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { message } from "@/i18n/messages";
import { officeRouteDeps } from "@/server/office-gate";
import { AccessError } from "@/server/permissions";
import { readBoundedJson } from "@/server/request-json";
import { createStorageDeleter } from "@/server/storage/s3-connection";

export async function GET(request: Request) {
  try {
    const user = await verifiedUser(request);
    return Response.json(await accountDeletionBlockers(getDb(), user), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

/** "Delete my account": needs a sign-in within the last 15 minutes and the typed word. The session cookies are cleared on success. */
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) throw new AccessError(401, message("Errors.signInToContinue"));
    const body = await readBoundedJson(request, 1_024, () => new AccessError(400, message("Errors.checkTheSuppliedDetails")));
    let deleter: ReturnType<typeof createStorageDeleter> | null = null;
    try { deleter = createStorageDeleter(); } catch { deleter = null; }
    // Mail and calendar connections are revoked at their provider first. Only the synthetic provider exists outside production; with the
    // integration off (production today) no connection can exist, and one that did would stop the deletion rather than be left behind.
    const office = officeRouteDeps();
    const result = await deleteMyAccount(getDb(), session.user.id, session.session.createdAt, body, deleter, new Date(), office && { provider: office.provider, credential: office.credential });
    const response = Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
    // The sessions are already deleted; expire the browser's copies too.
    const { cookieDomain } = siteAddresses();
    for (const name of (request.headers.get("cookie") ?? "").split(";").map((part) => part.split("=")[0].trim()).filter((name) => /session_(token|data)$/.test(name)))
      {
        const expiry = `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${name.startsWith("__Secure-") ? "; Secure" : ""}`;
        response.headers.append("Set-Cookie", expiry);
        if (cookieDomain) response.headers.append("Set-Cookie", `${expiry}; Domain=${cookieDomain}`);
      }
    return response;
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
