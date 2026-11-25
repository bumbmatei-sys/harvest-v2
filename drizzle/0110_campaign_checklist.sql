CREATE TABLE "campaign_checklist_items" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"item" text NOT NULL,
	"done" boolean NOT NULL,
	"done_by" text,
	"done_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_checklist_items_tenant_id_campaign_id_item_pk" PRIMARY KEY("tenant_id","campaign_id","item"),
	CONSTRAINT "campaign_checklist_item" CHECK ("campaign_checklist_items"."item" in ('assign_leaders', 'confirm_venues', 'define_budget', 'connect_payments', 'publish_registration', 'configure_qr', 'assign_counseling', 'invite_churches', 'create_events')),
	CONSTRAINT "campaign_checklist_done" CHECK (("campaign_checklist_items"."done" and "campaign_checklist_items"."done_by" is not null and "campaign_checklist_items"."done_at" is not null) or (not "campaign_checklist_items"."done" and "campaign_checklist_items"."done_by" is null and "campaign_checklist_items"."done_at" is null))
);
--> statement-breakpoint
ALTER TABLE "campaign_checklist_items" ADD CONSTRAINT "campaign_checklist_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_checklist_items" ADD CONSTRAINT "campaign_checklist_items_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- CW-06 setup checklist (founder decision Q8). FORCE RLS, no SECURITY DEFINER function. Anyone who can write campaigns in the ministry (owner, admin,
-- member) reads the checklist of a live campaign and records an item as done or not done, always as themselves; nothing can be deleted by the runtime role.
ALTER TABLE public.campaign_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_checklist_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_checklist_items FROM PUBLIC, harvest_app;
GRANT SELECT, INSERT ON public.campaign_checklist_items TO harvest_app;
GRANT UPDATE (done, done_by, done_at, updated_at) ON public.campaign_checklist_items TO harvest_app;
--> statement-breakpoint
CREATE POLICY campaign_checklist_read ON public.campaign_checklist_items FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.workspace_members m
    WHERE m.tenant_id = campaign_checklist_items.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND m.role_id IN ('owner', 'admin', 'member')));
CREATE POLICY campaign_checklist_create ON public.campaign_checklist_items FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND (done_by IS NULL OR done_by = nullif(current_setting('app.user_id', true), ''))
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_checklist_items.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin', 'member'))
    AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.tenant_id = campaign_checklist_items.tenant_id AND c.id = campaign_checklist_items.campaign_id AND c.archived_at IS NULL));
CREATE POLICY campaign_checklist_update ON public.campaign_checklist_items FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_checklist_items.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin', 'member'))
    AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.tenant_id = campaign_checklist_items.tenant_id AND c.id = campaign_checklist_items.campaign_id AND c.archived_at IS NULL))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND (done_by IS NULL OR done_by = nullif(current_setting('app.user_id', true), '')));
