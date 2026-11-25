import { accountMetrics, postMetrics, type AccountMetric, type AnalyticsStatus, type Metrics, type PostMetric } from "../lib/social/analytics";
import { adNetworks, adGoals, adStatuses, leadStatuses as adLeadStatuses, type ResultMetrics } from "../lib/ads/ads";
import type { AutoDmRule } from "../lib/social/auto-dm";
import { socialUploadLimits } from "../lib/social/upload-limits";
import { socialMediaMimes, type MediaMetadata } from "../lib/social/media";
import { socialPlatforms, type SocialPlatform } from "../lib/social/platforms";
import type { ComposerInput, DeliveryPayload, WeeklySlot } from "../lib/social/composer";
import type { LandingDefinition } from "../lib/connect-landing";
import type { RichDoc } from "../lib/rich-text";
import type { BrandTheme } from "../lib/theme-registry";
import type { Audience } from "../lib/audience";
import type { campaignStructures, campaignTypes } from "../lib/campaigns";
import type { BudgetConfig, OutreachConfig } from "../lib/campaign-wizard";
import type { ConnectPurpose, formVersionStatuses, responseConsentActors, responseConsentStatuses, responseContactKinds, responseLinkStatuses, responseStatuses } from "../lib/connect-data";
import { associationConsentPurposes } from "../lib/consent-purposes";
import type { FollowUpCaseState } from "../lib/follow-up-cases";
import { sql } from "drizzle-orm";
import { pgTable, type AnyPgColumn, text, timestamp, boolean, integer, bigint, uuid, primaryKey, uniqueIndex, unique, index, foreignKey, check, jsonb, doublePrecision, date, numeric } from "drizzle-orm/pg-core";

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
  // IANA time zone name (validated by the app): CRM report periods and labels are computed in it. Existing ministries read UTC.
  timeZone: text("time_zone").notNull().default("UTC"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("workspace_time_zone", sql`length(${t.timeZone}) between 1 and 64`), check("workspace_name_length", sql`length(trim(${t.name})) BETWEEN 1 AND 100`), check("workspace_brand_theme", sql`${t.brandTheme} in ('harvest', 'studio')`),
  check("workspace_audience", sql`${t.audience} is null or ${t.audience} in ('church', 'ministry_nonprofit', 'evangelist_missionary', 'creator')`)]);
export const workspaceMembers = pgTable("workspace_members", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  userId: text("user_id").notNull().references(() => users.id),
  roleId: text("role_id").notNull().references(() => roles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index("workspace_members_user_idx").on(t.userId, t.tenantId)]);
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id"),
  // Null identifies an automatic follow-up action; application inserts still require the session actor (RLS).
  actorId: text("actor_id").references(() => users.id),
  action: text("action").notNull(), targetId: text("target_id"),
  metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt), foreignKey({ columns: [t.tenantId], foreignColumns: [workspaces.tenantId] }),
  index("community_chat_mutations_idx").on(t.actorId,t.action,t.createdAt),
  check("audit_system_actor", sql`${t.actorId} is not null or ${t.action} in ('followup.case.withdraw', 'followup.case.revoke', 'community.live.auto_close', 'community.moderation_report_expire', 'newsletter.signup.confirmed', 'newsletter.unsubscribe.list', 'newsletter.unsubscribe.all', 'newsletter.withdrawal.propagated', 'community.profile_save', 'community.profile_withdraw', 'community.profile_erase', 'crm.form.submit', 'bio.message.submit', 'docs.trash.purge')`)]);
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
  // Optional cover image or logo, carried over from the wizard draft's cover when the draft is finished.
  coverFileId: uuid("cover_file_id").references((): AnyPgColumn => campaignFiles.id, { onDelete: "set null" }),
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

// CW-03 to CW-05: the private wizard draft behind a campaign. Steps 1 to 3 are columns, steps 4 to 7 are stored as intent only. Nothing reads
// budget or outreach to act outwardly. A finished draft links the campaign it created.
export const campaignDrafts = pgTable("campaign_drafts", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  createdBy: text("created_by").notNull().references(() => users.id),
  clientKey: text("client_key").notNull(),
  status: text("status").$type<"draft" | "finished" | "discarded">().notNull().default("draft"),
  version: integer("version").notNull().default(1),
  currentStep: integer("current_step").notNull().default(1),
  type: text("type").$type<typeof campaignTypes[number]>(),
  name: text("name"), description: text("description"), mission: text("mission"),
  country: text("country"), cityRegion: text("city_region"),
  startDate: date("start_date"), endDate: date("end_date"), timeZone: text("time_zone"),
  structure: text("structure").$type<typeof campaignStructures[number]>(),
  departments: text("departments").array().notNull().default(sql`'{}'::text[]`),
  modules: text("modules").array().notNull().default(sql`'{}'::text[]`),
  budget: jsonb("budget").$type<BudgetConfig>().notNull(),
  outreach: jsonb("outreach").$type<OutreachConfig>().notNull(),
  campaignId: uuid("campaign_id"), finishedAt: timestamp("finished_at", { withTimezone: true }),
  coverFileId: uuid("cover_file_id").references((): AnyPgColumn => campaignFiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.campaignId], foreignColumns: [campaigns.tenantId, campaigns.id] }),
  uniqueIndex("campaign_drafts_client_key_idx").on(t.tenantId, t.createdBy, t.clientKey),
  uniqueIndex("campaign_drafts_campaign_idx").on(t.tenantId, t.campaignId).where(sql`${t.campaignId} is not null`),
  index("campaign_drafts_tenant_idx").on(t.tenantId, t.status, t.updatedAt),
  check("campaign_draft_status", sql`${t.status} in ('draft', 'finished', 'discarded')`),
  check("campaign_draft_version", sql`${t.version} >= 1`),
  check("campaign_draft_step", sql`${t.currentStep} between 1 and 8`),
  check("campaign_draft_type", sql`${t.type} is null or ${t.type} in ('evangelistic_crusade', 'mission_trip', 'conference', 'local_outreach', 'custom_project')`),
  check("campaign_draft_name", sql`${t.name} is null or (length(btrim(${t.name})) between 1 and 200 and ${t.name} = btrim(${t.name}))`),
  check("campaign_draft_text", sql`length(${t.description}) <= 5000 and length(${t.mission}) <= 5000 and length(${t.country}) between 1 and 100 and length(${t.cityRegion}) between 1 and 200 and length(${t.timeZone}) between 1 and 100`),
  check("campaign_draft_dates", sql`${t.endDate} >= ${t.startDate}`),
  check("campaign_draft_structure", sql`${t.structure} in ('single', 'multi', 'online_hybrid')`),
  check("campaign_draft_client_key", sql`length(${t.clientKey}) between 1 and 200 and ${t.clientKey} ~ '^[A-Za-z0-9._:-]+$'`),
  check("campaign_draft_lists", sql`cardinality(${t.departments}) <= 13 and cardinality(${t.modules}) <= 18`),
  check("campaign_draft_json", sql`jsonb_typeof(${t.budget}) = 'object' and jsonb_typeof(${t.outreach}) = 'object'`),
  // A finished draft names its campaign; no other state does. A finished draft is complete: it has a type and a name.
  check("campaign_draft_finished", sql`(${t.status} = 'finished') = (${t.campaignId} is not null and ${t.finishedAt} is not null) and (${t.status} <> 'finished' or (${t.type} is not null and ${t.name} is not null))`),
]);
// The optional cover image or logo of a draft (and of the campaign it becomes). Same scanned-upload states as event covers: pending, uploaded,
// quarantined, ready. Only a ready, unretired file can be a cover. Storage objects of replaced covers are not cleaned up yet (see the acceptance record).
export const campaignFiles = pgTable("campaign_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  draftId: uuid("draft_id").notNull(),
  uploaderId: text("uploader_id").references(() => users.id, { onDelete: "set null" }),
  key: text("key").notNull().unique(),
  kind: text("kind", { enum: ["cover"] }).notNull().default("cover"),
  name: text("name").notNull(),
  mime: text("mime", { enum: ["image/jpeg", "image/png", "image/webp"] }).notNull(),
  size: integer("size").notNull(),
  checksum: text("checksum").notNull(),
  status: text("status", { enum: ["pending", "uploaded", "quarantined", "ready"] }).notNull().default("pending"),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.draftId], foreignColumns: [campaignDrafts.tenantId, campaignDrafts.id] }),
  index("campaign_files_draft_idx").on(t.tenantId, t.draftId),
  check("campaign_file_kind", sql`${t.kind} = 'cover'`),
  check("campaign_file_mime", sql`${t.mime} in ('image/jpeg','image/png','image/webp')`),
  check("campaign_file_name", sql`length(btrim(${t.name})) between 1 and 200`),
  check("campaign_file_size", sql`${t.size} between 1 and 10485760`),
  check("campaign_file_checksum", sql`${t.checksum} ~ '^[a-f0-9]{64}$'`),
  check("campaign_file_status", sql`${t.status} in ('pending','uploaded','quarantined','ready')`),
  check("campaign_file_key", sql`${t.key} = 'workspaces/' || ${t.tenantId}::text || '/campaign-drafts/' || ${t.draftId}::text || '/files/' || ${t.id}::text`),
]);
// Department leaders and members of a draft. People are existing ministry members; a CRM contact is never referenced here.
export const campaignDraftAssignments = pgTable("campaign_draft_assignments", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), draftId: uuid("draft_id").notNull(),
  userId: text("user_id").notNull(), department: text("department").notNull(), role: text("role").$type<"leader" | "member">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.draftId], foreignColumns: [campaignDrafts.tenantId, campaignDrafts.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [workspaceMembers.tenantId, workspaceMembers.userId] }).onDelete("cascade"),
  uniqueIndex("campaign_draft_assignments_unique_idx").on(t.tenantId, t.draftId, t.department, t.userId),
  index("campaign_draft_assignments_user_idx").on(t.tenantId, t.userId),
  check("campaign_draft_assignment_role", sql`${t.role} in ('leader', 'member')`),
  check("campaign_draft_assignment_department", sql`${t.department} in ('campaign_leadership', 'church_mobilization', 'evangelistic_outreach', 'prayer_intercession', 'marketing_media', 'logistics_equipment', 'finance_fundraising', 'volunteers', 'counseling', 'discipleship_follow_up', 'worship_production', 'security_medical', 'transportation_hospitality')`),
]);

export const contacts = pgTable("contacts", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  erasedAt: timestamp("erased_at", { withTimezone: true }),
  id: uuid("id").notNull().defaultRandom(), name: text("name").notNull(), notes: text("notes").notNull().default(""),
  // Initial routing for a person created from a hosted CRM form.
  formOwnerId: text("form_owner_id").references(() => users.id, { onDelete: "set null" }),
  formLabels: text("form_labels").array().notNull().default(sql`ARRAY[]::text[]`),
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
  check("consent_notice_version", sql`${t.noticeVersion} in ('notice-v1', 'legacy-unversioned', 'connect-immutable', 'subject-withdrawal', 'newsletter-subject-v1', 'ad-lead-form-v1')`),
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
// Deal stage movement, recorded by a trigger on every stage change (no content). Read by owners and admins for the CRM reports.
export const crmDealStageMoves = pgTable("crm_deal_stage_moves", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull(), dealId: uuid("deal_id").notNull(),
  fromStageId: uuid("from_stage_id").notNull(), toStageId: uuid("to_stage_id").notNull(),
  movedAt: timestamp("moved_at", { withTimezone: true }).notNull().defaultNow(), movedBy: text("moved_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [foreignKey({ name: "crm_deal_stage_moves_deal_fk", columns: [t.tenantId, t.dealId], foreignColumns: [opportunities.tenantId, opportunities.id] }).onDelete("cascade"),
  index("crm_deal_stage_moves_period_idx").on(t.tenantId, t.movedAt), index("crm_deal_stage_moves_deal_idx").on(t.tenantId, t.dealId, t.movedAt)]);
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
export const crmNotificationKinds = ["task_assigned", "task_due", "task_overdue"] as const;
export const crmNotifications = pgTable("crm_notifications", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  recipientUserId: text("recipient_user_id").notNull().references(() => users.id),
  actorUserId: text("actor_user_id").references(() => users.id),
  kind: text("kind").$type<typeof crmNotificationKinds[number]>().notNull(),
  taskId: uuid("task_id").notNull(),
  // The due time a due/overdue notice was generated for; with the task, recipient and kind it is the dedupe key.
  dueAt: timestamp("due_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [crmTasks.tenantId, crmTasks.id] }),
  index("crm_notifications_recipient_idx").on(t.tenantId, t.recipientUserId, t.readAt, t.createdAt),
  uniqueIndex("crm_notifications_due_unique").on(t.tenantId, t.taskId, t.recipientUserId, t.kind, t.dueAt).where(sql`${t.kind} in ('task_due', 'task_overdue')`),
  check("crm_notification_kind", sql`${t.kind} in ('task_assigned', 'task_due', 'task_overdue')`),
  check("crm_notification_due_at", sql`(${t.kind} = 'task_assigned') = (${t.dueAt} is null)`)]);
// Per-person on/off for each due/overdue kind in one ministry (default on; in-app only).
export const crmNotificationPreferences = pgTable("crm_notification_preferences", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  userId: text("user_id").notNull().references(() => users.id),
  due: boolean("due").notNull().default(true),
  overdue: boolean("overdue").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId] })]);
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
  size: bigint("size", { mode: "number" }).notNull(), checksum: text("checksum").notNull(),
  status: text("status", { enum: ["pending", "uploaded", "quarantined", "ready"] }).notNull().default("pending"),
  visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
  socialUpload: boolean("social_upload").notNull().default(false),
  mediaMetadata: jsonb("media_metadata").$type<MediaMetadata>(),
  multipartId: text("multipart_id"),
  socialRetiredAt: timestamp("social_retired_at", { withTimezone: true }),
  socialConfirmUntil: timestamp("social_confirm_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("files_key_idx").on(t.key), unique("files_tenant_id_id_unique").on(t.tenantId, t.id), index("files_tenant_created_idx").on(t.tenantId, t.createdAt),
  foreignKey({ columns: [t.tenantId, t.ownerId], foreignColumns: [workspaceMembers.tenantId, workspaceMembers.userId] }),
  check("files_size", sql`${t.size} BETWEEN 1 AND (case when ${t.socialUpload} then ${sql.raw(String(socialUploadLimits.fileBytes))} else 10485760 end)`),
  check("files_checksum", sql`${t.checksum} ~ '^[a-f0-9]{64}$'`),
  check("files_status", sql`${t.status} IN ('pending', 'uploaded', 'quarantined', 'ready')`),
  check("files_visibility", sql`${t.visibility} IN ('private', 'public')`),
  check("files_mime", sql`(${t.socialUpload} and ${t.mime} IN (${sql.raw(socialMediaMimes.map(mime => "'" + mime + "'").join(", "))}))
    or (not ${t.socialUpload} and ${t.mime} IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'))`),
  check("files_social_upload_shape", sql`(not ${t.socialUpload} and ${t.mediaMetadata} is null and ${t.multipartId} is null)
    or (${t.socialUpload} and ${t.visibility} = 'private' and (${t.status} <> 'ready' or (jsonb_typeof(${t.mediaMetadata}) = 'object' and ${t.mediaMetadata} is not null))
       and (${t.multipartId} is null or length(${t.multipartId}) between 1 and 2048))`),
  check("files_social_operation_scope", sql`${t.socialUpload} or (${t.socialRetiredAt} is null and ${t.socialConfirmUntil} is null)`),
  index("social_upload_cleanup_idx").on(t.createdAt, t.id).where(sql`${t.socialUpload} and ${t.status} in ('pending','uploaded')`),
  check("files_key_scope", sql`${t.key} = 'workspaces/' || ${t.tenantId}::text || '/files/' || ${t.id}::text`),
  check("files_name", sql`length(${t.name}) BETWEEN 1 AND 200`),
]);

// CRM-07: contact association events (Zernio, forms and other touchpoints). The event itself is an
// `association.record` row in the audit ledger; this table keeps its content, like crm_notes does for
// notes. A row exists only while the person's consent for its purpose allowed it (ADR 0013).
export const associationSources = ["zernio", "form", "touchpoint"] as const;
export const associationKinds = ["message", "comment", "mention", "form_submission", "signup", "call", "meeting", "visit", "other"] as const;
export const associationPurposes = associationConsentPurposes;
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
  check("ai_tool_approval_expiry", sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '10 minutes'`)]);

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
  check("form_version_retention", sql`${t.pendingRetentionDays} between 1 and 36500`), // the platform maximum (30) is enforced by a trigger, migration 0043
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
// HC retention (migration 0043): one row per sweep. Counts only: no ministry, no response, no person.
export const connectRetentionRuns = pgTable("connect_retention_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status", { enum: ["ok", "failed"] as const }).notNull(),
  responsesErased: integer("responses_erased").notNull().default(0),
  tombstonesDeleted: integer("tombstones_deleted").notNull().default(0),
  errorCode: text("error_code"),
}, (t) => [
  index("connect_retention_runs_finished_idx").on(t.finishedAt.desc()),
  check("connect_retention_run_status", sql`${t.status} in ('ok', 'failed') and (${t.status} = 'failed') = (${t.errorCode} is not null)`),
  check("connect_retention_run_error", sql`${t.errorCode} is null or ${t.errorCode} ~ '^[a-z_]{1,40}$'`),
  check("connect_retention_run_counts", sql`${t.responsesErased} >= 0 and ${t.tombstonesDeleted} >= 0`)]);

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

// Hosted CRM publication is separate from Connect publication and its offered purposes.
export const crmFormPublications = pgTable("crm_form_publications", {
  tenantId: uuid("tenant_id").notNull(), formId: uuid("form_id").notNull(), versionId: uuid("version_id").notNull(),
  noticeVersionId: uuid("notice_version_id").notNull(), publishedBy: text("published_by").notNull().references(() => users.id),
  definition: jsonb("definition").notNull(), publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.tenantId, t.formId, t.versionId] }),
  foreignKey({ name: "crm_form_publication_form_fk", columns: [t.tenantId, t.formId], foreignColumns: [forms.tenantId, forms.id] }),
  foreignKey({ name: "crm_form_publication_version_fk", columns: [t.tenantId, t.versionId], foreignColumns: [formVersions.tenantId, formVersions.id] }),
  foreignKey({ name: "crm_form_publication_notice_fk", columns: [t.tenantId, t.noticeVersionId], foreignColumns: [privacyNoticeVersions.tenantId, privacyNoticeVersions.id] }),
  check("crm_form_publication_definition", sql`jsonb_typeof(${t.definition}) = 'object' and ${t.definition}->>'kind' = 'crm-form-v1' and octet_length(${t.definition}::text) <= 65536`)]);

export const crmFormAddresses = pgTable("crm_form_addresses", {
  tenantId: uuid("tenant_id").notNull(), formId: uuid("form_id").notNull(), slug: text("slug").notNull(),
  versionId: uuid("version_id"), retiredAt: timestamp("retired_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.tenantId, t.formId] }), uniqueIndex("crm_form_address_slug_idx").on(t.slug),
  foreignKey({ name: "crm_form_address_form_fk", columns: [t.tenantId, t.formId], foreignColumns: [forms.tenantId, forms.id] }),
  foreignKey({ name: "crm_form_address_version_fk", columns: [t.tenantId, t.formId, t.versionId], foreignColumns: [crmFormPublications.tenantId, crmFormPublications.formId, crmFormPublications.versionId] }),
  check("crm_form_address_slug", sql`public.valid_crm_form_slug(${t.slug})`),
  check("crm_form_address_state", sql`(${t.versionId} is null) = (${t.retiredAt} is not null)`)]);

export const crmFormResponses = pgTable("crm_form_responses", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull(), formId: uuid("form_id").notNull(), versionId: uuid("version_id").notNull(),
  contactId: uuid("contact_id").notNull(), companyId: uuid("company_id"), campaignId: uuid("campaign_id"), qrLinkId: uuid("qr_link_id"),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  labels: text("labels").array().notNull(), answers: jsonb("answers").notNull(), consentBlockId: text("consent_block_id").notNull(),
  requestHash: text("request_hash").notNull(),
  createdContact: boolean("created_contact").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "crm_form_response_publication_fk", columns: [t.tenantId, t.formId, t.versionId], foreignColumns: [crmFormPublications.tenantId, crmFormPublications.formId, crmFormPublications.versionId] }),
  foreignKey({ name: "crm_form_response_contact_fk", columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ name: "crm_form_response_company_fk", columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
  foreignKey({ name: "crm_form_response_campaign_fk", columns: [t.tenantId, t.campaignId], foreignColumns: [campaigns.tenantId, campaigns.id] }),
  foreignKey({ name: "crm_form_response_qr_fk", columns: [t.tenantId, t.qrLinkId], foreignColumns: [campaignResponseLinks.tenantId, campaignResponseLinks.id] }),
  index("crm_form_responses_listing_idx").on(t.tenantId, t.formId, t.submittedAt, t.id),
  index("crm_form_responses_contact_idx").on(t.tenantId, t.contactId),
  index("crm_form_responses_expiry_idx").on(t.tenantId, t.expiresAt),
  check("crm_form_response_answers", sql`jsonb_typeof(${t.answers}) = 'object' and octet_length(${t.answers}::text) <= 65536 and (${t.answers}->>${t.consentBlockId} = 'yes') is true`),
  check("crm_form_response_request_hash", sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
  check("crm_form_response_expiry", sql`${t.expiresAt} > ${t.submittedAt}`)]);

// Short-lived anonymous abuse counters and replay keys never contain answers or contact identifiers.
export const crmFormQuotas = pgTable("crm_form_quotas", {
  scope: text("scope").notNull(), minute: timestamp("minute", { withTimezone: true }).notNull(), attempts: integer("attempts").notNull(),
}, t => [primaryKey({ columns: [t.scope, t.minute] }), index("crm_form_quota_expiry_idx").on(t.minute)]);
export const crmFormReceipts = pgTable("crm_form_receipts", {
  id: uuid("id").primaryKey(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("crm_form_receipt_expiry_idx").on(t.expiresAt)]);

// A minimal source tag that outlives the hosted-form response: the immutable publication title and the first
// submission time, never answers. Written only by the submit definer; removed on erasure, moved on merge.
export const contactFormSources = pgTable("contact_form_sources", {
  tenantId: uuid("tenant_id").notNull(), contactId: uuid("contact_id").notNull(), formId: uuid("form_id").notNull(), versionId: uuid("version_id").notNull(),
  formTitle: text("form_title").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.contactId, t.versionId] }),
  foreignKey({ name: "contact_form_sources_contact_fk", columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete("cascade"),
  foreignKey({ name: "contact_form_sources_publication_fk", columns: [t.tenantId, t.formId, t.versionId], foreignColumns: [crmFormPublications.tenantId, crmFormPublications.formId, crmFormPublications.versionId] }),
  check("contact_form_sources_title", sql`length(${t.formTitle}) <= 300`)]);

// The durable first source of a person: only the source kind and the first-seen date, never content. It outlives the evidence
// (a Connect response, an import row) that expires or is purged, and goes when the person is erased. Written by definer triggers;
// a merge keeps the earliest.
export const contactFirstSources = pgTable("contact_first_sources", {
  tenantId: uuid("tenant_id").notNull(), contactId: uuid("contact_id").notNull(),
  kind: text("kind").$type<"manual" | "csv_import" | "connect" | "form">().notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.contactId] }),
  foreignKey({ name: "contact_first_sources_contact_fk", columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete("cascade"),
  check("contact_first_sources_kind", sql`${t.kind} in ('manual', 'csv_import', 'connect', 'form')`)]);

// HC-06A: minimal provenance; trusted database writers own all mutations.
export const contactSourceEvents = pgTable("contact_source_events", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull(), contactId: uuid("contact_id").notNull(),
  kind: text("kind").$type<"manual" | "csv_import" | "connect" | "form">().notNull(),
  outcome: text("outcome").$type<"created" | "updated">().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  importId: uuid("import_id"), rowNumber: integer("row_number"),
  responseId: uuid("response_id"), entryRoute: text("entry_route").$type<"qr" | "short">(),
  crmFormResponseId: uuid("crm_form_response_id"),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
}, t => [foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.importId], foreignColumns: [crmImports.tenantId, crmImports.id] }),
  foreignKey({ name: "contact_sources_response_fk", columns: [t.tenantId, t.responseId], foreignColumns: [campaignResponses.tenantId, campaignResponses.id] }).onUpdate("cascade"),
  foreignKey({ name: "contact_sources_crm_form_response_fk", columns: [t.tenantId, t.crmFormResponseId], foreignColumns: [crmFormResponses.tenantId, crmFormResponses.id] }).onDelete("cascade"),
  uniqueIndex("contact_sources_crm_form_response_unique").on(t.tenantId, t.crmFormResponseId).where(sql`${t.crmFormResponseId} is not null`),
  uniqueIndex("contact_sources_response_unique").on(t.tenantId, t.responseId).where(sql`${t.kind} = 'connect'`),
  uniqueIndex("contact_sources_import_unique").on(t.tenantId, t.importId, t.rowNumber).where(sql`${t.kind} = 'csv_import'`),
  index("contact_sources_history").on(t.tenantId, t.contactId, t.occurredAt, t.id),
  check("contact_sources_contract", sql`((${t.kind} = 'manual' and ${t.outcome} = 'created' and ${t.importId} is null and ${t.rowNumber} is null and ${t.revertedAt} is null and ${t.responseId} is null and ${t.entryRoute} is null) or (${t.kind} = 'csv_import' and ${t.outcome} in ('created','updated') and ${t.importId} is not null and ${t.rowNumber} is not null and ${t.rowNumber} > 0 and ${t.responseId} is null and ${t.entryRoute} is null) or (${t.kind} = 'connect' and ${t.outcome} in ('created','updated') and ${t.importId} is null and ${t.rowNumber} is null and ${t.revertedAt} is null and ${t.responseId} is not null and ${t.entryRoute} is not null and ${t.entryRoute} in ('qr','short'))) and ${t.crmFormResponseId} is null or (${t.kind} = 'form' and ${t.outcome} in ('created','updated') and ${t.importId} is null and ${t.rowNumber} is null and ${t.revertedAt} is null and ${t.responseId} is null and ${t.entryRoute} is null and ${t.crmFormResponseId} is not null)`)]);

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

// HC-13: one follow-up case per verified, associated response (the HC-06 request key). It holds ids, state and timestamps only: no name,
// contact method or free text. Writes happen only through the followup_* definers; the application role has no write grant and reads
// the minimal columns through RLS (owner/admin: all; the assigned member: own open cases). campaign_id and response_id are not readable
// by the application role. Migration 0048 (hand-written part) adds RLS, grants, the guard and the lifecycle hooks.
export const followUpCases = pgTable("followup_cases", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(),
  campaignId: uuid("campaign_id").notNull(), responseId: uuid("response_id").notNull(), contactId: uuid("contact_id").notNull(),
  state: text("state").$type<FollowUpCaseState>().notNull().default("requested"),
  assigneeId: text("assignee_id"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  stateChangedAt: timestamp("state_changed_at", { withTimezone: true }).notNull().defaultNow(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.campaignId], foreignColumns: [campaigns.tenantId, campaigns.id] }),
  foreignKey({ columns: [t.tenantId, t.responseId], foreignColumns: [campaignResponses.tenantId, campaignResponses.id] }),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ columns: [t.tenantId, t.assigneeId], foreignColumns: [workspaceMembers.tenantId, workspaceMembers.userId] }),
  uniqueIndex("followup_cases_response_idx").on(t.tenantId, t.responseId),
  index("followup_cases_queue_idx").on(t.tenantId, t.createdAt, t.id),
  index("followup_cases_assignee_idx").on(t.tenantId, t.assigneeId, t.createdAt, t.id).where(sql`${t.assigneeId} is not null`),
  index("followup_cases_contact_idx").on(t.tenantId, t.contactId),
  check("followup_case_state", sql`${t.state} in ('requested', 'awaiting_assignment', 'assigned', 'attempted', 'no_response', 'connected', 'closed', 'withdrawn')`),
  check("followup_case_assignee", sql`(${t.state} in ('assigned', 'attempted') and ${t.assigneeId} is not null)
    or (${t.state} in ('requested', 'awaiting_assignment', 'withdrawn') and ${t.assigneeId} is null) or ${t.state} in ('no_response', 'connected', 'closed')`),
  check("followup_case_assigned_at", sql`(${t.assigneeId} is null) or (${t.assignedAt} is not null)`),
  check("followup_case_version", sql`${t.version} >= 1`)]);

// Communities (ADR 0013, C02/C03). Visibility, admission and pricing are independent settings.
// Member access is enforced by RLS through an active community_memberships row; staff access by tenant.
export const communityStatuses = ["draft", "published", "archived"] as const;
export const communityVisibilities = ["listed", "unlisted", "hidden"] as const;
export const communityPricings = ["free", "paid"] as const;
export const communityMembershipRoles = ["owner", "admin", "moderator", "contributor", "member"] as const;
export const communityMembershipStatuses = ["active", "pending", "banned", "left", "removed"] as const;
export const entitlementSources = ["community_free_join", "admin_grant", "invitation", "application", "product_purchase", "bundle", "subscription", "free_enrolment"] as const;
export const reservedCommunitySlugs = ["new", "discover", "search", "create", "settings", "admin", "api", "me", "account"] as const;
const reservedSlugSql = sql.raw(reservedCommunitySlugs.map((slug) => `'${slug}'`).join(", "));

export const communities = pgTable("communities", {
  eventPublicationEpoch: uuid("event_publication_epoch").notNull().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  tagline: text("tagline"),
  status: text("status", { enum: communityStatuses }).notNull().default("draft"),
  visibility: text("visibility", { enum: communityVisibilities }).notNull().default("hidden"),
  pricing: text("pricing", { enum: communityPricings }).notNull().default("free"),
  allowOpen: boolean("allow_open").notNull().default(false),
  allowApply: boolean("allow_apply").notNull().default(false),
  allowInvite: boolean("allow_invite").notNull().default(true),
  allowEntitlement: boolean("allow_entitlement").notNull().default(false),
  description: text("description"),
  // Individual rules (PR 4a replaced the single free-text field).
  rulesList: text("rules_list").array().notNull().default(sql`ARRAY[]::text[]`),
  // Bumped whenever the rules change; joiners must accept the current version (PR 3).
  rulesVersion: integer("rules_version").notNull().default(0),
  // Shared question set (src/lib/questions.ts), bumped by questionsVersion on every change.
  joinQuestions: jsonb("join_questions").$type<import("../lib/questions").Question[]>().notNull().default(sql`'[]'::jsonb`),
  questionsVersion: integer("questions_version").notNull().default(0),
  // C12a: held content. New members' first post waits for a host; matching banned words hold posts and replies.
  holdFirstPosts: boolean("hold_first_posts").notNull().default(false),
  bannedWords: text("banned_words").array().notNull().default(sql`ARRAY[]::text[]`),
  // C15a: shown in the new-member welcome card; the introductions category is where "Introduce yourself" leads.
  welcomeMessage: text("welcome_message"),
  introCategoryId: uuid("intro_category_id").references((): AnyPgColumn => communityCategories.id, { onDelete: "set null" }),
  chatEnabled: boolean("chat_enabled").notNull().default(true),
  dmPolicy: text("dm_policy").notNull().default("channels_only"),
  discoverOptIn: boolean("discover_opt_in").notNull().default(false),
  // Cleared if the creator's account is deleted, so account erasure is never blocked by a community.
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("communities_slug_idx").on(t.slug),
  check("community_dm_policy", sql`${t.dmPolicy} in ('channels_only','members')`),
  check("community_slug", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$' and ${t.slug} not in (${reservedSlugSql})`),
  check("community_name", sql`length(${t.name}) between 1 and 80`),
  check("community_tagline", sql`${t.tagline} is null or length(${t.tagline}) between 1 and 160`),
  check("community_status", sql`${t.status} in ('draft', 'published', 'archived')`),
  check("community_visibility", sql`${t.visibility} in ('listed', 'unlisted', 'hidden')`),
  check("community_pricing", sql`${t.pricing} in ('free', 'paid')`),
  check("community_version", sql`${t.version} >= 1`),
  check("community_description", sql`${t.description} is null or length(${t.description}) between 1 and 2000`),
  check("community_rules_list", sql`cardinality(${t.rulesList}) <= 20`),
  check("community_join_questions", sql`jsonb_typeof(${t.joinQuestions}) = 'array' and jsonb_array_length(${t.joinQuestions}) <= 10`),
  check("community_questions_version", sql`${t.questionsVersion} >= 0`),
  check("community_banned_words", sql`cardinality(${t.bannedWords}) <= 100`),
  check("community_welcome_message", sql`${t.welcomeMessage} is null or length(${t.welcomeMessage}) between 1 and 1000`),
  check("community_rules_version", sql`${t.rulesVersion} >= 0`)]);

export const communityMemberships = pgTable("community_memberships", {
  eventAccessEpoch: uuid("event_access_epoch").notNull().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  communityId: uuid("community_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: communityMembershipRoles }).notNull().default("member"),
  status: text("status", { enum: communityMembershipStatuses }).notNull().default("pending"),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  rulesVersionAccepted: integer("rules_version_accepted"),
  adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true }),
  joinAnswers: jsonb("join_answers").$type<import("../lib/questions").Answers>(),
  mutedUntil: timestamp("muted_until", { withTimezone: true }),
  dmAcceptMembers: boolean("dm_accept_members").notNull().default(true),
  chatStateRev: bigint("chat_state_rev", { mode: "number" }).notNull().default(0),
  // C15a: notification preferences, the last time the bell was opened and the dismissed welcome card.
  notifyReplies: boolean("notify_replies").notNull().default(true),
  notifyLikes: boolean("notify_likes").notNull().default(true),
  notifyAnnouncements: boolean("notify_announcements").notNull().default(true),
  notificationsMuted: boolean("notifications_muted").notNull().default(false),
  notificationsSeenAt: timestamp("notifications_seen_at", { withTimezone: true }),
  welcomeDismissedAt: timestamp("welcome_dismissed_at", { withTimezone: true }),
  // C15b: how much community email this person gets. Digest frequencies start counting from the cursor.
  emailFrequency: text("email_frequency", { enum: ["off", "important", "daily", "weekly"] as const }).notNull().default("important"),
  emailDigestCursor: timestamp("email_digest_cursor", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.communityId, t.userId] }),
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }),
  check("community_chat_state_rev", sql`${t.chatStateRev} >= 0`),
  index("community_memberships_user_idx").on(t.userId, t.status),
  check("community_membership_role", sql`${t.role} in ('owner', 'admin', 'moderator', 'contributor', 'member')`),
  check("community_membership_status", sql`${t.status} in ('active', 'pending', 'banned', 'left', 'removed')`),
  check("community_membership_email_frequency", sql`${t.emailFrequency} in ('off', 'important', 'daily', 'weekly')`)]);

export const entitlements = pgTable("entitlements", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  catalogItemId: uuid("catalog_item_id"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id").notNull(),
  tier: text("tier"),
  source: text("source", { enum: entitlementSources }).notNull(),
  grantedBy: text("granted_by").references(() => users.id, { onDelete: "set null" }),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  index("entitlements_subject_idx").on(t.userId, t.resourceType, t.resourceId),
  foreignKey({ columns: [t.tenantId, t.catalogItemId, t.userId], foreignColumns: [catalogEnrolments.tenantId, catalogEnrolments.itemId, catalogEnrolments.userId] }),
  uniqueIndex("entitlement_free_enrolment_idx").on(t.tenantId, t.catalogItemId, t.userId).where(sql`${t.source} = 'free_enrolment'`),
  check("entitlement_resource_type", sql`${t.resourceType} in ('community','course','product')`),
  check("entitlement_catalog_link", sql`(${t.resourceType} = 'community' and ${t.catalogItemId} is null and ${t.source} <> 'free_enrolment') or
    (${t.resourceType} in ('course','product') and ${t.catalogItemId} is not null and ${t.catalogItemId} = ${t.resourceId} and ${t.source} = 'free_enrolment')`),
  check("entitlement_source", sql`${t.source} in ('community_free_join', 'admin_grant', 'invitation', 'application', 'product_purchase', 'bundle', 'subscription', 'free_enrolment')`),
  check("entitlement_window", sql`${t.validUntil} is null or ${t.validUntil} > ${t.validFrom}`),
  check("entitlement_tier", sql`${t.tier} is null or length(${t.tier}) between 1 and 80`),
  check("entitlement_reason", sql`${t.reason} is null or length(${t.reason}) between 1 and 200`),
  // revoked_by may become null if that account is deleted, but never names a revoker without a revocation time.
  check("entitlement_revocation", sql`${t.revokedBy} is null or ${t.revokedAt} is not null`)]);

// PR 3 (C08): personal invitation links. Only hashes of the email and the token are stored.
export const communityInvites = pgTable("community_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  communityId: uuid("community_id").notNull(),
  emailHash: text("email_hash").notNull(),
  emailHint: text("email_hint").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  redeemedBy: text("redeemed_by").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  uniqueIndex("community_invites_open_idx").on(t.communityId, t.emailHash).where(sql`${t.redeemedAt} is null and ${t.revokedAt} is null`),
  index("community_invites_email_idx").on(t.emailHash),
  check("community_invite_hashes", sql`${t.emailHash} ~ '^[a-f0-9]{64}$' and ${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
  check("community_invite_hint", sql`length(${t.emailHint}) between 3 and 320`)]);

// PR 4a (C07): applications to join. Staff-only table; applicants act through definers (migration 0037).
export const communityApplicationStatuses = ["pending", "info_requested", "approved", "declined", "withdrawn"] as const;
export const communityApplications = pgTable("community_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  communityId: uuid("community_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: communityApplicationStatuses }).notNull().default("pending"),
  answers: jsonb("answers").$type<import("../lib/questions").Answers>().notNull().default(sql`'{}'::jsonb`),
  questionsVersion: integer("questions_version").notNull(),
  rulesVersion: integer("rules_version").notNull(),
  adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true }).notNull(),
  infoRequest: text("info_request"),
  reviewerNote: text("reviewer_note"),
  decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  uniqueIndex("community_applications_open_idx").on(t.communityId, t.userId).where(sql`${t.status} in ('pending', 'info_requested')`),
  index("community_applications_queue_idx").on(t.tenantId, t.communityId, t.status, t.createdAt),
  check("community_application_status", sql`${t.status} in ('pending', 'info_requested', 'approved', 'declined', 'withdrawn')`),
  check("community_application_answers", sql`jsonb_typeof(${t.answers}) = 'object'`),
  check("community_application_info", sql`${t.infoRequest} is null or length(${t.infoRequest}) between 1 and 500`),
  check("community_application_note", sql`${t.reviewerNote} is null or length(${t.reviewerNote}) between 1 and 1000`)]);

// PR 4b (C09/C10): forum. Every table carries tenant_id + community_id; members read through
// community_can_read and write only through the definers in migration 0038.
export const communityCategories = pgTable("community_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  name: text("name").notNull(), emoji: text("emoji"),
  position: integer("position").notNull().default(0),
  hostsOnly: boolean("hosts_only").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  index("community_categories_order_idx").on(t.communityId, t.position),
  check("community_category_name", sql`length(${t.name}) between 1 and 60`),
  check("community_category_emoji", sql`${t.emoji} is null or length(${t.emoji}) between 1 and 16`)]);

export const communityFiles = pgTable("community_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  uploaderId: text("uploader_id").references(() => users.id, { onDelete: "set null" }),
  key: text("key").notNull(), name: text("name").notNull(), mime: text("mime").notNull(),
  size: integer("size").notNull(), checksum: text("checksum").notNull(),
  status: text("status", { enum: ["pending", "uploaded", "quarantined", "ready"] }).notNull().default("pending"),
  kind: text("kind", { enum: ["cover", "attachment"] }).notNull(),
  postId: uuid("post_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  uniqueIndex("community_files_key_idx").on(t.key), index("community_files_post_idx").on(t.postId),
  check("community_file_size", sql`${t.size} between 1 and 10485760`),
  check("community_file_checksum", sql`${t.checksum} ~ '^[a-f0-9]{64}$'`),
  check("community_file_status", sql`${t.status} in ('pending', 'uploaded', 'quarantined', 'ready')`),
  check("community_file_kind", sql`${t.kind} in ('cover', 'attachment')`),
  check("community_file_mime", sql`${t.mime} in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain') and (${t.kind} = 'attachment' or ${t.mime} in ('image/jpeg', 'image/png', 'image/webp'))`),
  check("community_file_key_scope", sql`${t.key} = 'workspaces/' || ${t.tenantId}::text || '/communities/' || ${t.communityId}::text || '/files/' || ${t.id}::text`),
  check("community_file_name", sql`length(${t.name}) between 1 and 200`)]);

export const communityPosts = pgTable("community_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  categoryId: uuid("category_id").notNull().references(() => communityCategories.id),
  authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: jsonb("body").$type<import("../lib/rich-text").RichDoc>().notNull(),
  bodyText: text("body_text").notNull().default(""),
  videoUrl: text("video_url"),
  coverFileId: uuid("cover_file_id").references(() => communityFiles.id, { onDelete: "set null" }),
  pinned: boolean("pinned").notNull().default(false),
  commentsOff: boolean("comments_off").notNull().default(false),
  likesOff: boolean("likes_off").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedBy: text("removed_by").references(() => users.id, { onDelete: "set null" }),
  heldAt: timestamp("held_at", { withTimezone: true }),
  heldReason: text("held_reason", { enum: ["first_post", "banned_word"] }),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  check("community_post_held", sql`(${t.heldAt} is null) = (${t.heldReason} is null) and (${t.heldReason} is null or ${t.heldReason} in ('first_post', 'banned_word'))`),
  index("community_posts_feed_idx").on(t.communityId, t.pinned, t.createdAt),
  check("community_post_title", sql`length(${t.title}) between 1 and 200`),
  check("community_post_body", sql`jsonb_typeof(${t.body}) = 'object' and length(${t.body}::text) <= 100000`),
  check("community_post_body_text", sql`length(${t.bodyText}) <= 20000`),
  check("community_post_video", sql`${t.videoUrl} is null or (length(${t.videoUrl}) <= 500 and ${t.videoUrl} like 'https://%')`)]);

export const communityComments = pgTable("community_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  postId: uuid("post_id").notNull().references(() => communityPosts.id, { onDelete: "cascade" }),
  authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedBy: text("removed_by").references(() => users.id, { onDelete: "set null" }),
  heldAt: timestamp("held_at", { withTimezone: true }),
  heldReason: text("held_reason", { enum: ["first_post", "banned_word"] }),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  check("community_comment_held", sql`(${t.heldAt} is null) = (${t.heldReason} is null) and (${t.heldReason} is null or ${t.heldReason} in ('first_post', 'banned_word'))`),
  index("community_comments_post_idx").on(t.postId, t.createdAt),
  check("community_comment_body", sql`length(${t.body}) between 1 and 5000`)]);

export const communityLikes = pgTable("community_likes", {
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  targetType: text("target_type", { enum: ["post", "comment"] }).notNull(),
  targetId: uuid("target_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.targetType, t.targetId, t.userId] }),
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  index("community_likes_recent_idx").on(t.communityId, t.targetType, t.createdAt),
  check("community_like_target", sql`${t.targetType} in ('post', 'comment')`)]);

// C12a: member reports and the moderation history. Hosts read through community_is_host; writes only through
// the definers in migration 0039. Reporter ids are never returned to members.
export const communityReports = pgTable("community_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  reporterId: text("reporter_id").references(() => users.id, { onDelete: "set null" }),
  targetType: text("target_type", { enum: ["post", "comment", "member", "message", "dm_message"] }).notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason", { enum: ["spam", "harassment", "inappropriate", "other"] }).notNull(),
  note: text("note"),
  status: text("status", { enum: ["open", "dismissed", "actioned", "expired"] }).notNull().default("open"),
  needsEscalation: boolean("needs_escalation").notNull().default(false),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  unique("community_reports_scope").on(t.tenantId, t.communityId, t.id),
  index("community_dm_reports_open_age_idx").on(t.createdAt, t.id).where(sql`${t.targetType} = 'dm_message' and ${t.status} = 'open'`),
  uniqueIndex("community_reports_open_idx").on(t.communityId, t.reporterId, t.targetType, t.targetId).where(sql`${t.status} = 'open'`),
  index("community_reports_queue_idx").on(t.communityId, t.status, t.targetType, t.targetId),
  check("community_report_target", sql`${t.targetType} in ('post', 'comment', 'member', 'message', 'dm_message') and length(${t.targetId}) between 1 and 200`),
  check("community_report_reason", sql`${t.reason} in ('spam', 'harassment', 'inappropriate', 'other')`),
  check("community_report_note", sql`${t.note} is null or length(${t.note}) between 1 and 500`),
  check("community_report_status", sql`${t.status} in ('open', 'dismissed', 'actioned', 'expired')`)]);

export const communityModerationActions = pgTable("community_moderation_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  subjectUserId: text("subject_user_id").references(() => users.id, { onDelete: "set null" }),
  detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  index("community_moderation_actions_idx").on(t.communityId, t.createdAt),
  check("community_moderation_action", sql`${t.action} in ('report_dismiss', 'report_remove', 'held_approve', 'held_reject', 'mute', 'unmute', 'ban', 'unban', 'warn', 'appeal_approve', 'appeal_decline', 'message_remove', 'message_restore', 'message_pin', 'message_unpin', 'dm_evidence_view', 'report_expire', 'report_action')`),
  check("community_moderation_target", sql`${t.targetType} in ('post', 'comment', 'member', 'message', 'dm_message')`)]);

// C12b (migration 0040): warnings, appeals and edit history. Same model as reports: FORCE RLS, hosts and staff read,
// every write through a definer. Members never read revisions or other people's warnings and appeals.
export const communityWarnings = pgTable("community_warnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  issuedBy: text("issued_by").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  index("community_warnings_user_idx").on(t.communityId, t.userId, t.createdAt),
  check("community_warning_reason", sql`length(${t.reason}) between 1 and 500`)]);

export const communityAppeals = pgTable("community_appeals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  status: text("status", { enum: ["open", "approved", "declined"] }).notNull().default("open"),
  reply: text("reply"),
  decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  uniqueIndex("community_appeals_open_idx").on(t.communityId, t.userId).where(sql`${t.status} = 'open'`),
  index("community_appeals_queue_idx").on(t.communityId, t.status, t.createdAt),
  check("community_appeal_message", sql`length(${t.message}) between 1 and 1000`),
  check("community_appeal_reply", sql`${t.reply} is null or length(${t.reply}) between 1 and 500`),
  check("community_appeal_status", sql`${t.status} in ('open', 'approved', 'declined')`)]);

export const communityPostRevisions = pgTable("community_post_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  postId: uuid("post_id").notNull().references(() => communityPosts.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: jsonb("body").$type<import("../lib/rich-text").RichDoc>().notNull(),
  bodyText: text("body_text").notNull().default(""),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  index("community_post_revisions_idx").on(t.postId, t.createdAt)]);

export const communityCommentRevisions = pgTable("community_comment_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  commentId: uuid("comment_id").notNull().references(() => communityComments.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  index("community_comment_revisions_idx").on(t.commentId, t.createdAt)]);

// PR 3 (C05): Discover read projection (ADR 0013 §7). A row exists only while the resource qualifies.
export const discoverListings = pgTable("discover_listings", {
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id").notNull(),
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  tagline: text("tagline"),
  hostName: text("host_name").notNull(),
  pricing: text("pricing").notNull(),
  admission: text("admission").array().notNull(),
  searchText: text("search_text").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // 0100: unified Discover. Sanitized public fields only; the approval state lives in discover_controls and is applied again at read time.
  summary: text("summary"), category: text("category"), language: text("language"), audience: text("audience"), isFree: boolean("is_free").notNull().default(true), contentHash: text("content_hash"),
}, (t) => [primaryKey({ columns: [t.resourceType, t.resourceId] }),
  index("discover_listings_order_idx").on(t.resourceType, t.updatedAt, t.resourceId),
  check("discover_resource_type", sql`${t.resourceType} in ('community','course','product')`),
  check("discover_listing_public_fields", sql`(${t.summary} is null or length(${t.summary}) <= 280) and (${t.language} is null or ${t.language} ~ '^[a-z]{2,3}$')`)]);

// C15a (migration 0041): in-app notifications. Members read only their own rows; every write is a definer
// (plus one staff INSERT for application decisions). Likes and the host queue are grouped into one unread row.
// C15b: one row per email to send. Holds no address and no message text; the worker resolves both at send time.
export const communityEmailDeliveries = pgTable("community_email_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  recipientId: text("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["instant", "digest"] as const }).notNull(),
  notificationId: uuid("notification_id"),
  windowStart: timestamp("window_start", { withTimezone: true }), windowEnd: timestamp("window_end", { withTimezone: true }),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status", { enum: ["queued", "sending", "sent", "failed", "skipped"] as const }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  uniqueIndex("community_email_deliveries_key_idx").on(t.idempotencyKey),
  index("community_email_deliveries_due_idx").on(t.status, t.lockedUntil, t.createdAt),
  check("community_email_delivery_kind", sql`${t.kind} in ('instant', 'digest') and (${t.kind} = 'instant') = (${t.notificationId} is not null)`),
  check("community_email_delivery_status", sql`${t.status} in ('queued', 'sending', 'sent', 'failed', 'skipped')`),
  check("community_email_delivery_error", sql`${t.lastError} is null or length(${t.lastError}) <= 40`)]);

export const communityNotifications = pgTable("community_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  recipientId: text("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["reply", "thread_reply", "like", "application", "warning", "held_decision", "appeal_decision", "host_queue"] as const }).notNull(),
  targetType: text("target_type", { enum: ["post", "comment", "application", "warning", "appeal", "community"] as const }).notNull(),
  targetId: text("target_id").notNull(),
  postId: uuid("post_id"),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  actorCount: integer("actor_count").notNull().default(1),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  uniqueIndex("community_chat_notifications_group_idx").on(t.recipientId,t.communityId,t.kind,t.targetType,t.targetId).where(sql`${t.kind} in ('chat_mention','chat_reply','dm') and ${t.readAt} is null`),
  index("community_notifications_inbox_idx").on(t.recipientId, t.communityId, t.readAt, t.createdAt.desc()),
  uniqueIndex("community_notifications_like_group_idx").on(t.recipientId, t.communityId, t.targetType, t.targetId).where(sql`${t.kind} = 'like' and ${t.readAt} is null`),
  uniqueIndex("community_notifications_queue_group_idx").on(t.recipientId, t.communityId).where(sql`${t.kind} = 'host_queue' and ${t.readAt} is null`),
  check("community_notification_kind", sql`${t.kind} in ('reply', 'thread_reply', 'like', 'application', 'warning', 'held_decision', 'appeal_decision', 'host_queue', 'chat_mention', 'chat_reply', 'dm')`),
  check("community_notification_target", sql`${t.targetType} in ('post', 'comment', 'application', 'warning', 'appeal', 'community', 'message', 'dm_conversation', 'channel') and length(${t.targetId}) between 1 and 200`),
  check("community_notification_count", sql`${t.actorCount} >= 1`)]);

// Social provider integration layer (migration 0051). Foundation only: nothing here can reach a provider.
// Provider credentials are stored ONLY as sealed envelopes (src/server/social/credential-envelope.ts).
export const socialConnectionStatuses = ["active", "disabled", "revoked"] as const;
export const socialPostStatuses = ["draft", "scheduled", "publishing", "published", "failed", "cancelled", "unknown"] as const;
export const socialConnections = pgTable("social_connections", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  provider: text("provider").$type<"zernio" | "fake">().notNull(), platform: text("platform").$type<SocialPlatform>().notNull(),
  externalAccountRef: text("external_account_ref").notNull(), displayName: text("display_name"),
  status: text("status").$type<typeof socialConnectionStatuses[number]>().notNull().default("active"),
  health: text("health").$type<"unknown" | "healthy" | "degraded" | "failing">().notNull().default("unknown"),
  healthCode: text("health_code"), healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
  credentialEnvelope: jsonb("credential_envelope").$type<Record<string, unknown>>().notNull(),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  // One live row per provider account across ALL tenants: an account can never feed two ministries.
  uniqueIndex("social_connections_account_idx").on(t.provider, t.externalAccountRef).where(sql`${t.status} <> 'revoked'`),
  index("social_connections_tenant_idx").on(t.tenantId, t.createdAt),
  check("social_connection_provider", sql`${t.provider} in ('zernio', 'fake')`),
  check("social_connection_platform", sql`${t.platform} in (${sql.raw(socialPlatforms.map(platform => "'" + platform + "'").join(", "))})`),
  check("social_connection_status", sql`${t.status} in ('active', 'disabled', 'revoked')`),
  check("social_connection_health", sql`${t.health} in ('unknown', 'healthy', 'degraded', 'failing') and (${t.healthCode} is null or ${t.healthCode} ~ '^[a-z0-9_.-]{1,60}$')`),
  check("social_connection_fields", sql`length(${t.externalAccountRef}) between 1 and 200 and (${t.displayName} is null or length(${t.displayName}) between 1 and 120)`),
  // Shape only: a sealed envelope has these keys and nothing resembling a plain token field.
  check("social_connection_envelope", sql`jsonb_typeof(${t.credentialEnvelope}) = 'object' and ${t.credentialEnvelope} ?& array['version', 'keyId', 'binding', 'iv', 'tag', 'ciphertext'] and not (${t.credentialEnvelope} ?| array['secret', 'token', 'apiKey', 'accessToken']) and octet_length(${t.credentialEnvelope}::text) <= 4096`),
]);
export const socialSchedules = pgTable("social_schedules", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  platform: text("platform").$type<SocialPlatform>(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  slots: jsonb("slots").$type<WeeklySlot[]>().notNull(),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("social_schedule_scope_idx").on(t.tenantId, sql`coalesce(${t.platform}, '')`).where(sql`${t.archivedAt} is null`),
  check("social_schedule_platform", sql`${t.platform} in (${sql.raw(socialPlatforms.map(platform => "'" + platform + "'").join(", "))})`),
  check("social_schedule_shape", sql`length(${t.name}) between 1 and 120 and length(${t.timezone}) between 1 and 80
    and jsonb_typeof(${t.slots}) = 'array' and jsonb_array_length(${t.slots}) between 1 and 84 and ${t.version} > 0`),
]);
export const socialDrafts = pgTable("social_drafts", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  document: jsonb("document").$type<ComposerInput>().notNull(),
  status: text("status").$type<"draft" | "submitted" | "cancelled">().notNull().default("draft"),
  version: integer("version").notNull().default(1),
  reviewHash: text("review_hash"),
  reviewBy: text("review_by").references(() => users.id),
  reviewExpires: timestamp("review_expires", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  index("social_drafts_planner_idx").on(t.tenantId, t.status, t.updatedAt, t.id),
  check("social_draft_shape", sql`${t.status} in ('draft', 'submitted', 'cancelled') and ${t.version} > 0
    and jsonb_typeof(${t.document}) = 'object' and octet_length(${t.document}::text) <= 1100000
    and ((${t.reviewHash} is null and ${t.reviewBy} is null and ${t.reviewExpires} is null)
      or (${t.status} = 'draft' and ${t.reviewHash} ~ '^[0-9a-f]{64}$' and ${t.reviewHash} is not null and ${t.reviewBy} is not null and ${t.reviewExpires} is not null))`),
]);
export const socialPostErrorCodes = ["PROVIDER_AUTH", "PROVIDER_REJECTED", "PROVIDER_CONFLICT", "PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED", "MAX_ATTEMPTS", "IDEMPOTENCY_WINDOW_EXPIRED", "CONNECTION_UNAVAILABLE", "PARTIAL_PUBLISH", "DISABLED", "CREDENTIAL_UNAVAILABLE", "UNCONFIRMED", "MEDIA_UNAVAILABLE", "MEDIA_URL_EXPIRED"] as const;
export const socialPosts = pgTable("social_posts", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  connectionId: uuid("connection_id").notNull(),
  draftId: uuid("draft_id"),
  scheduleId: uuid("schedule_id"),
  displayTimezone: text("display_timezone").notNull().default("UTC"),
  delivery: jsonb("delivery").$type<DeliveryPayload>(),
  repeatNumber: integer("repeat_number").notNull().default(0),
  status: text("status").$type<typeof socialPostStatuses[number]>().notNull().default("draft"),
  content: text("content").notNull(), media: jsonb("media").$type<{ kind: "image" | "video"; url: string }[]>().notNull().default(sql`'[]'::jsonb`),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  // One per logical post; sent to the provider on every attempt.
  idempotencyKey: text("idempotency_key").notNull(),
  attempts: integer("attempts").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(5),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }), lockToken: uuid("lock_token"),
  providerPostRef: text("provider_post_ref"), providerPostUrl: text("provider_post_url"), publishedAt: timestamp("published_at", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  unique("social_posts_tenant_connection_id_key").on(t.tenantId, t.connectionId, t.id),
  foreignKey({ columns: [t.tenantId, t.connectionId], foreignColumns: [socialConnections.tenantId, socialConnections.id] }),
  foreignKey({ columns: [t.tenantId, t.draftId], foreignColumns: [socialDrafts.tenantId, socialDrafts.id] }),
  foreignKey({ columns: [t.tenantId, t.scheduleId], foreignColumns: [socialSchedules.tenantId, socialSchedules.id] }),
  uniqueIndex("social_posts_draft_destination_idx").on(t.tenantId, t.draftId, t.connectionId, t.repeatNumber),
  index("social_posts_schedule_queue_idx").on(t.tenantId, t.scheduleId, t.scheduledFor),
  check("social_post_delivery", sql`(${t.draftId} is null and ${t.delivery} is null and ${t.scheduleId} is null and ${t.repeatNumber} = 0)
    or (${t.draftId} is not null and ${t.delivery} is not null and jsonb_typeof(${t.delivery}) = 'object'
      and octet_length(${t.delivery}::text) <= 70000 and ${t.media} = '[]'::jsonb and ${t.repeatNumber} between 0 and 52)`),
  uniqueIndex("social_posts_idempotency_idx").on(t.tenantId, t.idempotencyKey),
  index("social_posts_due_idx").on(t.status, t.nextAttemptAt).where(sql`${t.status} in ('scheduled', 'publishing')`),
  index("social_posts_tenant_idx").on(t.tenantId, t.status, t.scheduledFor),
  index("social_posts_provider_ref_idx").on(t.tenantId, t.connectionId, t.providerPostRef).where(sql`${t.providerPostRef} is not null`),
  check("social_post_status", sql`${t.status} in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled', 'unknown')`),
  check("social_post_url", sql`${t.providerPostUrl} is null or (${t.providerPostUrl} ~ '^https://' and length(${t.providerPostUrl}) <= 2048)`),
  check("social_post_content", sql`((${t.draftId} is null and length(${t.content}) between 1 and 10000) or (${t.draftId} is not null and length(${t.content}) <= 100000)) and jsonb_typeof(${t.media}) = 'array' and jsonb_array_length(${t.media}) <= 10 and octet_length(${t.media}::text) <= 8192`),
  check("social_post_counters", sql`${t.attempts} >= 0 and ${t.maxAttempts} between 1 and 10 and ${t.attempts} <= ${t.maxAttempts} and ${t.version} >= 1`),
  check("social_post_key", sql`length(${t.idempotencyKey}) between 8 and 100`),
  check("social_post_error", sql`${t.lastErrorCode} is null or ${t.lastErrorCode} in ('PROVIDER_AUTH', 'PROVIDER_REJECTED', 'PROVIDER_CONFLICT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'MAX_ATTEMPTS', 'IDEMPOTENCY_WINDOW_EXPIRED', 'CONNECTION_UNAVAILABLE', 'PARTIAL_PUBLISH', 'DISABLED', 'CREDENTIAL_UNAVAILABLE', 'UNCONFIRMED', 'MEDIA_UNAVAILABLE', 'MEDIA_URL_EXPIRED', 'MEDIA_FETCH_FAILED')`),
  // Shape per state. The trigger in migration 0051 adds the legal transitions.
  check("social_post_state_shape", sql`(${t.status} <> 'scheduled' or (${t.scheduledFor} is not null and ${t.nextAttemptAt} is not null and ${t.lockToken} is null and ${t.lockedAt} is null))
    and (${t.status} <> 'publishing' or (${t.firstAttemptAt} is not null and ((${t.lockToken} is not null and ${t.lockedAt} is not null) or (${t.lockToken} is null and ${t.lockedAt} is null and ${t.providerPostRef} is not null and ${t.nextAttemptAt} is not null))))
    and (${t.status} = 'publishing' or (${t.lockToken} is null and ${t.lockedAt} is null))
    and (${t.status} <> 'scheduled' or ${t.providerPostRef} is null)
    and (${t.status} <> 'published' or (${t.providerPostRef} is not null and ${t.publishedAt} is not null))
    and (${t.status} <> 'failed' or ${t.lastErrorCode} is not null)`),
]);
export const socialWebhookEvents = pgTable("social_webhook_events", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  connectionId: uuid("connection_id").notNull(), provider: text("provider").notNull(), providerEventId: text("provider_event_id").notNull(),
  eventType: text("event_type").notNull(), externalAccountRef: text("external_account_ref").notNull(), subjectRef: text("subject_ref"),
  // Allow-listed, content-free: platform and error category only. No message text, sender names or comment bodies are ever stored.
  detail: jsonb("detail").$type<{ platform?: string; errorCategory?: string; correlationKey?: string; activityRef?: string; publishedPostRef?: string }>().notNull().default(sql`'{}'::jsonb`),
  bodyHash: text("body_hash").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.connectionId], foreignColumns: [socialConnections.tenantId, socialConnections.id] }),
  // Replay protection: one row per provider event id. Duplicates insert nothing.
  uniqueIndex("social_webhook_events_event_idx").on(t.tenantId, t.provider, t.providerEventId),
  index("social_webhook_events_received_idx").on(t.tenantId, t.receivedAt),
  check("social_webhook_provider", sql`${t.provider} in ('zernio', 'fake')`),
  check("social_webhook_fields", sql`length(${t.providerEventId}) between 1 and 200 and length(${t.eventType}) between 1 and 100 and length(${t.externalAccountRef}) between 1 and 200 and (${t.subjectRef} is null or length(${t.subjectRef}) between 1 and 200)`),
  check("social_webhook_detail", sql`jsonb_typeof(${t.detail}) = 'object' and octet_length(${t.detail}::text) <= 512 and not (${t.detail} ?| array['text', 'message', 'body', 'sender', 'name', 'content'])`),
  check("social_webhook_body_hash", sql`${t.bodyHash} ~ '^[a-f0-9]{64}$'`),
]);

// Personal Office connections store grants and references. Credentials belong to the provider.
export const officeConnections = pgTable("office_connections", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  kind: text("kind").$type<"mail" | "calendar" | "files">().notNull(),
  provider: text("provider").$type<"fake" | "zernio">().notNull(),
  externalAccountRef: text("external_account_ref").notNull(),
  platform: text("platform").$type<"google" | "microsoft">(),
  profileRef: text("profile_ref"),
  health: text("health").$type<"healthy" | "unavailable" | "reconnect_needed">().notNull().default("reconnect_needed"),
  grants: integer("grants").notNull().default(0),
  noticeVersion: integer("notice_version"),
  /** The calendar this admin last created an event in. A reference only, never event content. */
  writeCalendarRef: text("write_calendar_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("office_connection_account_idx").on(t.tenantId, t.ownerUserId, t.kind, t.provider, t.externalAccountRef),
  unique("office_connection_owner_key").on(t.tenantId, t.ownerUserId, t.id),
  uniqueIndex("office_connection_personal_kind_idx").on(t.tenantId, t.ownerUserId, t.kind).where(sql`${t.platform} is not null and ${t.kind} <> 'files'`),
  uniqueIndex("office_connection_personal_files_platform_idx").on(t.tenantId, t.ownerUserId, t.kind, t.platform).where(sql`${t.platform} is not null and ${t.kind} = 'files'`),
  uniqueIndex("office_connection_provider_account_idx").on(t.provider, t.externalAccountRef).where(sql`${t.platform} is not null`),
  foreignKey({ name: "office_connection_member_fk", columns: [t.tenantId, t.ownerUserId], foreignColumns: [workspaceMembers.tenantId, workspaceMembers.userId] }).onDelete("cascade"),
  check("office_connection_kind", sql`${t.kind} in ('mail', 'calendar', 'files')`),
  check("office_connection_provider", sql`${t.provider} in ('fake', 'zernio')`),
  check("office_connection_ref", sql`length(${t.externalAccountRef}) between 1 and 200`),
  check("office_connection_write_calendar", sql`${t.writeCalendarRef} is null or length(${t.writeCalendarRef}) between 1 and 200`),
  check("office_connection_grant_shape", sql`${t.health} in ('healthy','unavailable','reconnect_needed')
    and (${t.grants} = 0 or (${t.kind} = 'mail' and ${t.grants} = 1) or (${t.kind} = 'calendar' and ${t.grants} in (2, 10)) or (${t.kind} = 'files' and ${t.grants} = 4))
    and ((${t.platform} is null and ${t.profileRef} is null and ${t.noticeVersion} is null and ${t.grants} = 0 and ${t.health} = 'reconnect_needed')
      or (${t.platform} is not null and ${t.platform} in ('google','microsoft') and ${t.profileRef} is not null and length(${t.profileRef}) between 1 and 200 and ${t.noticeVersion} is not null and ${t.noticeVersion} > 0))
    and (${t.health} <> 'healthy' or ${t.grants} <> 0)`),
]);

// Events created in Harvest, so only those can be edited or deleted. References and a time only: no title, notes or attendees, and no link to a contact.
export const officeCalendarEvents = pgTable("office_calendar_events", {
  tenantId: uuid("tenant_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  calendarRef: text("calendar_ref").notNull(),
  eventRef: text("event_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.tenantId, t.ownerUserId, t.connectionId, t.calendarRef, t.eventRef] }),
  foreignKey({ name: "office_calendar_event_connection_fk", columns: [t.tenantId, t.ownerUserId, t.connectionId], foreignColumns: [officeConnections.tenantId, officeConnections.ownerUserId, officeConnections.id] }).onDelete("cascade"),
  check("office_calendar_event_ref", sql`length(${t.calendarRef}) between 1 and 200 and length(${t.eventRef}) between 1 and 200`),
]);

export const officeConnectAttempts = pgTable("office_connect_attempts", {
  tenantId: uuid("tenant_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  id: uuid("id").notNull(),
  kind: text("kind").$type<"mail" | "calendar" | "files">().notNull(),
  platform: text("platform").$type<"google" | "microsoft">().notNull(),
  connectionId: uuid("connection_id"),
  provider: text("provider").$type<"fake" | "zernio">().notNull(),
  profileRef: text("profile_ref").notNull(),
  handoffRef: text("handoff_ref").notNull(),
  noticeVersion: integer("notice_version").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [
  primaryKey({ columns: [t.tenantId, t.ownerUserId, t.id] }),
  uniqueIndex("office_attempt_personal_kind_idx").on(t.tenantId, t.ownerUserId, t.kind).where(sql`${t.kind} <> 'files'`),
  uniqueIndex("office_attempt_personal_files_platform_idx").on(t.tenantId, t.ownerUserId, t.kind, t.platform).where(sql`${t.kind} = 'files'`),
  foreignKey({ name: "office_attempt_member_fk", columns: [t.tenantId, t.ownerUserId], foreignColumns: [workspaceMembers.tenantId, workspaceMembers.userId] }).onDelete("cascade"),
  foreignKey({ name: "office_attempt_connection_fk", columns: [t.tenantId, t.ownerUserId, t.connectionId], foreignColumns: [officeConnections.tenantId, officeConnections.ownerUserId, officeConnections.id] }).onDelete("cascade"),
  check("office_attempt_shape", sql`${t.kind} in ('mail','calendar','files') and ${t.platform} in ('google','microsoft') and ${t.provider} in ('fake','zernio')
    and length(${t.profileRef}) between 1 and 200 and length(${t.handoffRef}) between 1 and 200 and ${t.noticeVersion} > 0`),
]);

export const officeThreadMarkers = pgTable("office_thread_markers", {
  tenantId: uuid("tenant_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  threadRef: text("thread_ref").notNull(),
  read: boolean("read").notNull().default(false),
  starred: boolean("starred").notNull().default(false),
  contactId: uuid("contact_id"),
}, t => [
  primaryKey({ columns: [t.tenantId, t.ownerUserId, t.connectionId, t.threadRef] }),
  foreignKey({ name: "office_marker_connection_fk", columns: [t.tenantId, t.ownerUserId, t.connectionId], foreignColumns: [officeConnections.tenantId, officeConnections.ownerUserId, officeConnections.id] }).onDelete("cascade"),
  foreignKey({ name: "office_marker_contact_fk", columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete("cascade"),
  check("office_marker_ref", sql`length(${t.threadRef}) between 1 and 200`),
]);

export const officeContactReferences = pgTable("office_contact_references", {
  tenantId: uuid("tenant_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  kind: text("kind").$type<"event" | "file">().notNull(),
  itemRef: text("item_ref").notNull(),
  name: text("name"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
}, t => [
  primaryKey({ columns: [t.tenantId, t.ownerUserId, t.connectionId, t.contactId, t.kind, t.itemRef] }),
  foreignKey({ name: "office_reference_connection_fk", columns: [t.tenantId, t.ownerUserId, t.connectionId], foreignColumns: [officeConnections.tenantId, officeConnections.ownerUserId, officeConnections.id] }).onDelete("cascade"),
  foreignKey({ name: "office_reference_contact_fk", columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete("cascade"),
  check("office_reference_shape", sql`length(${t.itemRef}) between 1 and 200 and
    ((${t.kind} = 'file' and ${t.name} is not null and length(${t.name}) between 1 and 500 and ${t.startsAt} is null and ${t.endsAt} is null)
    or (${t.kind} = 'event' and ${t.name} is null and ${t.startsAt} is not null and ${t.endsAt} is not null and ${t.startsAt} < ${t.endsAt}))`),
]);

// Counter only: no visitor identifiers, headers, per-scan row or sub-day timestamp.
export const campaignScanDays = pgTable("campaign_scan_days", {
  tenantId: uuid("tenant_id").notNull(), campaignId: uuid("campaign_id").notNull(),
  day: date("day").notNull(), count: integer("count").notNull().default(0),
}, t => [primaryKey({ columns: [t.tenantId, t.campaignId, t.day] }),
  foreignKey({ columns: [t.tenantId, t.campaignId], foreignColumns: [campaigns.tenantId, campaigns.id] }),
  check("campaign_scan_count", sql`${t.count} >= 0`),
]);

// Community Live L1: member-only event metadata. Comments/prayer/payment storage is deliberately absent.
export const communityLiveEvents = pgTable("community_live_events", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  communityId: uuid("community_id").notNull(), id: uuid("id").notNull().defaultRandom(),
  title: text("title").notNull(), providerVideoId: text("provider_video_id").notNull(),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
  state: text("state", { enum: ["draft", "scheduled", "live", "ended", "replay", "cancelled"] }).notNull().default("draft"),
  commentsMode: text("comments_mode", { enum: ["held", "open", "off"] }).notNull().default("held"),
  donationSlot: text("donation_slot"),
  startedAt: timestamp("started_at", { withTimezone: true }), endedAt: timestamp("ended_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }),
  index("community_live_schedule_idx").on(t.tenantId, t.communityId, t.scheduledStart, t.id),
  check("community_live_title", sql`length(trim(${t.title})) between 1 and 120`),
  check("community_live_video", sql`${t.providerVideoId} ~ '^[A-Za-z0-9_-]{11}$'`),
  check("community_live_state", sql`${t.state} in ('draft','scheduled','live','ended','replay','cancelled')`),
  check("community_live_comments", sql`${t.commentsMode} in ('held','open','off')`),
  check("community_live_reserved", sql`${t.donationSlot} is null`),
  check("community_live_version", sql`${t.version} >= 1`),
  check("community_live_schedule", sql`${t.scheduledEnd} is null or ${t.scheduledEnd} > ${t.scheduledStart}`),
  check("community_live_started", sql`${t.state} not in ('live','ended','replay') or ${t.startedAt} is not null`),
  check("community_live_ended", sql`${t.state} not in ('ended','replay') or ${t.endedAt} is not null`)]);

// NL-01 is identity-linked record keeping only; consent remains in contact_consents.
export const newsletterAudiences = pgTable("newsletter_audiences", {
 tenantId: uuid("tenant_id").notNull().references(()=>workspaces.tenantId), id:uuid("id").notNull().defaultRandom(),name:text("name").notNull(),
 createdBy:text("created_by").notNull().references(()=>users.id), createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),check("newsletter_audience_name",sql`length(trim(${t.name})) between 1 and 100`)]);
export const newsletterLists = pgTable("newsletter_lists", {
 tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull().defaultRandom(),audienceId:uuid("audience_id").notNull(),name:text("name").notNull(),
 version:integer("version").notNull().default(1), createdBy:text("created_by").notNull().references(()=>users.id),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),archivedAt:timestamp("archived_at",{withTimezone:true}),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),foreignKey({columns:[t.tenantId,t.audienceId],foreignColumns:[newsletterAudiences.tenantId,newsletterAudiences.id]}),check("newsletter_list_name",sql`length(trim(${t.name})) between 1 and 100`)]);
export const newsletterSubscribers = pgTable("newsletter_subscribers", {
 tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull().defaultRandom(),contactId:uuid("contact_id").notNull(),
 suppressed:boolean("suppressed").notNull().default(false),tags:text("tags").array().notNull().default(sql`'{}'::text[]`),
 createdBy:text("created_by").notNull().references(()=>users.id),
 version:integer("version").notNull().default(1),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),uniqueIndex("newsletter_contact_unique").on(t.tenantId,t.contactId),
 foreignKey({columns:[t.tenantId,t.contactId],foreignColumns:[contacts.tenantId,contacts.id]}),
 check("newsletter_subscriber_version",sql`${t.version}>=1`),check("newsletter_tags_count",sql`cardinality(${t.tags})<=50`)]);
export const newsletterSubscriptions = pgTable("newsletter_subscriptions", {
 tenantId:uuid("tenant_id").notNull(),listId:uuid("list_id").notNull(),subscriberId:uuid("subscriber_id").notNull(),
 state:text("state",{enum:["subscribed","unsubscribed","bounced","suppressed"]}).notNull(),
 consentId:uuid("consent_id"),purpose:text("purpose").notNull().default("newsletter"),version:integer("version").notNull().default(1),
 createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.listId,t.subscriberId]}),foreignKey({columns:[t.tenantId,t.listId],foreignColumns:[newsletterLists.tenantId,newsletterLists.id]}),
 foreignKey({columns:[t.tenantId,t.subscriberId],foreignColumns:[newsletterSubscribers.tenantId,newsletterSubscribers.id]}),
 foreignKey({columns:[t.tenantId,t.consentId],foreignColumns:[contactConsents.tenantId,contactConsents.id]}),
 check("newsletter_subscription_state",sql`${t.state} in ('subscribed','unsubscribed','bounced','suppressed')`),
 check("newsletter_subscription_purpose",sql`${t.purpose}='newsletter'`),check("newsletter_subscription_consent",sql`${t.state}<>'subscribed' or ${t.consentId} is not null`),
 check("newsletter_subscription_version",sql`${t.version}>=1`)]);
export const newsletterSegments = pgTable("newsletter_segments", {
 tenantId:uuid("tenant_id").notNull(),id:uuid("id").notNull().defaultRandom(),audienceId:uuid("audience_id").notNull(),savedViewId:uuid("saved_view_id").notNull(),savedViewVersion:integer("saved_view_version").notNull(),
 name:text("name").notNull(),createdBy:text("created_by").notNull().references(()=>users.id),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),archivedAt:timestamp("archived_at",{withTimezone:true}),
},t=>[primaryKey({columns:[t.tenantId,t.id]}),foreignKey({columns:[t.tenantId,t.audienceId],foreignColumns:[newsletterAudiences.tenantId,newsletterAudiences.id]}),
 foreignKey({columns:[t.tenantId,t.savedViewId],foreignColumns:[crmSavedViews.tenantId,crmSavedViews.id]}).onDelete("cascade"),check("newsletter_segment_view_version",sql`${t.savedViewVersion}>=1`),check("newsletter_segment_name",sql`length(trim(${t.name})) between 1 and 100`)]);

// Provenance follows CRM source access: owner/admin only, separate from member-readable subscriber metadata.
export const newsletterImportProvenance = pgTable("newsletter_import_provenance", {
 tenantId:uuid("tenant_id").notNull(),subscriberId:uuid("subscriber_id").notNull(),source:text("source").notNull(),
 importId:uuid("import_id"),rowNumber:integer("row_number"),importedAt:timestamp("imported_at",{withTimezone:true}),
 createdBy:text("created_by").notNull().references(()=>users.id),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.subscriberId]}),foreignKey({columns:[t.tenantId,t.subscriberId],foreignColumns:[newsletterSubscribers.tenantId,newsletterSubscribers.id]}),
 foreignKey({columns:[t.tenantId,t.importId],foreignColumns:[crmImports.tenantId,crmImports.id]}),
 check("newsletter_import_provenance",sql`(${t.source}='manual' and ${t.importId} is null and ${t.rowNumber} is null and ${t.importedAt} is null) or (${t.source}='csv_import' and ${t.importId} is not null and ${t.rowNumber} is not null and ${t.rowNumber}>0 and ${t.importedAt} is not null)`)]);

// C11a: text channels. Application writes use the migration's narrow definers only.
export const communityChatState = pgTable("community_chat_state", {
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  rev: bigint("rev", { mode: "number" }).notNull().default(0),
}, t => [primaryKey({ columns: [t.tenantId,t.communityId] }), foreignKey({columns:[t.tenantId,t.communityId],foreignColumns:[communities.tenantId,communities.id]}).onDelete("cascade")]);
export const communityChannels = pgTable("community_channels", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  name: text("name").notNull(), emoji: text("emoji"), description: text("description"), position: integer("position").notNull().default(0),
  posting: text("posting").notNull().default("members"), accessMode: text("access_mode").notNull().default("all"), minRole: text("min_role").notNull().default("member"),
  slowModeSeconds: integer("slow_mode_seconds").notNull().default(0), lastRev: bigint("last_rev", {mode:"number"}).notNull().default(0),
  lastMessageAt: timestamp("last_message_at",{withTimezone:true}), archivedAt: timestamp("archived_at",{withTimezone:true}),
  createdBy: text("created_by").references(()=>users.id,{onDelete:"set null"}), createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[unique("community_channels_scope").on(t.tenantId,t.communityId,t.id),
  foreignKey({columns:[t.tenantId,t.communityId],foreignColumns:[communities.tenantId,communities.id]}).onDelete("cascade"),
  index("community_channels_order_idx").on(t.communityId,t.position),
  check("community_channel_name",sql`length(trim(${t.name})) between 1 and 60`),
  check("community_channel_emoji",sql`${t.emoji} is null or length(${t.emoji}) <= 16`),
  check("community_channel_description",sql`${t.description} is null or length(${t.description}) <= 200`),
  check("community_channel_posting",sql`${t.posting} in ('members','hosts')`),
  check("community_channel_access",sql`${t.accessMode} in ('all','role','invite','tier','tag')`),
  check("community_channel_role",sql`${t.minRole} in ('member','contributor','moderator','admin','owner')`),
  check("community_channel_slow",sql`${t.slowModeSeconds} between 0 and 3600`)]);
export const communityChannelMembers = pgTable("community_channel_members", {
  tenantId: uuid("tenant_id").notNull(),communityId:uuid("community_id").notNull(),channelId:uuid("channel_id").notNull(),
  userId:text("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}), addedBy:text("added_by").references(()=>users.id,{onDelete:"set null"}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.channelId,t.userId]}),foreignKey({columns:[t.tenantId,t.communityId],foreignColumns:[communities.tenantId,communities.id]}).onDelete("cascade"),
 foreignKey({columns:[t.tenantId,t.communityId,t.channelId],foreignColumns:[communityChannels.tenantId,communityChannels.communityId,communityChannels.id]}).onDelete("cascade")]);
export const communityMessages = pgTable("community_messages", {
  id:uuid("id").primaryKey().defaultRandom(),tenantId:uuid("tenant_id").notNull(),communityId:uuid("community_id").notNull(),channelId:uuid("channel_id").notNull(),
  authorId:text("author_id").references(()=>users.id,{onDelete:"set null"}), parentId:uuid("parent_id"),clientId:uuid("client_id").notNull(),
  body:text("body").notNull(),mentionIds:text("mention_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  seq:bigint("seq",{mode:"number"}).notNull(),rev:bigint("rev",{mode:"number"}).notNull(),replyCount:integer("reply_count").notNull().default(0),
  editedAt:timestamp("edited_at",{withTimezone:true}),pinnedAt:timestamp("pinned_at",{withTimezone:true}),pinnedBy:text("pinned_by").references(()=>users.id,{onDelete:"set null"}),
  heldAt:timestamp("held_at",{withTimezone:true}),heldReason:text("held_reason"),
  deletedAt:timestamp("deleted_at",{withTimezone:true}),deletedBy:text("deleted_by").references(()=>users.id,{onDelete:"set null"}),deletedKind:text("deleted_kind"),purgeAfter:timestamp("purge_after",{withTimezone:true}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[unique("community_messages_scope").on(t.tenantId,t.communityId,t.channelId,t.id),uniqueIndex("community_messages_client_idx").on(t.authorId,t.clientId),
 foreignKey({columns:[t.tenantId,t.communityId],foreignColumns:[communities.tenantId,communities.id]}).onDelete("cascade"),
 foreignKey({columns:[t.tenantId,t.communityId,t.channelId],foreignColumns:[communityChannels.tenantId,communityChannels.communityId,communityChannels.id]}).onDelete("cascade"),
 foreignKey({columns:[t.tenantId,t.communityId,t.channelId,t.parentId],foreignColumns:[t.tenantId,t.communityId,t.channelId,t.id]}).onDelete("set null"),
 index("community_messages_seq_idx").on(t.channelId,t.seq),index("community_messages_rev_idx").on(t.channelId,t.rev),
 index("community_messages_thread_idx").on(t.parentId,t.seq),index("community_messages_author_idx").on(t.communityId,t.authorId,t.createdAt),
 index("community_messages_purge_idx").on(t.purgeAfter).where(sql`${t.deletedAt} is not null`),
 check("community_message_body",sql`length(trim(${t.body})) between 1 and 2000`),check("community_message_mentions",sql`cardinality(${t.mentionIds}) <= 10`),
 check("community_message_deleted_kind",sql`${t.deletedKind} is null or ${t.deletedKind} in ('author','host')`)]);
export const communityMessageReactions = pgTable("community_message_reactions", {
 tenantId:uuid("tenant_id").notNull(),communityId:uuid("community_id").notNull(),channelId:uuid("channel_id").notNull(),messageId:uuid("message_id").notNull(),
 userId:text("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}),emoji:text("emoji").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.messageId,t.userId,t.emoji]}),foreignKey({columns:[t.tenantId,t.communityId],foreignColumns:[communities.tenantId,communities.id]}).onDelete("cascade"),
 foreignKey({columns:[t.tenantId,t.communityId,t.channelId,t.messageId],foreignColumns:[communityMessages.tenantId,communityMessages.communityId,communityMessages.channelId,communityMessages.id]}).onDelete("cascade"),
 check("community_reaction_emoji",sql`${t.emoji} in ('👍','❤️','🙏','😊','🎉','👏','💡','🔥','😮','😢','✅','🙌')`)]);
export const communityChannelReads = pgTable("community_channel_reads", {
 tenantId:uuid("tenant_id").notNull(),communityId:uuid("community_id").notNull(),channelId:uuid("channel_id").notNull(),userId:text("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}),
 lastReadSeq:bigint("last_read_seq",{mode:"number"}).notNull().default(0),mute:text("mute").notNull().default("none"),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.channelId,t.userId]}),foreignKey({columns:[t.tenantId,t.communityId],foreignColumns:[communities.tenantId,communities.id]}).onDelete("cascade"),
 foreignKey({columns:[t.tenantId,t.communityId,t.channelId],foreignColumns:[communityChannels.tenantId,communityChannels.communityId,communityChannels.id]}).onDelete("cascade"),check("community_channel_mute",sql`${t.mute} in ('none','mentions_only','all')`)]);
export const communityChatPurgeRuns = pgTable("community_chat_purge_runs", {
 id:uuid("id").primaryKey().defaultRandom(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),kind:text("kind").notNull(),
 deleted:integer("deleted").notNull().default(0),status:text("status").notNull(),failureCode:text("failure_code"),
},t=>[check("community_chat_purge_status",sql`${t.status} in ('ok','failed')`)]);

// C11c private messages. DM evidence survives purging or deleting the original conversation.
export const communityDmConversations = pgTable("community_dm_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  pairKey: text("pair_key").notNull(),
  origin: text("origin", { enum: ["staff", "member"] }).notNull(),
  startedBy: text("started_by").references(() => users.id, { onDelete: "set null" }),
  staffEngagedBy: text("staff_engaged_by").references(() => users.id, { onDelete: "set null" }),
  staffEngagedAt: timestamp("staff_engaged_at", { withTimezone: true }),
  lastRev: bigint("last_rev", { mode: "bigint" }).notNull().default(sql`0`),
  lastSenderId: text("last_sender_id").references(() => users.id, { onDelete: "set null" }),
  unanswered: integer("unanswered").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  unique("community_dm_conversations_scope").on(t.tenantId, t.communityId, t.id),
  unique("community_dm_conversations_pair").on(t.communityId, t.pairKey),
  index("community_dm_conversations_starter_idx").on(t.communityId, t.startedBy, t.createdAt),
  check("community_dm_origin", sql`${t.origin} in ('staff', 'member')`),
  check("community_dm_unanswered", sql`${t.unanswered} between 0 and 3`),
]);

export const communityDmParticipants = pgTable("community_dm_participants", {
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(), conversationId: uuid("conversation_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastReadSeq: bigint("last_read_seq", { mode: "bigint" }).notNull().default(sql`0`),
  stateRev: bigint("state_rev", { mode: "bigint" }).notNull().default(sql`0`),
  muted: boolean("muted").notNull().default(false),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  leftAt: timestamp("left_at", { withTimezone: true }),
}, t => [
  primaryKey({ columns: [t.conversationId, t.userId] }),
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.communityId, t.conversationId], foreignColumns: [communityDmConversations.tenantId, communityDmConversations.communityId, communityDmConversations.id] }).onDelete("cascade"),
  index("community_dm_participants_user_idx").on(t.userId, t.communityId, t.conversationId),
]);

export const communityDmMessages = pgTable("community_dm_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(), conversationId: uuid("conversation_id").notNull(),
  authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
  requestHash: text("request_hash").notNull(),
  clientId: uuid("client_id").notNull(),
  body: text("body").notNull(),
  seq: bigint("seq", { mode: "bigint" }).notNull(), rev: bigint("rev", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by").references(() => users.id, { onDelete: "set null" }),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
}, t => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.communityId, t.conversationId], foreignColumns: [communityDmConversations.tenantId, communityDmConversations.communityId, communityDmConversations.id] }).onDelete("cascade"),
  uniqueIndex("community_dm_client_idx").on(t.communityId, t.authorId, t.clientId),
  index("community_dm_messages_seq_idx").on(t.conversationId, t.seq),
  index("community_dm_messages_rev_idx").on(t.conversationId, t.rev),
  index("community_dm_messages_author_idx").on(t.communityId, t.authorId, t.createdAt),
  index("community_dm_messages_purge_idx").on(t.purgeAfter).where(sql`${t.purgeAfter} is not null`),
  check("community_dm_message_body", sql`length(trim(${t.body})) between 1 and 2000`),
]);

export const communityDmBlocks = pgTable("community_dm_blocks", {
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  blockerId: text("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  blockedId: text("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.communityId, t.blockerId, t.blockedId] }),
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  check("community_dm_block_distinct", sql`${t.blockerId} <> ${t.blockedId}`),
]);

export const communityDmReportEvidence = pgTable("community_dm_report_evidence", {
  reportId: uuid("report_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(), conversationId: uuid("conversation_id").notNull(),
  // Retain original identities for recusal even when an account or conversation is deleted.
  reporterKey: text("reporter_key").notNull(), subjectKey: text("subject_key"),
  reporterName: text("reporter_name"),
  snapshot: jsonb("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, t => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.communityId, t.reportId], foreignColumns: [communityReports.tenantId, communityReports.communityId, communityReports.id] }).onDelete("cascade"),
  index("community_dm_evidence_expiry_idx").on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
  check("community_dm_evidence_bound", sql`jsonb_array_length(${t.snapshot}) between 1 and 6`),
]);

export const events = pgTable("events", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  location: text("location"),
  coverFileId: uuid("cover_file_id").references((): AnyPgColumn => eventFiles.id, { onDelete: "set null" }),
  timeZone: text("time_zone").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  capacity: integer("capacity"),
  waitlistEnabled: boolean("waitlist_enabled").notNull().default(true),
  reminderMinutes: integer("reminder_minutes"),
  status: text("status", { enum: ["draft", "published", "cancelled"] }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  index("events_tenant_start_idx").on(t.tenantId, t.startsAt, t.id),
  check("event_content", sql`length(btrim(${t.title})) between 1 and 120 and length(${t.description}) <= 4000 and length(${t.timeZone}) between 1 and 100`),
  check("event_location", sql`length(btrim(${t.location})) between 1 and 240 and ${t.location} !~ '[[:cntrl:]]'`),
  check("event_interval", sql`${t.endsAt} > ${t.startsAt}`),
  check("event_capacity", sql`${t.capacity} is null or ${t.capacity} > 0`),
  check("event_reminder_minutes", sql`${t.reminderMinutes} between 1 and 10080`),
  check("event_status", sql`${t.status} in ('draft','published','cancelled') and ${t.version} > 0`),
]);

export const eventFiles = pgTable("event_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  eventId: uuid("event_id").notNull(),
  uploaderId: text("uploader_id").references(() => users.id, { onDelete: "set null" }),
  key: text("key").notNull().unique(),
  kind: text("kind", { enum: ["cover"] }).notNull().default("cover"),
  name: text("name").notNull(),
  mime: text("mime", { enum: ["image/jpeg", "image/png", "image/webp"] }).notNull(),
  size: integer("size").notNull(),
  checksum: text("checksum").notNull(),
  status: text("status", { enum: ["pending", "uploaded", "quarantined", "ready"] }).notNull().default("pending"),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [events.tenantId, events.id] }).onDelete("cascade"),
  index("event_files_parent").on(t.tenantId, t.eventId),
  check("event_file_kind", sql`${t.kind} = 'cover'`),
  check("event_file_mime", sql`${t.mime} in ('image/jpeg','image/png','image/webp')`),
  check("event_file_name", sql`length(btrim(${t.name})) between 1 and 200`),
  check("event_file_size", sql`${t.size} between 1 and 10485760`),
  check("event_file_checksum", sql`${t.checksum} ~ '^[a-f0-9]{64}$'`),
  check("event_file_status", sql`${t.status} in ('pending','uploaded','quarantined','ready')`),
  check("event_file_key", sql`${t.key} = 'workspaces/' || ${t.tenantId}::text || '/events/' || ${t.eventId}::text || '/files/' || ${t.id}::text`),
]);

export const eventJoinLinks = pgTable("event_join_links", {
  tenantId: uuid("tenant_id").notNull(),
  eventId: uuid("event_id").notNull(),
  url: text("url").notNull(),
  windowMinutes: integer("window_minutes").notNull().default(30),
}, (t) => [primaryKey({ columns: [t.tenantId, t.eventId] }),
  foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [events.tenantId, events.id] }).onDelete("cascade"),
  check("event_join_https", sql`length(${t.url}) between 9 and 2048 and ${t.url} ~ '^https://[^/?#@[:space:]]+([/?#]|$)' and ${t.url} !~ '[[:space:]]' and strpos(${t.url},chr(92)) = 0`),
  check("event_join_window", sql`${t.windowMinutes} between 0 and 1440`),
]);

// C14 owns placement. E01 defines the read-side contract, with no placement mutation endpoint.
export const communityEventLinks = pgTable("community_event_links", {
  tenantId: uuid("tenant_id").notNull(),
  eventId: uuid("event_id").notNull(),
  communityId: uuid("community_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.eventId, t.communityId] }),
  unique("community_event_link_id").on(t.tenantId, t.id),
  index("community_event_link_community_idx").on(t.tenantId, t.communityId, t.eventId),
  foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [events.tenantId, events.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
]);

export const eventRsvps = pgTable("event_rsvps", {
  tenantId: uuid("tenant_id").notNull(),
  eventId: uuid("event_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  state: text("state", { enum: ["going", "maybe", "not_going", "waitlisted"] }).notNull(),
  waitlistedAt: timestamp("waitlisted_at", { withTimezone: true }),
  sources: jsonb("sources").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.eventId, t.userId] }),
  foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [events.tenantId, events.id] }).onDelete("cascade"),
  index("event_rsvps_going_idx").on(t.tenantId, t.eventId).where(sql`${t.state} = 'going'`),
  index("event_rsvps_waitlist_idx").on(t.tenantId, t.eventId, t.waitlistedAt, t.userId).where(sql`${t.state} = 'waitlisted'`),
  check("event_rsvp_state", sql`${t.state} in ('going','maybe','not_going','waitlisted') and (${t.state} = 'waitlisted') = (${t.waitlistedAt} is not null) and ${t.version} > 0 and jsonb_typeof(${t.sources}) = 'object'`),
]);

export const newsletterSignupForms = pgTable("newsletter_signup_forms", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  listId: uuid("list_id").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  active: boolean("active").notNull().default(false),
  version: integer("version").notNull().default(1),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  unique("newsletter_signup_form_key").on(t.id),
  foreignKey({ columns: [t.tenantId, t.listId], foreignColumns: [newsletterLists.tenantId, newsletterLists.id] }),
  check("newsletter_signup_form_version", sql`${t.version} > 0`),
]);

export const newsletterSignupChallenges = pgTable("newsletter_signup_challenges", {
  tokenHash: text("token_hash").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  formId: uuid("form_id").notNull(),
  contactId: uuid("contact_id"),
  formVersion: integer("form_version").notNull(),
  emailProof: text("email_proof").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.formId], foreignColumns: [newsletterSignupForms.tenantId, newsletterSignupForms.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete("cascade"),
  index("newsletter_signup_challenges_contact").on(t.tenantId, t.contactId),
  index("newsletter_signup_challenges_expiry").on(t.expiresAt),
  check("newsletter_signup_challenge_hashes", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$' and ${t.emailProof} ~ '^[0-9a-f]{64}$'`),
]);

export const newsletterPreferenceTokens = pgTable("newsletter_preference_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  subscriberId: uuid("subscriber_id").notNull(),
  listId: uuid("list_id"),
  scope: text("scope", { enum: ["list", "all"] }).notNull(),
  emailProof: text("email_proof").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.subscriberId], foreignColumns: [newsletterSubscribers.tenantId, newsletterSubscribers.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.listId, t.subscriberId], foreignColumns: [newsletterSubscriptions.tenantId, newsletterSubscriptions.listId, newsletterSubscriptions.subscriberId] }).onDelete("cascade"),
  index("newsletter_preference_tokens_expiry").on(t.expiresAt),
  check("newsletter_preference_token_scope", sql`(${t.scope} = 'list' and ${t.listId} is not null) or (${t.scope} = 'all' and ${t.listId} is null)`),
  check("newsletter_preference_token_hashes", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$' and ${t.emailProof} ~ '^[0-9a-f]{64}$'`),
]);

export const newsletterIntakeLimits = pgTable("newsletter_intake_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
}, (t) => [
  index("newsletter_intake_limits_expiry").on(t.expiresAt),
  check("newsletter_intake_limit_count", sql`${t.count} > 0`),
]);

// Free standalone catalogue. A course or download is one item; community shelves reference it.
export const catalogItems = pgTable("catalog_items", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  kind: text("kind", { enum: ["course", "download"] }).notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  state: text("state", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
  visibility: text("visibility", { enum: ["hidden", "unlisted", "listed"] }).notNull().default("hidden"),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }), unique().on(t.tenantId, t.id, t.kind),
  check("catalog_item_kind", sql`${t.kind} in ('course','download')`),
  check("catalog_item_state", sql`${t.state} in ('draft','published','archived')`),
  check("catalog_item_visibility", sql`${t.visibility} in ('hidden','unlisted','listed')`),
  check("catalog_item_publication", sql`${t.state} <> 'published' or ${t.visibility} <> 'hidden'`),
  check("catalog_item_slug", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'`),
  check("catalog_item_title", sql`length(trim(${t.title})) between 1 and 120`),
  check("catalog_item_summary", sql`length(${t.summary}) <= 2000`),
  check("catalog_item_version", sql`${t.version} > 0`),
]);

export const catalogLessons = pgTable("catalog_lessons", {
  tenantId: uuid("tenant_id").notNull(), itemId: uuid("item_id").notNull(), id: uuid("id").notNull().defaultRandom(),
  kind: text("kind").notNull().default("course"),
  position: integer("position").notNull(), title: text("title").notNull(),
  body: jsonb("body").$type<RichDoc>().notNull(),
  published: boolean("published").notNull(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.itemId, t.id] }), unique().on(t.tenantId, t.itemId, t.position),
  foreignKey({ columns: [t.tenantId, t.itemId, t.kind], foreignColumns: [catalogItems.tenantId, catalogItems.id, catalogItems.kind] }),
  check("catalog_lesson_kind", sql`${t.kind} = 'course'`),
  check("catalog_lesson_position", sql`${t.position} between 0 and 49`),
  check("catalog_lesson_title", sql`length(trim(${t.title})) between 1 and 120`),
  check("catalog_lesson_body", sql`jsonb_typeof(${t.body}) = 'object' and octet_length(${t.body}::text) <= 32000`),
]);

export const catalogFiles = pgTable("catalog_files", {
  tenantId: uuid("tenant_id").notNull(), itemId: uuid("item_id").notNull(), fileId: uuid("file_id").notNull(),
  kind: text("kind").notNull().default("download"),
  position: integer("position").notNull(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.itemId, t.fileId] }), unique().on(t.tenantId, t.itemId, t.position),
  foreignKey({ columns: [t.tenantId, t.itemId, t.kind], foreignColumns: [catalogItems.tenantId, catalogItems.id, catalogItems.kind] }),
  foreignKey({ columns: [t.tenantId, t.fileId], foreignColumns: [files.tenantId, files.id] }),
  check("catalog_file_kind", sql`${t.kind} = 'download'`),
  check("catalog_file_position", sql`${t.position} between 0 and 19`),
]);

export const catalogEnrolments = pgTable("catalog_enrolments", {
  tenantId: uuid("tenant_id").notNull(), itemId: uuid("item_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.itemId, t.userId] }),
  foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }),
]);

export const communityProductLinks = pgTable("community_product_links", {
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(), itemId: uuid("item_id").notNull(),
  position: integer("position").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.communityId, t.itemId] }),
  foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [catalogItems.tenantId, catalogItems.id] }),
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  check("community_product_position", sql`${t.position} between 0 and 1000`),
]);

// Voluntary profile data follows the membership's account-deletion cascade.
export const communityMemberProfiles = pgTable("community_member_profiles", {
  tenantId: uuid("tenant_id").notNull(),
  communityId: uuid("community_id").notNull(),
  userId: text("user_id").notNull(),
  displayName: text("display_name"),
  bio: text("bio"),
  language: text("language"),
  links: jsonb("links").$type<{label: string; url: string}[]>().notNull().default([]),
  visibility: text("visibility", { enum: ["members", "unlisted", "private"] }).notNull().default("members"),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.communityId, t.userId] }),
  foreignKey({ columns: [t.tenantId, t.communityId, t.userId],
    foreignColumns: [communityMemberships.tenantId, communityMemberships.communityId, communityMemberships.userId] }).onDelete("cascade"),
  check("community_member_profile_display_name", sql`length(btrim(${t.displayName})) between 1 and 100`),
  check("community_member_profile_bio", sql`length(${t.bio}) <= 500`),
  check("community_member_profile_language", sql`length(btrim(${t.language})) between 1 and 80`),
  check("community_member_profile_links", sql`public.community_member_profile_links_valid(${t.links})`),
  check("community_member_profile_visibility", sql`${t.visibility} in ('members','unlisted','private')`),
  check("community_member_profile_version", sql`${t.version} > 0`),
]);

// Social inbox retains routing and Harvest workflow metadata only.
export const socialInboxItems = pgTable("social_inbox_items", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  connectionId: uuid("connection_id").notNull(),
  providerRef: text("provider_ref").notNull(),
  kind: text("kind").$type<"dm" | "comment" | "mention" | "story">().notNull(),
  activityAt: timestamp("activity_at", { withTimezone: true }),
  status: text("status").$type<"open" | "done">().notNull().default("open"),
  assigneeId: text("assignee_id"),
  starred: boolean("starred").notNull().default(false),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  contactId: uuid("contact_id"),
  version: integer("version").notNull().default(1),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("social_inbox_item_identity").on(t.tenantId, t.connectionId, t.kind, t.providerRef),
  foreignKey({ name: "social_inbox_item_connection_fk", columns: [t.tenantId, t.connectionId], foreignColumns: [socialConnections.tenantId, socialConnections.id] }),
  foreignKey({ name: "social_inbox_item_assignee_fk", columns: [t.tenantId, t.assigneeId], foreignColumns: [workspaceMembers.tenantId, workspaceMembers.userId] }),
  foreignKey({ name: "social_inbox_item_contact_fk", columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  index("social_inbox_item_activity_idx").on(t.tenantId, t.activityAt, t.id),
  check("social_inbox_item_shape", sql`${t.kind} in ('dm','comment','mention','story') and ${t.status} in ('open','done') and length(${t.providerRef}) between 1 and 200 and ${t.version} > 0`),
]);
export const socialInboxReads = pgTable("social_inbox_reads", {
  tenantId: uuid("tenant_id").notNull(),
  itemId: uuid("item_id").notNull(),
  readerId: text("reader_id").notNull(),
  readThrough: timestamp("read_through", { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.itemId, t.readerId] }),
  foreignKey({ name: "social_inbox_read_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [socialInboxItems.tenantId, socialInboxItems.id] }).onDelete("cascade"),
  foreignKey({ name: "social_inbox_read_reader_fk", columns: [t.tenantId, t.readerId], foreignColumns: [workspaceMembers.tenantId, workspaceMembers.userId] }).onDelete("cascade"),
]);
export const socialInboxLabels = pgTable("social_inbox_labels", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  archived: boolean("archived").notNull().default(false),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  uniqueIndex("social_inbox_label_name_idx").on(t.tenantId, sql`lower(${t.name})`).where(sql`not ${t.archived}`),
  check("social_inbox_label_shape", sql`length(trim(${t.name})) between 1 and 80 and ${t.version} > 0`),
]);
export const socialInboxItemLabels = pgTable("social_inbox_item_labels", {
  tenantId: uuid("tenant_id").notNull(),
  itemId: uuid("item_id").notNull(),
  labelId: uuid("label_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.itemId, t.labelId] }),
  foreignKey({ name: "social_inbox_item_label_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [socialInboxItems.tenantId, socialInboxItems.id] }).onDelete("cascade"),
  foreignKey({ name: "social_inbox_item_label_label_fk", columns: [t.tenantId, t.labelId], foreignColumns: [socialInboxLabels.tenantId, socialInboxLabels.id] }),
]);
export const socialInboxNotes = pgTable("social_inbox_notes", {
  tenantId: uuid("tenant_id").notNull(),
  itemId: uuid("item_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  authorId: text("author_id").notNull().references(() => users.id),
  note: text("note").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.itemId, t.id] }),
  foreignKey({ name: "social_inbox_note_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [socialInboxItems.tenantId, socialInboxItems.id] }).onDelete("cascade"),
  check("social_inbox_note_shape", sql`length(trim(${t.note})) between 1 and 5000 and ${t.version} > 0`),
]);
export const socialInboxSavedReplies = pgTable("social_inbox_saved_replies", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  name: text("name").notNull(),
  template: text("template").notNull(),
  version: integer("version").notNull().default(1),
  archived: boolean("archived").notNull().default(false),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  check("social_inbox_saved_reply_shape", sql`length(trim(${t.name})) between 1 and 80 and length(trim(${t.template})) between 1 and 5000 and ${t.version} > 0`),
]);
export const socialInboxHours = pgTable("social_inbox_hours", {
  tenantId: uuid("tenant_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  timezone: text("timezone").notNull(),
  hours: jsonb("hours").$type<{ day: number; start: string; end: string }[]>().notNull(),
  awayTemplate: text("away_template"),
  version: integer("version").notNull().default(1),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.connectionId] }),
  foreignKey({ name: "social_inbox_hours_connection_fk", columns: [t.tenantId, t.connectionId], foreignColumns: [socialConnections.tenantId, socialConnections.id] }),
  check("social_inbox_hours_shape", sql`length(${t.timezone}) between 1 and 80 and jsonb_typeof(${t.hours}) = 'array' and jsonb_array_length(${t.hours}) <= 28 and length(${t.hours}::text) <= 2400 and (${t.awayTemplate} is null or length(${t.awayTemplate}) between 1 and 5000) and ${t.version} > 0`),
]);
export const socialInboxReplies = pgTable("social_inbox_replies", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull(),
  itemId: uuid("item_id").notNull(),
  actorId: text("actor_id").notNull().references(() => users.id),
  connectionVersion: integer("connection_version").notNull(),
  mode: text("mode").$type<"message" | "comment" | "private" | "mention">().notNull(),
  fingerprint: text("fingerprint").notNull(),
  targetRef: text("target_ref"),
  fileId: uuid("file_id"),
  state: text("state").$type<"queued" | "leased" | "dispatching" | "unknown" | "confirmed" | "failed" | "cancelled">().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  reconcileAttempts: integer("reconcile_attempts").notNull().default(0),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
  nextAt: timestamp("next_at", { withTimezone: true }).notNull().defaultNow(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  leaseId: uuid("lease_id"),
  providerDeliveryRef: text("provider_delivery_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "social_inbox_reply_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [socialInboxItems.tenantId, socialInboxItems.id] }),
  foreignKey({ name: "social_inbox_reply_file_fk", columns: [t.tenantId, t.fileId], foreignColumns: [files.tenantId, files.id] }),
  uniqueIndex("social_inbox_private_reply_once").on(t.tenantId, t.itemId, t.targetRef)
    .where(sql`${t.mode} = 'private' and ${t.state} in ('queued','leased','dispatching','unknown','confirmed')`),
  index("social_inbox_reply_due_idx").on(t.state, t.nextAt, t.id),
  check("social_inbox_reply_shape", sql`${t.mode} in ('message','comment','private','mention') and ${t.state} in ('queued','leased','dispatching','unknown','confirmed','failed','cancelled') and ${t.fingerprint} ~ '^[a-zA-Z0-9_.:-]{1,100}:[a-f0-9]{64}$' and ${t.attempts} between 0 and 3 and ${t.reconcileAttempts} between 0 and 3 and ${t.version} > 0 and ((${t.leaseId} is null) = (${t.leaseUntil} is null)) and ((${t.attempts} = 0) = (${t.firstAttemptAt} is null)) and ((${t.state} = 'confirmed') = (${t.providerDeliveryRef} is not null)) and (${t.targetRef} is null or length(${t.targetRef}) between 1 and 200) and (${t.providerDeliveryRef} is null or length(${t.providerDeliveryRef}) between 1 and 200)`),
]);

// Only item IDs already encountered in an expiring, per-reader aggregate scan.
export const socialInboxScanItems = pgTable("social_inbox_scan_items", {
  tenantId: uuid("tenant_id").notNull(),
  readerId: text("reader_id").notNull(),
  scanId: uuid("scan_id").notNull(),
  itemId: uuid("item_id").notNull(),
  firstPage: integer("first_page").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.readerId, t.scanId, t.itemId] }),
  foreignKey({ name: "social_inbox_scan_reader_fk", columns: [t.tenantId, t.readerId], foreignColumns: [workspaceMembers.tenantId, workspaceMembers.userId] }).onDelete("cascade"),
  foreignKey({ name: "social_inbox_scan_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [socialInboxItems.tenantId, socialInboxItems.id] }).onDelete("cascade"),
  index("social_inbox_scan_expiry_idx").on(t.tenantId, t.readerId, t.expiresAt),
  check("social_inbox_scan_page", sql`${t.firstPage} >= 0`),
]);

export const socialPostMediaGrants = pgTable("social_post_media_grants", {
  tenantId: uuid("tenant_id").notNull(),
  postId: uuid("post_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimId: uuid("claim_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.postId] }),
  uniqueIndex("social_post_media_grant_id_idx").on(t.id),
  foreignKey({ name: "social_post_media_grant_delivery_fk", columns: [t.tenantId, t.postId], foreignColumns: [socialPosts.tenantId, socialPosts.id] }).onDelete("cascade"),
]);

export const socialAutoDmRules = pgTable("social_auto_dm_rules", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(),
  connectionId: uuid("connection_id").notNull(), postId: uuid("post_id"),
  rule: jsonb("rule").$type<AutoDmRule>().notNull(),
  enabled: boolean("enabled").notNull().default(false), version: integer("version").notNull().default(1),
  enabledBy: text("enabled_by"), enabledAt: timestamp("enabled_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  unique("social_auto_dm_rule_connection_key").on(t.tenantId, t.connectionId, t.id),
  foreignKey({ columns: [t.tenantId, t.connectionId], foreignColumns: [socialConnections.tenantId, socialConnections.id] }),
  foreignKey({ columns: [t.tenantId, t.postId], foreignColumns: [socialPosts.tenantId, socialPosts.id] }),
  index("social_auto_dm_active_idx").on(t.tenantId,t.connectionId).where(sql`${t.enabled}`),
  check("social_auto_dm_rule_shape", sql`${t.version} > 0 and jsonb_typeof(${t.rule}) = 'object' and octet_length(${t.rule}::text) <= 24000 and (${t.enabled} = (${t.enabledBy} is not null and ${t.enabledAt} is not null))`),
  check("social_auto_dm_rule_limits", sql`case when jsonb_typeof(${t.rule}->'cooldownMinutes') = 'number' and ${t.rule}->>'cooldownMinutes' ~ '^[0-9]{1,6}$' then (${t.rule}->>'cooldownMinutes')::integer between 1 and 43200 else false end and case when jsonb_typeof(${t.rule}->'recipientDaily') = 'number' and ${t.rule}->>'recipientDaily' ~ '^[0-9]{1,6}$' then (${t.rule}->>'recipientDaily')::integer between 1 and 5 else false end and case when jsonb_typeof(${t.rule}->'ruleDaily') = 'number' and ${t.rule}->>'ruleDaily' ~ '^[0-9]{1,6}$' then (${t.rule}->>'ruleDaily')::integer between 1 and 500 else false end`),
]);

export const socialAutoDmJobs = pgTable("social_auto_dm_jobs", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(),
  connectionId: uuid("connection_id").notNull(), ruleId: uuid("rule_id").notNull(), ruleVersion: integer("rule_version").notNull(),
  eventId: uuid("event_id").notNull(), step: text("step").$type<"primary" | "public" | "followup">().notNull().default("primary"),
  recipientKey: text("recipient_key"), requestHash: text("request_hash"), prefix: text("prefix").$type<"rule" | "away">(),
  policyVersion: integer("policy_version"),
  state: text("state").notNull().default("queued"), reason: text("reason"),
  attempts: integer("attempts").notNull().default(0), leasedUntil: timestamp("leased_until", { withTimezone: true }),
  lease: uuid("lease"),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
  nextAt: timestamp("next_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  deliveryRef: text("delivery_ref"),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "social_auto_dm_job_rule_fk", columns: [t.tenantId, t.connectionId, t.ruleId], foreignColumns: [socialAutoDmRules.tenantId, socialAutoDmRules.connectionId, socialAutoDmRules.id] }),
  foreignKey({ name: "social_auto_dm_job_event_fk", columns: [t.tenantId, t.eventId], foreignColumns: [socialWebhookEvents.tenantId,socialWebhookEvents.id] }),
  uniqueIndex("social_auto_dm_job_event_idx").on(t.tenantId,t.connectionId,t.ruleId,t.ruleVersion,t.eventId,t.step),
  index("social_auto_dm_due_idx").on(t.state,t.nextAt),
  index("social_auto_dm_activity_idx").on(t.tenantId,t.ruleId,t.createdAt),
  check("social_auto_dm_job_shape", sql`${t.state} in ('queued','leased','dispatching','unknown','sent','skipped','handed_off','cancelled') and
    ${t.step} in ('primary','public','followup') and ${t.attempts} between 0 and 3 and ${t.ruleVersion} > 0 and
    (${t.reason} is null or ${t.reason} in ('cooldown','limit','outside_hours','ineligible','suppressed','provider_error')) and
    (${t.recipientKey} is null or ${t.recipientKey} ~ '^[0-9a-f]{64}$') and
    (${t.requestHash} is null or ${t.requestHash} ~ '^[0-9a-f]{64}$') and
    (${t.prefix} is null or ${t.prefix} in ('rule','away')) and
    (${t.deliveryRef} is null or length(${t.deliveryRef}) between 1 and 200) and
    ((${t.lease} is null) = (${t.leasedUntil} is null))`),
]);

const numericAnalytics = (column: AnyPgColumn, fields: readonly string[]) =>
  sql`jsonb_typeof(${column}) = 'object' AND ${column} - array[${sql.raw(fields.map(field => "'" + field + "'").join(","))}] = '{}'::jsonb
    AND NOT jsonb_path_exists(${column}, '$.keyvalue() ? (@.value.type() != "number")')`;

export const socialAnalyticsPosts = pgTable("social_analytics_posts", {
  tenantId: uuid("tenant_id").notNull(), connectionId: uuid("connection_id").notNull(),
  providerRef: text("provider_ref").notNull(), plannerPostId: uuid("planner_post_id"),
  day: date("day").notNull(), capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  metrics: jsonb("metrics").$type<Metrics<PostMetric>>().notNull(),
}, (t) => [
  primaryKey({ columns: [t.tenantId,t.connectionId,t.providerRef,t.day] }),
  foreignKey({ name: "social_analytics_posts_connection_fk", columns:[t.tenantId,t.connectionId], foreignColumns:[socialConnections.tenantId,socialConnections.id] }),
  foreignKey({ name: "social_analytics_posts_planner_fk", columns:[t.tenantId,t.connectionId,t.plannerPostId], foreignColumns:[socialPosts.tenantId,socialPosts.connectionId,socialPosts.id] }),
  index("social_analytics_post_day_idx").on(t.day,t.tenantId),
  index("social_analytics_post_planner_idx").on(t.tenantId,t.plannerPostId,t.day),
  check("social_analytics_post_shape", sql`length(${t.providerRef}) between 1 and 200 and ${t.publishedAt} <= ${t.capturedAt} and ${t.day} = (${t.capturedAt} at time zone 'UTC')::date and ${numericAnalytics(t.metrics, postMetrics)}`),
]);

export const socialAnalyticsAccounts = pgTable("social_analytics_accounts", {
  tenantId: uuid("tenant_id").notNull(), connectionId: uuid("connection_id").notNull(), day: date("day").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  metrics: jsonb("metrics").$type<Metrics<AccountMetric>>().notNull(),
}, (t) => [
  primaryKey({ columns:[t.tenantId,t.connectionId,t.day] }),
  foreignKey({ name:"social_analytics_accounts_connection_fk", columns:[t.tenantId,t.connectionId], foreignColumns:[socialConnections.tenantId,socialConnections.id] }),
  index("social_analytics_account_day_idx").on(t.day,t.tenantId),
  check("social_analytics_account_shape", sql`${numericAnalytics(t.metrics, accountMetrics)}`),
]);

export const socialAnalyticsTimes = pgTable("social_analytics_times", {
  tenantId: uuid("tenant_id").notNull(), connectionId: uuid("connection_id").notNull(), day: date("day").notNull(),
  weekday: integer("weekday").notNull(), hour: integer("hour").notNull(),
  engagement: doublePrecision("engagement").notNull(), samples: integer("samples").notNull(),
}, (t) => [
  primaryKey({ columns:[t.tenantId,t.connectionId,t.day,t.weekday,t.hour] }),
  foreignKey({ name:"social_analytics_times_account_fk", columns:[t.tenantId,t.connectionId,t.day],
    foreignColumns:[socialAnalyticsAccounts.tenantId,socialAnalyticsAccounts.connectionId,socialAnalyticsAccounts.day] }).onDelete("cascade"),
  check("social_analytics_time_shape", sql`${t.weekday} between 0 and 6 and ${t.hour} between 0 and 23 and ${t.samples} > 0 and ${t.engagement} between 0 and 9007199254740991`),
]);

export const socialAnalyticsRefresh = pgTable("social_analytics_refresh", {
  tenantId: uuid("tenant_id").notNull(), connectionId: uuid("connection_id").notNull(),
  state: text("state").$type<AnalyticsStatus>().notNull().default("pending"),
  checkedAt: timestamp("checked_at", { withTimezone: true }), refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
  lease: uuid("lease"), leasedUntil: timestamp("leased_until", { withTimezone: true }),
  failures: integer("failures").notNull().default(0),
  page: integer("page").notNull().default(1),
}, (t) => [
  primaryKey({ columns:[t.tenantId,t.connectionId] }),
  foreignKey({ name:"social_analytics_refresh_connection_fk", columns:[t.tenantId,t.connectionId], foreignColumns:[socialConnections.tenantId,socialConnections.id] }),
  index("social_analytics_refresh_due_idx").on(t.dueAt),
  check("social_analytics_refresh_shape", sql`${t.state} in ('pending','ready','partial','delayed','expired','unavailable') and ${t.failures} between 0 and 20 and ${t.page} between 1 and 10000 and ((${t.lease} is null) = (${t.leasedUntil} is null))`),
]);

// Newsletter authored material lives in revisions, independently of delivery evidence.
export const newsletterConnections = pgTable("newsletter_connections", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  domain: text("domain").notNull(),
  records: jsonb("records").$type<import("../server/newsletter-campaigns/port").DomainRecord[]>().notNull(),
  ownership: boolean("ownership").notNull().default(false),
  spf: boolean("spf").notNull().default(false),
  dkim: boolean("dkim").notNull().default(false),
  bounce: boolean("bounce").notNull().default(false),
  dmarc: boolean("dmarc").notNull().default(false),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), unique().on(t.tenantId, t.domain),
  uniqueIndex("newsletter_verified_domain").on(t.domain).where(sql`${t.ownership} and ${t.spf} and ${t.dkim} and ${t.bounce} and ${t.dmarc}`)]);

export const newsletterIdentities = pgTable("newsletter_identities", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  connectionId: uuid("connection_id"),
  address: text("address").notNull(),
  purpose: text("purpose", { enum: ["sender", "reply-to"] }).notNull().default("sender"),
  ownershipVerified: boolean("ownership_verified").notNull().default(false),
  confirmationDigest: text("confirmation_digest"),
  confirmationExpiresAt: timestamp("confirmation_expires_at", { withTimezone: true }),
  enabled: boolean("enabled").notNull().default(true),
  displayName: text("display_name"),
  version: integer("version").notNull().default(1),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }), unique().on(t.tenantId, t.address, t.purpose),
  check("newsletter_identity_display_name", sql`${t.displayName} is null or (char_length(${t.displayName}) between 1 and 80 and ${t.displayName} !~ '[<>"@[:cntrl:]]')`),
  check("newsletter_identity_purpose", sql`(${t.purpose}='sender' and ${t.connectionId} is not null)
    or (${t.purpose}='reply-to' and ${t.connectionId} is null)`),
  foreignKey({ columns: [t.tenantId, t.connectionId], foreignColumns: [newsletterConnections.tenantId, newsletterConnections.id] })]);

export const newsletterTemplates = pgTable("newsletter_templates", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  archived: boolean("archived").notNull().default(false),
}, t => [primaryKey({ columns: [t.tenantId, t.id] })]);

export const newsletterTemplateRevisions = pgTable("newsletter_template_revisions", {
  tenantId: uuid("tenant_id").notNull(),
  templateId: uuid("template_id").notNull(),
  version: integer("version").notNull(),
  content: jsonb("content").$type<import("../lib/newsletter-content").NewsletterContent>().notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.templateId, t.version] }),
  foreignKey({ columns: [t.tenantId, t.templateId], foreignColumns: [newsletterTemplates.tenantId, newsletterTemplates.id] })]);

export const newsletterCampaignStates = ["draft", "reviewed", "scheduled", "sending", "sent", "partial", "failed", "cancelled"] as const;
export const newsletterCampaigns = pgTable("newsletter_campaigns", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  revision: integer("revision").notNull().default(1),
  state: text("state", { enum: newsletterCampaignStates }).notNull().default("draft"),
  reviewDigest: text("review_digest"),
  reviewExpiresAt: timestamp("review_expires_at", { withTimezone: true }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  timezone: text("timezone"),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  senderVersion: integer("sender_version"),
  replyVersion: integer("reply_version"),
  senderDomainVersion: integer("sender_domain_version"),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }),
  index("newsletter_campaign_due_idx").on(t.state, t.scheduledAt),
  check("newsletter_campaign_state", sql`${t.state} in ('draft','reviewed','scheduled','sending','sent','partial','failed','cancelled')`)]);

export const newsletterCampaignRevisions = pgTable("newsletter_campaign_revisions", {
  tenantId: uuid("tenant_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  revision: integer("revision").notNull(),
  subject: text("subject").notNull(),
  preheader: text("preheader"),
  senderId: uuid("sender_id"),
  replyToId: uuid("reply_to_id"),
  content: jsonb("content").$type<import("../lib/newsletter-content").NewsletterContent>().notNull(),
  plainText: text("plain_text").notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.campaignId, t.revision] }),
  foreignKey({ columns: [t.tenantId, t.campaignId], foreignColumns: [newsletterCampaigns.tenantId, newsletterCampaigns.id] }),
  foreignKey({ name: "newsletter_revision_sender_fk", columns: [t.tenantId, t.senderId], foreignColumns: [newsletterIdentities.tenantId, newsletterIdentities.id] }),
  foreignKey({ name: "newsletter_revision_reply_fk", columns: [t.tenantId, t.replyToId], foreignColumns: [newsletterIdentities.tenantId, newsletterIdentities.id] }),
  check("newsletter_subject_length", sql`length(${t.subject}) between 1 and 150`),
  check("newsletter_preheader_length", sql`length(${t.preheader}) <= 200`)]);

export const newsletterCampaignLists = pgTable("newsletter_campaign_lists", {
  tenantId: uuid("tenant_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  revision: integer("revision").notNull(),
  listId: uuid("list_id").notNull(),
  listVersion: integer("list_version").notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.campaignId, t.revision, t.listId] }),
  foreignKey({ name: "newsletter_campaign_list_revision_fk", columns: [t.tenantId, t.campaignId, t.revision], foreignColumns: [newsletterCampaignRevisions.tenantId, newsletterCampaignRevisions.campaignId, newsletterCampaignRevisions.revision] }),
  foreignKey({ columns: [t.tenantId, t.listId], foreignColumns: [newsletterLists.tenantId, newsletterLists.id] })]);

export const newsletterCampaignSegments = pgTable("newsletter_campaign_segments", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  campaignId: uuid("campaign_id").notNull(),
  revision: integer("revision").notNull(),
  segmentId: uuid("segment_id"),
  segmentVersion: integer("segment_version").notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "newsletter_campaign_segment_revision_fk", columns: [t.tenantId, t.campaignId, t.revision], foreignColumns: [newsletterCampaignRevisions.tenantId, newsletterCampaignRevisions.campaignId, newsletterCampaignRevisions.revision] }),
  foreignKey({ name: "newsletter_campaign_segment_fk", columns: [t.tenantId, t.segmentId], foreignColumns: [newsletterSegments.tenantId, newsletterSegments.id] }).onDelete("set null")]);

export const newsletterSkipReasons = ["global_suppressed", "list_suppressed", "not_subscribed", "consent_missing", "consent_withdrawn", "person_unavailable", "address_unavailable", "eligibility_changed", "review_invalidated", "cancelled"] as const;
export const newsletterDeliveries = pgTable("newsletter_deliveries", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull().defaultRandom(), // immutable provider-echoed delivery correlation
  campaignId: uuid("campaign_id").notNull(),
  revision: integer("revision").notNull(),
  subscriberId: uuid("subscriber_id"),
  suppressionSubscriberId: uuid("suppression_subscriber_id"),
  listId: uuid("list_id"),
  subscriptionVersion: integer("subscription_version"),
  addressBinding: text("address_binding"),
  state: text("state", { enum: ["queued", "unknown", "operator_review", "accepted", "failed", "skipped"] }).notNull(),
  skipReason: text("skip_reason", { enum: newsletterSkipReasons }),
  selectedAt: timestamp("selected_at", { withTimezone: true }).notNull().defaultNow(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
  lease: uuid("lease"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  bouncedAt: timestamp("bounced_at", { withTimezone: true }),
  complainedAt: timestamp("complained_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  providerRef: text("provider_ref"),
  attemptedAddressHash: text("attempted_address_hash"),
  attemptedKeyVersion: text("attempted_key_version"),
  operatorReviewAt: timestamp("operator_review_at", { withTimezone: true }),
}, t => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  unique("newsletter_delivery_subscriber_unique").on(t.tenantId, t.campaignId, t.revision, t.subscriberId),
  unique("newsletter_delivery_reference_unique").on(t.providerRef),
  unique("newsletter_delivery_correlation_unique").on(t.id),
  check("newsletter_attempted_hash_pair", sql`(${t.attemptedAddressHash} is null) = (${t.attemptedKeyVersion} is null)`),
  index("newsletter_unknown_age_idx").on(t.attemptedAt, t.id).where(sql`${t.state} = 'unknown'`),
  index("newsletter_delivery_retention_idx").on(t.selectedAt, t.id),
  index("newsletter_delivery_due_idx").on(t.state, t.nextCheckAt, t.leaseUntil),
  foreignKey({ name: "newsletter_delivery_revision_fk", columns: [t.tenantId, t.campaignId, t.revision], foreignColumns: [newsletterCampaignRevisions.tenantId, newsletterCampaignRevisions.campaignId, newsletterCampaignRevisions.revision] }),
  foreignKey({ name: "newsletter_delivery_subscriber_fk", columns: [t.tenantId, t.subscriberId], foreignColumns: [newsletterSubscribers.tenantId, newsletterSubscribers.id] }).onDelete("set null"),
  foreignKey({ name: "newsletter_delivery_suppression_fk", columns: [t.tenantId, t.suppressionSubscriberId], foreignColumns: [newsletterSubscribers.tenantId, newsletterSubscribers.id] }).onDelete("set null"),
  foreignKey({ name: "newsletter_delivery_list_fk", columns: [t.tenantId, t.listId], foreignColumns: [newsletterLists.tenantId, newsletterLists.id] }),
  check("newsletter_delivery_state", sql`${t.state} in ('queued','unknown','operator_review','accepted','failed','skipped')`),
  check("newsletter_delivery_reason", sql`(${t.state} = 'skipped') = (${t.skipReason} is not null) and (${t.skipReason} is null or ${t.skipReason} in ('global_suppressed','list_suppressed','not_subscribed','consent_missing','consent_withdrawn','person_unavailable','address_unavailable','eligibility_changed','review_invalidated','cancelled'))`),
]);


// Only anonymous counts are carried forward when individual delivery evidence expires.
export const newsletterArchivedCounts = pgTable("newsletter_archived_counts", {
  tenantId: uuid("tenant_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  day: date("day").notNull(),
  metric: text("metric").notNull(),
  count: bigint("count", { mode: "number" }).notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.campaignId, t.day, t.metric] }),
  foreignKey({ columns: [t.tenantId, t.campaignId], foreignColumns: [newsletterCampaigns.tenantId, newsletterCampaigns.id] })]);

export const newsletterSuppressions = pgTable("newsletter_suppressions", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  // The nil UUID denotes a ministry-wide block. Any other scope is a newsletter list.
  scope: uuid("scope").notNull(),
  addressHash: text("address_hash").notNull(),
  keyVersion: text("key_version").notNull(),
  reason: text("reason").notNull(),
  blockedAt: timestamp("blocked_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.tenantId, t.keyVersion, t.scope, t.addressHash, t.reason] }),
  check("newsletter_suppression_reason", sql`${t.reason} in ('unsubscribe','hard_bounce','complaint')`)]);

export const newsletterRetentionRuns = pgTable("newsletter_retention_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  purged: integer("purged").notNull(),
});

export const newsletterCallbackReceipts = pgTable("newsletter_callback_receipts", {
  messageId: uuid("message_id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("newsletter_callback_receipt_expiry_idx").on(t.expiresAt)]);

export const workerJobLeases = pgTable("worker_job_leases", {
  job: text("job").primaryKey(),
  token: uuid("token").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const workerJobReceipts = pgTable("worker_job_receipts", {
  job: text("job").notNull().references(() => workerJobLeases.job),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.job, t.scheduledFor] })]);

/** The ministry's default newsletter brand kit (logo, colours, font, button style, mailing address). One row per ministry. */
export const newsletterBrandKits = pgTable("newsletter_brand_kits", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  kit: jsonb("kit").$type<import("../lib/email/blocks").BrandKit>().notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.tenantId] }), check("newsletter_brand_kit_object", sql`jsonb_typeof(${t.kit})='object' AND pg_column_size(${t.kit})<=4096`)]);

// Hosted newsletter sign-up forms: one pending row per sign-up. Holds digests and the two optional name parts only until the address is confirmed or the
// sign-up expires (then the names are cleared); the address itself is never stored. No foreign key to contacts, so erase and merge need no extra handling
// beyond the before-erase trigger that drops a person's pending rows.
export const newsletterFormSignups = pgTable("newsletter_form_signups", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  formId: uuid("form_id").notNull(),
  versionId: uuid("version_id").notNull(),
  receipt: uuid("receipt").notNull(),
  tokenHash: text("token_hash").notNull(),
  emailProof: text("email_proof").notNull(),
  contactId: uuid("contact_id"),
  listIds: uuid("list_ids").array().notNull(),
  wordingVersion: text("wording_version").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  state: text("state", { enum: ["pending", "confirmed", "blocked", "expired"] }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  unique("newsletter_form_signup_token").on(t.tokenHash),
  unique("newsletter_form_signup_receipt").on(t.tenantId, t.formId, t.receipt),
  foreignKey({ name: "newsletter_form_signup_publication_fk", columns: [t.tenantId, t.formId, t.versionId], foreignColumns: [crmFormPublications.tenantId, crmFormPublications.formId, crmFormPublications.versionId] }),
  index("newsletter_form_signups_form_idx").on(t.tenantId, t.formId, t.state),
  index("newsletter_form_signups_expiry_idx").on(t.expiresAt).where(sql`${t.state} = 'pending'`),
  index("newsletter_form_signups_contact_idx").on(t.tenantId, t.contactId).where(sql`${t.contactId} is not null`),
  check("newsletter_form_signup_hashes", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$' and ${t.emailProof} ~ '^[0-9a-f]{64}$'`),
  check("newsletter_form_signup_lists", sql`cardinality(${t.listIds}) between 1 and 10`),
  check("newsletter_form_signup_names", sql`length(coalesce(${t.firstName}, '')) <= 100 and length(coalesce(${t.lastName}, '')) <= 100 and (${t.state} = 'pending' or (${t.firstName} is null and ${t.lastName} is null))`),
  check("newsletter_form_signup_confirmed", sql`(${t.state} in ('confirmed', 'blocked')) = (${t.confirmedAt} is not null)`),
]);
// Newsletter automations: a trigger (joins a sign-up form, or is added to a list) and ordered steps (send an email, wait, end) kept as one jsonb list validated
// by the app (email steps hold a version 2 email document). Runs and the per-contact log are written only by definer functions; consent is re-checked at every send.
export const newsletterAutomations = pgTable("newsletter_automations", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  id: uuid("id").notNull().defaultRandom(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  state: text("state", { enum: ["draft", "active", "paused"] }).notNull().default("draft"),
  triggerType: text("trigger_type", { enum: ["form", "list"] }).notNull(),
  triggerFormId: uuid("trigger_form_id"),
  triggerListId: uuid("trigger_list_id"),
  steps: jsonb("steps").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "newsletter_automation_form_fk", columns: [t.tenantId, t.triggerFormId], foreignColumns: [forms.tenantId, forms.id] }),
  foreignKey({ name: "newsletter_automation_list_fk", columns: [t.tenantId, t.triggerListId], foreignColumns: [newsletterLists.tenantId, newsletterLists.id] }),
  check("newsletter_automation_name", sql`length(trim(${t.name})) between 1 and 100`),
  check("newsletter_automation_version", sql`${t.version} >= 1`),
  check("newsletter_automation_trigger", sql`(${t.triggerType} = 'form' and ${t.triggerFormId} is not null and ${t.triggerListId} is null) or (${t.triggerType} = 'list' and ${t.triggerListId} is not null and ${t.triggerFormId} is null)`),
  check("newsletter_automation_steps", sql`jsonb_typeof(${t.steps}) = 'array' and jsonb_array_length(${t.steps}) <= 20 and length(${t.steps}::text) <= 600000 and (${t.state} <> 'active' or jsonb_array_length(${t.steps}) > 0)`),
  index("newsletter_automation_state_idx").on(t.tenantId, t.state),
]);

export const newsletterAutomationRuns = pgTable("newsletter_automation_runs", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  automationId: uuid("automation_id").notNull(),
  contactId: uuid("contact_id").notNull(),
  listId: uuid("list_id").notNull(),
  state: text("state", { enum: ["active", "completed", "stopped"] }).notNull().default("active"),
  stopReason: text("stop_reason", { enum: ["consent_withdrawn", "unsubscribed", "suppressed", "no_address", "image_unavailable", "automation_changed"] }),
  stepIndex: integer("step_index").notNull().default(0),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
  lease: uuid("lease"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  attemptId: uuid("attempt_id"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  unique("newsletter_automation_run_contact").on(t.tenantId, t.automationId, t.contactId),
  foreignKey({ name: "newsletter_automation_run_automation_fk", columns: [t.tenantId, t.automationId], foreignColumns: [newsletterAutomations.tenantId, newsletterAutomations.id] }),
  foreignKey({ name: "newsletter_automation_run_contact_fk", columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ name: "newsletter_automation_run_list_fk", columns: [t.tenantId, t.listId], foreignColumns: [newsletterLists.tenantId, newsletterLists.id] }),
  index("newsletter_automation_run_due_idx").on(t.nextRunAt).where(sql`${t.state} = 'active'`),
  index("newsletter_automation_run_contact_idx").on(t.tenantId, t.contactId),
  check("newsletter_automation_run_state", sql`(${t.state} = 'active') = (${t.finishedAt} is null) and (${t.state} = 'stopped') = (${t.stopReason} is not null) and ${t.stepIndex} >= 0`),
]);

export const newsletterAutomationLog = pgTable("newsletter_automation_log", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  runId: uuid("run_id").notNull(),
  stepIndex: integer("step_index").notNull(),
  stepType: text("step_type", { enum: ["enter", "email", "wait", "end", "stopped"] }).notNull(),
  outcome: text("outcome", { enum: ["entered", "sent", "unknown", "failed", "waiting", "completed", "stopped"] }).notNull(),
  reason: text("reason"),
  providerRef: text("provider_ref"),
  attemptId: uuid("attempt_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "newsletter_automation_log_run_fk", columns: [t.tenantId, t.runId], foreignColumns: [newsletterAutomationRuns.tenantId, newsletterAutomationRuns.id] }).onDelete("cascade"),
  index("newsletter_automation_log_run_idx").on(t.tenantId, t.runId, t.at),
  check("newsletter_automation_log_shape", sql`${t.stepIndex} >= 0 and length(coalesce(${t.reason}, '')) <= 80`),
]);

// Docs (slice 1). A ministry's documents: folders (nested), docs, and the ordered page tree of each doc. Rich content is Tiptap JSON, sanitised again on the server.
export const docFolders = pgTable("doc_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  parentId: uuid("parent_id"),
  name: text("name").notNull(), position: integer("position").notNull().default(0),
  ownerId: text("owner_id").notNull().references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("doc_folders_tenant_id_uq").on(t.tenantId, t.id), index("doc_folders_parent_idx").on(t.tenantId, t.parentId),
  foreignKey({ name: "doc_folders_parent_fk", columns: [t.tenantId, t.parentId], foreignColumns: [t.tenantId, t.id] }).onDelete("restrict"),
  uniqueIndex("doc_folders_name_uq").on(t.tenantId, sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
  check("doc_folders_name_len", sql`char_length(btrim(${t.name})) between 1 and 80 and ${t.name}=btrim(${t.name})`), check("doc_folders_not_own_parent", sql`${t.parentId} is distinct from ${t.id}`)]);
export const docs = pgTable("docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  folderId: uuid("folder_id"),
  // `kind`: slice 1 creates documents only; spreadsheets will live in Docs too, so one folder tree holds both. `docs.id` stays stable for later hooks (live-stream sermon notes, imported copies).
  kind: text("kind").$type<"document" | "spreadsheet">().notNull().default("document"),
  // Who can read: `private` (the owner, people it is shared with, owners and admins) or `ministry` (every member, at `ministryAccess`). The public link is hard-off unless the non-production gate allows it.
  visibility: text("visibility").$type<"private" | "ministry">().notNull().default("private"), ministryAccess: text("ministry_access").$type<"view" | "comment" | "edit">().notNull().default("view"),
  publicEnabled: boolean("public_enabled").notNull().default(false), publicTokenHash: text("public_token_hash"), wiki: boolean("wiki").notNull().default(false),
  title: text("title").notNull(), ownerId: text("owner_id").notNull().references(() => users.id),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true }), deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("docs_tenant_id_uq").on(t.tenantId, t.id), unique("docs_id_owner_uq").on(t.id, t.ownerId), index("docs_folder_idx").on(t.tenantId, t.folderId, t.updatedAt),
  foreignKey({ name: "docs_folder_fk", columns: [t.tenantId, t.folderId], foreignColumns: [docFolders.tenantId, docFolders.id] }).onDelete("restrict"),
  check("docs_title_len", sql`char_length(${t.title}) <= 200`), check("docs_kind_known", sql`${t.kind} in ('document','spreadsheet')`), check("docs_visibility_known", sql`${t.visibility} in ('private','ministry') and ${t.ministryAccess} in ('view','comment','edit')`),
  uniqueIndex("docs_public_token_uq").on(t.publicTokenHash).where(sql`${t.publicTokenHash} is not null`)]);
export const docPages = pgTable("doc_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), docId: uuid("doc_id").notNull(), parentId: uuid("parent_id"),
  position: integer("position").notNull().default(0),
  title: text("title").notNull().default(""), icon: text("icon"), subtitle: text("subtitle").notNull().default(""),
  // The body is the editor engine's own JSON; `engine` names the engine and `schemaVersion` its content schema, so the engine can be replaced without guessing.
  engine: text("engine").notNull().default("tiptap"), schemaVersion: integer("schema_version").notNull().default(1),
  content: jsonb("content").$type<import("../lib/docs").DocContent>().notNull(),
  style: jsonb("style").$type<import("../lib/docs").PageStyle>().notNull().default({}),
  protected: boolean("protected").notNull().default(false), version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => users.id), updatedBy: text("updated_by").references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("doc_pages_doc_id_uq").on(t.docId, t.id), index("doc_pages_tree_idx").on(t.docId, t.parentId, t.position),
  foreignKey({ name: "doc_pages_doc_fk", columns: [t.tenantId, t.docId], foreignColumns: [docs.tenantId, docs.id] }).onDelete("restrict"),
  foreignKey({ name: "doc_pages_parent_fk", columns: [t.docId, t.parentId], foreignColumns: [t.docId, t.id] }).onDelete("restrict"),
  check("doc_pages_title_len", sql`char_length(${t.title}) <= 200`), check("doc_pages_subtitle_len", sql`char_length(${t.subtitle}) <= 200`), check("doc_pages_engine_known", sql`${t.engine} in ('tiptap')`), check("doc_pages_content_object", sql`jsonb_typeof(${t.content})='object' AND pg_column_size(${t.content})<=524288`),
  check("doc_pages_style_object", sql`jsonb_typeof(${t.style})='object' AND pg_column_size(${t.style})<=2048`), check("doc_pages_not_own_parent", sql`${t.parentId} is distinct from ${t.id}`)]);
export const docFavorites = pgTable("doc_favorites", {
  tenantId: uuid("tenant_id").notNull(), docId: uuid("doc_id").notNull(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  placement: text("placement").$type<"top" | "sidebar">().notNull().default("top"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.docId, t.userId] }), foreignKey({ name: "doc_favorites_doc_fk", columns: [t.tenantId, t.docId], foreignColumns: [docs.tenantId, docs.id] }).onDelete("cascade")]);

// Docs slice 2: sharing, comments, relationships, templates, history, attachments and in-app notifications. No table here points to `contacts` (erase and merge stay untouched):
// a link to a person is a plain id that is looked up, with the viewer's own CRM rights, when it is read.
export const docShares = pgTable("doc_shares", {
  tenantId: uuid("tenant_id").notNull(), docId: uuid("doc_id").notNull(),
  // The doc's owner, copied in and pinned to the real owner by a composite foreign key, so the write policy can name who may share without reading `docs` (whose policy reads this table).
  ownerId: text("owner_id").notNull(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").$type<"view" | "comment" | "edit">().notNull(), createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.docId, t.userId] }), foreignKey({ name: "doc_shares_doc_fk", columns: [t.tenantId, t.docId], foreignColumns: [docs.tenantId, docs.id] }).onDelete("cascade"), foreignKey({ name: "doc_shares_owner_fk", columns: [t.docId, t.ownerId], foreignColumns: [docs.id, docs.ownerId] }).onDelete("cascade"), check("doc_shares_role_known", sql`${t.role} in ('view','comment','edit')`)]);
/** "Share this page": one person gets view, comment or edit on one page of a doc, and no access to the rest of it. Same denormalised owner as `doc_shares`, for the same reason. */
export const docPageShares = pgTable("doc_page_shares", {
  tenantId: uuid("tenant_id").notNull(), docId: uuid("doc_id").notNull(), pageId: uuid("page_id").notNull(),
  ownerId: text("owner_id").notNull(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").$type<"view" | "comment" | "edit">().notNull(), createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.pageId, t.userId] }), index("doc_page_shares_user_idx").on(t.userId, t.docId),
  foreignKey({ name: "doc_page_shares_page_fk", columns: [t.docId, t.pageId], foreignColumns: [docPages.docId, docPages.id] }).onDelete("cascade"),
  foreignKey({ name: "doc_page_shares_doc_fk", columns: [t.tenantId, t.docId], foreignColumns: [docs.tenantId, docs.id] }).onDelete("cascade"),
  foreignKey({ name: "doc_page_shares_owner_fk", columns: [t.docId, t.ownerId], foreignColumns: [docs.id, docs.ownerId] }).onDelete("cascade")]);
export const docComments = pgTable("doc_comments", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull(), docId: uuid("doc_id").notNull(), pageId: uuid("page_id").notNull(), parentId: uuid("parent_id"),
  authorId: text("author_id").notNull().references(() => users.id), body: text("body").notNull(), quote: text("quote"),
  status: text("status").$type<"open" | "resolved">().notNull().default("open"), assigneeId: text("assignee_id").references(() => users.id), resolvedBy: text("resolved_by").references(() => users.id), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  mentions: text("mentions").array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("doc_comments_page_idx").on(t.docId, t.pageId, t.createdAt), foreignKey({ name: "doc_comments_page_fk", columns: [t.docId, t.pageId], foreignColumns: [docPages.docId, docPages.id] }).onDelete("cascade"),
  foreignKey({ name: "doc_comments_parent_fk", columns: [t.parentId], foreignColumns: [t.id] }).onDelete("cascade"), foreignKey({ name: "doc_comments_doc_fk", columns: [t.tenantId, t.docId], foreignColumns: [docs.tenantId, docs.id] }),
  check("doc_comments_body_len", sql`char_length(btrim(${t.body})) between 1 and 2000`), check("doc_comments_quote_len", sql`${t.quote} is null or char_length(${t.quote}) <= 300`), check("doc_comments_status_known", sql`${t.status} in ('open','resolved')`)]);
export const docLinks = pgTable("doc_links", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull(), docId: uuid("doc_id").notNull(), pageId: uuid("page_id"),
  targetKind: text("target_kind").$type<"contact" | "task" | "doc">().notNull(), targetId: uuid("target_id").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("doc_links_target_idx").on(t.tenantId, t.targetKind, t.targetId), uniqueIndex("doc_links_uq").on(t.docId, sql`coalesce(${t.pageId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.targetKind, t.targetId),
  foreignKey({ name: "doc_links_doc_fk", columns: [t.tenantId, t.docId], foreignColumns: [docs.tenantId, docs.id] }), foreignKey({ name: "doc_links_page_fk", columns: [t.docId, t.pageId], foreignColumns: [docPages.docId, docPages.id] }).onDelete("cascade"),
  check("doc_links_kind_known", sql`${t.targetKind} in ('contact','task','doc')`)]);
export const docTemplates = pgTable("doc_templates", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  name: text("name").notNull(), category: text("category").notNull().default("other"), description: text("description").notNull().default(""),
  pages: jsonb("pages").$type<import("../lib/docs").TemplatePage[]>().notNull(), version: integer("version").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => users.id), updatedBy: text("updated_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("doc_templates_tenant_idx").on(t.tenantId, t.category), check("doc_templates_name_len", sql`char_length(btrim(${t.name})) between 1 and 80`), check("doc_templates_desc_len", sql`char_length(${t.description}) <= 200`),
  check("doc_templates_category_known", sql`${t.category} in ('meetings','worship','events','people','planning','other')`), check("doc_templates_pages", sql`jsonb_typeof(${t.pages})='array' and pg_column_size(${t.pages})<=524288`)]);
export const docPageVersions = pgTable("doc_page_versions", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull(), docId: uuid("doc_id").notNull(), pageId: uuid("page_id").notNull(),
  number: integer("number").notNull(), title: text("title").notNull().default(""), content: jsonb("content").$type<import("../lib/docs").DocContent>().notNull(),
  reason: text("reason").$type<"autosave" | "restore" | "template" | "import">().notNull().default("autosave"),
  createdBy: text("created_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("doc_page_versions_page_idx").on(t.pageId, t.createdAt), foreignKey({ name: "doc_page_versions_page_fk", columns: [t.docId, t.pageId], foreignColumns: [docPages.docId, docPages.id] }).onDelete("cascade"),
  foreignKey({ name: "doc_page_versions_doc_fk", columns: [t.tenantId, t.docId], foreignColumns: [docs.tenantId, docs.id] }), check("doc_page_versions_content", sql`jsonb_typeof(${t.content})='object' and pg_column_size(${t.content})<=524288`),
  check("doc_page_versions_reason", sql`${t.reason} in ('autosave','restore','template','import')`)]);
export const docAttachments = pgTable("doc_attachments", {
  tenantId: uuid("tenant_id").notNull(), docId: uuid("doc_id").notNull(), fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  attachedBy: text("attached_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.docId, t.fileId] }), foreignKey({ name: "doc_attachments_doc_fk", columns: [t.tenantId, t.docId], foreignColumns: [docs.tenantId, docs.id] })]);
export const docNotifications = pgTable("doc_notifications", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"mention" | "reply" | "assigned" | "shared">().notNull(), docId: uuid("doc_id").notNull(), pageId: uuid("page_id"), commentId: uuid("comment_id"),
  actorId: text("actor_id").notNull().references(() => users.id), readAt: timestamp("read_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("doc_notifications_user_idx").on(t.userId, t.createdAt), foreignKey({ name: "doc_notifications_doc_fk", columns: [t.tenantId, t.docId], foreignColumns: [docs.tenantId, docs.id] }).onDelete("cascade"),
  check("doc_notifications_kind_known", sql`${t.kind} in ('mention','reply','assigned','shared')`)]);
// ---- Link in bio (migration 0094) ------------------------------------------------------------------------------------------------------------------------
// One public page per ministry. `draft` is what the editor saves; `published` is the immutable copy the public address serves. Anonymous reads and writes go through
// SECURITY DEFINER functions (public page, photo, click, message), never straight to a table. Policies, grants and the functions are in the migration.
export const bioPages = pgTable("bio_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  handle: text("handle").notNull(),
  status: text("status").$type<"draft" | "published">().notNull().default("draft"),
  draft: jsonb("draft").$type<import("../lib/link-in-bio").BioDefinition>().notNull(),
  version: integer("version").notNull().default(1),
  photoFileId: uuid("photo_file_id"),
  coverFileId: uuid("cover_file_id"),
  published: jsonb("published").$type<import("../lib/link-in-bio").BioDefinition>(),
  publishedPhotoFileId: uuid("published_photo_file_id"),
  publishedCoverFileId: uuid("published_cover_file_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("bio_pages_tenant_id_uq").on(t.tenantId, t.id), unique("bio_pages_tenant_uq").on(t.tenantId), uniqueIndex("bio_pages_handle_uq").on(t.handle),
  check("bio_pages_handle", sql`public.valid_bio_handle(${t.handle})`), check("bio_pages_status", sql`${t.status} in ('draft','published')`),
  check("bio_pages_draft", sql`jsonb_typeof(${t.draft})='object' and ${t.draft}->>'kind'='bio-v1' and pg_column_size(${t.draft})<=65536`),
  check("bio_pages_published", sql`(${t.status}='published') = (${t.published} is not null) and (${t.published} is null or (jsonb_typeof(${t.published})='object' and pg_column_size(${t.published})<=65536))`)]);
export const bioFiles = pgTable("bio_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), pageId: uuid("page_id").notNull(),
  uploaderId: text("uploader_id").references(() => users.id, { onDelete: "set null" }),
  key: text("key").notNull().unique(), kind: text("kind").notNull().default("photo"), name: text("name").notNull(), mime: text("mime").notNull(), size: integer("size").notNull(),
  checksum: text("checksum").notNull(), status: text("status").$type<"pending" | "uploaded" | "quarantined" | "ready">().notNull().default("pending"),
  retiredAt: timestamp("retired_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("bio_files_page").on(t.tenantId, t.pageId), foreignKey({ columns: [t.tenantId, t.pageId], foreignColumns: [bioPages.tenantId, bioPages.id] }).onDelete("cascade"),
  check("bio_file_kind", sql`${t.kind} in ('photo','cover')`), check("bio_file_mime", sql`${t.mime} in ('image/jpeg','image/png','image/webp')`),
  check("bio_file_name", sql`length(btrim(${t.name})) between 1 and 200`), check("bio_file_size", sql`${t.size} between 1 and 10485760`),
  check("bio_file_checksum", sql`${t.checksum} ~ '^[a-f0-9]{64}$'`), check("bio_file_status", sql`${t.status} in ('pending','uploaded','quarantined','ready')`),
  check("bio_file_key", sql`${t.key} = 'workspaces/' || ${t.tenantId}::text || '/bio/' || ${t.pageId}::text || '/files/' || ${t.id}::text`)]);
// Aggregate clicks only: a block, a day and a count. No visitor, address, agent or referrer is kept.
export const bioClicks = pgTable("bio_clicks", {
  tenantId: uuid("tenant_id").notNull(), pageId: uuid("page_id").notNull(), blockId: text("block_id").notNull(), day: date("day").notNull(), clicks: integer("clicks").notNull(),
}, (t) => [primaryKey({ columns: [t.pageId, t.blockId, t.day] }), foreignKey({ columns: [t.tenantId, t.pageId], foreignColumns: [bioPages.tenantId, bioPages.id] }).onDelete("cascade"),
  check("bio_clicks_block", sql`${t.blockId} ~ '^[a-z0-9]{8}$'`), check("bio_clicks_count", sql`${t.clicks} > 0`)]);
// "Message me" submissions: stored like hosted form responses (90 days), tied to the CRM person they created or matched. Erasing or merging that person removes or moves them.
export const bioMessages = pgTable("bio_messages", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull(), pageId: uuid("page_id").notNull(), contactId: uuid("contact_id").notNull(),
  name: text("name").notNull(), email: text("email").notNull(), body: text("body").notNull(), notice: text("notice").notNull(),
  status: text("status").$type<"new" | "handled">().notNull().default("new"), requestHash: text("request_hash").notNull(), createdContact: boolean("created_contact").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index("bio_messages_listing_idx").on(t.tenantId, t.createdAt, t.id), index("bio_messages_contact_idx").on(t.tenantId, t.contactId),
  foreignKey({ columns: [t.tenantId, t.pageId], foreignColumns: [bioPages.tenantId, bioPages.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }).onDelete("cascade"),
  check("bio_messages_status", sql`${t.status} in ('new','handled')`), check("bio_messages_hash", sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
  check("bio_messages_lengths", sql`length(${t.name}) between 1 and 100 and length(${t.email}) between 3 and 254 and length(${t.body}) between 1 and 2000`),
  check("bio_messages_expiry", sql`${t.expiresAt} > ${t.createdAt}`)]);
export const bioQuotas = pgTable("bio_quotas", { scope: text("scope").notNull(), minute: timestamp("minute", { withTimezone: true }).notNull(), attempts: integer("attempts").notNull() },
  (t) => [primaryKey({ columns: [t.scope, t.minute] }), index("bio_quota_expiry_idx").on(t.minute)]);
export const bioReceipts = pgTable("bio_receipts", { id: uuid("id").primaryKey(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull() }, (t) => [index("bio_receipt_expiry_idx").on(t.expiresAt)]);
// Ads server (migration 0098). Metadata, numeric results and lead records only: no creative copy beyond what is needed, no provider tokens, no raw responses.
const inList = (values: readonly string[]) => sql.raw(values.map(v => "'" + v + "'").join(", "));
export const adsAccounts = pgTable("ads_accounts", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(),
  connectionId: uuid("connection_id").notNull(), network: text("network").$type<typeof adNetworks[number]>().notNull(),
  externalRef: text("external_ref").notNull(), name: text("name").notNull(), currency: text("currency"), timezone: text("timezone"),
  status: text("status").notNull().default("active"), health: jsonb("health").$type<Record<string, { state: string; fixUrl?: string | null }>>().notNull().default({}),
  lastRefusal: jsonb("last_refusal").$type<{ code: string; fixUrl: string | null } | null>(), healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }), syncState: text("sync_state").notNull().default("pending"),
  // 0104: scheduled results sync (worker role). A lease keeps two workers off the same account; failures back the next attempt off.
  syncDueAt: timestamp("sync_due_at", { withTimezone: true }).notNull().defaultNow(), syncLease: uuid("sync_lease"), syncLeasedUntil: timestamp("sync_leased_until", { withTimezone: true }), syncFailures: integer("sync_failures").notNull().default(0),
  version: integer("version").notNull().default(1), createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_accounts_connection_fk", columns: [t.tenantId, t.connectionId], foreignColumns: [socialConnections.tenantId, socialConnections.id] }),
  uniqueIndex("ads_accounts_ref_idx").on(t.tenantId, t.connectionId, t.externalRef),
  check("ads_accounts_shape", sql`${t.network} in (${inList(adNetworks)}) and length(${t.externalRef}) between 1 and 200 and length(${t.name}) between 1 and 200
    and ${t.status} in ('active','restricted','disabled','closed','unknown') and ${t.syncState} in ('pending','ready','failing','delayed') and jsonb_typeof(${t.health}) = 'object' and pg_column_size(${t.health}) <= 4096`),
]);
const entityColumns = () => ({
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(),
  externalRef: text("external_ref"), name: text("name").notNull(), status: text("status").$type<typeof adStatuses[number]>().notNull().default("paused"),
  version: integer("version").notNull().default(1), syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const adsCampaigns = pgTable("ads_campaigns", {
  ...entityColumns(), goal: text("goal").$type<typeof adGoals[number]>().notNull(),
  budgetAmount: numeric("budget_amount", { precision: 14, scale: 2, mode: "number" }), budgetType: text("budget_type"), budgetLevel: text("budget_level"),
  sharedBudgetRef: text("shared_budget_ref"), startDate: date("start_date"), endDate: date("end_date"), bidding: jsonb("bidding").$type<{ costType: string; unitCost?: number } | null>(),
  specialAdCategories: text("special_ad_categories").array().notNull().default(sql`'{}'::text[]`), attributionModel: text("attribution_model").notNull().default("default"),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_campaigns_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  uniqueIndex("ads_campaigns_ref_idx").on(t.tenantId, t.adAccountId, t.externalRef), index("ads_campaigns_account_idx").on(t.tenantId, t.adAccountId, t.status),
  check("ads_campaigns_shape", sql`${t.goal} in (${inList(adGoals)}) and ${t.status} in (${inList(adStatuses)}) and length(${t.name}) between 1 and 200 and ${t.budgetAmount} >= 0
    and (${t.budgetType} is null or ${t.budgetType} in ('daily','lifetime')) and (${t.budgetLevel} is null or ${t.budgetLevel} in ('campaign','adset'))
    and (${t.budgetType} is distinct from 'lifetime' or ${t.endDate} is not null) and (${t.startDate} is null or ${t.endDate} is null or ${t.endDate} >= ${t.startDate})`),
]);
export const adsAdSets = pgTable("ads_ad_sets", {
  ...entityColumns(), campaignId: uuid("campaign_id").notNull(),
  budgetAmount: numeric("budget_amount", { precision: 14, scale: 2, mode: "number" }), budgetType: text("budget_type"), startDate: date("start_date"), endDate: date("end_date"),
  bidding: jsonb("bidding").$type<{ costType: string; unitCost?: number } | null>(), targeting: jsonb("targeting").$type<Record<string, unknown>>().notNull().default({}),
  rawTargeting: jsonb("raw_targeting").$type<Record<string, unknown> | null>(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_ad_sets_campaign_fk", columns: [t.tenantId, t.campaignId], foreignColumns: [adsCampaigns.tenantId, adsCampaigns.id] }),
  foreignKey({ name: "ads_ad_sets_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  uniqueIndex("ads_ad_sets_ref_idx").on(t.tenantId, t.adAccountId, t.externalRef), index("ads_ad_sets_campaign_idx").on(t.tenantId, t.campaignId),
  check("ads_ad_sets_shape", sql`${t.status} in (${inList(adStatuses)}) and length(${t.name}) between 1 and 200 and ${t.budgetAmount} >= 0 and (${t.budgetType} is null or ${t.budgetType} in ('daily','lifetime'))
    and jsonb_typeof(${t.targeting}) = 'object' and pg_column_size(${t.targeting}) <= 16384 and (${t.rawTargeting} is null or pg_column_size(${t.rawTargeting}) <= 16384)`),
]);
export const adsAds = pgTable("ads_ads", {
  ...entityColumns(), campaignId: uuid("campaign_id").notNull(), adSetId: uuid("ad_set_id").notNull(), format: text("format").notNull(),
  creativeRef: text("creative_ref"), sourcePostRef: text("source_post_ref"), leadFormId: uuid("lead_form_id"),
  reviewStatus: text("review_status").notNull().default("unknown"), reviewReason: text("review_reason"), deliveryIssue: text("delivery_issue"),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_ads_ad_set_fk", columns: [t.tenantId, t.adSetId], foreignColumns: [adsAdSets.tenantId, adsAdSets.id] }),
  foreignKey({ name: "ads_ads_campaign_fk", columns: [t.tenantId, t.campaignId], foreignColumns: [adsCampaigns.tenantId, adsCampaigns.id] }),
  foreignKey({ name: "ads_ads_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  uniqueIndex("ads_ads_ref_idx").on(t.tenantId, t.adAccountId, t.externalRef), index("ads_ads_ad_set_idx").on(t.tenantId, t.adSetId),
  check("ads_ads_shape", sql`${t.status} in (${inList(adStatuses)}) and length(${t.name}) between 1 and 200 and ${t.format} in ('image','video','carousel','document','event','text','messaging','call')
    and ${t.reviewStatus} in ('unknown','in_review','approved','rejected') and (${t.reviewReason} is null or length(${t.reviewReason}) <= 500) and (${t.deliveryIssue} is null or length(${t.deliveryIssue}) <= 500)`),
]);
export const adsResults = pgTable("ads_results", {
  tenantId: uuid("tenant_id").notNull(), adAccountId: uuid("ad_account_id").notNull(), level: text("level").notNull(), entityId: uuid("entity_id").notNull(),
  day: date("day").notNull(), attributionModel: text("attribution_model").notNull().default("default"), capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  metrics: jsonb("metrics").$type<ResultMetrics>().notNull(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.level, t.entityId, t.day, t.attributionModel] }),
  foreignKey({ name: "ads_results_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  index("ads_results_day_idx").on(t.day, t.tenantId),
  check("ads_results_shape", sql`${t.level} in ('campaign','adset','ad') and jsonb_typeof(${t.metrics}) = 'object'
    and ${t.metrics} - array['spend','impressions','reach','clicks','ctr','cpc','cpm','results','costPerResult','conversions','leads'] = '{}'::jsonb
    and not jsonb_path_exists(${t.metrics}, '$.keyvalue() ? (@.value.type() != "number")')`),
]);
export const adsLaunchRequests = pgTable("ads_launch_requests", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(),
  kind: text("kind").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), status: text("status").notNull().default("draft"),
  reviewHash: text("review_hash"), reviewedBy: text("reviewed_by").references(() => users.id), reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  validation: jsonb("validation").$type<{ ok: boolean; problems: string[] } | null>(), idempotencyKey: uuid("idempotency_key"),
  resultCampaignId: uuid("result_campaign_id"), resultAdSetId: uuid("result_ad_set_id"), resultAdId: uuid("result_ad_id"), errorCode: text("error_code"),
  version: integer("version").notNull().default(1), createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_launch_requests_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  uniqueIndex("ads_launch_requests_key_idx").on(t.tenantId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  index("ads_launch_requests_account_idx").on(t.tenantId, t.adAccountId, t.createdAt),
  check("ads_launch_requests_shape", sql`${t.kind} in ('campaign','boost','add_ad') and ${t.status} in ('draft','reviewed','launching','launched','failed','ambiguous','cancelled')
    and pg_column_size(${t.payload}) <= 65536 and (${t.status} not in ('reviewed','launching','launched','ambiguous') or ${t.reviewHash} is not null)`),
]);
export const adsOperations = pgTable("ads_operations", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(), idempotencyKey: uuid("idempotency_key").notNull(),
  op: text("op").notNull(), targetLevel: text("target_level"), targetId: uuid("target_id"), summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("pending"), errorCode: text("error_code"), actorId: text("actor_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_operations_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  uniqueIndex("ads_operations_key_idx").on(t.tenantId, t.idempotencyKey),
  check("ads_operations_shape", sql`${t.op} in ('status','bulk_status','rename','budget','delete') and ${t.status} in ('pending','applied','failed','ambiguous') and pg_column_size(${t.summary}) <= 8192`),
]);
export const adsLeadForms = pgTable("ads_lead_forms", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(), externalRef: text("external_ref"),
  name: text("name").notNull(), status: text("status").notNull().default("active"), consentText: text("consent_text").notNull(), privacyUrl: text("privacy_url").notNull(),
  questions: jsonb("questions").$type<string[]>().notNull(),
  // 0104: which consent each explicit lead-form question grants once a lead becomes a contact (purpose -> question key). Nothing is granted unless the form asked and the person answered yes.
  consentQuestions: jsonb("consent_questions").$type<Record<string, string>>().notNull().default({}), createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_lead_forms_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  uniqueIndex("ads_lead_forms_ref_idx").on(t.tenantId, t.adAccountId, t.externalRef),
  check("ads_lead_forms_shape", sql`length(${t.name}) between 1 and 120 and length(${t.consentText}) between 1 and 1000 and ${t.status} in ('active','archived') and jsonb_typeof(${t.questions}) = 'array'`),
]);
export const adsLeads = pgTable("ads_leads", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(), network: text("network").notNull(),
  leadRef: text("lead_ref").notNull(), formRef: text("form_ref"), campaignRef: text("campaign_ref"), adRef: text("ad_ref"),
  status: text("status").$type<typeof adLeadStatuses[number]>().notNull().default("new"),
  // Answers the person gave and the exact consent text shown on the form, kept as evidence. No CRM contact exists and no consent is implied until a person reviews it.
  fields: jsonb("fields").$type<Record<string, string>>().notNull().default({}), consentText: text("consent_text"), submittedAt: timestamp("submitted_at", { withTimezone: true }),
  // 0104: set when an owner or admin converts the lead into a CRM contact (explicit action, existing consent and provenance rules).
  contactId: uuid("contact_id"), convertedAt: timestamp("converted_at", { withTimezone: true }),
  version: integer("version").notNull().default(1), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_leads_contact_fk", columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id] }),
  foreignKey({ name: "ads_leads_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  uniqueIndex("ads_leads_ref_idx").on(t.tenantId, t.adAccountId, t.leadRef), index("ads_leads_status_idx").on(t.tenantId, t.status, t.createdAt),
  check("ads_leads_shape", sql`${t.status} in (${inList(adLeadStatuses)}) and ${t.network} in (${inList(adNetworks)}) and length(${t.leadRef}) between 1 and 200
    and jsonb_typeof(${t.fields}) = 'object' and pg_column_size(${t.fields}) <= 8192 and (${t.consentText} is null or length(${t.consentText}) <= 1000)`),
]);
export const adsAudiences = pgTable("ads_audiences", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(), externalRef: text("external_ref").notNull(),
  kind: text("kind").notNull(), name: text("name").notNull(), sizeEstimate: bigint("size_estimate", { mode: "number" }), status: text("status").notNull().default("ready"),
  spec: jsonb("spec").$type<Record<string, unknown> | null>(), syncedAt: timestamp("synced_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_audiences_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  uniqueIndex("ads_audiences_ref_idx").on(t.tenantId, t.adAccountId, t.externalRef),
  check("ads_audiences_shape", sql`${t.kind} in ('custom','lookalike','saved_targeting','website','engagement','customer_list') and length(${t.name}) between 1 and 200 and (${t.spec} is null or pg_column_size(${t.spec}) <= 16384)`),
]);
export const adsRules = pgTable("ads_rules", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(), name: text("name").notNull(), level: text("level").notNull(),
  condition: jsonb("condition").$type<Record<string, unknown>>().notNull(), action: text("action").notNull(), enabled: boolean("enabled").notNull().default(false),
  version: integer("version").notNull().default(1), createdBy: text("created_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_rules_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  check("ads_rules_shape", sql`length(${t.name}) between 1 and 120 and ${t.level} in ('campaign','adset','ad') and ${t.action} in ('pause','notify') and pg_column_size(${t.condition}) <= 1024`),
]);
export const adsRuleRuns = pgTable("ads_rule_runs", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), ruleId: uuid("rule_id").notNull(), targetLevel: text("target_level").notNull(), targetId: uuid("target_id").notNull(),
  outcome: text("outcome").notNull(), detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}), ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_rule_runs_rule_fk", columns: [t.tenantId, t.ruleId], foreignColumns: [adsRules.tenantId, adsRules.id] }).onDelete("cascade"),
  index("ads_rule_runs_rule_idx").on(t.tenantId, t.ruleId, t.ranAt),
  check("ads_rule_runs_shape", sql`${t.outcome} in ('triggered','skipped','failed','source') and pg_column_size(${t.detail}) <= 2048`),
]);
export const adsAlerts = pgTable("ads_alerts", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(), kind: text("kind").notNull(), severity: text("severity").notNull().default("warning"),
  subjectLevel: text("subject_level"), subjectId: uuid("subject_id"), dedupeKey: text("dedupe_key").notNull(), state: text("state").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_alerts_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  uniqueIndex("ads_alerts_open_idx").on(t.tenantId, t.adAccountId, t.dedupeKey).where(sql`${t.state} = 'open'`),
  check("ads_alerts_shape", sql`${t.kind} in ('ad_rejected','delivery_issue','payment_problem','spend_without_results','budget_capped','connection_lost','sync_failed','account_restricted')
    and ${t.severity} in ('info','warning','critical') and ${t.state} in ('open','resolved','dismissed') and length(${t.dedupeKey}) between 1 and 200`),
]);
// Data model only. No conversion event is ever sent (privacy and consent design is an open founder decision).
export const adsConversionDestinations = pgTable("ads_conversion_destinations", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(), externalRef: text("external_ref").notNull(),
  kind: text("kind").notNull().default("pixel"), name: text("name").notNull(), lastEventAt: timestamp("last_event_at", { withTimezone: true }), status: text("status").notNull().default("unknown"),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_conversion_destinations_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  uniqueIndex("ads_conversion_destinations_ref_idx").on(t.tenantId, t.adAccountId, t.externalRef),
  check("ads_conversion_destinations_shape", sql`${t.kind} in ('pixel','conversion_api','offline') and length(${t.name}) between 1 and 200 and ${t.status} in ('unknown','active','inactive')`),
]);
export const adsWebhookEvents = pgTable("ads_webhook_events", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), provider: text("provider").notNull(), providerEventId: text("provider_event_id").notNull(),
  eventType: text("event_type").notNull(), externalAccountRef: text("external_account_ref").notNull(), subjectRef: text("subject_ref"), bodyHash: text("body_hash").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex("ads_webhook_events_event_idx").on(t.tenantId, t.provider, t.providerEventId),
  check("ads_webhook_events_shape", sql`length(${t.providerEventId}) between 1 and 200 and length(${t.eventType}) between 1 and 80`),
]);
// Social approvals (migration 0099). Metadata only: ids, statuses, a fingerprint of the draft and a short rejection reason. Never post text.
export const socialApprovalStatuses = ["pending", "approved", "rejected", "withdrawn", "superseded"] as const;
export const socialSelfApprovalModes = ["never", "owner_only", "always"] as const;
export const socialApprovalSettings = pgTable("social_approval_settings", {
  tenantId: uuid("tenant_id").primaryKey().references(() => workspaces.tenantId), mode: text("mode").$type<"off" | "required">().notNull().default("off"),
  selfApproval: text("self_approval").$type<typeof socialSelfApprovalModes[number]>().notNull().default("owner_only"), version: integer("version").notNull().default(1),
  updatedBy: text("updated_by").references(() => users.id), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("social_approval_settings_shape", sql`${t.mode} in ('off','required') and ${t.selfApproval} in ('never','owner_only','always') and ${t.version} >= 1`)]);
export const socialApprovals = pgTable("social_approvals", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId), id: uuid("id").notNull().defaultRandom(), draftId: uuid("draft_id"), postId: uuid("post_id"),
  status: text("status").$type<typeof socialApprovalStatuses[number]>().notNull().default("pending"), fingerprint: text("fingerprint").notNull(),
  requestedBy: text("requested_by").notNull().references(() => users.id), requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy: text("decided_by").references(() => users.id), decidedAt: timestamp("decided_at", { withTimezone: true }), note: text("note"), version: integer("version").notNull().default(1),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "social_approvals_draft_fk", columns: [t.tenantId, t.draftId], foreignColumns: [socialDrafts.tenantId, socialDrafts.id] }),
  foreignKey({ name: "social_approvals_post_fk", columns: [t.tenantId, t.postId], foreignColumns: [socialPosts.tenantId, socialPosts.id] }),
  uniqueIndex("social_approvals_pending_draft_idx").on(t.tenantId, t.draftId).where(sql`${t.status} = 'pending' and ${t.draftId} is not null`),
  uniqueIndex("social_approvals_pending_post_idx").on(t.tenantId, t.postId).where(sql`${t.status} = 'pending' and ${t.postId} is not null`),
  index("social_approvals_queue_idx").on(t.tenantId, t.status, t.requestedAt),
  check("social_approvals_shape", sql`num_nonnulls(${t.draftId}, ${t.postId}) = 1 and ${t.status} in ('pending','approved','rejected','withdrawn','superseded') and ${t.fingerprint} ~ '^[0-9a-f]{64}$'
    and (${t.note} is null or length(${t.note}) <= 500) and ${t.version} >= 1 and (${t.status} not in ('approved','rejected') or (${t.decidedBy} is not null and ${t.decidedAt} is not null))
    and (${t.status} <> 'rejected' or ${t.note} is not null)`),
]);
export const socialApprovalNotices = pgTable("social_approval_notices", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), recipientUserId: text("recipient_user_id").notNull().references(() => users.id),
  approvalId: uuid("approval_id").notNull(), kind: text("kind").$type<"requested" | "approved" | "rejected">().notNull(), readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "social_approval_notices_approval_fk", columns: [t.tenantId, t.approvalId], foreignColumns: [socialApprovals.tenantId, socialApprovals.id] }),
  index("social_approval_notices_inbox_idx").on(t.tenantId, t.recipientUserId, t.readAt, t.createdAt),
  check("social_approval_notices_kind", sql`${t.kind} in ('requested','approved','rejected')`),
]);
// Discover controls (0100): owner metadata and the platform review state, one row per listed-or-requested resource. A community's opt-in stays its canonical column;
// a course or product has no such column, so its opt-in lives here. Owners can request and withdraw; only the platform functions approve, reject, suspend or reinstate.
export const discoverControls = pgTable("discover_controls", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId, { onDelete: "cascade" }), resourceType: text("resource_type").$type<"community" | "course" | "product">().notNull(),
  resourceId: uuid("resource_id").notNull(), ownerOptIn: boolean("owner_opt_in").notNull().default(false), category: text("category"), language: text("language"),
  reviewState: text("review_state").$type<"not_requested" | "pending" | "approved" | "rejected" | "suspended">().notNull().default("not_requested"), reviewReason: text("review_reason"),
  reviewedBy: text("reviewed_by"), reviewedAt: timestamp("reviewed_at", { withTimezone: true }), reviewedHash: text("reviewed_hash"), currentHash: text("current_hash"),
  version: integer("version").notNull().default(1), updatedBy: text("updated_by").references(() => users.id), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.resourceType, t.resourceId] }), index("discover_controls_review_idx").on(t.reviewState, t.updatedAt),
  check("discover_controls_shape", sql`${t.resourceType} in ('community','course','product') and ${t.reviewState} in ('not_requested','pending','approved','rejected','suspended')
    and (${t.language} is null or ${t.language} ~ '^[a-z]{2,3}$') and (${t.category} is null or ${t.category} in ('discipleship','prayer','worship','bible_study','outreach','missions','youth','family','leadership','service','recovery','other'))
    and (${t.reviewReason} is null or length(${t.reviewReason}) <= 500) and ${t.version} >= 1 and (${t.reviewState} not in ('approved','rejected','suspended') or ${t.reviewedBy} is not null)`)]);
export const discoverMinistryStanding = pgTable("discover_ministry_standing", {
  tenantId: uuid("tenant_id").primaryKey().references(() => workspaces.tenantId, { onDelete: "cascade" }), suspended: boolean("suspended").notNull().default(false), reason: text("reason"),
  setBy: text("set_by"), setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("discover_standing_reason", sql`${t.reason} is null or length(${t.reason}) <= 500`)]);
export const discoverReports = pgTable("discover_reports", {
  id: uuid("id").primaryKey().defaultRandom(), resourceType: text("resource_type").notNull(), resourceId: uuid("resource_id").notNull(), tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId, { onDelete: "cascade" }),
  reporterId: text("reporter_id").notNull().references(() => users.id, { onDelete: "cascade" }), reason: text("reason").notNull(), note: text("note"), status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), resolvedBy: text("resolved_by"), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => [uniqueIndex("discover_reports_open_idx").on(t.reporterId, t.resourceType, t.resourceId).where(sql`${t.status} = 'open'`), index("discover_reports_queue_idx").on(t.status, t.createdAt),
  check("discover_reports_shape", sql`${t.resourceType} in ('community','course','product') and ${t.reason} in ('spam','inappropriate','misleading','impersonation','other') and ${t.status} in ('open','reviewed','dismissed') and (${t.note} is null or length(${t.note}) <= 500)`)]);
export const discoverReviewEvents = pgTable("discover_review_events", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId, { onDelete: "cascade" }), resourceType: text("resource_type").notNull(), resourceId: uuid("resource_id").notNull(),
  decision: text("decision").notNull(), reason: text("reason"), reviewer: text("reviewer").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("discover_review_events_resource_idx").on(t.tenantId, t.resourceType, t.resourceId, t.createdAt),
  check("discover_review_events_shape", sql`${t.decision} in ('approve','reject','suspend','reinstate','standing_suspend','standing_restore') and (${t.reason} is null or length(${t.reason}) <= 500)`)]);

// 0104. Customer-list audience uploads: counts only. The hashed identifiers are sent to the provider and never stored here, and nothing in this table references a person.
export const adsAudienceUploads = pgTable("ads_audience_uploads", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(), audienceId: uuid("audience_id").notNull(), idempotencyKey: uuid("idempotency_key").notNull(),
  status: text("status").notNull().default("pending"), eligible: integer("eligible").notNull().default(0), excluded: jsonb("excluded").$type<Record<string, number>>().notNull().default({}), sent: integer("sent").notNull().default(0),
  errorCode: text("error_code"), requestedBy: text("requested_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_audience_uploads_account_fk", columns: [t.tenantId, t.adAccountId], foreignColumns: [adsAccounts.tenantId, adsAccounts.id] }),
  foreignKey({ name: "ads_audience_uploads_audience_fk", columns: [t.tenantId, t.audienceId], foreignColumns: [adsAudiences.tenantId, adsAudiences.id] }),
  uniqueIndex("ads_audience_uploads_key_idx").on(t.tenantId, t.idempotencyKey),
  check("ads_audience_uploads_shape", sql`${t.status} in ('pending','sent','failed','ambiguous') and ${t.eligible} >= 0 and ${t.sent} >= 0 and pg_column_size(${t.excluded}) <= 2048`)]);
// 0104. Conversion events sent to a pixel destination. One row per event digest; the digest is a one-way hash, so the row cannot be traced back to a person.
export const adsConversionSends = pgTable("ads_conversion_sends", {
  tenantId: uuid("tenant_id").notNull(), id: uuid("id").notNull().defaultRandom(), adAccountId: uuid("ad_account_id").notNull(), destinationId: uuid("destination_id").notNull(), eventName: text("event_name").notNull(),
  eventDigest: text("event_digest").notNull(), status: text("status").notNull().default("pending"), idempotencyKey: uuid("idempotency_key").notNull(), requestedBy: text("requested_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }),
  foreignKey({ name: "ads_conversion_sends_destination_fk", columns: [t.tenantId, t.destinationId], foreignColumns: [adsConversionDestinations.tenantId, adsConversionDestinations.id] }),
  uniqueIndex("ads_conversion_sends_event_idx").on(t.tenantId, t.destinationId, t.eventDigest),
  check("ads_conversion_sends_shape", sql`${t.status} in ('pending','sent','failed','ambiguous') and length(${t.eventName}) between 1 and 60 and ${t.eventDigest} ~ '^[0-9a-f]{64}$'`)]);
// C21 follow-up (0101). A departure record: when an active member left, was removed or banned, and (for a voluntary leave) why. The reason is a fixed list plus short
// optional text. Written only by the membership trigger; read by owners and admins; deleted with the person (cascade).
export const communityLeaveReasons = ["moved_away", "too_busy", "not_relevant", "too_many_notifications", "content_quality", "privacy", "other"] as const;
export const communityExits = pgTable("community_exits", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), kind: text("kind").$type<"left" | "removed" | "banned">().notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }), leftAt: timestamp("left_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").$type<typeof communityLeaveReasons[number]>(), otherText: text("other_text"),
}, (t) => [foreignKey({ name: "community_exits_community_fk", columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  index("community_exits_period_idx").on(t.tenantId, t.communityId, t.leftAt), index("community_exits_user_idx").on(t.userId),
  check("community_exits_shape", sql`${t.kind} in ('left','removed','banned') and (${t.reason} is null or (${t.kind} = 'left' and ${t.reason} in ('moved_away','too_busy','not_relevant','too_many_notifications','content_quality','privacy','other')))
    and (${t.otherText} is null or (${t.reason} = 'other' and length(btrim(${t.otherText})) between 1 and 200))`)]);
// Anonymous page-visit and join-click counters, one row per community, day and kind. No cookie, address, user or session is stored.
export const communityDailyCounts = pgTable("community_daily_counts", {
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(), day: date("day").notNull(), kind: text("kind").$type<"visit" | "join_click">().notNull(), n: integer("n").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.communityId, t.day, t.kind] }),
  foreignKey({ name: "community_daily_counts_community_fk", columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  check("community_daily_counts_shape", sql`${t.kind} in ('visit','join_click') and ${t.n} between 0 and 2147483000`)]);

// Harvest staff (0103). A person who works for Harvest, not for a ministry. Rows are written only by the grant and revoke functions, which run from an ops script as the migration owner:
// there is no self-serve path and no application role can read or write these tables. Staff reach only Discover review data, through definer functions that check this table.
export const platformStaffRoles = ["reviewer", "admin"] as const;
export const platformStaff = pgTable("platform_staff", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }), role: text("role").$type<typeof platformStaffRoles[number]>().notNull(), grantedBy: text("granted_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [check("platform_staff_shape", sql`${t.role} in ('reviewer','admin') and length(${t.grantedBy}) between 1 and 200`)]);
export const platformStaffAudit = pgTable("platform_staff_audit", {
  id: uuid("id").primaryKey().defaultRandom(), actorId: text("actor_id").notNull(), action: text("action").notNull(), targetType: text("target_type"), targetId: text("target_id"),
  tenantId: uuid("tenant_id"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("platform_staff_audit_actor_idx").on(t.actorId, t.createdAt), check("platform_staff_audit_shape", sql`length(${t.action}) between 1 and 80`)]);
