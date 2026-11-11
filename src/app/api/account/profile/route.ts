import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { getAccountProfile, updateAccountProfile } from "@/server/account-profile";

const noStore = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try { return Response.json(await getAccountProfile(getDb(), await verifiedUser(request)), { headers: noStore }); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    verifyOrigin(request);
    const profile = await updateAccountProfile(getDb(), await verifiedUser(request), await request.json());
    const response = NextResponse.json(profile, { headers: noStore });
    if (profile.locale) response.cookies.set("locale", profile.locale, { path: "/", sameSite: "lax", secure: new URL(request.url).protocol === "https:", maxAge: 60 * 60 * 24 * 365 });
    else response.cookies.delete("locale");
    return response;
  } catch (error) { return errorResponse(error); }
}
