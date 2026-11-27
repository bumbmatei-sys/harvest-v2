import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { AccessError } from "@/server/permissions";
import { getFileStorage } from "@/server/storage";
import { exportFileName, exportMyData } from "@/server/your-data";

/** "Download my data": the signed-in person's own export, as a JSON attachment. POST, because each export counts towards the hourly limit. */
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), now = new Date();
    let storage: ReturnType<typeof getFileStorage> | null = null;
    try { storage = getFileStorage(user); } catch { storage = null; }
    const data = await exportMyData(getDb(), storage, user, now);
    return new Response(JSON.stringify(data, null, 2), { headers: {
      "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${exportFileName(now)}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const response = errorResponse(error);
    if (error instanceof AccessError && error.status === 429) response.headers.set("Retry-After", String(error.details?.retryAfter ?? 3600));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
