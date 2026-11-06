CREATE TABLE "campaigns" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"mission" text,
	"country" text,
	"city_region" text,
	"start_date" date,
	"end_date" date,
	"time_zone" text,
	"structure" text,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_type" CHECK ("campaigns"."type" in ('evangelistic_crusade', 'mission_trip', 'conference', 'local_outreach', 'custom_project')),
	CONSTRAINT "campaign_status" CHECK ("campaigns"."status" in ('draft', 'active')),
	CONSTRAINT "campaign_name" CHECK (length(btrim("campaigns"."name")) between 1 and 200 and "campaigns"."name" = btrim("campaigns"."name")),
	CONSTRAINT "campaign_description" CHECK (length("campaigns"."description") <= 5000),
	CONSTRAINT "campaign_mission" CHECK (length("campaigns"."mission") <= 5000),
	CONSTRAINT "campaign_country" CHECK (length("campaigns"."country") between 1 and 100),
	CONSTRAINT "campaign_city_region" CHECK (length("campaigns"."city_region") between 1 and 200),
	CONSTRAINT "campaign_time_zone" CHECK (length("campaigns"."time_zone") between 1 and 100),
	CONSTRAINT "campaign_dates" CHECK ("campaigns"."end_date" >= "campaigns"."start_date"),
	CONSTRAINT "campaign_structure" CHECK ("campaigns"."structure" in ('single', 'multi', 'online_hybrid')),
	CONSTRAINT "campaign_idempotency_key" CHECK (length("campaigns"."idempotency_key") between 1 and 200 and "campaigns"."idempotency_key" ~ '^[A-Za-z0-9._:-]+$'),
	CONSTRAINT "campaign_fingerprint" CHECK ("campaigns"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_tenant_idempotency_idx" ON "campaigns" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "campaigns_tenant_created_idx" ON "campaigns" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "campaigns_tenant_owner_idx" ON "campaigns" USING btree ("tenant_id","owner_user_id");
--> statement-breakpoint
-- CW-01: FORCE RLS and explicit membership checks, in addition to withTenant's
-- verified, locked membership. No public role/policy and no UPDATE/DELETE grants.
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY campaigns_read ON campaigns FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaigns.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND m.role_id IN ('owner', 'admin', 'member', 'viewer')));
CREATE POLICY campaigns_create ON campaigns FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND owner_user_id = nullif(current_setting('app.user_id', true), '')
    AND status = 'draft' AND archived_at IS NULL
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaigns.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND m.role_id IN ('owner', 'admin', 'member')));
-- Drizzle includes defaulted columns in INSERT. The insert policy enforces draft
-- status, creator ownership and a null archive even for direct SQL inserts.
GRANT SELECT, INSERT ON campaigns TO harvest_app;
