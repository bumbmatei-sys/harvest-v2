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
-- Campaign budgets (PRD "What Happens After Clicking Finish?", item 4). Record keeping only: no money moves and no provider is called. FORCE RLS.
-- Founder decision (26 Nov): individual expenses (every field, payee and reference included) are for owners and admins only (a collaborator with the
-- campaigns area at "manage" counts as admin). Members and viewers see totals only, through public.campaign_budget_totals below, which returns sums per
-- category and overall and never a row. Budget lines (category and planned amount) are readable by everyone who can read campaigns. Owners and admins
-- add, change and remove lines and expenses of a live (unarchived) campaign, always recorded as themselves. Roles go through public.access_role (0113).
-- Updates are column-limited: the key, tenant, campaign, category of a line, currency and creator columns are not granted.
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
  manager_read text := $m$EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = %1$I.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
    AND public.access_role(m.tenant_id, m.user_id, 'campaigns', m.role_id) IN ('owner', 'admin'))$m$;
  manager text := $w$EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = %1$I.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
    AND public.access_role(m.tenant_id, m.user_id, 'campaigns', m.role_id) IN ('owner', 'admin'))
    AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.tenant_id = %1$I.tenant_id AND c.id = %1$I.campaign_id AND c.archived_at IS NULL)$w$;
  tenant text := $t$tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid$t$;
  me text := $u$nullif(current_setting('app.user_id', true), '')$u$;
  scope text := $s$tenant_id = nullif(current_setting('app.campaign_budget_tenant', true), '')::uuid AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid$s$;
BEGIN
  EXECUTE format('CREATE POLICY campaign_budget_lines_read ON public.campaign_budget_lines FOR SELECT TO harvest_app USING (%s AND %s)', tenant, format(reader, 'campaign_budget_lines'));
  EXECUTE format('CREATE POLICY campaign_expenses_read ON public.campaign_expenses FOR SELECT TO harvest_app USING (%s AND %s)', tenant, format(manager_read, 'campaign_expenses'));
  FOREACH tbl IN ARRAY ARRAY['campaign_budget_lines', 'campaign_expenses'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO harvest_app USING (%s AND %s)', tbl || '_delete', tbl, tenant, format(manager, tbl));
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO harvest_app USING (%s AND %s) WITH CHECK (%s AND %s)', tbl || '_update', tbl,
      tenant, format(manager, tbl), tenant, format(manager, tbl));
    -- The totals definer runs as the migration owner and reads one ministry's rows only while it has set this transaction-local flag itself.
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO %I USING (%s)', tbl || '_totals_definer', tbl, current_user, scope);
  END LOOP;
  EXECUTE format('CREATE POLICY campaign_budget_lines_create ON public.campaign_budget_lines FOR INSERT TO harvest_app WITH CHECK (%s AND created_by = %s AND %s)',
    tenant, me, format(manager, 'campaign_budget_lines'));
  EXECUTE format('CREATE POLICY campaign_expenses_create ON public.campaign_expenses FOR INSERT TO harvest_app WITH CHECK (%s AND recorded_by = %s AND %s)',
    tenant, me, format(manager, 'campaign_expenses'));
  -- The definer checks the caller's own membership and the campaign, under the same flag: only the caller's row, only that ministry.
  EXECUTE format($p$CREATE POLICY campaign_budget_definer_member ON public.workspace_members FOR SELECT TO %I
    USING (%s AND user_id = nullif(current_setting('app.user_id', true), ''))$p$, current_user, scope);
  EXECUTE format('CREATE POLICY campaign_budget_definer_campaign ON public.campaigns FOR SELECT TO %I USING (%s)', current_user, scope);
END $$;--> statement-breakpoint
-- Internal (not granted): sums per category and overall for one campaign, after checking the caller can read campaigns in that ministry and the
-- campaign belongs to it. Amounts are cents as text. Never returns a row of campaign_expenses.
CREATE FUNCTION public.campaign_budget_totals_scoped(p_tenant uuid, p_campaign uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); stored_role text; result jsonb; missing jsonb := '{"outcome":"not_found"}';
BEGIN
  IF actor IS NULL OR p_tenant IS NULL OR p_campaign IS NULL OR p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid THEN RETURN missing; END IF;
  SELECT w.role_id INTO stored_role FROM public.workspace_members w WHERE w.tenant_id = p_tenant AND w.user_id = actor;
  IF stored_role IS NULL OR coalesce(public.access_role(p_tenant, actor, 'campaigns', stored_role), '') NOT IN ('owner', 'admin', 'member', 'viewer') THEN RETURN missing; END IF;
  PERFORM 1 FROM public.campaigns c WHERE c.tenant_id = p_tenant AND c.id = p_campaign;
  IF NOT FOUND THEN RETURN missing; END IF;
  WITH planned AS (
    SELECT l.category, l.planned_cents FROM public.campaign_budget_lines l WHERE l.tenant_id = p_tenant AND l.campaign_id = p_campaign
  ), spent AS (
    SELECT e.category, sum(e.amount_cents) AS cents, count(*) AS n FROM public.campaign_expenses e WHERE e.tenant_id = p_tenant AND e.campaign_id = p_campaign GROUP BY e.category
  ), categories AS (
    SELECT coalesce(p.category, s.category) AS category, p.planned_cents, coalesce(s.cents, 0) AS cents, coalesce(s.n, 0) AS n
    FROM planned p FULL JOIN spent s ON s.category = p.category
  )
  SELECT pg_catalog.jsonb_build_object('outcome', 'ok',
    'categories', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('category', q.category, 'planned', q.planned_cents IS NOT NULL,
      'plannedCents', coalesce(q.planned_cents, 0)::text, 'spentCents', q.cents::text, 'remainingCents', (coalesce(q.planned_cents, 0) - q.cents)::text,
      'expenseCount', q.n::int) ORDER BY q.category), '[]'::jsonb),
    'totals', pg_catalog.jsonb_build_object('plannedCents', coalesce(sum(q.planned_cents), 0)::text, 'spentCents', coalesce(sum(q.cents), 0)::text,
      'remainingCents', (coalesce(sum(q.planned_cents), 0) - coalesce(sum(q.cents), 0))::text, 'expenseCount', coalesce(sum(q.n), 0)::int))
  INTO result FROM categories q;
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_budget_totals_scoped(uuid, uuid) FROM PUBLIC, harvest_app;--> statement-breakpoint
-- The entry point. Every other app.* flag (except the caller's ministry and user) is cleared for the call, so a flag the app set beforehand cannot widen
-- what the owner-role policies let it read; this function then sets its own flag and puts every setting back afterwards.
CREATE FUNCTION public.campaign_budget_totals(p_tenant uuid, p_campaign uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb; entry record; result jsonb;
BEGIN
  SELECT coalesce(pg_catalog.jsonb_object_agg(s.name, s.setting), '{}'::jsonb) INTO prior FROM pg_catalog.pg_settings s
    WHERE s.name LIKE 'app.%' AND s.name NOT IN ('app.tenant_id', 'app.user_id');
  FOR entry IN SELECT key FROM pg_catalog.jsonb_each_text(prior) LOOP PERFORM pg_catalog.set_config(entry.key, '', true); END LOOP;
  PERFORM pg_catalog.set_config('app.campaign_budget_tenant', coalesce(p_tenant::text, ''), true);
  result := public.campaign_budget_totals_scoped(p_tenant, p_campaign);
  PERFORM pg_catalog.set_config('app.campaign_budget_tenant', '', true);
  FOR entry IN SELECT key, value FROM pg_catalog.jsonb_each_text(prior) LOOP PERFORM pg_catalog.set_config(entry.key, entry.value, true); END LOOP;
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_budget_totals(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_budget_totals(uuid, uuid) TO harvest_app;
