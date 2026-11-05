import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, integer, bigint, uuid, primaryKey, uniqueIndex, index, foreignKey, check, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
  locale: text("locale"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
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
  brandTheme: text("brand_theme").$type<"harvest" | "studio">().notNull().default("harvest"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("workspace_name_length", sql`length(trim(${t.name})) BETWEEN 1 AND 100`), check("workspace_brand_theme", sql`${t.brandTheme} in ('harvest', 'studio')`)]);
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

export const contacts = pgTable("contacts", {
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId),
  erasedAt: timestamp("erased_at", { withTimezone: true }),
  id: uuid("id").notNull().defaultRandom(), name: text("name").notNull(), notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index("contacts_tenant_name_idx").on(t.tenantId, t.name, t.id),
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
  check("consent_purpose", sql`${t.purpose} in ('marketing', 'outreach_follow_up', 'event_administration', 'account_communications', 'legacy_unspecified')`),
  check("consent_occurrence_bound", sql`${t.occurredAt} <= ${t.recordedAt} + interval '5 minutes'`),
  check("consent_notice_version", sql`${t.noticeVersion} in ('notice-v1', 'legacy-unversioned')`),
  check("consent_redaction", sql`(${t.redactedAt} is null and ${t.contactId} is not null and ${t.channel} is not null and ${t.source} is not null and ${t.evidence} is not null) or (${t.redactedAt} is not null and ${t.channel} is null and ${t.source} is null and ${t.evidence} is null and ${t.recordedBy} is null)`)]);
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
