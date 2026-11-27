import { createPool } from "../src/db/pool";
import { runBlogPublishWorker } from "../src/server/blog-publish-worker";

// Publishes scheduled blog articles whose time has come. Off unless HARVEST_BLOG_PUBLISH_ENABLED=1 outside production; connects as WORKER_DATABASE_URL.
const mode = process.argv.length > 3 ? "invalid" : process.argv[2] ?? "run";
process.exitCode = await runBlogPublishWorker(mode, process.env, createPool, console);
