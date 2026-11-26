import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import type { EventItem } from "../lib/event-view";
import { message } from "../i18n/messages";
import { eventsEnabled } from "./events";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

/** The events a campaign shows. `manage` is true for Events owners/admins, who see every linked event (drafts included) and may add or remove one. */
export type CampaignEventsView = { events: EventItem[]; manage: boolean };
export type CampaignEventCandidate = { id: string; title: string; startsAt: string; timeZone: string; status: EventItem["status"] };
type Outcome<T> = { outcome: "ok"; data: T; manage?: boolean } | { outcome: "not_found" };
type Action = "list" | "candidates" | "link" | "unlink";

export const campaignEventInput = z.object({ eventId: z.uuid(), linked: z.boolean() }).strict();

async function operate<T>(tx: Transaction, tenantId: string, campaignId: string, action: Action, eventId: string | null = null): Promise<{ data: T; manage: boolean }> {
  const result = (await tx.execute<{ result: Outcome<T> }>(sql`select public.campaign_events_operate(${tenantId}::uuid, ${campaignId}::uuid, ${action}, ${eventId}::uuid) as result`)).rows[0].result;
  if (result.outcome !== "ok") throw new AccessError(404, message("Campaigns.notFound"));
  return { data: result.data, manage: result.manage === true };
}

/**
 * Campaign events (founder approval, 26 Nov): a campaign links existing ministry events; Events stays the only events system. The database function
 * checks both sides. The caller must be able to write campaigns. Events owners/admins see every linked event; anyone else sees only the linked events
 * Events already shows them (published, in a community they can see), so a campaign never reveals an event Events would hide. Null while Events is off.
 */
export async function campaignEventsOf(tx: Transaction, tenantId: string, campaignId: string): Promise<CampaignEventsView | null> {
  if (!eventsEnabled()) return null;
  const { data, manage } = await operate<EventItem[]>(tx, tenantId, campaignId, "list");
  return { events: data, manage };
}

export async function listCampaignEvents(db: Database, userId: string, workspace: string, campaign: string): Promise<CampaignEventsView | null> {
  const id = uuidInput.parse(campaign);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", (tx, tenantId) => campaignEventsOf(tx, tenantId, id));
}

/** Events owners/admins only: the ministry's events that are not cancelled, not long over and not yet in this campaign. */
export async function campaignEventCandidates(db: Database, userId: string, workspace: string, campaign: string): Promise<CampaignEventCandidate[]> {
  const id = uuidInput.parse(campaign);
  if (!eventsEnabled()) throw new AccessError(404, message("Campaigns.notFound"));
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => (await operate<CampaignEventCandidate[]>(tx, tenantId, id, "candidates")).data);
}

/** Adds an event to the campaign or removes it. The event itself is not changed, published or announced. Audited when something changed. */
export async function setCampaignEvent(db: Database, userId: string, workspace: string, campaign: string, raw: unknown): Promise<CampaignEventsView> {
  const id = uuidInput.parse(campaign), { eventId, linked } = campaignEventInput.parse(raw);
  if (!eventsEnabled()) throw new AccessError(404, message("Campaigns.notFound"));
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const { data } = await operate<{ changed: boolean }>(tx, tenantId, id, linked ? "link" : "unlink", eventId);
    if (data.changed) await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: linked ? "campaign.event.link" : "campaign.event.unlink", targetId: id, metadata: { eventId } });
    return (await campaignEventsOf(tx, tenantId, id))!;
  });
}
