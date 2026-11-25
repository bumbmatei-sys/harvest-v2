CREATE TABLE "ads_accounts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"network" text NOT NULL,
	"external_ref" text NOT NULL,
	"name" text NOT NULL,
	"currency" text,
	"timezone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_refusal" jsonb,
	"health_checked_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"sync_state" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_accounts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_accounts_shape" CHECK ("ads_accounts"."network" in ('meta', 'google', 'linkedin', 'tiktok', 'pinterest', 'x', 'reddit', 'microsoft', 'snapchat', 'amazon') and length("ads_accounts"."external_ref") between 1 and 200 and length("ads_accounts"."name") between 1 and 200
    and "ads_accounts"."status" in ('active','restricted','disabled','closed','unknown') and "ads_accounts"."sync_state" in ('pending','ready','failing','delayed') and jsonb_typeof("ads_accounts"."health") = 'object' and pg_column_size("ads_accounts"."health") <= 4096)
);
--> statement-breakpoint
CREATE TABLE "ads_ad_sets" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_ref" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"budget_amount" numeric(14, 2),
	"budget_type" text,
	"start_date" date,
	"end_date" date,
	"bidding" jsonb,
	"targeting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_targeting" jsonb,
	CONSTRAINT "ads_ad_sets_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_ad_sets_shape" CHECK ("ads_ad_sets"."status" in ('active', 'paused', 'archived', 'deleted') and length("ads_ad_sets"."name") between 1 and 200 and "ads_ad_sets"."budget_amount" >= 0 and ("ads_ad_sets"."budget_type" is null or "ads_ad_sets"."budget_type" in ('daily','lifetime'))
    and jsonb_typeof("ads_ad_sets"."targeting") = 'object' and pg_column_size("ads_ad_sets"."targeting") <= 16384 and ("ads_ad_sets"."raw_targeting" is null or pg_column_size("ads_ad_sets"."raw_targeting") <= 16384))
);
--> statement-breakpoint
CREATE TABLE "ads_ads" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_ref" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ad_set_id" uuid NOT NULL,
	"format" text NOT NULL,
	"creative_ref" text,
	"source_post_ref" text,
	"lead_form_id" uuid,
	"review_status" text DEFAULT 'unknown' NOT NULL,
	"review_reason" text,
	"delivery_issue" text,
	CONSTRAINT "ads_ads_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_ads_shape" CHECK ("ads_ads"."status" in ('active', 'paused', 'archived', 'deleted') and length("ads_ads"."name") between 1 and 200 and "ads_ads"."format" in ('image','video','carousel','document','event','text','messaging','call')
    and "ads_ads"."review_status" in ('unknown','in_review','approved','rejected') and ("ads_ads"."review_reason" is null or length("ads_ads"."review_reason") <= 500) and ("ads_ads"."delivery_issue" is null or length("ads_ads"."delivery_issue") <= 500))
);
--> statement-breakpoint
CREATE TABLE "ads_alerts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"subject_level" text,
	"subject_id" uuid,
	"dedupe_key" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "ads_alerts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_alerts_shape" CHECK ("ads_alerts"."kind" in ('ad_rejected','delivery_issue','payment_problem','spend_without_results','budget_capped','connection_lost','sync_failed','account_restricted')
    and "ads_alerts"."severity" in ('info','warning','critical') and "ads_alerts"."state" in ('open','resolved','dismissed') and length("ads_alerts"."dedupe_key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "ads_audiences" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"size_estimate" bigint,
	"status" text DEFAULT 'ready' NOT NULL,
	"spec" jsonb,
	"synced_at" timestamp with time zone,
	CONSTRAINT "ads_audiences_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_audiences_shape" CHECK ("ads_audiences"."kind" in ('custom','lookalike','saved_targeting','website','engagement','customer_list') and length("ads_audiences"."name") between 1 and 200 and ("ads_audiences"."spec" is null or pg_column_size("ads_audiences"."spec") <= 16384))
);
--> statement-breakpoint
CREATE TABLE "ads_campaigns" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_ref" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"goal" text NOT NULL,
	"budget_amount" numeric(14, 2),
	"budget_type" text,
	"budget_level" text,
	"shared_budget_ref" text,
	"start_date" date,
	"end_date" date,
	"bidding" jsonb,
	"special_ad_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"attribution_model" text DEFAULT 'default' NOT NULL,
	CONSTRAINT "ads_campaigns_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_campaigns_shape" CHECK ("ads_campaigns"."goal" in ('engagement', 'traffic', 'awareness', 'video_views', 'lead_generation', 'conversions', 'messages', 'app_promotion') and "ads_campaigns"."status" in ('active', 'paused', 'archived', 'deleted') and length("ads_campaigns"."name") between 1 and 200 and "ads_campaigns"."budget_amount" >= 0
    and ("ads_campaigns"."budget_type" is null or "ads_campaigns"."budget_type" in ('daily','lifetime')) and ("ads_campaigns"."budget_level" is null or "ads_campaigns"."budget_level" in ('campaign','adset'))
    and ("ads_campaigns"."budget_type" is distinct from 'lifetime' or "ads_campaigns"."end_date" is not null) and ("ads_campaigns"."start_date" is null or "ads_campaigns"."end_date" is null or "ads_campaigns"."end_date" >= "ads_campaigns"."start_date"))
);
--> statement-breakpoint
CREATE TABLE "ads_conversion_destinations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"kind" text DEFAULT 'pixel' NOT NULL,
	"name" text NOT NULL,
	"last_event_at" timestamp with time zone,
	"status" text DEFAULT 'unknown' NOT NULL,
	CONSTRAINT "ads_conversion_destinations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_conversion_destinations_shape" CHECK ("ads_conversion_destinations"."kind" in ('pixel','conversion_api','offline') and length("ads_conversion_destinations"."name") between 1 and 200 and "ads_conversion_destinations"."status" in ('unknown','active','inactive'))
);
--> statement-breakpoint
CREATE TABLE "ads_launch_requests" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"review_hash" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"validation" jsonb,
	"idempotency_key" uuid,
	"result_campaign_id" uuid,
	"result_ad_set_id" uuid,
	"result_ad_id" uuid,
	"error_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_launch_requests_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_launch_requests_shape" CHECK ("ads_launch_requests"."kind" in ('campaign','boost','add_ad') and "ads_launch_requests"."status" in ('draft','reviewed','launching','launched','failed','ambiguous','cancelled')
    and pg_column_size("ads_launch_requests"."payload") <= 65536 and ("ads_launch_requests"."status" not in ('reviewed','launching','launched','ambiguous') or "ads_launch_requests"."review_hash" is not null))
);
--> statement-breakpoint
CREATE TABLE "ads_lead_forms" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_ref" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"consent_text" text NOT NULL,
	"privacy_url" text NOT NULL,
	"questions" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_lead_forms_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_lead_forms_shape" CHECK (length("ads_lead_forms"."name") between 1 and 120 and length("ads_lead_forms"."consent_text") between 1 and 1000 and "ads_lead_forms"."status" in ('active','archived') and jsonb_typeof("ads_lead_forms"."questions") = 'array')
);
--> statement-breakpoint
CREATE TABLE "ads_leads" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"network" text NOT NULL,
	"lead_ref" text NOT NULL,
	"form_ref" text,
	"campaign_ref" text,
	"ad_ref" text,
	"status" text DEFAULT 'new' NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_text" text,
	"submitted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_leads_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_leads_shape" CHECK ("ads_leads"."status" in ('new', 'contacted', 'unreachable', 'qualified', 'converted', 'disqualified') and "ads_leads"."network" in ('meta', 'google', 'linkedin', 'tiktok', 'pinterest', 'x', 'reddit', 'microsoft', 'snapchat', 'amazon') and length("ads_leads"."lead_ref") between 1 and 200
    and jsonb_typeof("ads_leads"."fields") = 'object' and pg_column_size("ads_leads"."fields") <= 8192 and ("ads_leads"."consent_text" is null or length("ads_leads"."consent_text") <= 1000))
);
--> statement-breakpoint
CREATE TABLE "ads_operations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"op" text NOT NULL,
	"target_level" text,
	"target_id" uuid,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_operations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_operations_shape" CHECK ("ads_operations"."op" in ('status','bulk_status','rename','budget','delete') and "ads_operations"."status" in ('pending','applied','failed','ambiguous') and pg_column_size("ads_operations"."summary") <= 8192)
);
--> statement-breakpoint
CREATE TABLE "ads_results" (
	"tenant_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"level" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"day" date NOT NULL,
	"attribution_model" text DEFAULT 'default' NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"metrics" jsonb NOT NULL,
	CONSTRAINT "ads_results_tenant_id_level_entity_id_day_attribution_model_pk" PRIMARY KEY("tenant_id","level","entity_id","day","attribution_model"),
	CONSTRAINT "ads_results_shape" CHECK ("ads_results"."level" in ('campaign','adset','ad') and jsonb_typeof("ads_results"."metrics") = 'object'
    and "ads_results"."metrics" - array['spend','impressions','reach','clicks','ctr','cpc','cpm','results','costPerResult','conversions','leads'] = '{}'::jsonb
    and not jsonb_path_exists("ads_results"."metrics", '$.keyvalue() ? (@.value.type() != "number")'))
);
--> statement-breakpoint
CREATE TABLE "ads_rule_runs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"target_level" text NOT NULL,
	"target_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_rule_runs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_rule_runs_shape" CHECK ("ads_rule_runs"."outcome" in ('triggered','skipped','failed','source') and pg_column_size("ads_rule_runs"."detail") <= 2048)
);
--> statement-breakpoint
CREATE TABLE "ads_rules" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" text NOT NULL,
	"condition" jsonb NOT NULL,
	"action" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_rules_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_rules_shape" CHECK (length("ads_rules"."name") between 1 and 120 and "ads_rules"."level" in ('campaign','adset','ad') and "ads_rules"."action" in ('pause','notify') and pg_column_size("ads_rules"."condition") <= 1024)
);
--> statement-breakpoint
CREATE TABLE "ads_webhook_events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"external_account_ref" text NOT NULL,
	"subject_ref" text,
	"body_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_webhook_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_webhook_events_shape" CHECK (length("ads_webhook_events"."provider_event_id") between 1 and 200 and length("ads_webhook_events"."event_type") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "ads_accounts" ADD CONSTRAINT "ads_accounts_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_accounts" ADD CONSTRAINT "ads_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_accounts" ADD CONSTRAINT "ads_accounts_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_ad_sets" ADD CONSTRAINT "ads_ad_sets_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."ads_campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_ad_sets" ADD CONSTRAINT "ads_ad_sets_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_ads" ADD CONSTRAINT "ads_ads_ad_set_fk" FOREIGN KEY ("tenant_id","ad_set_id") REFERENCES "public"."ads_ad_sets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_ads" ADD CONSTRAINT "ads_ads_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."ads_campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_ads" ADD CONSTRAINT "ads_ads_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_alerts" ADD CONSTRAINT "ads_alerts_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_audiences" ADD CONSTRAINT "ads_audiences_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_campaigns" ADD CONSTRAINT "ads_campaigns_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_conversion_destinations" ADD CONSTRAINT "ads_conversion_destinations_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_launch_requests" ADD CONSTRAINT "ads_launch_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_launch_requests" ADD CONSTRAINT "ads_launch_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_launch_requests" ADD CONSTRAINT "ads_launch_requests_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_lead_forms" ADD CONSTRAINT "ads_lead_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_lead_forms" ADD CONSTRAINT "ads_lead_forms_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_leads" ADD CONSTRAINT "ads_leads_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_operations" ADD CONSTRAINT "ads_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_operations" ADD CONSTRAINT "ads_operations_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_results" ADD CONSTRAINT "ads_results_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_rule_runs" ADD CONSTRAINT "ads_rule_runs_rule_fk" FOREIGN KEY ("tenant_id","rule_id") REFERENCES "public"."ads_rules"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_rules" ADD CONSTRAINT "ads_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_rules" ADD CONSTRAINT "ads_rules_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ads_accounts_ref_idx" ON "ads_accounts" USING btree ("tenant_id","connection_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_ad_sets_ref_idx" ON "ads_ad_sets" USING btree ("tenant_id","ad_account_id","external_ref");--> statement-breakpoint
CREATE INDEX "ads_ad_sets_campaign_idx" ON "ads_ad_sets" USING btree ("tenant_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_ads_ref_idx" ON "ads_ads" USING btree ("tenant_id","ad_account_id","external_ref");--> statement-breakpoint
CREATE INDEX "ads_ads_ad_set_idx" ON "ads_ads" USING btree ("tenant_id","ad_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_alerts_open_idx" ON "ads_alerts" USING btree ("tenant_id","ad_account_id","dedupe_key") WHERE "ads_alerts"."state" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "ads_audiences_ref_idx" ON "ads_audiences" USING btree ("tenant_id","ad_account_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_campaigns_ref_idx" ON "ads_campaigns" USING btree ("tenant_id","ad_account_id","external_ref");--> statement-breakpoint
CREATE INDEX "ads_campaigns_account_idx" ON "ads_campaigns" USING btree ("tenant_id","ad_account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_conversion_destinations_ref_idx" ON "ads_conversion_destinations" USING btree ("tenant_id","ad_account_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_launch_requests_key_idx" ON "ads_launch_requests" USING btree ("tenant_id","idempotency_key") WHERE "ads_launch_requests"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "ads_launch_requests_account_idx" ON "ads_launch_requests" USING btree ("tenant_id","ad_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_lead_forms_ref_idx" ON "ads_lead_forms" USING btree ("tenant_id","ad_account_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_leads_ref_idx" ON "ads_leads" USING btree ("tenant_id","ad_account_id","lead_ref");--> statement-breakpoint
CREATE INDEX "ads_leads_status_idx" ON "ads_leads" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_operations_key_idx" ON "ads_operations" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ads_results_day_idx" ON "ads_results" USING btree ("day","tenant_id");--> statement-breakpoint
CREATE INDEX "ads_rule_runs_rule_idx" ON "ads_rule_runs" USING btree ("tenant_id","rule_id","ran_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_webhook_events_event_idx" ON "ads_webhook_events" USING btree ("tenant_id","provider","provider_event_id");--> statement-breakpoint
CREATE FUNCTION public.ads_can(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner','admin'))
$$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ads_accounts','ads_campaigns','ads_ad_sets','ads_ads','ads_results','ads_launch_requests','ads_operations','ads_lead_forms','ads_leads',
    'ads_audiences','ads_rules','ads_rule_runs','ads_alerts','ads_conversion_destinations','ads_webhook_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO harvest_app', t);
    EXECUTE format('CREATE POLICY ads_admin ON public.%I TO harvest_app USING (public.ads_can(tenant_id)) WITH CHECK (public.ads_can(tenant_id))', t);
    -- Only the SECURITY DEFINER functions below set this flag; the application role can never satisfy the guard.
    EXECUTE format('CREATE POLICY ads_definer ON public.%I TO PUBLIC USING (current_user <> ''harvest_app'' AND current_setting(''app.ads_definer'', true) = ''on'') WITH CHECK (current_user <> ''harvest_app'' AND current_setting(''app.ads_definer'', true) = ''on'')', t);
  END LOOP;
  -- Provider-derived history is append-only for the app role except where a person removes a record on purpose.
  REVOKE INSERT, UPDATE ON public.ads_webhook_events FROM harvest_app;
  GRANT DELETE ON public.ads_leads, public.ads_rules, public.ads_alerts, public.ads_launch_requests TO harvest_app;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.ads_webhook_apply(p_provider text, p_event_id text, p_type text, p_account_ref text, p_subject_ref text,
  p_body_hash text, p_occurred timestamptz, p_data jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a record; n integer; st text; inserted integer; lead_fields jsonb; consent text; form_ref text; rev text;
BEGIN
  IF p_provider IS NULL OR p_provider NOT IN ('zernio','fake') OR p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 200
    OR p_type IS NULL OR length(p_type) NOT BETWEEN 1 AND 80 OR p_account_ref IS NULL OR length(p_account_ref) NOT BETWEEN 1 AND 200
    OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR pg_column_size(p_data) > 16384 THEN RAISE EXCEPTION 'invalid ads event'; END IF;
  PERFORM set_config('app.ads_definer','on',true);
  PERFORM set_config('app.social_definer','on',true);
  SELECT count(*) INTO n FROM public.ads_accounts x JOIN public.social_connections c ON (c.tenant_id,c.id)=(x.tenant_id,x.connection_id)
    WHERE c.provider=p_provider AND x.external_ref=p_account_ref AND c.status <> 'revoked';
  IF n = 0 THEN RETURN 'unknown_account'; END IF;
  -- The same provider account under two ministries is never guessed at.
  IF n > 1 THEN RETURN 'ambiguous_account'; END IF;
  SELECT x.tenant_id, x.id, x.network INTO a FROM public.ads_accounts x JOIN public.social_connections c ON (c.tenant_id,c.id)=(x.tenant_id,x.connection_id)
    WHERE c.provider=p_provider AND x.external_ref=p_account_ref AND c.status <> 'revoked';
  PERFORM set_config('app.social_definer','',true);
  INSERT INTO public.ads_webhook_events(tenant_id,provider,provider_event_id,event_type,external_account_ref,subject_ref,body_hash,occurred_at)
    VALUES (a.tenant_id,p_provider,p_event_id,p_type,p_account_ref,left(p_subject_ref,200),p_body_hash,p_occurred) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN RETURN 'duplicate'; END IF;

  IF p_type = 'ad_account.status_changed' THEN
    st := p_data->>'status';
    IF st IN ('active','restricted','disabled','closed') THEN
      UPDATE public.ads_accounts SET status=st, version=version+1, updated_at=now() WHERE (tenant_id,id)=(a.tenant_id,a.id);
      IF st <> 'active' THEN
        INSERT INTO public.ads_alerts(tenant_id,ad_account_id,kind,severity,dedupe_key) VALUES (a.tenant_id,a.id,'account_restricted','critical','account:'||st) ON CONFLICT DO NOTHING;
      ELSE
        UPDATE public.ads_alerts SET state='resolved',resolved_at=now() WHERE (tenant_id,ad_account_id,kind,state)=(a.tenant_id,a.id,'account_restricted','open');
      END IF;
    END IF;
  ELSIF p_type = 'account.ads.sync_failed' THEN
    UPDATE public.ads_accounts SET sync_state='failing',updated_at=now() WHERE (tenant_id,id)=(a.tenant_id,a.id);
    INSERT INTO public.ads_alerts(tenant_id,ad_account_id,kind,severity,dedupe_key) VALUES (a.tenant_id,a.id,'sync_failed','warning','sync') ON CONFLICT DO NOTHING;
  ELSIF p_type IN ('account.ads.sync_recovered','account.ads.initial_sync_completed') THEN
    UPDATE public.ads_accounts SET sync_state='ready',updated_at=now() WHERE (tenant_id,id)=(a.tenant_id,a.id);
    UPDATE public.ads_alerts SET state='resolved',resolved_at=now() WHERE (tenant_id,ad_account_id,kind,state)=(a.tenant_id,a.id,'sync_failed','open');
  ELSIF p_type IN ('campaign.updated','ad_set.updated','ad.updated') AND p_subject_ref IS NOT NULL THEN
    st := p_data->>'status';
    IF st IN ('active','paused','archived','deleted') THEN
      IF p_type = 'campaign.updated' THEN UPDATE public.ads_campaigns SET status=st,version=version+1,updated_at=now() WHERE (tenant_id,ad_account_id,external_ref)=(a.tenant_id,a.id,p_subject_ref);
      ELSIF p_type = 'ad_set.updated' THEN UPDATE public.ads_ad_sets SET status=st,version=version+1,updated_at=now() WHERE (tenant_id,ad_account_id,external_ref)=(a.tenant_id,a.id,p_subject_ref);
      ELSE UPDATE public.ads_ads SET status=st,version=version+1,updated_at=now() WHERE (tenant_id,ad_account_id,external_ref)=(a.tenant_id,a.id,p_subject_ref); END IF;
    END IF;
  ELSIF p_type = 'ad.review_updated' AND p_subject_ref IS NOT NULL THEN
    rev := p_data->>'review';
    IF rev IN ('in_review','approved','rejected') THEN
      UPDATE public.ads_ads SET review_status=rev,review_reason=CASE WHEN rev='rejected' THEN left(p_data->>'reason',500) ELSE NULL END,version=version+1,updated_at=now()
        WHERE (tenant_id,ad_account_id,external_ref)=(a.tenant_id,a.id,p_subject_ref);
      IF rev = 'rejected' THEN
        INSERT INTO public.ads_alerts(tenant_id,ad_account_id,kind,severity,subject_level,subject_id,dedupe_key)
          SELECT a.tenant_id,a.id,'ad_rejected','warning','ad',x.id,'ad_rejected:'||x.id FROM public.ads_ads x WHERE (x.tenant_id,x.ad_account_id,x.external_ref)=(a.tenant_id,a.id,p_subject_ref) ON CONFLICT DO NOTHING;
      ELSE
        UPDATE public.ads_alerts al SET state='resolved',resolved_at=now() FROM public.ads_ads x
          WHERE (x.tenant_id,x.ad_account_id,x.external_ref)=(a.tenant_id,a.id,p_subject_ref) AND (al.tenant_id,al.ad_account_id,al.dedupe_key,al.state)=(a.tenant_id,a.id,'ad_rejected:'||x.id,'open');
      END IF;
    END IF;
  ELSIF p_type = 'ad.delivery_issue' AND p_subject_ref IS NOT NULL THEN
    UPDATE public.ads_ads SET delivery_issue=left(coalesce(p_data->>'issue','delivery_issue'),500),version=version+1,updated_at=now()
      WHERE (tenant_id,ad_account_id,external_ref)=(a.tenant_id,a.id,p_subject_ref);
    INSERT INTO public.ads_alerts(tenant_id,ad_account_id,kind,severity,subject_level,subject_id,dedupe_key)
      SELECT a.tenant_id,a.id,'delivery_issue','warning','ad',x.id,'delivery:'||x.id FROM public.ads_ads x WHERE (x.tenant_id,x.ad_account_id,x.external_ref)=(a.tenant_id,a.id,p_subject_ref) ON CONFLICT DO NOTHING;
  ELSIF p_type = 'lead.received' AND p_subject_ref IS NOT NULL THEN
    -- Stored as an ad-lead record only: no CRM contact is created and no consent is implied.
    lead_fields := CASE WHEN jsonb_typeof(p_data->'fields')='object' THEN p_data->'fields' ELSE '{}'::jsonb END;
    IF EXISTS (SELECT 1 FROM jsonb_each(lead_fields) e WHERE jsonb_typeof(e.value) <> 'string') OR pg_column_size(lead_fields) > 8192 THEN lead_fields := '{}'::jsonb; END IF;
    form_ref := p_data->>'formId';
    SELECT f.consent_text INTO consent FROM public.ads_lead_forms f WHERE (f.tenant_id,f.ad_account_id,f.external_ref)=(a.tenant_id,a.id,form_ref);
    INSERT INTO public.ads_leads(tenant_id,ad_account_id,network,lead_ref,form_ref,campaign_ref,ad_ref,fields,consent_text,submitted_at)
      VALUES (a.tenant_id,a.id,a.network,p_subject_ref,left(form_ref,200),left(p_data->>'campaignId',200),left(p_data->>'adId',200),lead_fields,consent,p_occurred) ON CONFLICT DO NOTHING;
  END IF;
  RETURN 'applied';
END $$;
--> statement-breakpoint
CREATE FUNCTION public.ads_results_prune(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE removed integer;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid ads prune batch'; END IF;
  PERFORM set_config('app.ads_definer','on',true);
  WITH old AS (SELECT tenant_id,level,entity_id,day,attribution_model FROM public.ads_results
    WHERE day < (now() at time zone 'UTC')::date - 400 ORDER BY day LIMIT p_limit FOR UPDATE SKIP LOCKED)
  DELETE FROM public.ads_results r USING old WHERE (r.tenant_id,r.level,r.entity_id,r.day,r.attribution_model)=(old.tenant_id,old.level,old.entity_id,old.day,old.attribution_model);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;
--> statement-breakpoint
-- Ad leads are personal data. Fixed 90-day retention, removed in bounded batches by the worker role only.
CREATE FUNCTION public.ads_leads_prune(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE removed integer;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid ads lead prune batch'; END IF;
  PERFORM set_config('app.ads_definer','on',true);
  WITH old AS (SELECT tenant_id,id FROM public.ads_leads WHERE created_at < now() - interval '90 days' ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  DELETE FROM public.ads_leads l USING old WHERE (l.tenant_id,l.id)=(old.tenant_id,old.id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;
--> statement-breakpoint
-- Rights path: removes every lead of the acting ministry whose email or phone answer matches the identifier. Owner or admin of the session's ministry only; returns a count, never the data.
CREATE FUNCTION public.ads_leads_erase_by_identifier(p_identifier text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE t uuid := nullif(current_setting('app.tenant_id', true), '')::uuid; ident text; digits text; removed integer;
BEGIN
  IF t IS NULL OR NOT public.ads_can(t) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
  ident := lower(btrim(coalesce(p_identifier,'')));
  IF length(ident) NOT BETWEEN 3 AND 320 THEN RAISE EXCEPTION 'invalid identifier'; END IF;
  digits := regexp_replace(ident, '[^0-9]', '', 'g');
  PERFORM set_config('app.ads_definer','on',true);
  DELETE FROM public.ads_leads l WHERE l.tenant_id = t AND EXISTS (
    SELECT 1 FROM jsonb_each_text(l.fields) f WHERE f.key IN ('email','phone','phone_number','email_address')
      AND (lower(btrim(f.value)) = ident OR (length(digits) >= 7 AND regexp_replace(f.value, '[^0-9]', '', 'g') = digits)));
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM set_config('app.ads_definer','',true);
  RETURN removed;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ads_can(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ads_can(uuid) TO harvest_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ads_webhook_apply(text,text,text,text,text,text,timestamptz,jsonb), public.ads_results_prune(integer), public.ads_leads_prune(integer), public.ads_leads_erase_by_identifier(text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.ads_results_prune(integer), public.ads_leads_prune(integer) TO harvest_worker;
  END IF;
  -- The public webhook route runs as the application role: it may call only the idempotent event function.
  GRANT EXECUTE ON FUNCTION public.ads_webhook_apply(text,text,text,text,text,text,timestamptz,jsonb), public.ads_leads_erase_by_identifier(text) TO harvest_app;
END $$;
