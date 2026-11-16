import "server-only";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { syntheticIntakeEnabled } from "./connect-intake-mode";
/** Only called from synthetic landing resolution; never receives request headers or visitor data. */
export async function recordSyntheticScan(db: Database, kind: "qr" | "short", code: string) {
  if (!syntheticIntakeEnabled()) return;
  await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.connect_intake_mode','synthetic',true)`);
    await tx.execute(sql`select public.connect_record_scan(${kind},${code})`);
  });
}
