CREATE TABLE "newsletter_brand_kits" (
	"tenant_id" uuid NOT NULL,
	"kit" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_brand_kits_tenant_id_pk" PRIMARY KEY("tenant_id"),
	CONSTRAINT "newsletter_brand_kit_object" CHECK (jsonb_typeof("newsletter_brand_kits"."kit")='object' AND pg_column_size("newsletter_brand_kits"."kit")<=4096)
);
--> statement-breakpoint
ALTER TABLE "newsletter_brand_kits" ADD CONSTRAINT "newsletter_brand_kits_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;