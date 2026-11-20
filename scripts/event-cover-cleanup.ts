import { createPool } from "../src/db/pool";
import { runEventCoverCleanupWorker } from "../src/server/event-cover-cleanup-worker";
import { createStorageDeleter } from "../src/server/storage/s3-connection";

const mode = process.argv.length > 3 ? "invalid" : process.argv[2] ?? "run";
let storage: ReturnType<typeof createStorageDeleter> | undefined;
process.exitCode = await runEventCoverCleanupWorker(mode, process.env, createPool, () => storage ??= createStorageDeleter(), console);
