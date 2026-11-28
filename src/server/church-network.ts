import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

type ChurchLink = { id: string; parentId: string; childId: string; status: "pending" | "linked" | "unlinked" };
type ChurchSummary = ChurchLink & { activeOutreachCampaigns: number };
type Action = "request" | "accept" | "unlink" | "count";
const missing = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));
const invitation = z.object({ childId: z.uuid() }).strict();
const acceptance = z.object({ accept: z.literal(true) }).strict();

async function linkAction(db: Database, user: string, tenantId: string, action: Action, targetId: string) {
  const tenant = z.uuid().parse(tenantId);
  const target = z.uuid().parse(targetId);
  const { rows: [row] } = await withUser(db, user, tx => tx.execute<{ data: ChurchLink | ChurchSummary | null }>(
    sql`select public.church_network(${tenant}::uuid, ${action}, ${target}::uuid) as data`,
  ));
  if (row.data === null) throw missing();
  return row.data;
}

export async function listChurchLinks(db: Database, user: string, tenantId: string) {
  const tenant = z.uuid().parse(tenantId);
  const { rows: [row] } = await withUser(db, user, tx => tx.execute<{ data: ChurchLink[] | null }>(
    sql`select public.church_network_invitations(${tenant}::uuid) as data`,
  ));
  if (row.data === null) throw missing();
  return { links: row.data };
}

export function requestChurchLink(db: Database, user: string, tenant: string, input: unknown) {
  return linkAction(db, user, tenant, "request", invitation.parse(input).childId);
}

export function acceptChurchLink(db: Database, user: string, tenant: string, linkId: string, input: unknown) {
  acceptance.parse(input);
  return linkAction(db, user, tenant, "accept", linkId);
}

export function unlinkChurch(db: Database, user: string, tenant: string, linkId: string) {
  return linkAction(db, user, tenant, "unlink", linkId);
}

export function churchNetworkSummary(db: Database, user: string, tenant: string, linkId: string) {
  return linkAction(db, user, tenant, "count", linkId);
}
