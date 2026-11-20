import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { getKeyProvider } from "../connect-key-provider";
import { SOCIAL_INTEGRATION_ENABLED } from "./registry";

export const POSTING_MEDIA_LINK_SECONDS = 2 * 60 * 60;
// Only record a shorter value here when it is documented for the publishing fetch path.
export function postingMediaLifetime(providerFetchSeconds?: number) {
  if (providerFetchSeconds === undefined) return POSTING_MEDIA_LINK_SECONDS;
  if (!Number.isInteger(providerFetchSeconds) || providerFetchSeconds < 1) throw new Error("POSTING_MEDIA_WINDOW_INVALID");
  return Math.min(POSTING_MEDIA_LINK_SECONDS, providerFetchSeconds);
}

const purpose = "social-post-media:v1" as const;
const signed = (keyId: string, claims: string) => createHmac("sha256", getKeyProvider().resolveKey(purpose, keyId)).update(claims).digest("base64url");
const grantInput = z.object({ grantId: z.uuid(), fileId: z.uuid(), expires: z.number().int().positive() }).strict();

export function postingMediaUrl(origin: string, grantId: string, fileId: string, expiresAt: Date) {
  const endpoint = new URL(origin);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("POSTING_MEDIA_ORIGIN_INVALID");
  const claims = Buffer.from(JSON.stringify({ grantId, fileId, expires: expiresAt.getTime() })).toString("base64url");
  const key = getKeyProvider().currentKeyId(purpose);
  return new URL(`/api/integrations/social/posting-media/${key}.${claims}.${signed(key, claims)}`, endpoint.origin).href;
}

export type PostingMediaStorage = {
  read(key: string, range: string | undefined, head: boolean): Promise<Response>;
};
const responseHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const missing = () => new Response(null, { status: 404, headers: responseHeaders });
export async function readPostingMedia(database: () => Database, request: Request, token: string,
  storage: () => PostingMediaStorage, enabled = SOCIAL_INTEGRATION_ENABLED, now = Date.now) {
  if (!enabled || token.length > 600) return missing();
  try {
    const [key, encoded, signature, extra] = token.split(".");
    if (!key || !encoded || !signature || extra !== undefined) return missing();
    const actual = Buffer.from(signature);
    const expected = Buffer.from(signed(key, encoded));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return missing();
    const claims = grantInput.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (claims.expires <= now()) return missing();
    const range = request.headers.get("range") ?? undefined;
    if (range && !/^bytes=(?:\d{1,16}-\d{0,16}|-\d{1,16})$/.test(range)) return new Response(null, { status: 416, headers: responseHeaders });
    const { rows: [file] } = await database().execute<{ object_key: string; mime: string; size: string }>(sql`
      select * from public.social_post_media_read(${claims.grantId}::uuid,${claims.fileId}::uuid)`);
    if (!file) return missing();
    if (request.method === "HEAD" && !range) return new Response(null, { headers: {
      ...responseHeaders, "Content-Type": file.mime, "Content-Length": file.size, "Accept-Ranges": "bytes",
    } });
    const object = await storage().read(file.object_key, range, request.method === "HEAD");
    if (object.status !== 200 && object.status !== 206 && object.status !== 416) return missing();
    const headers = new Headers({ ...responseHeaders, "Content-Type": file.mime, "Accept-Ranges": "bytes" });
    for (const name of ["content-length", "content-range"]) {
      const value = object.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(request.method === "HEAD" ? null : object.body, { headers, status: object.status });
  } catch { return missing(); }
}
