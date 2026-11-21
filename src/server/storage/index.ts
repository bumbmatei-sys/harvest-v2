import "server-only";
import { workerSettings } from "../worker-settings";
import { R2FileStorage } from "./r2";
import { S3Storage } from "./s3";
import { storageConfig } from "./s3-connection";
let storage: S3Storage | undefined;
export function getStorage() {
  return storage ??= new S3Storage(storageConfig());
}

// Used by the single-object routes. Node retains the same lazy S3 singleton.
export function getFileStorage(subject: string | null) {
  const scope = workerSettings.getStore();
  return scope ? new R2FileStorage(scope.bucket, scope.origin, scope.grantSecret, subject) : getStorage();
}
