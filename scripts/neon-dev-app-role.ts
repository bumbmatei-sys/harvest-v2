import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { escapeLiteral } from "pg";
import { createPool } from "../src/db/pool";
process.loadEnvFile(".env.local");
const metadata = JSON.parse(await readFile("docs/setup/neon-project.json", "utf8"));
const direct = new URL(process.env.DATABASE_URL_UNPOOLED!);
if (metadata.projectName !== "harvest-v2" || direct.hostname !== metadata.devEndpointHost) throw new Error("Expected harvest-v2 dev only.");
const pool = createPool(direct.toString(), 1);
try {
  const existing = await readFile(".env.local", "utf8");
  if (/^DATABASE_URL=/m.test(existing)) throw new Error("An application connection already exists; no password was changed.");
  const password = randomBytes(32).toString("base64url");
  await pool.query(`ALTER ROLE harvest_app LOGIN PASSWORD ${escapeLiteral(password)}`);
  direct.username = "harvest_app"; direct.password = password;
  direct.hostname = direct.hostname.replace(/^(ep-[^.]+)\./, "$1-pooler.");
  await writeFile(".env.local", `${existing.trimEnd()}\nDATABASE_URL=${direct.toString()}\n`, { mode: 0o600 });
  console.info("Configured the unprivileged harvest_app login for harvest-v2 dev; saved pooled URL privately.");
} catch { console.error("App-role setup failed; inspect privately. No connection string logged."); process.exitCode = 1; }
finally { await pool.end(); }
