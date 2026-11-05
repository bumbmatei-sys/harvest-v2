import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { getProfile, updateProfile } from "@/server/profile";
export async function GET(request: Request) {
  try {
    return Response.json(await getProfile(getDb(), await verifiedUser(request)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request);
    const profile = await updateProfile(getDb(), userId, await request.json());
    const response = NextResponse.json(profile, { headers: { "Cache-Control": "private, no-store" } });
    if (profile.locale) response.cookies.set("locale", profile.locale, { path: "/", sameSite: "lax", secure: new URL(request.url).protocol === "https:", maxAge: 60 * 60 * 24 * 365 });
    else response.cookies.delete("locale");
    return response;
  } catch (error) { return errorResponse(error); }
}
