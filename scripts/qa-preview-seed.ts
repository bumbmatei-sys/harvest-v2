import { drizzle } from "drizzle-orm/node-postgres";
import { createPool } from "../src/db/pool";
import * as schema from "../src/db/schema";
import { qaSeedTarget } from "../src/server/qa-preview-gate";
import { FakeProvider } from "../src/server/social/fake-provider";
import { socialPlatforms } from "../src/lib/social/platforms";
import { AccessError } from "../src/server/permissions";
import { QA_SOCIAL_CREDENTIAL, seedQaPreview } from "./qa-preview-seed-data";

// QA-1: `npm run qa:preview-seed`. Reads HARVEST_ENV and DATABASE_URL (the harvest_app login of an allowed preview,
// staging or local test database) and nothing else from the environment, never .env files. Prints counts or a fixed
// error identifier; never a connection string, name or address. Social records are added only when
// HARVEST_CONNECT_TEST_KEY (the same synthetic key the target app holds) is set; otherwise they are skipped.
let pool: ReturnType<typeof createPool> | undefined;
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
  console.log(JSON.stringify(await seedQaPreview(db, { social })));
} catch (error) {
  const reason = error instanceof Error && /^QA_SEED_[A-Z_:a-z]+$/.test(error.message) ? error.message : "QA_SEED_FAILED";
  console.error(reason);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
