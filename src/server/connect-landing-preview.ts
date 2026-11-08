import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { campaignResponseLinks, campaigns, forms, formVersions, privacyNoticeVersions } from "../db/schema";
import { intakeDefinition, intakePurposes, type IntakeManifest } from "../lib/connect-intake";
import { syntheticIntakeEnabled } from "./connect-intake-mode";
import { withTenant } from "./tenancy";

/** Protected, presentation-only preview. No public capability is minted and submission is disabled. */
export async function landingPreviewForm(db: Database, user: string, tenant: string, campaign: string, link: string): Promise<IntakeManifest | null> {
  if (!syntheticIntakeEnabled()) return null;
  return withTenant(db, user, tenant, "campaigns:write", async (tx) => {
    const [row] = await tx.select({ definition: formVersions.definition, purposes: formVersions.offeredPurposes,
      notice: privacyNoticeVersions.body, retentionDays: formVersions.pendingRetentionDays }).from(campaignResponseLinks)
      .innerJoin(campaigns, and(eq(campaigns.tenantId, tenant), eq(campaigns.id, campaignResponseLinks.campaignId), isNull(campaigns.archivedAt)))
      .innerJoin(formVersions, and(eq(formVersions.tenantId, tenant), eq(formVersions.id, campaignResponseLinks.formVersionId), eq(formVersions.status, "published")))
      .innerJoin(forms, and(eq(forms.tenantId, tenant), eq(forms.id, formVersions.formId), isNull(forms.archivedAt)))
      .innerJoin(privacyNoticeVersions, and(eq(privacyNoticeVersions.tenantId, tenant), eq(privacyNoticeVersions.id, formVersions.noticeVersionId)))
      .where(and(eq(campaignResponseLinks.tenantId, tenant), eq(campaignResponseLinks.campaignId, campaign), eq(campaignResponseLinks.id, link)));
    if (!row || row.retentionDays === null) return null;
    const definition = intakeDefinition.safeParse(row.definition);
    if (!definition.success) return null;
    return { definition: definition.data, purposes: row.purposes.filter(p => intakePurposes.includes(p)), notice: row.notice,
      retentionDays: row.retentionDays, receiptToken: "", stamp: "", capability: "" };
  });
}
