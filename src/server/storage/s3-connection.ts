import { AbortMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { message } from "../../i18n/messages";
import { requiredEnv } from "../../lib/env";

export function storageConfig() {
  return { endpoint: requiredEnv("S3_ENDPOINT"), bucket: requiredEnv("S3_BUCKET"),
    accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"), secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
    region: requiredEnv("S3_REGION") };
}

export function connectStorage(config: ReturnType<typeof storageConfig>) {
  const endpoint = new URL(config.endpoint);
  if (endpoint.username || endpoint.password || !["http:", "https:"].includes(endpoint.protocol)) throw new Error(message("Errors.invalidS3Endpoint"));
  if (endpoint.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error(message("Errors.storageRequiresHttps"));
  return new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 2,
  });
}

// The worker only needs deletion. Keep the web upload and download adapter out of the CLI.
export function createStorageDeleter() {
  const config = storageConfig(), client = connectStorage(config);
  return { async deleteObject(key: string) {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(15_000) });
  } };
}

export function createPostingMediaReader() {
  const config = storageConfig(), client = connectStorage(config);
  return { async read(key: string, range: string | undefined, head: boolean) {
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key, Range: range }));
      const headers = new Headers();
      if (result.ContentLength !== undefined) headers.set("Content-Length", String(result.ContentLength));
      if (result.ContentRange) headers.set("Content-Range", result.ContentRange);
      if (head) result.Body?.transformToWebStream().cancel().catch(() => undefined);
      return new Response(head ? null : result.Body?.transformToWebStream(), { status: result.ContentRange ? 206 : 200, headers });
    } catch (error) {
      if (error instanceof Error && error.name === "InvalidRange") return new Response(null, { status: 416 });
      throw error;
    }
  } };
}

export function createSocialUploadDeleter() {
  const config = { endpoint: requiredEnv("SOCIAL_CLEANUP_S3_ENDPOINT"), bucket: requiredEnv("SOCIAL_CLEANUP_S3_BUCKET"),
    accessKeyId: requiredEnv("SOCIAL_CLEANUP_S3_ACCESS_KEY_ID"), secretAccessKey: requiredEnv("SOCIAL_CLEANUP_S3_SECRET_ACCESS_KEY"),
    region: requiredEnv("SOCIAL_CLEANUP_S3_REGION") };
  const client = connectStorage(config);
  return {
    async deleteObject(key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(15_000) });
    },
    async abortMultipart(key: string, uploadId: string) {
      try {
        await client.send(new AbortMultipartUploadCommand({ Bucket: config.bucket, Key: key, UploadId: uploadId }), { abortSignal: AbortSignal.timeout(15_000) });
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "NoSuchUpload") throw error;
      }
    },
  };
}
