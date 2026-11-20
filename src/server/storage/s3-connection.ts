import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
