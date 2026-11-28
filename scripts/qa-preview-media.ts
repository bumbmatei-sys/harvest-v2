import { request } from "node:http";
import { S3Storage } from "../src/server/storage/s3";
import type { storageConfig } from "../src/server/storage/s3-connection";
import type { PreviewMedia } from "./qa-preview-features";

export function previewMedia(config: ReturnType<typeof storageConfig>): PreviewMedia {
  const endpoint = URL.parse(config.endpoint);
  if (!endpoint || endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" ||
      endpoint.href !== `${endpoint.origin}/` || !endpoint.port) throw new Error("QA_SEED_MEDIA_TARGET_REFUSED");
  return {
    storage: new S3Storage(config),
    async upload(grant, bytes) {
      const url = URL.parse(grant.url);
      if (!url || url.origin !== endpoint.origin) throw new Error("QA_SEED_MEDIA_TARGET_REFUSED");
      await new Promise<void>((resolve, reject) => {
        const fail = () => reject(new Error("QA_SEED_MEDIA_UPLOAD_FAILED"));
        const put = request(url, { method: grant.method, headers: grant.headers, signal: AbortSignal.timeout(15_000) }, (response) => {
          response.resume();
          response.once("error", fail);
          response.once("end", () => response.statusCode === 200 ? resolve() : fail());
        });
        put.once("error", fail);
        put.end(bytes);
      });
    },
  };
}
