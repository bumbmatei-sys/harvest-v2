import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { blogEnabled } from "@/server/blog-mode";
import { SOCIAL_INTEGRATION_ENABLED } from "@/server/social/registry";
import { createPostingMediaReader } from "@/server/storage/s3-connection";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const missing = () => new Response(null, { status: 404, headers });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!blogEnabled() || !SOCIAL_INTEGRATION_ENABLED) return missing();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return missing();
  try {
    const { rows: [file] } = await getDb().execute<{ object_key: string; mime: string; size: string }>(
      sql`select * from public.blog_external_asset(${id.data}::uuid)`);
    if (!file) return missing();
    const head = request.method === "HEAD";
    const responseHeaders = { ...headers, "Content-Type": file.mime, "Content-Length": String(file.size) };
    if (head) return new Response(null, { headers: responseHeaders });
    const object = await createPostingMediaReader().read(file.object_key, undefined, false);
    return object.status === 200 ? new Response(object.body, { headers: responseHeaders }) : missing();
  } catch { return missing(); }
}
export const HEAD = GET;
