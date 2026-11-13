import { createPool } from "../src/db/pool";
import { runCommunityEmail } from "../src/server/community-email";
import { testMailboxSender } from "../src/server/community-email-sender";

// C15b: queues and sends community notification email. TEST MODE ONLY: it writes to a local mailbox file and refuses to
// run unless HARVEST_COMMUNITY_EMAIL=test, a mailbox path is set and the site origin is localhost. The live sender is
// hard-disabled in code. Runs as the application role. Run it every few minutes: digests go out when their window has elapsed.
let pool: ReturnType<typeof createPool> | undefined;
try {
  const path = process.env.HARVEST_COMMUNITY_TEST_MAILBOX, origin = new URL(process.env.BETTER_AUTH_URL ?? "");
  if (process.env.HARVEST_COMMUNITY_EMAIL !== "test" || !path || !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("TEST_MODE_REQUIRED");
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("SECRET_REQUIRED");
  pool = createPool(process.env.DATABASE_URL!);
  pool.on("error", () => console.error("community_email_pool_failed"));
  const { rows: [role] } = await pool.query("select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  if (role?.current_user !== "harvest_app" || role.rolsuper || role.rolbypassrls) throw new Error("APPLICATION_ROLE_REQUIRED");
  console.log(JSON.stringify(await runCommunityEmail(pool, testMailboxSender(path), { origin: origin.origin, secret })));
} catch { console.error("community_email_failed"); process.exitCode = 1; }
finally { await pool?.end(); }
