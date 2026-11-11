import type { LandingDefinition } from "../lib/connect-landing";
import type { BrandTheme } from "../lib/theme-registry";
import type { Audience } from "../lib/audience";
import type { campaignStructures, campaignTypes } from "../lib/campaigns";
import type { ConnectPurpose, formVersionStatuses, responseConsentActors, responseConsentStatuses, responseContactKinds, responseLinkStatuses, responseStatuses } from "../lib/connect-data";
import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, integer, bigint, uuid, primaryKey, uniqueIndex, unique, index, foreignKey, check, jsonb, doublePrecision, date, numeric } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
  locale: text("locale"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  cityRegion: text("city_region"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  onboardingSkippedAt: timestamp("onboarding_skipped_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("user_profile_city_region", sql`${t.cityRegion} is null or length(${t.cityRegion}) between 1 and 200`)]);
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [index("sessions_user_idx").on(t.userId)]);
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }), scope: text("scope"), password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("accounts_user_idx").on(t.userId), uniqueIndex("accounts_provider_idx").on(t.providerId, t.accountId)]);
export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("verifications_identifier_idx").on(t.identifier)]);
export const rateLimits = pgTable("rate_limits", {
  id: text("id").primaryKey(), key: text("key").notNull().unique(), count: integer("count").notNull(), lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
export const otpCooldowns = pgTable("otp_cooldowns", {
  email: text("email").primaryKey(), sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).array().notNull().default(sql`ARRAY[]::timestamptz[]`),
  reservationId: uuid("reservation_id"),
});
export const roles = pgTable("roles", { id: text("id").primaryKey() });
export const workspaces = pgTable("workspaces", {
  tenantId: uuid("tenant_id").primaryKey().defaultRandom(), name: text("name").notNull(),
  brandTheme: text("brand_theme").$type<BrandTheme>().notNull().default("harvest"),
  // Ministry audience; null means unspecified (ministries created before it existed).
  audience: text("audience").$type<Audience>(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("workspace_name_length", sql`length(trim(${t.name})) BETWEEN 1 AND 100`), check("workspace_brand_theme", sql`${t.brandTheme} in ('harvest', 'studio')`),
  check("workspace_audience", sql`${t.audience} is null or ${t.audience} in ('church', 'ministry_nonprofit', 'evangelist_missionary')`)]);
export const workspaceMembers = pgTable("workspace_members", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  userId: text("user_id").notNull().references(() => users.id),
  roleId: text("role_id").notNull().references(() => roles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index("workspace_members_user_idx").on(t.userId, t.tenantId)]);
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id"),
  actorId: text("actor_id").notNull().references(() => users.id),
  action: text("action").notNull(), targetId: text("target_id"),
  metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt), foreignKey({ columns: [t.tenantId], foreignColumns: [workspaces.tenantId] })]);
export const authSchema = { user: users, session: sessions, account: accounts, verification: verifications, rateLimit: rateLimits };

// A campaign belongs to its parent workspace; it never creates another tenant.
export const campaigns = pgTable("campaigns", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  type: text("type").$type<typeof campaignTypes[number]>().notNull(),
  status: text("status").$type<"draft" | "active">().notNull().default("draft"),
  name: text("name").notNull(), description: text("description"), mission: text("mission"),
  country: text("country"), cityRegion: text("city_region"),
  startDate: date("start_date"), endDate: date("end_date"), timeZone: text("time_zone"),
  structure: text("structure").$type<typeof campaignStructures[number]>(),
  idempotencyKey: text("idempotency_key").notNull(), fingerprint: text("fingerprint").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("campaigns_tenant_idempotency_idx").on(t.tenantId, t.idempotencyKey),
  index("campaigns_tenant_created_idx").on(t.tenantId, t.createdAt, t.id),
  index("campaigns_tenant_owner_idx").on(t.tenantId, t.ownerUserId),
  check("campaign_type", sql`${t.type} in ('evangelistic_crusade', 'mission_trip', 'conference', 'local_outreach', 'custom_project')`),
  check("campaign_status", sql`${t.status} in ('draft', 'active')`),
  check("campaign_name", sql`length(btrim(${t.name})) between 1 and 200 and ${t.name} = btrim(${t.name})`),
  check("campaign_description", sql`length(${t.description}) <= 5000`),
  check("campaign_mission", sql`length(${t.mission}) <= 5000`),
  check("campaign_country", sql`length(${t.country}) between 1 and 100`),
  check("campaign_city_region", sql`length(${t.cityRegion}) between 1 and 200`),
  check("campaign_time_zone", sql`length(${t.timeZone}) between 1 and 100`),
  check("campaign_dates", sql`${t.endDate} >= ${t.startDate}`),
  check("campaign_structure", sql`${t.structure} in ('single', 'multi', 'online_hybrid')`),
  check("campaign_idempotency_key", sql`length(${t.idempotencyKey}) between 1 and 200 and ${t.idempotencyKey} ~ '^[A-Za-z0-9._:-]+$'`),
  check("campaign_fingerprint", sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
]);

export const contacts = pgTable("contacts", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  erasedAt: timestamp("erased_at", { withTimezone: true }),
  id: uuid("id").notNull().defaultRandom(), name: text("name").notNull(), notes: text("notes").notNull().default(""),
  // Display-name key for duplicate suggestions only; never an identity or merge key.
  normalizedName: text("normalized_name").notNull().generatedAlwaysAs(sql`lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))`),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index("contacts_tenant_name_idx").on(t.tenantId, t.name, t.id),
  index("contacts_tenant_normalized_name_idx").on(t.tenantId, t.normalizedName), index("contacts_tenant_created_idx").on(t.tenantId, t.createdAt, t.id),
  check("contact_version", sql`${t.version} >= 1`),
  check("contact_name_length", sql`length(trim(${t.name})) between 1 and 100`), check("contact_notes_length", sql`length(${t.notes}) <= 5000`)]);
export const contactIdentifiers = pgTable("contact_identifiers", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), contactId: uuid("contact_id").notNull(),
  kind: text("kind").$type<"email" | "phone" | "social">().notNull(), value: text("value").notNull(), normalizedValue: text("normalized_value").notNull(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  uniqueIndex("identifiers_tenant_kind_value_idx").on(t.tenantId, t.kind, t.normalizedValue),
  uniqueIndex("identifiers_tenant_contact_kind_idx").on(t.tenantId, t.contactId, t.kind),
  check("identifier_kind", sql`${t.kind} in ('email', 'phone', 'social')`),
  check("identifier_value_length", sql`length(${t.value}) between 1 and 254 and length(${t.normalizedValue}) between 1 and 254`)]);
export const contactConsents = pgTable("contact_consents", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), contactId: uuid("contact_id"),
  recordedBy: text("recorded_by").references(() => users.id),
  purpose: text("purpose").notNull(), noticeVersion: text("notice_version").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  channel: text("channel").$type<"email" | "sms" | "social">(),
  status: text("status").$type<"granted" | "withdrawn" | "unknown">().notNull(),
  source: text("source"), evidence: text("evidence"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  index("consents_tenant_contact_time_idx").on(t.tenantId, t.contactId, t.occurredAt),
  check("consent_channel", sql`${t.channel} in ('email', 'sms', 'social')`), check("consent_status", sql`${t.status} in ('granted', 'withdrawn', 'unknown')`),
  check("consent_source_length", sql`length(trim(${t.source})) between 1 and 200`), check("consent_evidence_length", sql`length(trim(${t.evidence})) between 1 and 2000`),
  // CRM-07 adds messaging, form follow-up and newsletter: separate opt-ins, never one bundled box.
  check("consent_purpose", sql`${t.purpose} in ('marketing', 'outreach_follow_up', 'event_administration', 'account_communications', 'legacy_unspecified', 'messaging', 'form_follow_up', 'newsletter')`),
  check("consent_occurrence_bound", sql`${t.occurredAt} <= ${t.recordedAt} + interval '5 minutes'`),
  check("consent_notice_version", sql`${t.noticeVersion} in ('notice-v1', 'legacy-unversioned', 'connect-immutable', 'subject-withdrawal')`),
  check("consent_redaction", sql`(${t.redactedAt} is null and ${t.contactId} is not null and ${t.channel} is not null and ${t.source} is not null and ${t.evidence} is not null) or (${t.redactedAt} is not null and ${t.channel} is null and ${t.source} is null and ${t.evidence} is null and ${t.recordedBy} is null)`)]);
// CRM-01: organizations and explicit, tenant-scoped person-organization links.
export const companies = pgTable("companies", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(), name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().generatedAlwaysAs(sql`lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))`),
  // Normalized registrable host (no scheme, www, port or path). Unique per tenant when present.
  domain: text("domain"), description: text("description").notNull().default(""),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("companies_tenant_domain_idx").on(t.tenantId, t.domain).where(sql`${t.domain} is not null`),
  index("companies_tenant_name_idx").on(t.tenantId, t.normalizedName, t.id),
  index("companies_tenant_created_idx").on(t.tenantId, t.createdAt, t.id),
  check("company_name_length", sql`length(btrim(${t.name})) between 1 and 100 and ${t.name} = btrim(${t.name})`),
  check("company_description_length", sql`length(${t.description}) <= 2000`),
  check("company_domain_format", sql`${t.domain} is null or (length(${t.domain}) <= 253 and ${t.domain} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$')`),
  check("company_version", sql`${t.version} >= 1`)]);
export const contactCompanyLinks = pgTable("contact_company_links", {
  tenantId: uuid("tenant_id").notNull(), contactId: uuid("contact_id").notNull(), companyId: uuid("company_id").notNull(),
  title: text("title").notNull().default(""), isPrimary: boolean("is_primary").notNull().default(false),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.contactId, t.companyId] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
  uniqueIndex("company_links_one_primary_idx").on(t.tenantId, t.contactId).where(sql`${t.isPrimary}`),
  index("company_links_tenant_company_idx").on(t.tenantId, t.companyId, t.contactId),
  check("company_link_title_length", sql`length(${t.title}) <= 100 and ${t.title} = btrim(${t.title})`)]);
// CRM-03: tenant-scoped custom field definitions and typed values for people and companies.
export const crmObjectTypes = ["person", "company"] as const;
export const crmFieldTypes = ["text", "number", "date", "boolean", "select", "multi_select", "relation"] as const;
export type CrmFieldOption = { value: string; label: string };
export const crmFieldDefinitions = pgTable("crm_field_definitions", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  objectType: text("object_type").$type<typeof crmObjectTypes[number]>().notNull(),
  // Stable machine key: immutable after creation (column grant + trigger).
  key: text("key").notNull(), label: text("label").notNull(), description: text("description").notNull().default(""),
  type: text("type").$type<typeof crmFieldTypes[number]>().notNull(),
  required: boolean("required").notNull().default(false),
  options: jsonb("options").$type<CrmFieldOption[]>().notNull().default([]),
  relationTarget: text("relation_target").$type<typeof crmObjectTypes[number]>(),
  position: integer("position").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("crm_fields_tenant_object_key_idx").on(t.tenantId, t.objectType, t.key),
  // Lets values reference (tenant, field, object type) so a value can never cross object types.
  uniqueIndex("crm_fields_tenant_id_object_idx").on(t.tenantId, t.id, t.objectType),
  index("crm_fields_tenant_object_position_idx").on(t.tenantId, t.objectType, t.position),
  check("crm_field_object_type", sql`${t.objectType} in ('person', 'company')`),
  check("crm_field_type", sql`${t.type} in ('text', 'number', 'date', 'boolean', 'select', 'multi_select', 'relation')`),
  check("crm_field_key", sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
  check("crm_field_label", sql`length(btrim(${t.label})) between 1 and 60 and ${t.label} = btrim(${t.label})`),
  check("crm_field_description", sql`length(${t.description}) <= 280`),
  check("crm_field_relation_target", sql`(${t.type} = 'relation') = (${t.relationTarget} is not null) and (${t.relationTarget} is null or ${t.relationTarget} in ('person', 'company'))`),
  check("crm_field_options", sql`jsonb_typeof(${t.options}) = 'array' and jsonb_array_length(${t.options}) <= 50 and (${t.type} in ('select', 'multi_select')) = (jsonb_array_length(${t.options}) > 0)`),
  check("crm_field_version", sql`${t.version} >= 1`)]);
export const crmFieldValues = pgTable("crm_field_values", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(),
  fieldId: uuid("field_id").notNull(), objectType: text("object_type").$type<typeof crmObjectTypes[number]>().notNull(),
  contactId: uuid("contact_id"), companyId: uuid("company_id"),
  valueText: text("value_text"), valueNumber: doublePrecision("value_number"), valueDate: date("value_date", { mode: "string" }),
  valueBoolean: boolean("value_boolean"), valueOptions: text("value_options").array(),
  relationContactId: uuid("relation_contact_id"), relationCompanyId: uuid("relation_company_id"),
  updatedBy: text("updated_by").notNull().references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.fieldId, t.objectType], foreignColumns: [crmFieldDefinitions.tenantId, crmFieldDefinitions.id, crmFieldDefinitions.objectType] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
  foreignKey({ columns: [t.tenantId, t.relationContactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ columns: [t.tenantId, t.relationCompanyId], foreignColumns: [companies.tenantId, companies.id] }),
  uniqueIndex("crm_values_contact_field_idx").on(t.tenantId, t.contactId, t.fieldId).where(sql`${t.contactId} is not null`),
  uniqueIndex("crm_values_company_field_idx").on(t.tenantId, t.companyId, t.fieldId).where(sql`${t.companyId} is not null`),
  index("crm_values_tenant_field_idx").on(t.tenantId, t.fieldId),
  index("crm_values_relation_contact_idx").on(t.tenantId, t.relationContactId).where(sql`${t.relationContactId} is not null`),
  check("crm_value_record", sql`(${t.objectType} = 'person' and ${t.contactId} is not null and ${t.companyId} is null) or (${t.objectType} = 'company' and ${t.companyId} is not null and ${t.contactId} is null)`),
  check("crm_value_single", sql`num_nonnulls(${t.valueText}, ${t.valueNumber}, ${t.valueDate}, ${t.valueBoolean}, ${t.valueOptions}, ${t.relationContactId}, ${t.relationCompanyId}) = 1`),
  check("crm_value_text_length", sql`${t.valueText} is null or length(${t.valueText}) between 1 and 500`)]);
// Saved list views. owner_user_id NULL = shared with the workspace; otherwise personal.
export const crmSavedViews = pgTable("crm_saved_views", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  objectType: text("object_type").$type<typeof crmObjectTypes[number]>().notNull(),
  name: text("name").notNull(), ownerUserId: text("owner_user_id").references(() => users.id),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  index("crm_views_tenant_object_idx").on(t.tenantId, t.objectType, t.ownerUserId),
  check("crm_view_object_type", sql`${t.objectType} in ('person', 'company')`),
  check("crm_view_name", sql`length(btrim(${t.name})) between 1 and 60 and ${t.name} = btrim(${t.name})`),
  check("crm_view_state", sql`jsonb_typeof(${t.state}) = 'object' and octet_length(${t.state}::text) <= 16384`),
  check("crm_view_version", sql`${t.version} >= 1`)]);
// CRM-04: tenant pipelines, ordered stages with terminal kinds, and opportunities (deals).
export const crmStageKinds = ["open", "won", "lost"] as const;
export const crmStageColors = ["neutral", "primary", "success", "warning", "destructive"] as const;
export const crmPipelines = pgTable("crm_pipelines", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  name: text("name").notNull(), isDefault: boolean("is_default").notNull().default(false),
  position: integer("position").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  // At most one live default pipeline per workspace.
  uniqueIndex("crm_pipelines_one_default_idx").on(t.tenantId).where(sql`${t.isDefault} and ${t.archivedAt} is null`),
  index("crm_pipelines_tenant_position_idx").on(t.tenantId, t.position),
  check("crm_pipeline_name", sql`length(btrim(${t.name})) between 1 and 60 and ${t.name} = btrim(${t.name})`),
  check("crm_pipeline_default_live", sql`not (${t.isDefault} and ${t.archivedAt} is not null)`),
  check("crm_pipeline_version", sql`${t.version} >= 1`)]);
export const crmPipelineStages = pgTable("crm_pipeline_stages", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), pipelineId: uuid("pipeline_id").notNull(),
  // Stable machine key: immutable after creation (column grant + trigger).
  key: text("key").notNull(), name: text("name").notNull(),
  kind: text("kind").$type<typeof crmStageKinds[number]>().notNull().default("open"),
  probability: integer("probability"), color: text("color").$type<typeof crmStageColors[number]>().notNull().default("neutral"),
  position: integer("position").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  // Opportunities reference (tenant, pipeline, stage) so a deal's stage always belongs to its pipeline.
  uniqueIndex("crm_stages_tenant_pipeline_id_idx").on(t.tenantId, t.pipelineId, t.id),
  uniqueIndex("crm_stages_pipeline_key_idx").on(t.tenantId, t.pipelineId, t.key),
  index("crm_stages_pipeline_position_idx").on(t.tenantId, t.pipelineId, t.position),
  foreignKey({ columns: [t.tenantId, t.pipelineId], foreignColumns: [crmPipelines.tenantId, crmPipelines.id] }),
  check("crm_stage_key", sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
  check("crm_stage_name", sql`length(btrim(${t.name})) between 1 and 60 and ${t.name} = btrim(${t.name})`),
  check("crm_stage_kind", sql`${t.kind} in ('open', 'won', 'lost')`),
  check("crm_stage_probability", sql`${t.probability} is null or ${t.probability} between 0 and 100`),
  check("crm_stage_color", sql`${t.color} in ('neutral', 'primary', 'success', 'warning', 'destructive')`),
  check("crm_stage_version", sql`${t.version} >= 1`)]);
export const opportunities = pgTable("opportunities", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  name: text("name").notNull(), pipelineId: uuid("pipeline_id").notNull(), stageId: uuid("stage_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2, mode: "string" }), currency: text("currency").notNull().default("USD"),
  expectedCloseDate: date("expected_close_date", { mode: "string" }),
  ownerUserId: text("owner_user_id").references(() => users.id),
  companyId: uuid("company_id"), contactId: uuid("contact_id"),
  position: doublePrecision("position").notNull().default(0),
  closedReason: text("closed_reason"),
  stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.pipelineId], foreignColumns: [crmPipelines.tenantId, crmPipelines.id] }),
  foreignKey({ columns: [t.tenantId, t.pipelineId, t.stageId], foreignColumns: [crmPipelineStages.tenantId, crmPipelineStages.pipelineId, crmPipelineStages.id] }),
  foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  index("opportunities_board_idx").on(t.tenantId, t.pipelineId, t.stageId, t.position),
  index("opportunities_company_idx").on(t.tenantId, t.companyId).where(sql`${t.companyId} is not null`),
  index("opportunities_contact_idx").on(t.tenantId, t.contactId).where(sql`${t.contactId} is not null`),
  check("opportunity_name", sql`length(btrim(${t.name})) between 1 and 200 and ${t.name} = btrim(${t.name})`),
  check("opportunity_amount", sql`${t.amount} is null or (${t.amount} >= 0 and ${t.amount} < 1000000000000)`),
  check("opportunity_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  check("opportunity_closed_reason", sql`${t.closedReason} is null or length(${t.closedReason}) between 1 and 500`),
  check("opportunity_version", sql`${t.version} >= 1`)]);
// CRM-05: tasks (ownership), notes and per-recipient in-app notifications.
export const crmTaskStatuses = ["open", "done"] as const;
export const crmTaskPriorities = ["none", "low", "medium", "high"] as const;
export const crmTasks = pgTable("crm_tasks", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  title: text("title").notNull(), body: text("body").notNull().default(""),
  status: text("status").$type<typeof crmTaskStatuses[number]>().notNull().default("open"),
  priority: text("priority").$type<typeof crmTaskPriorities[number]>().notNull().default("none"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  assigneeUserId: text("assignee_user_id").references(() => users.id),
  contactId: uuid("contact_id"), companyId: uuid("company_id"), opportunityId: uuid("opportunity_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
  foreignKey({ columns: [t.tenantId, t.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  index("crm_tasks_assignee_idx").on(t.tenantId, t.assigneeUserId, t.status, t.dueAt),
  index("crm_tasks_due_idx").on(t.tenantId, t.status, t.dueAt),
  index("crm_tasks_contact_idx").on(t.tenantId, t.contactId).where(sql`${t.contactId} is not null`),
  index("crm_tasks_company_idx").on(t.tenantId, t.companyId).where(sql`${t.companyId} is not null`),
  index("crm_tasks_opportunity_idx").on(t.tenantId, t.opportunityId).where(sql`${t.opportunityId} is not null`),
  check("crm_task_title", sql`length(btrim(${t.title})) between 1 and 200 and ${t.title} = btrim(${t.title})`),
  check("crm_task_body", sql`length(${t.body}) <= 5000`),
  check("crm_task_status", sql`${t.status} in ('open', 'done')`),
  check("crm_task_priority", sql`${t.priority} in ('none', 'low', 'medium', 'high')`),
  check("crm_task_completed", sql`(${t.status} = 'done') = (${t.completedAt} is not null)`),
  check("crm_task_version", sql`${t.version} >= 1`)]);
export const crmNotes = pgTable("crm_notes", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  body: text("body").notNull(),
  contactId: uuid("contact_id"), companyId: uuid("company_id"), opportunityId: uuid("opportunity_id"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
  foreignKey({ columns: [t.tenantId, t.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  index("crm_notes_contact_idx").on(t.tenantId, t.contactId, t.createdAt).where(sql`${t.contactId} is not null`),
  index("crm_notes_company_idx").on(t.tenantId, t.companyId, t.createdAt).where(sql`${t.companyId} is not null`),
  index("crm_notes_opportunity_idx").on(t.tenantId, t.opportunityId, t.createdAt).where(sql`${t.opportunityId} is not null`),
  // A note belongs to exactly one record.
  check("crm_note_target", sql`num_nonnulls(${t.contactId}, ${t.companyId}, ${t.opportunityId}) = 1`),
  check("crm_note_body", sql`length(btrim(${t.body})) between 1 and 10000`),
  check("crm_note_version", sql`${t.version} >= 1`)]);
export const crmNotificationKinds = ["task_assigned"] as const;
export const crmNotifications = pgTable("crm_notifications", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  recipientUserId: text("recipient_user_id").notNull().references(() => users.id),
  actorUserId: text("actor_user_id").references(() => users.id),
  kind: text("kind").$type<typeof crmNotificationKinds[number]>().notNull(),
  taskId: uuid("task_id").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [crmTasks.tenantId, crmTasks.id] }),
  index("crm_notifications_recipient_idx").on(t.tenantId, t.recipientUserId, t.readAt, t.createdAt),
  check("crm_notification_kind", sql`${t.kind} in ('task_assigned')`)]);
// CRM-06: tenant-scoped CSV imports. One row per CSV data line keeps the preview,
// the error report and batch rollback on the server (ADR 0012).
export const crmImportEntities = ["person", "company"] as const;
export const crmImportStatuses = ["draft", "preview", "running", "completed", "failed", "rolled_back"] as const;
export const crmImportRowStatuses = ["pending", "ready", "done", "error", "skipped", "rolled_back"] as const;
export const crmImportActions = ["create", "update", "skip", "error", "conflict"] as const;
export type CrmImportStats = Partial<Record<"total" | "create" | "update" | "skip" | "error" | "conflict" | "created" | "updated" | "skipped" | "failed" | "removed" | "reverted" | "kept", number>>;
/** What "Fill empty fields" changed on a matched record, so a rollback can revert exactly that. */
export type CrmImportApplied = { notes?: boolean; description?: boolean; identifiers?: string[]; companyId?: string; linked?: boolean };
export const crmImports = pgTable("crm_imports", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  entity: text("entity").$type<typeof crmImportEntities[number]>().notNull(),
  status: text("status").$type<typeof crmImportStatuses[number]>().notNull().default("draft"),
  // Client-generated per file selection: re-sending the same upload returns the same import.
  clientKey: uuid("client_key").notNull(),
  fileName: text("file_name").notNull(),
  headers: jsonb("headers").$type<string[]>().notNull(),
  // One target per header, aligned by position; null means "Don't import".
  mapping: jsonb("mapping").$type<(string | null)[]>().notNull(),
  onMatch: text("on_match").$type<"skip" | "fill">().notNull().default("skip"),
  rowCount: integer("row_count").notNull(),
  stats: jsonb("stats").$type<CrmImportStats>().notNull().default({}),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  previewedAt: timestamp("previewed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("crm_imports_client_key_idx").on(t.tenantId, t.clientKey),
  index("crm_imports_tenant_created_idx").on(t.tenantId, t.createdAt, t.id),
  check("crm_import_entity", sql`${t.entity} in ('person', 'company')`),
  check("crm_import_status", sql`${t.status} in ('draft', 'preview', 'running', 'completed', 'failed', 'rolled_back')`),
  check("crm_import_on_match", sql`${t.onMatch} in ('skip', 'fill')`),
  check("crm_import_rows_bound", sql`${t.rowCount} between 1 and 5000`),
  check("crm_import_file_name", sql`length(btrim(${t.fileName})) between 1 and 200`),
  check("crm_import_shape", sql`jsonb_typeof(${t.headers}) = 'array' and jsonb_typeof(${t.mapping}) = 'array' and jsonb_array_length(${t.headers}) between 1 and 100 and jsonb_array_length(${t.mapping}) = jsonb_array_length(${t.headers})`),
  check("crm_import_version", sql`${t.version} >= 1`)]);
export const crmImportRows = pgTable("crm_import_rows", {
  tenantId: uuid("tenant_id").notNull(), importId: uuid("import_id").notNull(),
  rowNumber: integer("row_number").notNull(),
  // The CSV cells, aligned with the import's headers. Scrubbed to [] when the person is erased.
  raw: jsonb("raw").$type<string[]>().notNull(),
  // "kind:normalized" identifiers parsed from the row, so erasure can find rows about a person.
  matchKeys: text("match_keys").array().notNull().default(sql`'{}'::text[]`),
  status: text("status").$type<typeof crmImportRowStatuses[number]>().notNull().default("pending"),
  action: text("action").$type<typeof crmImportActions[number]>(),
  error: text("error"), warning: text("warning"),
  contactId: uuid("contact_id"), companyId: uuid("company_id"),
  created: boolean("created").notNull().default(false),
  applied: jsonb("applied").$type<CrmImportApplied>(),
  resultVersion: integer("result_version"),
}, (t) => [primaryKey({ columns: [t.tenantId, t.importId, t.rowNumber] }),
  foreignKey({ columns: [t.tenantId, t.importId], foreignColumns: [crmImports.tenantId, crmImports.id] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
  index("crm_import_rows_status_idx").on(t.tenantId, t.importId, t.status, t.rowNumber),
  index("crm_import_rows_contact_idx").on(t.tenantId, t.contactId),
  index("crm_import_rows_company_idx").on(t.tenantId, t.companyId),
  index("crm_import_rows_keys_idx").using("gin", t.matchKeys),
  check("crm_import_row_number", sql`${t.rowNumber} between 1 and 5000`),
  check("crm_import_row_status", sql`${t.status} in ('pending', 'ready', 'done', 'error', 'skipped', 'rolled_back')`),
  check("crm_import_row_action", sql`${t.action} is null or ${t.action} in ('create', 'update', 'skip', 'error', 'conflict')`),
  check("crm_import_row_raw", sql`jsonb_typeof(${t.raw}) = 'array' and octet_length(${t.raw}::text) <= 20000`),
  check("crm_import_row_codes", sql`(${t.error} is null or length(${t.error}) <= 80) and (${t.warning} is null or length(${t.warning}) <= 80)`)]);

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  ownerId: text("owner_id").notNull(),
  key: text("key").notNull(), name: text("name").notNull(), mime: text("mime").notNull(),
  size: integer("size").notNull(), checksum: text("checksum").notNull(),
  status: text("status", { enum: ["pending", "uploaded", "quarantined", "ready"] }).notNull().default("pending"),
  visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("files_key_idx").on(t.key), index("files_tenant_created_idx").on(t.tenantId, t.createdAt),
  foreignKey({ columns: [t.tenantId, t.ownerId], foreignColumns: [workspaceMembers.tenantId, workspaceMembers.userId] }),
  check("files_size", sql`${t.size} BETWEEN 1 AND 10485760`),
  check("files_checksum", sql`${t.checksum} ~ '^[a-f0-9]{64}$'`),
  check("files_status", sql`${t.status} IN ('pending', 'uploaded', 'quarantined', 'ready')`),
  check("files_visibility", sql`${t.visibility} IN ('private', 'public')`),
  check("files_mime", sql`${t.mime} IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain')`),
  check("files_key_scope", sql`${t.key} = 'workspaces/' || ${t.tenantId}::text || '/files/' || ${t.id}::text`),
  check("files_name", sql`length(${t.name}) BETWEEN 1 AND 200`),
]);

// CRM-07: contact association events (Zernio, forms and other touchpoints). The event itself is an
// `association.record` row in the audit ledger; this table keeps its content, like crm_notes does for
// notes. A row exists only while the person's consent for its purpose allowed it (ADR 0013).
export const associationSources = ["zernio", "form", "touchpoint"] as const;
export const associationKinds = ["message", "comment", "mention", "form_submission", "signup", "call", "meeting", "visit", "other"] as const;
export const associationPurposes = ["messaging", "form_follow_up", "newsletter"] as const;
export const crmAssociations = pgTable("crm_associations", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  contactId: uuid("contact_id").notNull(), companyId: uuid("company_id"),
  source: text("source").$type<typeof associationSources[number]>().notNull(),
  kind: text("kind").$type<typeof associationKinds[number]>().notNull(),
  purpose: text("purpose").$type<typeof associationPurposes[number]>().notNull(),
  // The consent event that allowed storing this association (kept for the audit trail).
  consentId: uuid("consent_id").notNull(),
  // Provider event id (for example a Zernio message id) so redelivery is idempotent.
  externalId: text("external_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  summary: text("summary").notNull().default(""),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  // Set when erasure of another person scrubbed text that contained their email or phone.
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
  foreignKey({ columns: [t.tenantId, t.consentId], foreignColumns: [contactConsents.tenantId, contactConsents.id] }),
  uniqueIndex("crm_associations_external_idx").on(t.tenantId, t.source, t.externalId).where(sql`${t.externalId} is not null`),
  index("crm_associations_contact_idx").on(t.tenantId, t.contactId, t.occurredAt),
  index("crm_associations_company_idx").on(t.tenantId, t.companyId, t.occurredAt),
  check("crm_association_source", sql`${t.source} in ('zernio', 'form', 'touchpoint')`),
  check("crm_association_kind", sql`${t.kind} in ('message', 'comment', 'mention', 'form_submission', 'signup', 'call', 'meeting', 'visit', 'other')`),
  check("crm_association_purpose", sql`${t.purpose} in ('messaging', 'form_follow_up', 'newsletter')`),
  check("crm_association_external_id", sql`${t.externalId} is null or length(${t.externalId}) between 1 and 200`),
  check("crm_association_summary", sql`length(${t.summary}) <= 1000`),
  check("crm_association_payload", sql`jsonb_typeof(${t.payload}) = 'object' and octet_length(${t.payload}::text) <= 16384`)]);

// Phase 1 queues use the same composite tenant keys as the CRM spine.
export const jobStatuses = ["queued", "running", "succeeded", "dead_letter"] as const;
export const jobs = pgTable("jobs", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  kind: text("kind").notNull(), idempotencyKey: text("idempotency_key").notNull(),
  fingerprint: text("fingerprint").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status", { enum: jobStatuses }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0), runAttempts: integer("run_attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5), replayCount: integer("replay_count").notNull().default(0),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }), lockedBy: text("locked_by"), lockToken: uuid("lock_token"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("jobs_tenant_idempotency_idx").on(t.tenantId, t.idempotencyKey),
  index("jobs_tenant_due_idx").on(t.tenantId, t.status, t.scheduledFor),
  index("jobs_tenant_created_idx").on(t.tenantId, t.createdAt, t.id),
  check("jobs_status", sql`${t.status} in ('queued', 'running', 'succeeded', 'dead_letter')`),
  check("jobs_attempts", sql`${t.attempts} >= ${t.runAttempts} and ${t.runAttempts} >= 0 and ${t.maxAttempts} between 1 and 20 and ${t.replayCount} >= 0`),
  check("jobs_lock", sql`(${t.status} = 'running' and ${t.lockedAt} is not null and ${t.lockedBy} is not null and ${t.lockToken} is not null) or (${t.status} <> 'running' and ${t.lockedAt} is null and ${t.lockedBy} is null and ${t.lockToken} is null)`),
  check("jobs_key", sql`length(${t.idempotencyKey}) between 1 and 200 and length(${t.kind}) between 1 and 100`),
  check("jobs_fingerprint", sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
  check("jobs_payload", sql`jsonb_typeof(${t.payload}) = 'object' and octet_length(${t.payload}::text) <= 65536`),
  check("jobs_error", sql`${t.lastError} is null or ${t.lastError} in ('HANDLER_FAILED', 'INVALID_JOB_PAYLOAD', 'UNSUPPORTED_JOB_KIND', 'LEASE_EXPIRED')`),
]);
export const outboxEvents = pgTable("outbox_events", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  kind: text("kind").notNull(), idempotencyKey: text("idempotency_key").notNull(), fingerprint: text("fingerprint").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("outbox_tenant_idempotency_idx").on(t.tenantId, t.idempotencyKey),
  index("outbox_tenant_dispatch_idx").on(t.tenantId, t.dispatchedAt, t.createdAt),
  check("outbox_key", sql`length(${t.idempotencyKey}) between 1 and 190 and length(${t.kind}) between 1 and 100`),
  check("outbox_fingerprint", sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
  check("outbox_payload", sql`jsonb_typeof(${t.payload}) = 'object' and octet_length(${t.payload}::text) <= 65536`),
]);
export const externalWebhookEvents = pgTable("external_webhook_events", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  provider: text("provider").notNull(), connectionId: text("connection_id").notNull(), providerEventId: text("provider_event_id").notNull(),
  resourceId: text("resource_id").notNull(), sequence: integer("sequence").notNull(),
  rawBody: text("raw_body").notNull(), bodyHash: text("body_hash").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("webhooks_tenant_provider_event_idx").on(t.tenantId, t.provider, t.providerEventId),
  index("webhooks_tenant_created_idx").on(t.tenantId, t.createdAt, t.id),
  check("webhooks_provider", sql`${t.provider} = 'synthetic'`),
  check("webhooks_sequence", sql`${t.sequence} >= 0`),
  check("webhooks_fields", sql`length(${t.connectionId}) between 1 and 100 and length(${t.providerEventId}) between 1 and 100 and length(${t.resourceId}) between 1 and 100 and octet_length(${t.rawBody}) <= 65536`),
  check("webhooks_body_hash", sql`${t.bodyHash} ~ '^[a-f0-9]{64}$'`),
]);
// A deliberately small synthetic projection proves ordered, idempotent handling.
export const webhookResourceStates = pgTable("webhook_resource_states", {
  tenantId: uuid("tenant_id").notNull(), provider: text("provider").notNull(), connectionId: text("connection_id").notNull(),
  resourceId: text("resource_id").notNull(), sequence: integer("sequence").notNull(),
  eventId: uuid("event_id").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.provider, t.connectionId, t.resourceId] }),
  foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [externalWebhookEvents.tenantId, externalWebhookEvents.id] }),
  check("webhook_state_sequence", sql`${t.sequence} >= 0`),
]);

// CRM-08: outbound CRM webhooks (endpoints and per-event deliveries) and AI tool approvals.
export const crmWebhookEndpointStatuses = ["active", "disabled"] as const;
export const crmWebhookEndpoints = pgTable("crm_webhook_endpoints", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  // HTTPS destination, validated on save and re-validated (with DNS) before every delivery.
  url: text("url").notNull(),
  // CRM event types this endpoint receives (see src/server/crm-events.ts).
  eventTypes: text("event_types").array().notNull(),
  status: text("status").$type<typeof crmWebhookEndpointStatuses[number]>().notNull().default("active"),
  // The signing secret is derived from a server key and this counter; rotating bumps it. No secret is stored.
  secretVersion: integer("secret_version").notNull().default(1),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  check("crm_webhook_endpoint_url", sql`length(${t.url}) between 12 and 2000 and ${t.url} like 'https://%'`),
  check("crm_webhook_endpoint_events", sql`cardinality(${t.eventTypes}) between 1 and 50`),
  check("crm_webhook_endpoint_status", sql`${t.status} in ('active', 'disabled')`),
  check("crm_webhook_endpoint_versions", sql`${t.secretVersion} >= 1 and ${t.version} >= 1`)]);

export const crmWebhookDeliveryStatuses = ["pending", "in_flight", "succeeded", "dead", "cancelled"] as const;
export const crmWebhookDeliveryErrors = ["TIMEOUT", "NETWORK", "BLOCKED_DESTINATION", "INVALID_DESTINATION", "HTTP_STATUS", "REDIRECT", "ENDPOINT_INACTIVE", "EVENT_UNAVAILABLE", "LEASE_EXPIRED"] as const;
export const crmWebhookDeliveries = pgTable("crm_webhook_deliveries", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  endpointId: uuid("endpoint_id").notNull(),
  // The outbox row is the event; its id is the stable event id sent on every attempt.
  eventId: uuid("event_id").notNull(), eventType: text("event_type").notNull(),
  status: text("status").$type<typeof crmWebhookDeliveryStatuses[number]>().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(6),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }), lockToken: uuid("lock_token"),
  // Outcome codes only: never the URL, request body, response body or headers.
  lastStatusCode: integer("last_status_code"), lastError: text("last_error").$type<typeof crmWebhookDeliveryErrors[number]>(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.endpointId], foreignColumns: [crmWebhookEndpoints.tenantId, crmWebhookEndpoints.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [outboxEvents.tenantId, outboxEvents.id] }),
  uniqueIndex("crm_webhook_deliveries_event_idx").on(t.tenantId, t.endpointId, t.eventId),
  index("crm_webhook_deliveries_due_idx").on(t.tenantId, t.status, t.nextAttemptAt),
  check("crm_webhook_delivery_status", sql`${t.status} in ('pending', 'in_flight', 'succeeded', 'dead', 'cancelled')`),
  check("crm_webhook_delivery_attempts", sql`${t.attempts} >= 0 and ${t.maxAttempts} between 1 and 20 and ${t.attempts} <= ${t.maxAttempts}`),
  check("crm_webhook_delivery_error", sql`${t.lastError} is null or ${t.lastError} in ('TIMEOUT', 'NETWORK', 'BLOCKED_DESTINATION', 'INVALID_DESTINATION', 'HTTP_STATUS', 'REDIRECT', 'ENDPOINT_INACTIVE', 'EVENT_UNAVAILABLE', 'LEASE_EXPIRED')`),
  check("crm_webhook_delivery_status_code", sql`${t.lastStatusCode} is null or ${t.lastStatusCode} between 100 and 599`),
  check("crm_webhook_delivery_type", sql`length(${t.eventType}) between 1 and 100`)]);

export const aiToolApprovalStatuses = ["pending", "approved", "rejected", "consumed"] as const;
export const aiToolApprovals = pgTable("ai_tool_approvals", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  tool: text("tool").notNull(),
  // SHA-256 of the canonical, validated arguments. The arguments themselves are not stored.
  argsHash: text("args_hash").notNull(),
  // The person on whose behalf the tool runs; only they can approve it and only they can use the approval.
  requestedBy: text("requested_by").notNull().references(() => users.id),
  status: text("status").$type<typeof aiToolApprovalStatuses[number]>().notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }), consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  index("ai_tool_approvals_requester_idx").on(t.tenantId, t.requestedBy, t.createdAt),
  check("ai_tool_approval_tool", sql`${t.tool} ~ '^crm_[a-z_]{1,60}$'`),
  check("ai_tool_approval_hash", sql`${t.argsHash} ~ '^[a-f0-9]{64}$'`),
  check("ai_tool_approval_status", sql`${t.status} in ('pending', 'approved', 'rejected', 'consumed')`),
  check("ai_tool_approval_expiry", sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '1 hour'`)]);

// HC-02: canonical Forms storage (owned by Forms, reused by Connect and later registration forms)
// and immutable privacy notice versions. Notice copy is supplied and published by the workspace;
// Harvest stores exactly what was presented and its SHA-256, never generated legal text.
export const privacyNoticeVersions = pgTable("privacy_notice_versions", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  noticeKey: text("notice_key").notNull(), version: integer("version").notNull(), locale: text("locale").notNull(),
  body: text("body").notNull(),
  // Computed by the insert trigger from body; a caller-supplied value is overwritten.
  bodySha256: text("body_sha256").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("privacy_notice_versions_key_idx").on(t.tenantId, t.noticeKey, t.locale, t.version),
  check("privacy_notice_key", sql`${t.noticeKey} ~ '^[a-z0-9][a-z0-9._-]{0,63}$'`),
  check("privacy_notice_version", sql`${t.version} >= 1`),
  check("privacy_notice_locale", sql`${t.locale} ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' and length(${t.locale}) <= 35`),
  check("privacy_notice_body", sql`length(btrim(${t.body})) between 1 and 20000`),
  check("privacy_notice_hash", sql`${t.bodySha256} ~ '^[a-f0-9]{64}$'`)]);
export const forms = pgTable("forms", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  index("forms_tenant_created_idx").on(t.tenantId, t.createdAt, t.id),
  check("form_name", sql`length(btrim(${t.name})) between 1 and 200 and ${t.name} = btrim(${t.name})`)]);
export const formVersions = pgTable("form_versions", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), formId: uuid("form_id").notNull(),
  version: integer("version").notNull(),
  status: text("status").$type<typeof formVersionStatuses[number]>().notNull().default("draft"),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull().default({}),
  // Each offered purpose is a separate, unchecked opt-in on the published form.
  offeredPurposes: text("offered_purposes").array().$type<ConnectPurpose[]>().notNull().default(sql`ARRAY[]::text[]`),
  noticeVersionId: uuid("notice_version_id"),
  // Workspace-configured, legally reviewed pending-data retention. No platform default exists:
  // a version cannot publish until it is set. The upper bound only prevents date overflow.
  pendingRetentionDays: integer("pending_retention_days"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }), publishedBy: text("published_by").references(() => users.id),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.formId], foreignColumns: [forms.tenantId, forms.id] }),
  foreignKey({ columns: [t.tenantId, t.noticeVersionId], foreignColumns: [privacyNoticeVersions.tenantId, privacyNoticeVersions.id] }),
  uniqueIndex("form_versions_form_version_idx").on(t.tenantId, t.formId, t.version),
  check("form_version_number", sql`${t.version} >= 1`),
  check("form_version_status", sql`${t.status} in ('draft', 'published', 'retired')`),
  check("form_version_definition", sql`jsonb_typeof(${t.definition}) = 'object' and octet_length(${t.definition}::text) <= 65536`),
  check("form_version_purposes", sql`${t.offeredPurposes} <@ ARRAY['account_communications', 'outreach_follow_up', 'newsletter']::text[] and array_position(${t.offeredPurposes}, null) is null`),
  check("form_version_retention", sql`${t.pendingRetentionDays} between 1 and 36500`),
  check("form_version_publication", sql`(${t.status} = 'draft' and ${t.publishedAt} is null and ${t.publishedBy} is null and ${t.retiredAt} is null)
    or (${t.status} in ('published', 'retired') and ${t.noticeVersionId} is not null and ${t.pendingRetentionDays} is not null
      and cardinality(${t.offeredPurposes}) >= 1 and ${t.publishedAt} is not null and ${t.publishedBy} is not null
      and (${t.status} = 'retired') = (${t.retiredAt} is not null))`)]);

// HC-02: a campaign's public response source (QR code / short URL). HC-03 adds the lifecycle:
// owner/admin definers publish, disable, rotate and archive; both codes are generated by the database.
export const campaignResponseLinks = pgTable("campaign_response_links", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), campaignId: uuid("campaign_id").notNull(),
  // Null for a resource-only source: it can never accept a response.
  formVersionId: uuid("form_version_id"),
  // Opaque 128-bit code encoded in the QR. Generated by the insert trigger; a caller-supplied value is overwritten.
  publicCode: text("public_code").notNull(),
  // HC-03: human-friendly 60-bit Crockford base32 short code (/s/XXXX-XXXX-XXXX). Also database-generated.
  shortCode: text("short_code").notNull(),
  status: text("status").$type<typeof responseLinkStatuses[number]>().notNull().default("draft"),
  locale: text("locale"),
  // HC-03: internal name for organizers (night, venue, screen). Never exposed publicly.
  label: text("label"),
  // HC-03: the only organizer text the public resolver returns, and only while published.
  publicTitle: text("public_title"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }), publishedBy: text("published_by").references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  // Incremented on every rotation; retired codes stay in campaign_response_link_codes.
  codeGeneration: integer("code_generation").notNull().default(1),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.campaignId], foreignColumns: [campaigns.tenantId, campaigns.id] }),
  foreignKey({ columns: [t.tenantId, t.formVersionId], foreignColumns: [formVersions.tenantId, formVersions.id] }),
  // Public resolution is by code alone, so codes are unique across all workspaces.
  uniqueIndex("campaign_response_links_code_idx").on(t.publicCode),
  uniqueIndex("campaign_response_links_short_code_idx").on(t.shortCode),
  index("campaign_response_links_campaign_idx").on(t.tenantId, t.campaignId, t.createdAt),
  // Target for responses: the link, its campaign and its form version must agree.
  unique("campaign_response_links_parent_key").on(t.tenantId, t.campaignId, t.id, t.formVersionId),
  check("campaign_response_link_code", sql`${t.publicCode} ~ '^[a-f0-9]{32}$'`),
  check("campaign_response_link_short_code", sql`${t.shortCode} ~ '^[0-9A-HJKMNP-TV-Z]{12}$'`),
  check("campaign_response_link_status", sql`${t.status} in ('draft', 'published', 'disabled', 'archived')`),
  check("campaign_response_link_locale", sql`${t.locale} ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' and length(${t.locale}) <= 35`),
  check("campaign_response_link_label", sql`${t.label} is null or (length(btrim(${t.label})) between 1 and 80 and ${t.label} = btrim(${t.label}))`),
  check("campaign_response_link_title", sql`${t.publicTitle} is null or (length(btrim(${t.publicTitle})) between 1 and 120 and ${t.publicTitle} = btrim(${t.publicTitle}))`),
  check("campaign_response_link_generation", sql`${t.codeGeneration} >= 1`),
  check("campaign_response_link_lifecycle", sql`(${t.status} = 'draft' and ${t.publishedAt} is null and ${t.publishedBy} is null and ${t.archivedAt} is null)
    or (${t.status} in ('published', 'disabled') and ${t.publishedAt} is not null and ${t.archivedAt} is null)
    or (${t.status} = 'archived' and ${t.archivedAt} is not null)`)]);
// HC-03: every code ever issued for a link (current and retired), so a code is never reissued and
// organizers can see when printed material stopped working. Written only by the link definers.
export const campaignResponseLinkCodes = pgTable("campaign_response_link_codes", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), linkId: uuid("link_id").notNull(),
  kind: text("kind").$type<"qr" | "short">().notNull(), code: text("code").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.linkId], foreignColumns: [campaignResponseLinks.tenantId, campaignResponseLinks.id] }),
  uniqueIndex("campaign_response_link_codes_code_idx").on(t.code),
  index("campaign_response_link_codes_link_idx").on(t.tenantId, t.linkId, t.issuedAt),
  check("campaign_response_link_code_kind", sql`(${t.kind} = 'qr' and ${t.code} ~ '^[a-f0-9]{32}$') or (${t.kind} = 'short' and ${t.code} ~ '^[0-9A-HJKMNP-TV-Z]{12}$')`),
  check("campaign_response_link_code_retired", sql`${t.retiredAt} is null or ${t.retiredAt} >= ${t.issuedAt}`)]);

// HC-02: restricted pending guest intake. Separate from CRM contacts until HC-06 performs an
// authorized, verified association; nothing here creates a contact, consent or membership.
export const campaignResponses = pgTable("campaign_responses", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(),
  campaignId: uuid("campaign_id").notNull(), linkId: uuid("link_id").notNull(), formVersionId: uuid("form_version_id").notNull(),
  // Client-generated retry key; unique per campaign so a retried submission is one response.
  publicSubmissionId: uuid("public_submission_id").notNull(),
  status: text("status").$type<typeof responseStatuses[number]>().notNull().default("pending"),
  preferredName: text("preferred_name"), locale: text("locale"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  // Computed at insert from the form version's retention; never caller-supplied.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  // Set only by the controlled verified-claim transaction; no direct app write grant.
  contactId: uuid("contact_id"), associatedAt: timestamp("associated_at", { withTimezone: true }),
  erasedAt: timestamp("erased_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.campaignId], foreignColumns: [campaigns.tenantId, campaigns.id] }),
  foreignKey({ columns: [t.tenantId, t.formVersionId], foreignColumns: [formVersions.tenantId, formVersions.id] }),
  foreignKey({ name: "campaign_responses_link_fk", columns: [t.tenantId, t.campaignId, t.linkId, t.formVersionId], foreignColumns: [campaignResponseLinks.tenantId, campaignResponseLinks.campaignId, campaignResponseLinks.id, campaignResponseLinks.formVersionId] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  uniqueIndex("campaign_responses_submission_idx").on(t.tenantId, t.campaignId, t.publicSubmissionId),
  index("campaign_responses_campaign_idx").on(t.tenantId, t.campaignId, t.submittedAt),
  index("campaign_responses_expiry_idx").on(t.tenantId, t.expiresAt).where(sql`${t.status} = 'pending'`),
  index("campaign_responses_contact_idx").on(t.tenantId, t.contactId).where(sql`${t.contactId} is not null`),
  check("campaign_response_status", sql`${t.status} in ('pending', 'associated', 'erased')`),
  check("campaign_response_name", sql`${t.preferredName} is null or (length(btrim(${t.preferredName})) between 1 and 100 and ${t.preferredName} = btrim(${t.preferredName}))`),
  check("campaign_response_locale", sql`${t.locale} ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' and length(${t.locale}) <= 35`),
  check("campaign_response_state", sql`(${t.status} = 'pending' and ${t.expiresAt} is not null and ${t.contactId} is null and ${t.associatedAt} is null and ${t.erasedAt} is null)
    or (${t.status} = 'associated' and ${t.contactId} is not null and ${t.associatedAt} is not null and ${t.erasedAt} is null)
    or (${t.status} = 'erased' and ${t.erasedAt} is not null and ${t.expiresAt} is null and ${t.contactId} is null and ${t.associatedAt} is null
      and ${t.preferredName} is null and ${t.locale} is null)`)]);
// Contact methods awaiting verification. The application role has no grant on this table.
export const campaignResponseContactMethods = pgTable("campaign_response_contact_methods", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), responseId: uuid("response_id").notNull(),
  kind: text("kind").$type<typeof responseContactKinds[number]>().notNull(),
  value: text("value").notNull(), normalizedValue: text("normalized_value").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.responseId], foreignColumns: [campaignResponses.tenantId, campaignResponses.id] }).onUpdate("cascade"),
  uniqueIndex("campaign_response_contact_kind_idx").on(t.tenantId, t.responseId, t.kind),
  check("campaign_response_contact_kind", sql`${t.kind} in ('email', 'phone')`),
  check("campaign_response_contact_value", sql`length(${t.value}) between 1 and 254 and length(${t.normalizedValue}) between 1 and 254`)]);
// Append-only, per-purpose evidence for a pending response: one grant and at most one withdrawal.
export const campaignResponseConsents = pgTable("campaign_response_consents", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), responseId: uuid("response_id").notNull(),
  purpose: text("purpose").$type<ConnectPurpose>().notNull(),
  status: text("status").$type<typeof responseConsentStatuses[number]>().notNull(),
  channel: text("channel").$type<"email" | "sms">(),
  // What was presented: the published form version and its immutable notice version.
  formVersionId: uuid("form_version_id").notNull(), noticeVersionId: uuid("notice_version_id").notNull(),
  actorKind: text("actor_kind").$type<typeof responseConsentActors[number]>().notNull(),
  recordedBy: text("recorded_by").references(() => users.id),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.responseId], foreignColumns: [campaignResponses.tenantId, campaignResponses.id] }).onUpdate("cascade"),
  foreignKey({ columns: [t.tenantId, t.formVersionId], foreignColumns: [formVersions.tenantId, formVersions.id] }),
  foreignKey({ columns: [t.tenantId, t.noticeVersionId], foreignColumns: [privacyNoticeVersions.tenantId, privacyNoticeVersions.id] }),
  uniqueIndex("campaign_response_consents_grant_idx").on(t.tenantId, t.responseId, t.purpose).where(sql`${t.status} = 'granted'`),
  uniqueIndex("campaign_response_consents_withdrawal_idx").on(t.tenantId, t.responseId, t.purpose).where(sql`${t.status} = 'withdrawn'`),
  check("campaign_response_consent_purpose", sql`${t.purpose} in ('account_communications', 'outreach_follow_up', 'newsletter')`),
  check("campaign_response_consent_status", sql`${t.status} in ('granted', 'withdrawn')`),
  check("campaign_response_consent_channel", sql`${t.channel} in ('email', 'sms')`),
  check("campaign_response_consent_actor", sql`(${t.actorKind} = 'subject' and ${t.recordedBy} is null)
    or (${t.actorKind} = 'staff' and (${t.recordedBy} is not null or ${t.redactedAt} is not null))`),
  // Grants come only from the person; staff can record a withdrawal on their behalf, never a grant.
  check("campaign_response_consent_grantor", sql`${t.status} = 'withdrawn' or ${t.actorKind} = 'subject'`),
  check("campaign_response_consent_occurrence", sql`${t.occurredAt} <= ${t.recordedAt} + interval '5 minutes'`),
  check("campaign_response_consent_redaction", sql`${t.redactedAt} is null or (${t.channel} is null and ${t.recordedBy} is null)`)]);

// HC-05: one restricted, encrypted pending envelope and revocation-only receipt per response.
// No app table grants; narrow definers derive tenant context from the code or receipt hash.
export const connectIntakeReceipts = pgTable("connect_intake_receipts", {
  tenantId: uuid("tenant_id").notNull(), responseId: uuid("response_id").notNull(),
  receiptHash: text("receipt_hash").notNull(), fingerprint: text("fingerprint").notNull(),
  sealedData: jsonb("sealed_data").$type<Record<string, unknown>>().notNull(),
  replayUntil: timestamp("replay_until", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.responseId] }),
  foreignKey({ columns: [t.tenantId, t.responseId], foreignColumns: [campaignResponses.tenantId, campaignResponses.id] }),
  uniqueIndex("connect_intake_receipt_hash_idx").on(t.receiptHash),
  check("connect_intake_receipt_hash", sql`${t.receiptHash} ~ '^[a-f0-9]{64}$' and ${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
  check("connect_intake_sealed", sql`jsonb_typeof(${t.sealedData}) = 'object' and octet_length(${t.sealedData}::text) <= 4096`)]);
// Opaque, short-lived SOURCE/receipt quotas; no IP address or contact value is stored.
export const connectIntakeLimits = pgTable("connect_intake_limits", {
  key: text("key").primaryKey(), count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("connect_intake_limits_expiry_idx").on(t.expiresAt), check("connect_intake_limit_count", sql`${t.count} > 0`)]);

// Restricted, purpose-specific audit for guest/expiry operations. Never impersonates a users row.
export const connectIntakeEvents = pgTable("connect_intake_events", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), responseId: uuid("response_id"),
  event: text("event").notNull(), actor: text("actor").notNull(), purpose: text("purpose"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t=>[primaryKey({columns:[t.tenantId,t.id]}),
  foreignKey({columns:[t.tenantId,t.responseId],foreignColumns:[campaignResponses.tenantId,campaignResponses.id]}),
  check("connect_intake_event_kind",sql`${t.event} in ('submit','withdraw','erase','purge') and ${t.actor} in ('guest','worker')`),
  check("connect_intake_event_purpose",sql`(${t.event}='withdraw' and ${t.purpose} in ('outreach_follow_up','newsletter')) or (${t.event}<>'withdraw' and ${t.purpose} is null)`)]);

// HC-07: private delivery queue and one-use personal-account claim. No direct app grants.
export const connectInvitations = pgTable("connect_invitations", {
 tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), responseId: uuid("response_id").notNull(),
 sourceCode: text("source_code").notNull(), tokenHash: text("token_hash").notNull(), recipientHash: text("recipient_hash").notNull(),
 envelope: jsonb("envelope").$type<Record<string, unknown>>(), expiresAt: timestamp("expires_at",{withTimezone:true}).notNull(),
 issuedAt: timestamp("issued_at",{withTimezone:true}).array().notNull(), generation: integer("generation").notNull().default(1),
 status: text("status").notNull().default("queued"), attempts: integer("attempts").notNull().default(0),
 availableAt: timestamp("available_at",{withTimezone:true}).notNull().defaultNow(), lockedAt: timestamp("locked_at",{withTimezone:true}),
 lease: uuid("lease"), consumedAt: timestamp("consumed_at",{withTimezone:true}),
}, t=>[primaryKey({columns:[t.tenantId,t.id]}),
 foreignKey({columns:[t.tenantId,t.responseId],foreignColumns:[campaignResponses.tenantId,campaignResponses.id]}),
 uniqueIndex("connect_invitation_response_idx").on(t.tenantId,t.responseId),uniqueIndex("connect_invitation_token_idx").on(t.tokenHash),
 index("connect_invitation_due_idx").on(t.status,t.availableAt),
 check("connect_invitation_fields",sql`${t.tokenHash} ~ '^[a-f0-9]{64}$' and ${t.recipientHash} ~ '^[a-f0-9]{64}$' and ${t.sourceCode} ~ '^[a-f0-9]{32}$' and ${t.generation}>0 and ${t.attempts}>=0 and cardinality(${t.issuedAt}) between 1 and 20`),
 check("connect_invitation_status",sql`${t.status} in ('queued','running','sent','failed') and ((${t.status}='running' and ${t.lease} is not null and ${t.lockedAt} is not null) or (${t.status}<>'running' and ${t.lease} is null and ${t.lockedAt} is null))`),
 check("connect_invitation_envelope",sql`${t.envelope} is null or (jsonb_typeof(${t.envelope})='object' and octet_length(${t.envelope}::text)<=4096)`)]);
export const connectInvitationFlows = pgTable("connect_invitation_flows", {
 hash: text("hash").primaryKey(), tenantId: uuid("tenant_id").notNull(), invitationId: uuid("invitation_id").notNull(),
 generation: integer("generation").notNull(), expiresAt: timestamp("expires_at",{withTimezone:true}).notNull(),
},t=>[foreignKey({columns:[t.tenantId,t.invitationId],foreignColumns:[connectInvitations.tenantId,connectInvitations.id]}).onDelete("cascade"),
 check("connect_invitation_flow_hash",sql`${t.hash} ~ '^[a-f0-9]{64}$' and ${t.generation}>0`),index("connect_invitation_flow_expiry_idx").on(t.expiresAt)]);
// HC-06 v3 consumes this grant in the association transaction; legacy HC-07 leaves it unconsumed.
export const responseAccountClaims = pgTable("response_account_claims", {
 tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), responseId: uuid("response_id").notNull(),
 invitationId: uuid("invitation_id").notNull(), userId: text("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}),
 verifiedAt: timestamp("verified_at",{withTimezone:true}).notNull().defaultNow(), expiresAt: timestamp("expires_at",{withTimezone:true}).notNull(),
 associationConsumedAt: timestamp("association_consumed_at",{withTimezone:true}),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),
 foreignKey({columns:[t.tenantId,t.responseId],foreignColumns:[campaignResponses.tenantId,campaignResponses.id]}),
 foreignKey({columns:[t.tenantId,t.invitationId],foreignColumns:[connectInvitations.tenantId,connectInvitations.id]}).onDelete("cascade"),
 uniqueIndex("response_account_claim_response_idx").on(t.tenantId,t.responseId),check("response_account_claim_expiry",sql`${t.expiresAt}>${t.verifiedAt}`)]);

// Personalized QR landing drafts and immutable publication snapshots. Publication writes use
// connect_landing_write only; tenant/link references prevent cross-QR snapshot pointers.
export const connectLandingVersions = pgTable("connect_landing_versions", {
  tenantId: uuid("tenant_id").notNull(), linkId: uuid("link_id").notNull(), revision: integer("revision").notNull(),
  definition: jsonb("definition").$type<LandingDefinition>().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  publishedBy: text("published_by").notNull().references(() => users.id),
}, (t) => [primaryKey({ columns: [t.tenantId, t.linkId, t.revision] }),
  foreignKey({ name: "connect_landing_versions_link_fk", columns: [t.tenantId, t.linkId], foreignColumns: [campaignResponseLinks.tenantId, campaignResponseLinks.id] }),
  check("connect_landing_versions_revision_check", sql`${t.revision} > 0`),
  check("connect_landing_versions_definition_check", sql`public.valid_connect_landing(${t.definition})`)]);
export const connectLandingStates = pgTable("connect_landing_states", {
  tenantId: uuid("tenant_id").notNull(), linkId: uuid("link_id").notNull(), revision: integer("revision").notNull(),
  definition: jsonb("definition").$type<LandingDefinition>().notNull(), publishedRevision: integer("published_revision"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.linkId] }),
  foreignKey({ name: "connect_landing_states_link_fk", columns: [t.tenantId, t.linkId], foreignColumns: [campaignResponseLinks.tenantId, campaignResponseLinks.id] }),
  foreignKey({ name: "connect_landing_states_published_fk", columns: [t.tenantId, t.linkId, t.publishedRevision], foreignColumns: [connectLandingVersions.tenantId, connectLandingVersions.linkId, connectLandingVersions.revision] }),
  check("connect_landing_states_revision_check", sql`${t.revision} > 0`),
  check("connect_landing_states_definition_check", sql`public.valid_connect_landing(${t.definition})`),
  check("connect_landing_states_check", sql`${t.publishedRevision} is null or ${t.publishedRevision} <= ${t.revision}`)]);

// HC-06A: minimal provenance; trusted database writers own all mutations.
export const contactSourceEvents = pgTable("contact_source_events", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull(), contactId: uuid("contact_id").notNull(),
  kind: text("kind").$type<"manual" | "csv_import" | "connect">().notNull(),
  outcome: text("outcome").$type<"created" | "updated">().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  importId: uuid("import_id"), rowNumber: integer("row_number"),
  responseId: uuid("response_id"), entryRoute: text("entry_route").$type<"qr" | "short">(),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
}, t => [foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.importId], foreignColumns: [crmImports.tenantId, crmImports.id] }),
  foreignKey({ name: "contact_sources_response_fk", columns: [t.tenantId, t.responseId], foreignColumns: [campaignResponses.tenantId, campaignResponses.id] }).onUpdate("cascade"),
  uniqueIndex("contact_sources_response_unique").on(t.tenantId, t.responseId).where(sql`${t.kind} = 'connect'`),
  uniqueIndex("contact_sources_import_unique").on(t.tenantId, t.importId, t.rowNumber).where(sql`${t.kind} = 'csv_import'`),
  index("contact_sources_history").on(t.tenantId, t.contactId, t.occurredAt, t.id),
  check("contact_sources_contract", sql`(${t.kind} = 'manual' and ${t.outcome} = 'created' and ${t.importId} is null and ${t.rowNumber} is null and ${t.revertedAt} is null and ${t.responseId} is null and ${t.entryRoute} is null) or (${t.kind} = 'csv_import' and ${t.outcome} in ('created','updated') and ${t.importId} is not null and ${t.rowNumber} is not null and ${t.rowNumber} > 0 and ${t.responseId} is null and ${t.entryRoute} is null) or (${t.kind} = 'connect' and ${t.outcome} in ('created','updated') and ${t.importId} is null and ${t.rowNumber} is null and ${t.revertedAt} is null and ${t.responseId} is not null and ${t.entryRoute} is not null and ${t.entryRoute} in ('qr','short'))`)]);

// HC-06B restricted persistence; app access goes through scoped capability services.
export const connectResponseSubjects = pgTable("connect_response_subjects", {
  tenantId: uuid("tenant_id").notNull(), responseId: uuid("response_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  handle: uuid("handle").notNull().defaultRandom().unique(), boundAt: timestamp("bound_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.tenantId, t.responseId] }),
  foreignKey({ columns: [t.tenantId, t.responseId], foreignColumns: [campaignResponses.tenantId, campaignResponses.id] }).onUpdate("cascade"),
  index("connect_subject_user").on(t.userId, t.handle)]);
export const connectConsentOrigins = pgTable("connect_consent_origins", {
  tenantId: uuid("tenant_id").notNull(), consentId: uuid("consent_id").notNull(), responseId: uuid("response_id").notNull(),
  responseConsentId: uuid("response_consent_id").notNull(), formVersionId: uuid("form_version_id").notNull(), noticeVersionId: uuid("notice_version_id").notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.consentId] }),
  uniqueIndex("connect_consent_origins_response_unique").on(t.tenantId, t.responseConsentId),
  foreignKey({ columns: [t.tenantId, t.consentId], foreignColumns: [contactConsents.tenantId, contactConsents.id] }),
  foreignKey({ columns: [t.tenantId, t.responseId], foreignColumns: [campaignResponses.tenantId, campaignResponses.id] }).onUpdate("cascade"),
  foreignKey({ columns: [t.tenantId, t.responseConsentId], foreignColumns: [campaignResponseConsents.tenantId, campaignResponseConsents.id] }),
  foreignKey({ columns: [t.tenantId, t.formVersionId], foreignColumns: [formVersions.tenantId, formVersions.id] }),
  foreignKey({ columns: [t.tenantId, t.noticeVersionId], foreignColumns: [privacyNoticeVersions.tenantId, privacyNoticeVersions.id] })]);
export const connectClaimCompletions = pgTable("connect_claim_completions", {
  flowHash: text("flow_hash").primaryKey(), tenantId: uuid("tenant_id").notNull(), responseId: uuid("response_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [foreignKey({ columns: [t.tenantId, t.responseId], foreignColumns: [campaignResponses.tenantId, campaignResponses.id] }).onUpdate("cascade"),
  index("connect_completion_expiry").on(t.expiresAt), check("connect_completion_hash", sql`${t.flowHash} ~ '^[a-f0-9]{64}$'`)]);
