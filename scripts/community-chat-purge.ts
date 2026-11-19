import { createPool } from "../src/db/pool";
import { runChatPurgeWorker } from "../src/server/community-chat-purge-worker";

const mode = process.argv.length > 3 ? "invalid" : process.argv[2] ?? "run";
process.exitCode = await runChatPurgeWorker(mode, process.env, createPool, console);
