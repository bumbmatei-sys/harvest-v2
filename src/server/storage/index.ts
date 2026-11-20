import "server-only";
import { S3Storage } from "./s3";
import { storageConfig } from "./s3-connection";
let storage: S3Storage | undefined;
export function getStorage() {
  return storage ??= new S3Storage(storageConfig());
}
