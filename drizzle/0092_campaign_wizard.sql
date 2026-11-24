CREATE TABLE "campaign_draft_assignments" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"department" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_draft_assignments_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_draft_assignment_role" CHECK ("campaign_draft_assignments"."role" in ('leader', 'member')),
	CONSTRAINT "campaign_draft_assignment_department" CHECK ("campaign_draft_assignments"."department" in ('campaign_leadership', 'church_mobilization', 'evangelistic_outreach', 'prayer_intercession', 'marketing_media', 'logistics_equipment', 'finance_fundraising', 'volunteers', 'counseling', 'discipleship_follow_up', 'worship_production', 'security_medical', 'transportation_hospitality'))
);
--> statement-breakpoint
CREATE TABLE "campaign_drafts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_by" text NOT NULL,
	"client_key" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"type" text,
	"name" text,
	"description" text,
	"mission" text,
	"country" text,
	"city_region" text,
	"start_date" date,
	"end_date" date,
	"time_zone" text,
	"structure" text,
	"departments" text[] DEFAULT '{}'::text[] NOT NULL,
	"modules" text[] DEFAULT '{}'::text[] NOT NULL,
	"budget" jsonb NOT NULL,
	"outreach" jsonb NOT NULL,
	"campaign_id" uuid,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_drafts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_draft_status" CHECK ("campaign_drafts"."status" in ('draft', 'finished', 'discarded')),
	CONSTRAINT "campaign_draft_version" CHECK ("campaign_drafts"."version" >= 1),
	CONSTRAINT "campaign_draft_step" CHECK ("campaign_drafts"."current_step" between 1 and 8),
	CONSTRAINT "campaign_draft_type" CHECK ("campaign_drafts"."type" is null or "campaign_drafts"."type" in ('evangelistic_crusade', 'mission_trip', 'conference', 'local_outreach', 'custom_project')),
	CONSTRAINT "campaign_draft_name" CHECK ("campaign_drafts"."name" is null or (length(btrim("campaign_drafts"."name")) between 1 and 200 and "campaign_drafts"."name" = btrim("campaign_drafts"."name"))),
	CONSTRAINT "campaign_draft_text" CHECK (length("campaign_drafts"."description") <= 5000 and length("campaign_drafts"."mission") <= 5000 and length("campaign_drafts"."country") between 1 and 100 and length("campaign_drafts"."city_region") between 1 and 200 and length("campaign_drafts"."time_zone") between 1 and 100),
	CONSTRAINT "campaign_draft_dates" CHECK ("campaign_drafts"."end_date" >= "campaign_drafts"."start_date"),
	CONSTRAINT "campaign_draft_structure" CHECK ("campaign_drafts"."structure" in ('single', 'multi', 'online_hybrid')),
	CONSTRAINT "campaign_draft_client_key" CHECK (length("campaign_drafts"."client_key") between 1 and 200 and "campaign_drafts"."client_key" ~ '^[A-Za-z0-9._:-]+$'),
	CONSTRAINT "campaign_draft_lists" CHECK (cardinality("campaign_drafts"."departments") <= 13 and cardinality("campaign_drafts"."modules") <= 18),
	CONSTRAINT "campaign_draft_json" CHECK (jsonb_typeof("campaign_drafts"."budget") = 'object' and jsonb_typeof("campaign_drafts"."outreach") = 'object'),
	CONSTRAINT "campaign_draft_finished" CHECK (("campaign_drafts"."status" = 'finished') = ("campaign_drafts"."campaign_id" is not null and "campaign_drafts"."finished_at" is not null) and ("campaign_drafts"."status" <> 'finished' or ("campaign_drafts"."type" is not null and "campaign_drafts"."name" is not null)))
);
--> statement-breakpoint
ALTER TABLE "campaign_draft_assignments" ADD CONSTRAINT "campaign_draft_assignments_tenant_id_draft_id_campaign_drafts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","draft_id") REFERENCES "public"."campaign_drafts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_draft_assignments" ADD CONSTRAINT "campaign_draft_assignments_tenant_id_user_id_workspace_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD CONSTRAINT "campaign_drafts_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD CONSTRAINT "campaign_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD CONSTRAINT "campaign_drafts_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_draft_assignments_unique_idx" ON "campaign_draft_assignments" USING btree ("tenant_id","draft_id","department","user_id");--> statement-breakpoint
CREATE INDEX "campaign_draft_assignments_user_idx" ON "campaign_draft_assignments" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_drafts_client_key_idx" ON "campaign_drafts" USING btree ("tenant_id","created_by","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_drafts_campaign_idx" ON "campaign_drafts" USING btree ("tenant_id","campaign_id") WHERE "campaign_drafts"."campaign_id" is not null;--> statement-breakpoint
CREATE INDEX "campaign_drafts_tenant_idx" ON "campaign_drafts" USING btree ("tenant_id","status","updated_at");
--> statement-breakpoint
-- Campaign wizard drafts (CW-03 to CW-05). FORCE RLS on both tables. No SECURITY DEFINER function: the runtime role works through ordinary policies.
-- A draft is private to its creator (who must still be a non-viewer member). Owners and admins can read every draft in their ministry and discard
-- one, nothing more. Nothing is ever deleted (a discard is a status), and the assignments belong to a draft that is still open.
ALTER TABLE public.campaign_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_draft_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_draft_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_drafts, public.campaign_draft_assignments FROM PUBLIC, harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.campaign_drafts TO harvest_app;
GRANT UPDATE (status, version, current_step, type, name, description, mission, country, city_region, start_date, end_date, time_zone, structure,
  departments, modules, budget, outreach, campaign_id, finished_at, updated_at) ON public.campaign_drafts TO harvest_app;
GRANT SELECT, INSERT, DELETE ON public.campaign_draft_assignments TO harvest_app;
--> statement-breakpoint
CREATE POLICY campaign_drafts_read ON public.campaign_drafts FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.workspace_members m
    WHERE m.tenant_id = campaign_drafts.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND (m.role_id IN ('owner', 'admin') OR (m.role_id = 'member' AND campaign_drafts.created_by = m.user_id))));
CREATE POLICY campaign_drafts_create ON public.campaign_drafts FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND created_by = nullif(current_setting('app.user_id', true), '')
    AND status = 'draft' AND version = 1 AND campaign_id IS NULL AND finished_at IS NULL
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_drafts.tenant_id
      AND m.user_id = created_by AND m.role_id IN ('owner', 'admin', 'member')));
-- The creator edits and finishes an open draft.
CREATE POLICY campaign_drafts_edit ON public.campaign_drafts FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND status = 'draft'
    AND created_by = nullif(current_setting('app.user_id', true), '')
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_drafts.tenant_id
      AND m.user_id = created_by AND m.role_id IN ('owner', 'admin', 'member')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND created_by = nullif(current_setting('app.user_id', true), ''));
-- An owner or admin can only discard someone else's open draft.
CREATE POLICY campaign_drafts_discard ON public.campaign_drafts FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND status = 'draft'
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_drafts.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND status = 'discarded');
--> statement-breakpoint
CREATE POLICY campaign_draft_assignments_read ON public.campaign_draft_assignments FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.campaign_drafts d
    WHERE d.tenant_id = campaign_draft_assignments.tenant_id AND d.id = campaign_draft_assignments.draft_id));
CREATE POLICY campaign_draft_assignments_write ON public.campaign_draft_assignments FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.campaign_drafts d
    WHERE d.tenant_id = campaign_draft_assignments.tenant_id AND d.id = campaign_draft_assignments.draft_id
      AND d.status = 'draft' AND d.created_by = nullif(current_setting('app.user_id', true), '')));
CREATE POLICY campaign_draft_assignments_delete ON public.campaign_draft_assignments FOR DELETE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.campaign_drafts d
    WHERE d.tenant_id = campaign_draft_assignments.tenant_id AND d.id = campaign_draft_assignments.draft_id
      AND d.status = 'draft' AND d.created_by = nullif(current_setting('app.user_id', true), '')));
--> statement-breakpoint
-- Activation is a state change on the campaign row and nothing else: owners and admins may change status (and its timestamp) of a live campaign.
-- Still no UPDATE of any other column and no DELETE for the runtime role.
GRANT UPDATE (status, updated_at) ON public.campaigns TO harvest_app;
CREATE POLICY campaigns_set_status ON public.campaigns FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND archived_at IS NULL
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaigns.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND archived_at IS NULL AND status IN ('draft', 'active'));
