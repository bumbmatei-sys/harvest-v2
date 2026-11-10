import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { uuidInput } from "../lib/contact-input";
import { message } from "../i18n/messages";
import { withTenant } from "./tenancy";

const LIMIT = 500;
/** A link's organizer-facing name. An unlabeled link never falls back to its public short code. */
export const linkDisplayName = (label: string | null, campaign: string) => label?.trim() || message("Crm.sourceFilters.untitledLink", { campaign });
export type SourceOptions = {
  campaigns: { id: string; name: string; archived: boolean }[];
  links: { id: string; campaignId: string; name: string; archived: boolean }[];
  forms: { id: string; name: string }[];
};

/**
 * Choices for the source-rule editor (HC-06C). Owners and admins only, the same capability as the
 * Source column. Only form versions that can carry responses (published or retired) are offered.
 * Link labels are internal organizer names; public codes are never returned.
 */
export function sourceOptions(db: Database, userId: string, workspace: string): Promise<SourceOptions> {
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:sources_read", async (tx, tenantId) => {
    const campaigns = (await tx.execute(sql`select id::text, name, archived_at is not null as archived from campaigns
      where tenant_id = ${tenantId} order by archived_at is not null, lower(name), id limit ${LIMIT}`)).rows as SourceOptions["campaigns"];
    const linkRows = (await tx.execute(sql`select l.id::text, l.campaign_id::text as "campaignId", nullif(btrim(l.label), '') as label, c.name as campaign, l.archived_at is not null as archived
      from campaign_response_links l join campaigns c on c.tenant_id = l.tenant_id and c.id = l.campaign_id where l.tenant_id = ${tenantId}
      order by l.archived_at is not null, lower(coalesce(nullif(btrim(l.label), ''), c.name)), l.id limit ${LIMIT}`)).rows as { id: string; campaignId: string; label: string | null; campaign: string; archived: boolean }[];
    const links: SourceOptions["links"] = linkRows.map((row) => ({ id: row.id, campaignId: row.campaignId, name: linkDisplayName(row.label, row.campaign), archived: row.archived }));
    const forms = (await tx.execute(sql`select v.id::text, f.name, v.version from form_versions v join forms f on f.tenant_id = v.tenant_id and f.id = v.form_id
      where v.tenant_id = ${tenantId} and v.status in ('published', 'retired') order by lower(f.name), v.version desc, v.id limit ${LIMIT}`)).rows as { id: string; name: string; version: number }[];
    return { campaigns, links, forms: forms.map((form) => ({ id: form.id, name: message("Crm.sourceFilters.formVersion", { name: form.name, version: form.version }) })) };
  });
}
