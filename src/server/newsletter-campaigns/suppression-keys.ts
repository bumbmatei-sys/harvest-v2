import { sql } from "drizzle-orm";
import type { Transaction } from "../../db/client";

export function newsletterSuppressionKeys(env: Record<string, string | undefined> = process.env): string {
  let keys: unknown;
  try { keys = JSON.parse(env.HARVEST_NEWSLETTER_SUPPRESSION_KEYS ?? "null"); }
  catch { throw new Error("NEWSLETTER_SUPPRESSION_KEYS_UNAVAILABLE"); }
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 8 ||
      !keys.every(key => typeof key === "string" && /^[a-f0-9]{64}$/.test(key)) || new Set(keys).size !== keys.length) {
    throw new Error("NEWSLETTER_SUPPRESSION_KEYS_UNAVAILABLE");
  }
  return JSON.stringify(keys);
}

// Local to the active transaction. Use bound parameters and disable parameter capture on this connection.
export async function installNewsletterSuppressionKeys(tx: Transaction) {
  await tx.execute(sql`select set_config('app.nl_suppression_keys',${newsletterSuppressionKeys()},true) is not null`);
}
