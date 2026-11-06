CREATE TABLE "crm_import_rows" (
	"tenant_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"match_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"action" text,
	"error" text,
	"warning" text,
	"contact_id" uuid,
	"company_id" uuid,
	"created" boolean DEFAULT false NOT NULL,
	"applied" jsonb,
	"result_version" integer,
	CONSTRAINT "crm_import_rows_tenant_id_import_id_row_number_pk" PRIMARY KEY("tenant_id","import_id","row_number"),
	CONSTRAINT "crm_import_row_number" CHECK ("crm_import_rows"."row_number" between 1 and 5000),
	CONSTRAINT "crm_import_row_status" CHECK ("crm_import_rows"."status" in ('pending', 'ready', 'done', 'error', 'skipped', 'rolled_back')),
	CONSTRAINT "crm_import_row_action" CHECK ("crm_import_rows"."action" is null or "crm_import_rows"."action" in ('create', 'update', 'skip', 'error', 'conflict')),
	CONSTRAINT "crm_import_row_raw" CHECK (jsonb_typeof("crm_import_rows"."raw") = 'array' and octet_length("crm_import_rows"."raw"::text) <= 20000),
	CONSTRAINT "crm_import_row_codes" CHECK (("crm_import_rows"."error" is null or length("crm_import_rows"."error") <= 80) and ("crm_import_rows"."warning" is null or length("crm_import_rows"."warning") <= 80))
);
--> statement-breakpoint
CREATE TABLE "crm_imports" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"client_key" uuid NOT NULL,
	"file_name" text NOT NULL,
	"headers" jsonb NOT NULL,
	"mapping" jsonb NOT NULL,
	"on_match" text DEFAULT 'skip' NOT NULL,
	"row_count" integer NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previewed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	CONSTRAINT "crm_imports_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_import_entity" CHECK ("crm_imports"."entity" in ('person', 'company')),
	CONSTRAINT "crm_import_status" CHECK ("crm_imports"."status" in ('draft', 'preview', 'running', 'completed', 'failed', 'rolled_back')),
	CONSTRAINT "crm_import_on_match" CHECK ("crm_imports"."on_match" in ('skip', 'fill')),
	CONSTRAINT "crm_import_rows_bound" CHECK ("crm_imports"."row_count" between 1 and 5000),
	CONSTRAINT "crm_import_file_name" CHECK (length(btrim("crm_imports"."file_name")) between 1 and 200),
	CONSTRAINT "crm_import_shape" CHECK (jsonb_typeof("crm_imports"."headers") = 'array' and jsonb_typeof("crm_imports"."mapping") = 'array' and jsonb_array_length("crm_imports"."headers") between 1 and 100 and jsonb_array_length("crm_imports"."mapping") = jsonb_array_length("crm_imports"."headers")),
	CONSTRAINT "crm_import_version" CHECK ("crm_imports"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "crm_import_rows" ADD CONSTRAINT "crm_import_rows_tenant_id_import_id_crm_imports_tenant_id_id_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."crm_imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_import_rows" ADD CONSTRAINT "crm_import_rows_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_import_rows" ADD CONSTRAINT "crm_import_rows_tenant_id_company_id_companies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_imports" ADD CONSTRAINT "crm_imports_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_imports" ADD CONSTRAINT "crm_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_import_rows_status_idx" ON "crm_import_rows" USING btree ("tenant_id","import_id","status","row_number");--> statement-breakpoint
CREATE INDEX "crm_import_rows_contact_idx" ON "crm_import_rows" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "crm_import_rows_company_idx" ON "crm_import_rows" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "crm_import_rows_keys_idx" ON "crm_import_rows" USING gin ("match_keys");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_imports_client_key_idx" ON "crm_imports" USING btree ("tenant_id","client_key");--> statement-breakpoint
CREATE INDEX "crm_imports_tenant_created_idx" ON "crm_imports" USING btree ("tenant_id","created_at","id");