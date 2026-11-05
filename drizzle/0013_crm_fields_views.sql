CREATE TABLE "crm_field_definitions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"object_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relation_target" text,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_field_definitions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_field_object_type" CHECK ("crm_field_definitions"."object_type" in ('person', 'company')),
	CONSTRAINT "crm_field_type" CHECK ("crm_field_definitions"."type" in ('text', 'number', 'date', 'boolean', 'select', 'multi_select', 'relation')),
	CONSTRAINT "crm_field_key" CHECK ("crm_field_definitions"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "crm_field_label" CHECK (length(btrim("crm_field_definitions"."label")) between 1 and 60 and "crm_field_definitions"."label" = btrim("crm_field_definitions"."label")),
	CONSTRAINT "crm_field_description" CHECK (length("crm_field_definitions"."description") <= 280),
	CONSTRAINT "crm_field_relation_target" CHECK (("crm_field_definitions"."type" = 'relation') = ("crm_field_definitions"."relation_target" is not null) and ("crm_field_definitions"."relation_target" is null or "crm_field_definitions"."relation_target" in ('person', 'company'))),
	CONSTRAINT "crm_field_options" CHECK (jsonb_typeof("crm_field_definitions"."options") = 'array' and jsonb_array_length("crm_field_definitions"."options") <= 50 and ("crm_field_definitions"."type" in ('select', 'multi_select')) = (jsonb_array_length("crm_field_definitions"."options") > 0)),
	CONSTRAINT "crm_field_version" CHECK ("crm_field_definitions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "crm_field_values" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"value_text" text,
	"value_number" double precision,
	"value_date" date,
	"value_boolean" boolean,
	"value_options" text[],
	"relation_contact_id" uuid,
	"relation_company_id" uuid,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_field_values_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_value_record" CHECK (("crm_field_values"."object_type" = 'person' and "crm_field_values"."contact_id" is not null and "crm_field_values"."company_id" is null) or ("crm_field_values"."object_type" = 'company' and "crm_field_values"."company_id" is not null and "crm_field_values"."contact_id" is null)),
	CONSTRAINT "crm_value_single" CHECK (num_nonnulls("crm_field_values"."value_text", "crm_field_values"."value_number", "crm_field_values"."value_date", "crm_field_values"."value_boolean", "crm_field_values"."value_options", "crm_field_values"."relation_contact_id", "crm_field_values"."relation_company_id") = 1),
	CONSTRAINT "crm_value_text_length" CHECK ("crm_field_values"."value_text" is null or length("crm_field_values"."value_text") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "crm_saved_views" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"object_type" text NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text,
	"state" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_saved_views_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_view_object_type" CHECK ("crm_saved_views"."object_type" in ('person', 'company')),
	CONSTRAINT "crm_view_name" CHECK (length(btrim("crm_saved_views"."name")) between 1 and 60 and "crm_saved_views"."name" = btrim("crm_saved_views"."name")),
	CONSTRAINT "crm_view_state" CHECK (jsonb_typeof("crm_saved_views"."state") = 'object' and octet_length("crm_saved_views"."state"::text) <= 16384),
	CONSTRAINT "crm_view_version" CHECK ("crm_saved_views"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "crm_field_definitions" ADD CONSTRAINT "crm_field_definitions_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_field_definitions" ADD CONSTRAINT "crm_field_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The composite (tenant, field, object type) FK below needs this unique index first.
CREATE UNIQUE INDEX "crm_fields_tenant_id_object_idx" ON "crm_field_definitions" USING btree ("tenant_id","id","object_type");--> statement-breakpoint
ALTER TABLE "crm_field_values" ADD CONSTRAINT "crm_field_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_field_values" ADD CONSTRAINT "crm_field_values_tenant_id_field_id_object_type_crm_field_definitions_tenant_id_id_object_type_fk" FOREIGN KEY ("tenant_id","field_id","object_type") REFERENCES "public"."crm_field_definitions"("tenant_id","id","object_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_field_values" ADD CONSTRAINT "crm_field_values_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_field_values" ADD CONSTRAINT "crm_field_values_tenant_id_company_id_companies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_field_values" ADD CONSTRAINT "crm_field_values_tenant_id_relation_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","relation_contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_field_values" ADD CONSTRAINT "crm_field_values_tenant_id_relation_company_id_companies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","relation_company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_fields_tenant_object_key_idx" ON "crm_field_definitions" USING btree ("tenant_id","object_type","key");--> statement-breakpoint
CREATE INDEX "crm_fields_tenant_object_position_idx" ON "crm_field_definitions" USING btree ("tenant_id","object_type","position");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_values_contact_field_idx" ON "crm_field_values" USING btree ("tenant_id","contact_id","field_id") WHERE "crm_field_values"."contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_values_company_field_idx" ON "crm_field_values" USING btree ("tenant_id","company_id","field_id") WHERE "crm_field_values"."company_id" is not null;--> statement-breakpoint
CREATE INDEX "crm_values_tenant_field_idx" ON "crm_field_values" USING btree ("tenant_id","field_id");--> statement-breakpoint
CREATE INDEX "crm_values_relation_contact_idx" ON "crm_field_values" USING btree ("tenant_id","relation_contact_id") WHERE "crm_field_values"."relation_contact_id" is not null;--> statement-breakpoint
CREATE INDEX "crm_views_tenant_object_idx" ON "crm_saved_views" USING btree ("tenant_id","object_type","owner_user_id");