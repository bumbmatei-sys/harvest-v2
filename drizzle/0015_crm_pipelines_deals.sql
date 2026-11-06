CREATE TABLE "crm_pipeline_stages" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'open' NOT NULL,
	"probability" integer,
	"color" text DEFAULT 'neutral' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_pipeline_stages_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_stage_key" CHECK ("crm_pipeline_stages"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "crm_stage_name" CHECK (length(btrim("crm_pipeline_stages"."name")) between 1 and 60 and "crm_pipeline_stages"."name" = btrim("crm_pipeline_stages"."name")),
	CONSTRAINT "crm_stage_kind" CHECK ("crm_pipeline_stages"."kind" in ('open', 'won', 'lost')),
	CONSTRAINT "crm_stage_probability" CHECK ("crm_pipeline_stages"."probability" is null or "crm_pipeline_stages"."probability" between 0 and 100),
	CONSTRAINT "crm_stage_color" CHECK ("crm_pipeline_stages"."color" in ('neutral', 'primary', 'success', 'warning', 'destructive')),
	CONSTRAINT "crm_stage_version" CHECK ("crm_pipeline_stages"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "crm_pipelines" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_pipelines_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_pipeline_name" CHECK (length(btrim("crm_pipelines"."name")) between 1 and 60 and "crm_pipelines"."name" = btrim("crm_pipelines"."name")),
	CONSTRAINT "crm_pipeline_default_live" CHECK (not ("crm_pipelines"."is_default" and "crm_pipelines"."archived_at" is not null)),
	CONSTRAINT "crm_pipeline_version" CHECK ("crm_pipelines"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"amount" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"expected_close_date" date,
	"owner_user_id" text,
	"company_id" uuid,
	"contact_id" uuid,
	"position" double precision DEFAULT 0 NOT NULL,
	"closed_reason" text,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "opportunity_name" CHECK (length(btrim("opportunities"."name")) between 1 and 200 and "opportunities"."name" = btrim("opportunities"."name")),
	CONSTRAINT "opportunity_amount" CHECK ("opportunities"."amount" is null or ("opportunities"."amount" >= 0 and "opportunities"."amount" < 1000000000000)),
	CONSTRAINT "opportunity_currency" CHECK ("opportunities"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "opportunity_closed_reason" CHECK ("opportunities"."closed_reason" is null or length("opportunities"."closed_reason") between 1 and 500),
	CONSTRAINT "opportunity_version" CHECK ("opportunities"."version" >= 1)
);
--> statement-breakpoint
-- The composite (tenant, pipeline, stage) FK on opportunities below needs this unique index first.
CREATE UNIQUE INDEX "crm_stages_tenant_pipeline_id_idx" ON "crm_pipeline_stages" USING btree ("tenant_id","pipeline_id","id");--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_tenant_id_pipeline_id_crm_pipelines_tenant_id_id_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."crm_pipelines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_pipeline_id_crm_pipelines_tenant_id_id_fk" FOREIGN KEY ("tenant_id","pipeline_id") REFERENCES "public"."crm_pipelines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_pipeline_id_stage_id_crm_pipeline_stages_tenant_id_pipeline_id_id_fk" FOREIGN KEY ("tenant_id","pipeline_id","stage_id") REFERENCES "public"."crm_pipeline_stages"("tenant_id","pipeline_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_company_id_companies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_stages_pipeline_key_idx" ON "crm_pipeline_stages" USING btree ("tenant_id","pipeline_id","key");--> statement-breakpoint
CREATE INDEX "crm_stages_pipeline_position_idx" ON "crm_pipeline_stages" USING btree ("tenant_id","pipeline_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipelines_one_default_idx" ON "crm_pipelines" USING btree ("tenant_id") WHERE "crm_pipelines"."is_default" and "crm_pipelines"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "crm_pipelines_tenant_position_idx" ON "crm_pipelines" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE INDEX "opportunities_board_idx" ON "opportunities" USING btree ("tenant_id","pipeline_id","stage_id","position");--> statement-breakpoint
CREATE INDEX "opportunities_company_idx" ON "opportunities" USING btree ("tenant_id","company_id") WHERE "opportunities"."company_id" is not null;--> statement-breakpoint
CREATE INDEX "opportunities_contact_idx" ON "opportunities" USING btree ("tenant_id","contact_id") WHERE "opportunities"."contact_id" is not null;