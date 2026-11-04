CREATE TABLE "contact_consents" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"recorded_by" text,
	"purpose" text NOT NULL,
	"notice_version" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	"channel" text,
	"status" text NOT NULL,
	"source" text,
	"evidence" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_consents_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "consent_channel" CHECK ("contact_consents"."channel" in ('email', 'sms', 'social')),
	CONSTRAINT "consent_status" CHECK ("contact_consents"."status" in ('granted', 'withdrawn', 'unknown')),
	CONSTRAINT "consent_source_length" CHECK (length(trim("contact_consents"."source")) between 1 and 200),
	CONSTRAINT "consent_evidence_length" CHECK (length(trim("contact_consents"."evidence")) between 1 and 2000),
	CONSTRAINT "consent_purpose" CHECK ("contact_consents"."purpose" in ('marketing', 'outreach_follow_up', 'event_administration', 'account_communications', 'legacy_unspecified')),
	CONSTRAINT "consent_notice_version" CHECK ("contact_consents"."notice_version" in ('notice-v1', 'legacy-unversioned')),
	CONSTRAINT "consent_redaction" CHECK (("contact_consents"."redacted_at" is null and "contact_consents"."contact_id" is not null and "contact_consents"."channel" is not null and "contact_consents"."source" is not null and "contact_consents"."evidence" is not null) or ("contact_consents"."redacted_at" is not null and "contact_consents"."contact_id" is null and "contact_consents"."channel" is null and "contact_consents"."source" is null and "contact_consents"."evidence" is null and "contact_consents"."recorded_by" is null))
);
--> statement-breakpoint
CREATE TABLE "contact_identifiers" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	CONSTRAINT "contact_identifiers_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "identifier_kind" CHECK ("contact_identifiers"."kind" in ('email', 'phone', 'social')),
	CONSTRAINT "identifier_value_length" CHECK (length("contact_identifiers"."value") between 1 and 254 and length("contact_identifiers"."normalized_value") between 1 and 254)
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"tenant_id" uuid NOT NULL,
	"erased_at" timestamp with time zone,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "contact_name_length" CHECK (length(trim("contacts"."name")) between 1 and 100),
	CONSTRAINT "contact_notes_length" CHECK (length("contacts"."notes") <= 5000)
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "brand_theme" text DEFAULT 'harvest' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identifiers" ADD CONSTRAINT "contact_identifiers_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_tenant_contact_time_idx" ON "contact_consents" USING btree ("tenant_id","contact_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identifiers_tenant_kind_value_idx" ON "contact_identifiers" USING btree ("tenant_id","kind","normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX "identifiers_tenant_contact_kind_idx" ON "contact_identifiers" USING btree ("tenant_id","contact_id","kind");--> statement-breakpoint
CREATE INDEX "contacts_tenant_name_idx" ON "contacts" USING btree ("tenant_id","name","id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspace_brand_theme" CHECK ("workspaces"."brand_theme" in ('harvest', 'studio'));