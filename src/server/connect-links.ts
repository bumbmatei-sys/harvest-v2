import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, campaignResponseLinkCodes, campaignResponseLinks, campaigns, formVersions, forms, workspaces } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { createLinkInput, linkActionInput, type LinkOutcome } from "../lib/connect-links";
import { message, type MessageKey } from "../i18n/messages";
import { AccessError, can } from "./permissions";
import { withTenant } from "./tenancy";

// HC-03: campaign QR / short-URL links. Reads follow the 0026 member policy; drafts are created by
// organizers (owner/admin/member, as in 0026); publish/disable/archive/rotate are owner/admin and
// run only through the connect_link_transition definer. Contract: docs/acceptance/hc-03.md.
const linkColumns = {
  id: campaignResponseLinks.id, campaignId: campaignResponseLinks.campaignId, label: campaignResponseLinks.label,
  publicTitle: campaignResponseLinks.publicTitle, status: campaignResponseLinks.status, locale: campaignResponseLinks.locale,
  formVersionId: campaignResponseLinks.formVersionId, publicCode: campaignResponseLinks.publicCode, shortCode: campaignResponseLinks.shortCode,
  expiresAt: campaignResponseLinks.expiresAt, publishedAt: campaignResponseLinks.publishedAt, archivedAt: campaignResponseLinks.archivedAt,
  codeGeneration: campaignResponseLinks.codeGeneration, rotatedAt: campaignResponseLinks.rotatedAt, createdAt: campaignResponseLinks.createdAt,
};
export type ConnectLink = Awaited<ReturnType<typeof listConnectLinks>>["links"][number];

async function liveCampaign(tx: Transaction, tenantId: string, campaignId: string) {
  const [row] = await tx.select({ id: campaigns.id, name: campaigns.name, status: campaigns.status }).from(campaigns)
    .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId), isNull(campaigns.archivedAt)));
  if (!row) throw new AccessError(404, message("Campaigns.notFound"));
  return row;
}

async function linkRows(tx: Transaction, tenantId: string, campaignId: string, linkId?: string) {
  const retired = tx.select({ linkId: campaignResponseLinkCodes.linkId, retired: count().as("retired") }).from(campaignResponseLinkCodes)
    .where(and(eq(campaignResponseLinkCodes.tenantId, tenantId), isNotNull(campaignResponseLinkCodes.retiredAt), eq(campaignResponseLinkCodes.kind, "qr")))
    .groupBy(campaignResponseLinkCodes.linkId).as("retired");
  return tx.select({ ...linkColumns, formStatus: formVersions.status, formVersion: formVersions.version, formName: forms.name,
    retiredCodes: sql<number>`coalesce(${retired.retired}, 0)::int` })
    .from(campaignResponseLinks)
    .leftJoin(formVersions, and(eq(formVersions.tenantId, campaignResponseLinks.tenantId), eq(formVersions.id, campaignResponseLinks.formVersionId)))
    .leftJoin(forms, and(eq(forms.tenantId, formVersions.tenantId), eq(forms.id, formVersions.formId)))
    .leftJoin(retired, eq(retired.linkId, campaignResponseLinks.id))
    .where(and(eq(campaignResponseLinks.tenantId, tenantId), eq(campaignResponseLinks.campaignId, campaignId),
      ...(linkId ? [eq(campaignResponseLinks.id, linkId)] : [])))
    .orderBy(desc(campaignResponseLinks.createdAt), desc(campaignResponseLinks.id));
}

export async function listConnectLinks(db: Database, userId: string, workspace: string, campaign: string) {
  const campaignId = uuidInput.parse(campaign);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:read", async (tx, tenantId, role) => {
    const owner = await liveCampaign(tx, tenantId, campaignId);
    const links = await linkRows(tx, tenantId, campaignId);
    // Published form versions this workspace can attach. Draft attachment is allowed by the schema
    // but a link can only publish with a published version, so the picker offers those.
    const versions = await tx.select({ id: formVersions.id, version: formVersions.version, formName: forms.name }).from(formVersions)
      .innerJoin(forms, and(eq(forms.tenantId, formVersions.tenantId), eq(forms.id, formVersions.formId)))
      .where(and(eq(formVersions.tenantId, tenantId), eq(formVersions.status, "published"), isNull(forms.archivedAt)))
      .orderBy(forms.name, desc(formVersions.version)).limit(100);
    return { campaign: owner, links, formVersions: versions, permissions: { manage: can(role, "campaigns:write"), publish: can(role, "connect:publish") } };
  });
}

/** One link for preview, projection and export (organizers only). */
export async function getConnectLink(db: Database, userId: string, workspace: string, campaign: string, link: string) {
  const campaignId = uuidInput.parse(campaign), linkId = uuidInput.parse(link);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    const owner = await liveCampaign(tx, tenantId, campaignId);
    const [row] = await linkRows(tx, tenantId, campaignId, linkId);
    if (!row) throw new AccessError(404, message("Connect.linkNotFound"));
    const [{ brandTheme }] = await tx.select({ brandTheme: workspaces.brandTheme }).from(workspaces).where(eq(workspaces.tenantId, tenantId));
    return { campaign: owner, link: row, brandTheme };
  });
}

export async function createConnectLink(db: Database, userId: string, workspace: string, campaign: string, data: unknown) {
  const campaignId = uuidInput.parse(campaign), input = createLinkInput.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), "campaigns:write", async (tx, tenantId) => {
    await liveCampaign(tx, tenantId, campaignId);
    if (input.formVersionId) {
      const [version] = await tx.select({ id: formVersions.id }).from(formVersions)
        .where(and(eq(formVersions.tenantId, tenantId), eq(formVersions.id, input.formVersionId), eq(formVersions.status, "published")));
      if (!version) throw new AccessError(404, message("Connect.formVersionNotFound"));
    }
    // Both codes are generated by the database's insert guard; these placeholders are overwritten.
    const [created] = await tx.insert(campaignResponseLinks).values({ tenantId, campaignId, createdBy: userId, label: input.label,
      publicTitle: input.publicTitle, locale: input.locale, formVersionId: input.formVersionId, publicCode: "0".repeat(32), shortCode: "0".repeat(12) })
      .returning({ id: campaignResponseLinks.id });
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "connect.link.create", targetId: created.id });
    const [row] = await linkRows(tx, tenantId, campaignId, created.id);
    return row;
  });
}

const refusals: Partial<Record<LinkOutcome, { status: 404 | 409; key: MessageKey }>> = {
  not_found: { status: 404, key: "Connect.linkNotFound" },
  stale: { status: 409, key: "Connect.outcomeStale" },
  link_archived: { status: 409, key: "Connect.outcomeArchived" },
  campaign_archived: { status: 409, key: "Connect.outcomeCampaignArchived" },
  form_not_published: { status: 409, key: "Connect.outcomeFormNotPublished" },
  expiry_in_past: { status: 409, key: "Connect.outcomeExpiryInPast" },
  invalid_transition: { status: 409, key: "Connect.outcomeInvalidTransition" },
  invalid_action: { status: 409, key: "Connect.outcomeInvalidTransition" },
};

export async function transitionConnectLink(db: Database, userId: string, workspace: string, campaign: string, link: string, data: unknown) {
  const campaignId = uuidInput.parse(campaign), linkId = uuidInput.parse(link), input = linkActionInput.parse(data);
  return withTenant(db, userId, uuidInput.parse(workspace), "connect:publish", async (tx, tenantId) => {
    // The link must belong to this campaign as well as this workspace.
    const [owned] = await tx.select({ id: campaignResponseLinks.id }).from(campaignResponseLinks)
      .where(and(eq(campaignResponseLinks.tenantId, tenantId), eq(campaignResponseLinks.campaignId, campaignId), eq(campaignResponseLinks.id, linkId)));
    if (!owned) throw new AccessError(404, message("Connect.linkNotFound"));
    const { rows } = await tx.execute<{ outcome: LinkOutcome }>(sql`select public.connect_link_transition(${tenantId}::uuid, ${linkId}::uuid, ${input.action},
      ${input.expiresAt}::timestamptz, ${input.expectedCode}) as outcome`);
    const outcome = rows[0].outcome;
    const refusal = refusals[outcome];
    if (refusal) throw new AccessError(refusal.status, message(refusal.key), { reason: outcome });
    const [row] = await linkRows(tx, tenantId, campaignId, linkId);
    return { outcome, link: row };
  });
}

/**
 * Public resolution by opaque code only. Runs as harvest_app with no tenant or user context; the
 * definer derives ownership from the code and returns only the allowlisted public fields. Read-only:
 * a scan writes nothing. Failures resolve to "unavailable" so guests still reach general resources.
 */
export async function resolveConnectLink(db: Database, kind: "qr" | "short", code: string) {
  try {
    return await db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ locale: string | null; public_title: string | null }>(sql`select locale, public_title from public.resolve_connect_link(${kind}, ${code})`);
      return rows[0] ? { locale: rows[0].locale, title: rows[0].public_title } : undefined;
    });
  } catch {
    console.error("connect_resolve_failed");
    return undefined;
  }
}
