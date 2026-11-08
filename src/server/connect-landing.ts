import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { campaigns, campaignResponseLinks, connectLandingStates, connectLandingVersions } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { emptyLanding, landingDefinition, landingExpectation, saveLandingInput, type LandingDefinition } from "../lib/connect-landing";
import { message } from "../i18n/messages";
import { AccessError, can } from "./permissions";
import { withTenant } from "./tenancy";

async function read(tx: Transaction, tenantId: string, campaignId: string, linkId: string, role: string) {
  const [link] = await tx.select({ publicCode: campaignResponseLinks.publicCode, title: campaignResponseLinks.publicTitle,
    status: campaignResponseLinks.status, archivedAt: campaigns.archivedAt }).from(campaignResponseLinks)
    .innerJoin(campaigns, and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignResponseLinks.campaignId)))
    .where(and(eq(campaignResponseLinks.tenantId, tenantId), eq(campaignResponseLinks.campaignId, campaignId), eq(campaignResponseLinks.id, linkId)));
  if (!link) throw new AccessError(404, message("Connect.linkNotFound"));
  const [state] = await tx.select().from(connectLandingStates).where(and(eq(connectLandingStates.tenantId, tenantId), eq(connectLandingStates.linkId, linkId)));
  const [published] = state?.publishedRevision ? await tx.select({ definition: connectLandingVersions.definition, revision: connectLandingVersions.revision })
    .from(connectLandingVersions).where(and(eq(connectLandingVersions.tenantId, tenantId), eq(connectLandingVersions.linkId, linkId), eq(connectLandingVersions.revision, state.publishedRevision))) : [];
  const editable = !link.archivedAt && link.status !== "archived";
  return { definition: state?.definition ?? emptyLanding, revision: state?.revision ?? 0, expectedCode: link.publicCode,
    published: published ?? null, title: link.title, permissions: { edit: editable && can(role, "campaigns:write"), publish: editable && can(role, "connect:publish") } };
}
export type EditableLanding = Awaited<ReturnType<typeof getLanding>>;
export async function getLanding(db: Database, user: string, tenant: string, campaign: string, link: string) {
  const tenantId = uuidInput.parse(tenant), campaignId = uuidInput.parse(campaign), linkId = uuidInput.parse(link);
  return withTenant(db, user, tenantId, "campaigns:write", (tx, id, role) => read(tx, id, campaignId, linkId, role));
}
export async function writeLanding(db: Database, user: string, tenant: string, campaign: string, link: string, body: unknown, publish = false) {
  const tenantId = uuidInput.parse(tenant), campaignId = uuidInput.parse(campaign), linkId = uuidInput.parse(link);
  const input = publish ? landingExpectation.parse(body) : saveLandingInput.parse(body);
  return withTenant(db, user, tenantId, publish ? "connect:publish" : "campaigns:write", async (tx, id, role) => {
    const definition = "definition" in input ? JSON.stringify(input.definition) : null;
    const { rows } = await tx.execute<{ outcome: string }>(sql`select public.connect_landing_write(${id}::uuid,${campaignId}::uuid,${linkId}::uuid,
      ${input.expectedRevision}::integer,${input.expectedCode},${definition}::jsonb,${publish}) as outcome`);
    const outcome = rows[0].outcome;
    if (outcome === "not_found") throw new AccessError(404, message("Connect.linkNotFound"));
    if (outcome === "invalid") throw new AccessError(400, message("LandingEditor.invalid"));
    if (!["saved", "published", "unchanged"].includes(outcome)) throw new AccessError(409, message("LandingEditor.conflict"), { reason: outcome });
    return { ...await read(tx, id, campaignId, linkId, role), outcome };
  });
}
/** Anonymous projection: ownership comes only from the opaque current code. No cross-request cache. */
export async function resolvePublishedLanding(db: Database, kind: "qr" | "short", code: string) {
  try {
    const { rows } = await db.execute<{ locale: string | null; public_title: string | null; definition: LandingDefinition | null }>(
      sql`select locale,public_title,definition from public.resolve_connect_landing(${kind},${code})`);
    const row = rows[0];
    if (!row) return undefined;
    // Fail closed on malformed stored presentation; never substitute private draft content.
    return { locale: row.locale, title: row.public_title, definition: row.definition ? landingDefinition.parse(row.definition) : undefined };
  } catch { console.error("connect_landing_resolve_failed"); return undefined; }
}
