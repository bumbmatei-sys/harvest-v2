import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { uuidInput } from "../lib/contact-input";
import { message } from "../i18n/messages";
import { withTenant } from "./tenancy";

const LIMIT = 500;
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
    const links = (await tx.execute(sql`select id::text, campaign_id::text as "campaignId", coalesce(nullif(btrim(label), ''), short_code) as name, archived_at is not null as archived
      from campaign_response_links where tenant_id = ${tenantId} order by archived_at is not null, lower(coalesce(nullif(btrim(label), ''), short_code)), id limit ${LIMIT}`)).rows as SourceOptions["links"];
    const forms = (await tx.execute(sql`select v.id::text, f.name, v.version from form_versions v join forms f on f.tenant_id = v.tenant_id and f.id = v.form_id
      where v.tenant_id = ${tenantId} and v.status in ('published', 'retired') order by lower(f.name), v.version desc, v.id limit ${LIMIT}`)).rows as { id: string; name: string; version: number }[];
    return { campaigns, links, forms: forms.map((form) => ({ id: form.id, name: message("Crm.sourceFilters.formVersion", { name: form.name, version: form.version }) })) };
  });
}
