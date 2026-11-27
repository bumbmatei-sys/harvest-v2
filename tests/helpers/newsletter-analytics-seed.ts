import { randomUUID } from "node:crypto";
import type { ClientBase } from "pg";

/**
 * Synthetic delivery evidence for the analytics tests, written only through a privileged connection to the disposable test database (the app role
 * cannot write deliveries outside a real send, and sending is hard-off). No personal data: deliveries carry no subscriber, address or provider reference.
 * The connection skips user triggers and foreign keys for the seed only (session_replication_role), exactly like the follow-up seed helper.
 */
export type SeedDay = { day: string; accepted: number; delivered?: number; bounced?: number; complained?: number; unsubscribed?: number; skipped?: number };
export async function seedCampaign(admin: ClientBase, input: { tenant: string; user: string; name: string; state?: "sent" | "partial" | "failed" | "sending" | "cancelled" | "draft"; days: readonly SeedDay[] }) {
  const id = randomUUID(), state = input.state ?? "sent";
  await admin.query("set session_replication_role = replica");
  try {
    await admin.query("insert into newsletter_campaigns(tenant_id,id,name,created_by,state,frozen_at,scheduled_at,timezone) values($1,$2,$3,$4,$5,case when $5='draft' then null else now() end,case when $5='draft' then null else now() end,case when $5='draft' then null else 'UTC' end)", [input.tenant, id, input.name, input.user, state]);
    await admin.query("insert into newsletter_campaign_revisions(tenant_id,campaign_id,revision,subject,content,plain_text) values($1,$2,1,$3,'{\"version\":2,\"blocks\":[]}'::jsonb,'Synthetic')", [input.tenant, id, input.name]);
    for (const day of input.days) {
      const at = `${day.day}T10:00:00Z`;
      const rows = day.accepted + (day.skipped ?? 0);
      for (let index = 0; index < rows; index++) {
        const accepted = index < day.accepted;
        await admin.query(`insert into newsletter_deliveries(tenant_id,id,campaign_id,revision,state,skip_reason,selected_at,attempted_at,accepted_at,delivered_at,bounced_at,complained_at,unsubscribed_at)
          values($1,$2,$3,1,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11,$12)`, [input.tenant, randomUUID(), id, accepted ? "accepted" : "skipped", accepted ? null : "not_subscribed", at,
          accepted ? at : null, accepted ? at : null,
          accepted && index < (day.delivered ?? 0) ? at : null,
          accepted && index >= (day.delivered ?? 0) && index < (day.delivered ?? 0) + (day.bounced ?? 0) ? at : null,
          accepted && index < (day.complained ?? 0) ? at : null,
          accepted && index >= day.accepted - (day.unsubscribed ?? 0) ? at : null]);
      }
    }
  } finally { await admin.query("set session_replication_role = origin"); }
  return id;
}

/** Synthetic daily audience counts (counts only, no people) for days before the worker's first real snapshot. Same privileged connection rule as above. */
export type SeedSnapshot = { day: string; subscribed: number; unsubscribed: number; suppressed: number };
export async function seedAudienceSnapshots(admin: ClientBase, tenant: string, days: readonly SeedSnapshot[]) {
  for (const day of days) await admin.query(`insert into newsletter_audience_snapshots(tenant_id,day,subscribed,unsubscribed,suppressed) values($1,$2,$3,$4,$5)
    on conflict (tenant_id,day) do update set subscribed=excluded.subscribed,unsubscribed=excluded.unsubscribed,suppressed=excluded.suppressed`,
    [tenant, day.day, day.subscribed, day.unsubscribed, day.suppressed]);
}
