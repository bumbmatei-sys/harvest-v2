import "server-only";
import { requiredEnv } from "../../lib/env";
import { S3Storage } from "./s3";
let storage: S3Storage | undefined;
export function getStorage() {
  return storage ??= new S3Storage({ endpoint: requiredEnv("S3_ENDPOINT"), bucket: requiredEnv("S3_BUCKET"),
    accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"), secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"), region: requiredEnv("S3_REGION"),
  });
}
