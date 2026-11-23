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
--> statement-breakpoint
-- The ministry default brand kit. Owners and admins (the newsletter campaign capability) read and write their own ministry's row only; nothing else reaches it.
ALTER TABLE public.newsletter_brand_kits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.newsletter_brand_kits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.newsletter_brand_kits FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker') THEN
    REVOKE ALL ON public.newsletter_brand_kits FROM harvest_worker;
  END IF;
END $$;
--> statement-breakpoint
CREATE POLICY newsletter_admin ON public.newsletter_brand_kits TO harvest_app
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
    SELECT FROM public.workspace_members m WHERE m.tenant_id=newsletter_brand_kits.tenant_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'') AND public.newsletter_capability(m.role_id,'newsletter:campaigns')))
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
    SELECT FROM public.workspace_members m WHERE m.tenant_id=newsletter_brand_kits.tenant_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'') AND public.newsletter_capability(m.role_id,'newsletter:campaigns')));
--> statement-breakpoint
GRANT SELECT, INSERT ON public.newsletter_brand_kits TO harvest_app;
--> statement-breakpoint
GRANT UPDATE (kit, version, updated_at) ON public.newsletter_brand_kits TO harvest_app;
