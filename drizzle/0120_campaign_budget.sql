CREATE TABLE "campaign_budget_lines" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"category" text NOT NULL,
	"planned_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_budget_lines_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_budget_line_category" CHECK ("campaign_budget_lines"."category" in ('venue', 'equipment_production', 'marketing_media', 'printing_materials', 'travel_transport', 'accommodation', 'hospitality_food', 'volunteers_staff', 'security_medical', 'administration', 'other')),
	CONSTRAINT "campaign_budget_line_currency" CHECK ("campaign_budget_lines"."currency" in ('USD','EUR','GBP','CAD','AUD','NZD','CHF','ZAR','BRL','MXN','INR','PHP','KES','NGN','GHS','RON')),
	CONSTRAINT "campaign_budget_line_planned" CHECK ("campaign_budget_lines"."planned_cents" between 0 and 1000000000000),
	CONSTRAINT "campaign_budget_line_version" CHECK ("campaign_budget_lines"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "campaign_expenses" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"spent_on" date NOT NULL,
	"category" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"payee" text,
	"reference" text,
	"recorded_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_expenses_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_expense_category" CHECK ("campaign_expenses"."category" in ('venue', 'equipment_production', 'marketing_media', 'printing_materials', 'travel_transport', 'accommodation', 'hospitality_food', 'volunteers_staff', 'security_medical', 'administration', 'other')),
	CONSTRAINT "campaign_expense_currency" CHECK ("campaign_expenses"."currency" in ('USD','EUR','GBP','CAD','AUD','NZD','CHF','ZAR','BRL','MXN','INR','PHP','KES','NGN','GHS','RON')),
	CONSTRAINT "campaign_expense_amount" CHECK ("campaign_expenses"."amount_cents" between 1 and 1000000000000),
	CONSTRAINT "campaign_expense_description" CHECK (length(btrim("campaign_expenses"."description")) between 1 and 200 and "campaign_expenses"."description" = btrim("campaign_expenses"."description")),
	CONSTRAINT "campaign_expense_payee" CHECK (length(btrim("campaign_expenses"."payee")) between 1 and 120),
	CONSTRAINT "campaign_expense_reference" CHECK (length(btrim("campaign_expenses"."reference")) between 1 and 120),
	CONSTRAINT "campaign_expense_version" CHECK ("campaign_expenses"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "campaign_budget_lines" ADD CONSTRAINT "campaign_budget_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_budget_lines" ADD CONSTRAINT "campaign_budget_lines_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_expenses" ADD CONSTRAINT "campaign_expenses_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_expenses" ADD CONSTRAINT "campaign_expenses_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_budget_lines_category_idx" ON "campaign_budget_lines" USING btree ("tenant_id","campaign_id","category");--> statement-breakpoint
CREATE INDEX "campaign_expenses_campaign_idx" ON "campaign_expenses" USING btree ("tenant_id","campaign_id","spent_on");--> statement-breakpoint
-- Campaign budgets (PRD "What Happens After Clicking Finish?", item 4). Record keeping only: no money moves and no provider is called. FORCE RLS and no
-- SECURITY DEFINER function. Everyone who can read campaigns in the ministry (owner, admin, member, viewer, or a collaborator with the campaigns area)
-- reads the rows, so the totals can be summed for them; the server returns individual expenses (payee, reference) to owners and admins only. Owners and
-- admins add, change and remove budget lines and expenses of a live (unarchived) campaign, always recorded as themselves. Roles go through
-- public.access_role (0113). Updates are column-limited: the key, tenant, campaign, category of a line, currency and creator columns are not granted.
ALTER TABLE public.campaign_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_budget_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_expenses FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_budget_lines, public.campaign_expenses FROM PUBLIC, harvest_app;
GRANT SELECT, INSERT, DELETE ON public.campaign_budget_lines, public.campaign_expenses TO harvest_app;
GRANT UPDATE (planned_cents, version, updated_at) ON public.campaign_budget_lines TO harvest_app;
GRANT UPDATE (spent_on, category, amount_cents, description, payee, reference, version, updated_at) ON public.campaign_expenses TO harvest_app;
--> statement-breakpoint
DO $$
DECLARE tbl text;
  reader text := $r$EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = %1$I.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
    AND public.access_role(m.tenant_id, m.user_id, 'campaigns', m.role_id) IN ('owner', 'admin', 'member', 'viewer'))$r$;
  manager text := $w$EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = %1$I.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
    AND public.access_role(m.tenant_id, m.user_id, 'campaigns', m.role_id) IN ('owner', 'admin'))
    AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.tenant_id = %1$I.tenant_id AND c.id = %1$I.campaign_id AND c.archived_at IS NULL)$w$;
  tenant text := $t$tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid$t$;
  me text := $u$nullif(current_setting('app.user_id', true), '')$u$;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['campaign_budget_lines', 'campaign_expenses'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO harvest_app USING (%s AND %s)', tbl || '_read', tbl, tenant, format(reader, tbl));
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO harvest_app USING (%s AND %s)', tbl || '_delete', tbl, tenant, format(manager, tbl));
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO harvest_app USING (%s AND %s) WITH CHECK (%s AND %s)', tbl || '_update', tbl,
      tenant, format(manager, tbl), tenant, format(manager, tbl));
  END LOOP;
  EXECUTE format('CREATE POLICY campaign_budget_lines_create ON public.campaign_budget_lines FOR INSERT TO harvest_app WITH CHECK (%s AND created_by = %s AND %s)',
    tenant, me, format(manager, 'campaign_budget_lines'));
  EXECUTE format('CREATE POLICY campaign_expenses_create ON public.campaign_expenses FOR INSERT TO harvest_app WITH CHECK (%s AND recorded_by = %s AND %s)',
    tenant, me, format(manager, 'campaign_expenses'));
END $$;
