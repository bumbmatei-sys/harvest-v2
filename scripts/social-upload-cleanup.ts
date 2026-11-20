import { createPool } from "../src/db/pool";
import { runSocialUploadCleanupWorker } from "../src/server/social/social-upload-cleanup";
import { createSocialUploadDeleter } from "../src/server/storage/s3-connection";

const mode = process.argv.length > 3 ? "invalid" : process.argv[2] ?? "run";
let storage: ReturnType<typeof createSocialUploadDeleter> | undefined;
process.exitCode = await runSocialUploadCleanupWorker(mode, process.env, createPool, () => storage ??= createSocialUploadDeleter(), console);
