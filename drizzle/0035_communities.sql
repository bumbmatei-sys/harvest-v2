CREATE TABLE "communities" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'hidden' NOT NULL,
	"pricing" text DEFAULT 'free' NOT NULL,
	"allow_open" boolean DEFAULT false NOT NULL,
	"allow_apply" boolean DEFAULT false NOT NULL,
	"allow_invite" boolean DEFAULT true NOT NULL,
	"allow_entitlement" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communities_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "community_slug" CHECK ("communities"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$' and "communities"."slug" not in ('new', 'discover', 'search', 'create', 'settings', 'admin', 'api', 'me', 'account')),
	CONSTRAINT "community_name" CHECK (length("communities"."name") between 1 and 80),
	CONSTRAINT "community_tagline" CHECK ("communities"."tagline" is null or length("communities"."tagline") between 1 and 160),
	CONSTRAINT "community_status" CHECK ("communities"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "community_visibility" CHECK ("communities"."visibility" in ('listed', 'unlisted', 'hidden')),
	CONSTRAINT "community_pricing" CHECK ("communities"."pricing" in ('free', 'paid')),
	CONSTRAINT "community_version" CHECK ("communities"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "community_memberships" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_memberships_tenant_id_community_id_user_id_pk" PRIMARY KEY("tenant_id","community_id","user_id"),
	CONSTRAINT "community_membership_role" CHECK ("community_memberships"."role" in ('owner', 'admin', 'moderator', 'contributor', 'member')),
	CONSTRAINT "community_membership_status" CHECK ("community_memberships"."status" in ('active', 'pending', 'banned', 'left', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"tier" text,
	"source" text NOT NULL,
	"granted_by" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "entitlement_resource_type" CHECK ("entitlements"."resource_type" in ('community')),
	CONSTRAINT "entitlement_source" CHECK ("entitlements"."source" in ('community_free_join', 'admin_grant', 'invitation', 'product_purchase', 'bundle', 'subscription')),
	CONSTRAINT "entitlement_window" CHECK ("entitlements"."valid_until" is null or "entitlements"."valid_until" > "entitlements"."valid_from"),
	CONSTRAINT "entitlement_tier" CHECK ("entitlements"."tier" is null or length("entitlements"."tier") between 1 and 80),
	CONSTRAINT "entitlement_reason" CHECK ("entitlements"."reason" is null or length("entitlements"."reason") between 1 and 200),
	CONSTRAINT "entitlement_revocation" CHECK ("entitlements"."revoked_by" is null or "entitlements"."revoked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT "workspace_audience";--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "communities_slug_idx" ON "communities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "community_memberships_user_idx" ON "community_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "entitlements_subject_idx" ON "entitlements" USING btree ("user_id","resource_type","resource_id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspace_audience" CHECK ("workspaces"."audience" is null or "workspaces"."audience" in ('church', 'ministry_nonprofit', 'evangelist_missionary', 'creator'));--> statement-breakpoint
-- ADR 0013: two-path RLS. Staff reach rows of their own ministry (app.tenant_id, set by withTenant after a
-- ministry-role check). Members reach a community only through their own ACTIVE membership (app.user_id).
-- No DELETE anywhere: communities archive, memberships change status, grants are revoked.
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['communities','community_memberships','entitlements'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', relation_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO harvest_app', relation_name);
  EXECUTE format($p$CREATE POLICY %I ON public.%I TO harvest_app
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, relation_name || '_staff', relation_name);
 END LOOP;
END $$;
--> statement-breakpoint
CREATE POLICY community_memberships_own ON public.community_memberships FOR SELECT TO harvest_app
  USING (user_id = nullif(current_setting('app.user_id', true), ''));
--> statement-breakpoint
CREATE POLICY entitlements_own ON public.entitlements FOR SELECT TO harvest_app
  USING (user_id = nullif(current_setting('app.user_id', true), ''));
--> statement-breakpoint
CREATE POLICY communities_member ON public.communities FOR SELECT TO harvest_app
  USING (EXISTS (SELECT 1 FROM public.community_memberships m
    WHERE m.tenant_id = communities.tenant_id AND m.community_id = communities.id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.status = 'active'));
