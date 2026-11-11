import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { saveOnboarding, skipOnboarding } from "@/server/account-profile";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skip") }).strict(),
  z.object({ action: z.literal("save"), name: z.string(), locale: z.string().nullable(), cityRegion: z.string().nullable() }).strict(),
]);
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request), input = body.parse(await request.json());
    const profile = input.action === "skip"
      ? await skipOnboarding(getDb(), userId)
      : await saveOnboarding(getDb(), userId, { name: input.name, locale: input.locale, cityRegion: input.cityRegion });
    const response = NextResponse.json(profile, { headers: { "Cache-Control": "private, no-store" } });
    if (input.action === "save") {
      if (profile.locale) response.cookies.set("locale", profile.locale, { path: "/", sameSite: "lax", secure: new URL(request.url).protocol === "https:", maxAge: 60 * 60 * 24 * 365 });
      else response.cookies.delete("locale");
    }
    return response;
  } catch (error) { return errorResponse(error); }
}
