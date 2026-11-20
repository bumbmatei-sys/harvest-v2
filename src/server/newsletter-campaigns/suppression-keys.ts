import { sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";

function parseSuppressionKeys(env: NodeJS.ProcessEnv): string[] | null {
  let keys: unknown;
  try { keys = JSON.parse(env.HARVEST_NEWSLETTER_SUPPRESSION_KEYS ?? "null"); }
  catch { return null; }
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 8 ||
      !keys.every(key => typeof key === "string" && /^[a-f0-9]{64}$/.test(key)) || new Set(keys).size !== keys.length) {
    return null;
  }
  return keys;
}

export function newsletterSuppressionKeys(env = process.env): string {
  const keys = parseSuppressionKeys(env);
  if (!keys) throw new Error("NEWSLETTER_SUPPRESSION_KEYS_UNAVAILABLE");
  return JSON.stringify(keys);
}

export function newsletterSuppressionHealth(env = process.env) {
  const keys = parseSuppressionKeys(env);
  return keys ? { status: "present", keyVersionCount: keys.length } as const
    : { status: "missing", keyVersionCount: 0 } as const;
}

export function checkNewsletterSuppressionStartup(runtime: "web" | "worker", env = process.env) {
  const health = newsletterSuppressionHealth(env);
  const output = JSON.stringify({ event: "newsletter_suppression_key_ring", runtime, ...health });
  if (health.status === "missing") {
    console.error(output);
    // The web app can boot. Newsletter operations enforce the ring before using it.
    if (runtime === "worker") throw new Error("NEWSLETTER_SUPPRESSION_KEYS_UNAVAILABLE");
    return;
  }
  console.info(output);
}

// Local to the active transaction. Use bound parameters and disable parameter capture on this connection.
export async function installNewsletterSuppressionKeys(tx: Transaction) {
  await tx.execute(sql`select set_config('app.nl_suppression_keys',${newsletterSuppressionKeys()},true) is not null`);
}
