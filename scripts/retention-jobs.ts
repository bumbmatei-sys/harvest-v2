import { createPool } from "../src/db/pool";
import { runRetentionWorker } from "../src/server/retention-jobs";

const mode = process.argv.length > 3 ? "invalid" : process.argv[2] ?? "run";
process.exitCode = await runRetentionWorker(mode, process.env, createPool, console);
