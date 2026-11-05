CREATE TABLE "companies" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))) STORED NOT NULL,
	"domain" text,
	"description" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "company_name_length" CHECK (length(btrim("companies"."name")) between 1 and 100 and "companies"."name" = btrim("companies"."name")),
	CONSTRAINT "company_description_length" CHECK (length("companies"."description") <= 2000),
	CONSTRAINT "company_domain_format" CHECK ("companies"."domain" is null or (length("companies"."domain") <= 253 and "companies"."domain" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$')),
	CONSTRAINT "company_version" CHECK ("companies"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "contact_company_links" (
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_company_links_tenant_id_contact_id_company_id_pk" PRIMARY KEY("tenant_id","contact_id","company_id"),
	CONSTRAINT "company_link_title_length" CHECK (length("contact_company_links"."title") <= 100 and "contact_company_links"."title" = btrim("contact_company_links"."title"))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "normalized_name" text GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_links" ADD CONSTRAINT "contact_company_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_links" ADD CONSTRAINT "contact_company_links_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_company_links" ADD CONSTRAINT "contact_company_links_tenant_id_company_id_companies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_tenant_domain_idx" ON "companies" USING btree ("tenant_id","domain") WHERE "companies"."domain" is not null;--> statement-breakpoint
CREATE INDEX "companies_tenant_name_idx" ON "companies" USING btree ("tenant_id","normalized_name","id");--> statement-breakpoint
CREATE INDEX "companies_tenant_created_idx" ON "companies" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_links_one_primary_idx" ON "contact_company_links" USING btree ("tenant_id","contact_id") WHERE "contact_company_links"."is_primary";--> statement-breakpoint
CREATE INDEX "company_links_tenant_company_idx" ON "contact_company_links" USING btree ("tenant_id","company_id","contact_id");--> statement-breakpoint
CREATE INDEX "contacts_tenant_normalized_name_idx" ON "contacts" USING btree ("tenant_id","normalized_name");--> statement-breakpoint
CREATE INDEX "contacts_tenant_created_idx" ON "contacts" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contact_version" CHECK ("contacts"."version" >= 1);