import { getDb } from "@/db/client";
import { readPostingMedia } from "@/server/social/posting-media";
import { createPostingMediaReader } from "@/server/storage/s3-connection";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return readPostingMedia(getDb, request, (await params).token, createPostingMediaReader);
}
export const HEAD = GET;
