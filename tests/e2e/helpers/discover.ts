import { readFile } from "node:fs/promises";
import { Client } from "pg";

// Seeds for the Discover browser tests. Everything goes through the disposable database's privileged connection (the one the other specs use for rows the app role cannot write):
// reviewer decisions and staff grants exist only as ops functions and never as a web route. Synthetic data only.
export async function discoverAdmin() {
  const admin = new Client({ connectionString: await readFile(`${process.env.HARVEST_E2E_MAILBOX}.admin`, "utf8") });
  await admin.connect();
  const q = async <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await admin.query<R>(sql, values)).rows;
  const userId = async (email: string) => (await q<{ id: string }>("select id from users where email = $1", [email]))[0].id;
  return {
    q, end: () => admin.end(),
    /** The review queue is global, so a spec that counts rows starts from an empty one (other specs in the same run approve listings of their own). */
    async reset() { await q("delete from discover_reports"); await q("delete from discover_controls"); await q("delete from discover_ministry_standing"); },
    /** Grant a Harvest staff role to a signed-in test user (the ops script does this in a real deployment). */
    async grantStaff(email: string, role: "reviewer" | "admin") { await q("select public.platform_staff_grant($1, $2, $3)", [await userId(email), role, "e2e ops"]); },
    /** A reviewer decision made directly in the database (approve, reject, suspend, reinstate). */
    async decide(type: string, id: string, decision: "approve" | "reject" | "suspend" | "reinstate", reason: string | null = null) {
      const [control] = await q<{ tenant_id: string; version: number }>("select tenant_id, version from discover_controls where resource_type = $1 and resource_id = $2", [type, id]);
      // The audit row names the reviewer by a real user id (a foreign key), so any existing test user stands in for the ops reviewer here.
      const [reviewer] = await q<{ id: string }>("select id from users order by created_at limit 1");
      return (await q<{ r: string }>("select public.discover_platform_decide($1::uuid, $2, $3::uuid, $4, $5, $6, $7) as r", [control.tenant_id, type, id, decision, reason, reviewer.id, control.version]))[0].r;
    },
    /** Make a person's sessions look older than the 15 minute staff sign-in window. */
    async ageSessions(email: string, minutes: number) { await q("update sessions set created_at = now() - make_interval(mins => $2) where user_id = $1", [await userId(email), minutes]); },
  };
}
