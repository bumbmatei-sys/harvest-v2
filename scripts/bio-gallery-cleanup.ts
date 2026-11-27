import { createPool } from "../src/db/pool";
import { sweepBioGallery } from "../src/server/bio-gallery-cleanup-worker";
import { createStorageDeleter } from "../src/server/storage/s3-connection";
import { requireWorkerRole, workerDatabaseUrl } from "../src/server/worker-role";

const mode = process.argv[2] ?? "run";
if (process.env.HARVEST_BIO_GALLERY_CLEANUP_ENABLED === "1" &&
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") &&
    process.env.VERCEL_ENV !== "production" && process.env.HARVEST_ENV !== "production") {
  let pool: ReturnType<typeof createPool> | undefined;
  try {
    pool = createPool(workerDatabaseUrl(process.env));
    await requireWorkerRole(pool);
    if (mode === "check") {
      const { rows: [row] } = await pool.query<{ healthy: boolean }>("select public.bio_gallery_cleanup_health() as healthy");
      if (!row?.healthy) throw new Error("BIO_GALLERY_CLEANUP_UNHEALTHY");
    } else if (mode === "run") {
      const result = await sweepBioGallery(pool, createStorageDeleter());
      console.info(result);
      if (result.failed) throw new Error("BIO_GALLERY_CLEANUP_FAILED");
    } else {
      throw new Error("BIO_GALLERY_CLEANUP_USAGE");
    }
  } catch {
    console.error("bio_gallery_cleanup_failed");
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
