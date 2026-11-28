import { getDb } from "@/db/client";
import { searchChurchDirectory } from "@/server/church-directory";
import { errorResponse } from "@/server/http";
import { throttlePublicRead } from "@/server/public-read-limit";

export async function GET(request: Request) {
  try {
    const limited = await throttlePublicRead(request, "church-directory");
    if (limited) return limited;
    const query = new URL(request.url).searchParams;
    return Response.json(await searchChurchDirectory(getDb(), {
      name: query.get("name"), cityRegion: query.get("cityRegion"), after: query.get("after"),
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
