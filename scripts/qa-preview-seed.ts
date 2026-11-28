import { drizzle } from "drizzle-orm/node-postgres";
import { createPool } from "../src/db/pool";
import * as schema from "../src/db/schema";
import { qaSeedTarget } from "../src/server/qa-preview-gate";
import { FakeProvider } from "../src/server/social/fake-provider";
import { socialPlatforms } from "../src/lib/social/platforms";
import { AccessError } from "../src/server/permissions";
import { storageConfig } from "../src/server/storage/s3-connection";
import { previewMedia } from "./qa-preview-media";
import { QA_SOCIAL_CREDENTIAL, seedQaPreview } from "./qa-preview-seed-data";

// QA-1: `npm run qa:preview-seed`. Reads HARVEST_ENV and DATABASE_URL (the harvest_app login of an allowed preview,
// staging or local test database). Reads explicit synthetic key and loopback storage settings, never .env files.
// Prints only counts or a fixed error identifier.
let pool: ReturnType<typeof createPool> | undefined;
let newsletterWorker: ReturnType<typeof createPool> | undefined;
try {
  if (process.argv.length > 2) throw new Error("QA_SEED_USAGE");
  const { url } = qaSeedTarget(process.env);
  pool = createPool(url, 1);
  pool.on("error", () => console.error("QA_SEED_POOL_FAILED"));
  const db = drizzle(pool, { schema });
  let social;
  if (process.env.HARVEST_CONNECT_TEST_KEY) {
    const fake = new FakeProvider({ validSecret: QA_SOCIAL_CREDENTIAL, accounts: socialPlatforms.map((platform) => ({ platform, accountRef: `test-${platform}`, displayName: `Test ${platform}` })) });
    social = { enabled: true, provider: (id: string) => { if (id === "fake") return fake; throw new AccessError(404, "unavailable"); }, now: () => new Date() };
  }
  if (process.env.QA_PREVIEW_NEWSLETTER_WORKER_URL) {
    const workerUrl = URL.parse(process.env.QA_PREVIEW_NEWSLETTER_WORKER_URL);
    const appUrl = new URL(url);
    if (!workerUrl || workerUrl.username !== "harvest_worker" || workerUrl.protocol !== appUrl.protocol ||
        workerUrl.host !== appUrl.host || workerUrl.pathname !== appUrl.pathname || workerUrl.hash ||
        [...workerUrl.searchParams.keys()].some((key) => key !== "sslmode" && key !== "channel_binding")) {
      throw new Error("QA_SEED_WORKER_TARGET_REFUSED");
    }
    newsletterWorker = createPool(workerUrl.href, 1);
    newsletterWorker.on("error", () => console.error("QA_SEED_WORKER_POOL_FAILED"));
  }
  const media = process.env.QA_PREVIEW_MEDIA === "1" ? previewMedia(storageConfig()) : undefined;
  console.log(JSON.stringify(await seedQaPreview(db, { social, media, newsletterWorker })));
} catch (error) {
  const reason = error instanceof Error && /^QA_SEED_[A-Z_:a-z]+$/.test(error.message) ? error.message : "QA_SEED_FAILED";
  console.error(reason);
  process.exitCode = 1;
} finally {
  await Promise.all([pool?.end(), newsletterWorker?.end()]);
}
