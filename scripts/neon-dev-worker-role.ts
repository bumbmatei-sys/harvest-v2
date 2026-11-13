import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { escapeLiteral } from "pg";
import { createPool } from "../src/db/pool";
// Neon dev branch only: creates (or re-passwords) the harvest_worker login, grants the six worker functions and saves WORKER_DATABASE_URL privately.
// Run only with approval. Staging and production follow docs/setup/worker-role.md. The password is never printed.
process.loadEnvFile(".env.local");
const metadata = JSON.parse(await readFile("docs/setup/neon-project.json", "utf8"));
const direct = new URL(process.env.DATABASE_URL_UNPOOLED!);
if (metadata.projectName !== "harvest-v2" || direct.hostname !== metadata.devEndpointHost) throw new Error("Expected harvest-v2 dev only.");
const pool = createPool(direct.toString(), 1);
try {
  const existing = await readFile(".env.local", "utf8");
  if (/^WORKER_DATABASE_URL=/m.test(existing)) throw new Error("A worker connection already exists; no password was changed.");
  const password = randomBytes(32).toString("base64url");
  await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN CREATE ROLE harvest_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$");
  await pool.query(`ALTER ROLE harvest_worker LOGIN PASSWORD ${escapeLiteral(password)}`);
  await pool.query(`GRANT EXECUTE ON FUNCTION public.community_email_enqueue(integer), public.community_email_claim(integer), public.community_email_complete(uuid, text, text),
    public.connect_retention_sweep(integer), public.connect_retention_record_failure(text), public.connect_retention_health() TO harvest_worker`);
  direct.username = "harvest_worker"; direct.password = password;
  direct.hostname = direct.hostname.replace(/^(ep-[^.]+)\./, "$1-pooler.");
  await writeFile(".env.local", `${existing.trimEnd()}\nWORKER_DATABASE_URL=${direct.toString()}\n`, { mode: 0o600 });
  console.info("Configured the unprivileged harvest_worker login for harvest-v2 dev; saved pooled URL privately.");
} catch { console.error("Worker-role setup failed; inspect privately. No connection string logged."); process.exitCode = 1; }
finally { await pool.end(); }
