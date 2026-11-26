CREATE TABLE "campaign_boards" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"department" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_boards_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_board_department" CHECK ("campaign_boards"."department" in ('general', 'campaign_leadership', 'church_mobilization', 'evangelistic_outreach', 'prayer_intercession', 'marketing_media', 'logistics_equipment', 'finance_fundraising', 'volunteers', 'counseling', 'discipleship_follow_up', 'worship_production', 'security_medical', 'transportation_hospitality'))
);
--> statement-breakpoint
CREATE TABLE "campaign_milestones" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"board_id" uuid,
	"title" text NOT NULL,
	"due_date" date,
	"reached_at" timestamp with time zone,
	"reached_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_milestones_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_milestone_title" CHECK (length(btrim("campaign_milestones"."title")) between 1 and 200 and "campaign_milestones"."title" = btrim("campaign_milestones"."title")),
	CONSTRAINT "campaign_milestone_reached" CHECK (("campaign_milestones"."reached_at" is null) = ("campaign_milestones"."reached_by" is null)),
	CONSTRAINT "campaign_milestone_version" CHECK ("campaign_milestones"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "campaign_tasks" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"milestone_id" uuid,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"assignee_id" text,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_tasks_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_task_title" CHECK (length(btrim("campaign_tasks"."title")) between 1 and 200 and "campaign_tasks"."title" = btrim("campaign_tasks"."title")),
	CONSTRAINT "campaign_task_notes" CHECK (length("campaign_tasks"."notes") <= 5000),
	CONSTRAINT "campaign_task_status" CHECK ("campaign_tasks"."status" in ('todo', 'in_progress', 'done')),
	CONSTRAINT "campaign_task_position" CHECK ("campaign_tasks"."position" >= 0),
	CONSTRAINT "campaign_task_done" CHECK (("campaign_tasks"."status" = 'done') = ("campaign_tasks"."completed_at" is not null) and ("campaign_tasks"."completed_at" is null) = ("campaign_tasks"."completed_by" is null)),
	CONSTRAINT "campaign_task_version" CHECK ("campaign_tasks"."version" >= 1)
);
--> statement-breakpoint
-- The (tenant, campaign, id) keys are created before the foreign keys that reference them.
CREATE UNIQUE INDEX "campaign_boards_campaign_id_idx" ON "campaign_boards" USING btree ("tenant_id","campaign_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_milestones_campaign_id_idx" ON "campaign_milestones" USING btree ("tenant_id","campaign_id","id");--> statement-breakpoint
ALTER TABLE "campaign_boards" ADD CONSTRAINT "campaign_boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_boards" ADD CONSTRAINT "campaign_boards_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_milestones" ADD CONSTRAINT "campaign_milestones_reached_by_users_id_fk" FOREIGN KEY ("reached_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_milestones" ADD CONSTRAINT "campaign_milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_milestones" ADD CONSTRAINT "campaign_milestones_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_milestones" ADD CONSTRAINT "campaign_milestones_board_fk" FOREIGN KEY ("tenant_id","campaign_id","board_id") REFERENCES "public"."campaign_boards"("tenant_id","campaign_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tasks" ADD CONSTRAINT "campaign_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tasks" ADD CONSTRAINT "campaign_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tasks" ADD CONSTRAINT "campaign_tasks_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tasks" ADD CONSTRAINT "campaign_tasks_board_fk" FOREIGN KEY ("tenant_id","campaign_id","board_id") REFERENCES "public"."campaign_boards"("tenant_id","campaign_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_tasks" ADD CONSTRAINT "campaign_tasks_milestone_fk" FOREIGN KEY ("tenant_id","campaign_id","milestone_id") REFERENCES "public"."campaign_milestones"("tenant_id","campaign_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_boards_department_idx" ON "campaign_boards" USING btree ("tenant_id","campaign_id","department");--> statement-breakpoint
CREATE INDEX "campaign_milestones_campaign_idx" ON "campaign_milestones" USING btree ("tenant_id","campaign_id","due_date");--> statement-breakpoint
CREATE INDEX "campaign_tasks_board_idx" ON "campaign_tasks" USING btree ("tenant_id","board_id","status","position");--> statement-breakpoint
CREATE INDEX "campaign_tasks_campaign_idx" ON "campaign_tasks" USING btree ("tenant_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_tasks_milestone_idx" ON "campaign_tasks" USING btree ("tenant_id","milestone_id");--> statement-breakpoint
-- Campaign boards, tasks and milestones (founder approval, 26 Nov). FORCE RLS and no SECURITY DEFINER function. Everyone who can read campaigns in the
-- ministry (owner, admin, member, viewer, or a collaborator with the campaigns area) reads them; everyone who can write campaigns adds, changes and
-- removes tasks and milestones of a live (unarchived) campaign, always recorded as themselves. Boards are never changed or removed by the runtime role.
-- Roles go through public.access_role (0113). Nothing here references a CRM contact or sends anything.
ALTER TABLE public.campaign_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_boards FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_milestones FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_tasks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_boards, public.campaign_milestones, public.campaign_tasks FROM PUBLIC, harvest_app;
GRANT SELECT, INSERT ON public.campaign_boards TO harvest_app;
GRANT SELECT, INSERT, DELETE ON public.campaign_milestones, public.campaign_tasks TO harvest_app;
GRANT UPDATE (board_id, title, due_date, reached_at, reached_by, version, updated_at) ON public.campaign_milestones TO harvest_app;
GRANT UPDATE (board_id, milestone_id, title, notes, status, position, assignee_id, due_date, completed_at, completed_by, version, updated_at) ON public.campaign_tasks TO harvest_app;
--> statement-breakpoint
DO $$
DECLARE tbl text;
  reader text := $r$EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = %1$I.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
    AND public.access_role(m.tenant_id, m.user_id, 'campaigns', m.role_id) IN ('owner', 'admin', 'member', 'viewer'))$r$;
  writer text := $w$EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = %1$I.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
    AND public.access_role(m.tenant_id, m.user_id, 'campaigns', m.role_id) IN ('owner', 'admin', 'member'))
    AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.tenant_id = %1$I.tenant_id AND c.id = %1$I.campaign_id AND c.archived_at IS NULL)$w$;
  tenant text := $t$tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid$t$;
  me text := $u$nullif(current_setting('app.user_id', true), '')$u$;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['campaign_boards', 'campaign_milestones', 'campaign_tasks'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO harvest_app USING (%s AND %s)', tbl || '_read', tbl, tenant, format(reader, tbl));
  END LOOP;
  EXECUTE format('CREATE POLICY campaign_boards_create ON public.campaign_boards FOR INSERT TO harvest_app WITH CHECK (%s AND created_by = %s AND %s)',
    tenant, me, format(writer, 'campaign_boards'));
  EXECUTE format($m$CREATE POLICY campaign_milestones_create ON public.campaign_milestones FOR INSERT TO harvest_app
    WITH CHECK (%s AND created_by = %s AND (reached_by IS NULL OR reached_by = %s) AND %s)$m$, tenant, me, me, format(writer, 'campaign_milestones'));
  -- A new task is created by the caller, completed (if at all) by the caller, and assigned (if at all) to someone who can write campaigns here.
  EXECUTE format($m$CREATE POLICY campaign_tasks_create ON public.campaign_tasks FOR INSERT TO harvest_app
    WITH CHECK (%s AND created_by = %s AND (completed_by IS NULL OR completed_by = %s) AND %s
      AND (assignee_id IS NULL OR EXISTS (SELECT 1 FROM public.workspace_members a WHERE a.tenant_id = campaign_tasks.tenant_id AND a.user_id = campaign_tasks.assignee_id
        AND public.access_role(a.tenant_id, a.user_id, 'campaigns', a.role_id) IN ('owner', 'admin', 'member'))))$m$, tenant, me, me, format(writer, 'campaign_tasks'));
  FOREACH tbl IN ARRAY ARRAY['campaign_milestones', 'campaign_tasks'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO harvest_app USING (%s AND %s)', tbl || '_delete', tbl, tenant, format(writer, tbl));
  END LOOP;
  -- Updates keep the row in its ministry and campaign (the key columns are not granted). The server checks a newly chosen assignee is eligible;
  -- the policy keeps any assignee a member of this ministry, so editing a task whose assignee later lost access still works.
  EXECUTE format($m$CREATE POLICY campaign_milestones_update ON public.campaign_milestones FOR UPDATE TO harvest_app USING (%s AND %s)
    WITH CHECK (%s AND %s)$m$, tenant, format(writer, 'campaign_milestones'), tenant, format(writer, 'campaign_milestones'));
  EXECUTE format($m$CREATE POLICY campaign_tasks_update ON public.campaign_tasks FOR UPDATE TO harvest_app USING (%s AND %s)
    WITH CHECK (%s AND %s AND (assignee_id IS NULL OR EXISTS (SELECT 1 FROM public.workspace_members a WHERE a.tenant_id = campaign_tasks.tenant_id
      AND a.user_id = campaign_tasks.assignee_id)))$m$, tenant, format(writer, 'campaign_tasks'), tenant, format(writer, 'campaign_tasks'));
END $$;
