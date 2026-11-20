CREATE TABLE "catalog_enrolments" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_enrolments_tenant_id_item_id_user_id_pk" PRIMARY KEY("tenant_id","item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_files" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text DEFAULT 'download' NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "catalog_files_tenant_id_item_id_file_id_pk" PRIMARY KEY("tenant_id","item_id","file_id"),
	CONSTRAINT "catalog_files_tenant_id_item_id_position_unique" UNIQUE("tenant_id","item_id","position"),
	CONSTRAINT "catalog_file_kind" CHECK ("catalog_files"."kind" = 'download'),
	CONSTRAINT "catalog_file_position" CHECK ("catalog_files"."position" between 0 and 19)
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'hidden' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "catalog_items_slug_unique" UNIQUE("slug"),
	CONSTRAINT "catalog_items_tenant_id_id_kind_unique" UNIQUE("tenant_id","id","kind"),
	CONSTRAINT "catalog_item_kind" CHECK ("catalog_items"."kind" in ('course','download')),
	CONSTRAINT "catalog_item_state" CHECK ("catalog_items"."state" in ('draft','published','archived')),
	CONSTRAINT "catalog_item_visibility" CHECK ("catalog_items"."visibility" in ('hidden','unlisted','listed')),
	CONSTRAINT "catalog_item_publication" CHECK ("catalog_items"."state" <> 'published' or "catalog_items"."visibility" <> 'hidden'),
	CONSTRAINT "catalog_item_slug" CHECK ("catalog_items"."slug" ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
	CONSTRAINT "catalog_item_title" CHECK (length(trim("catalog_items"."title")) between 1 and 120),
	CONSTRAINT "catalog_item_summary" CHECK (length("catalog_items"."summary") <= 2000),
	CONSTRAINT "catalog_item_version" CHECK ("catalog_items"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_lessons" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'course' NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"published" boolean NOT NULL,
	CONSTRAINT "catalog_lessons_tenant_id_item_id_id_pk" PRIMARY KEY("tenant_id","item_id","id"),
	CONSTRAINT "catalog_lessons_tenant_id_item_id_position_unique" UNIQUE("tenant_id","item_id","position"),
	CONSTRAINT "catalog_lesson_kind" CHECK ("catalog_lessons"."kind" = 'course'),
	CONSTRAINT "catalog_lesson_position" CHECK ("catalog_lessons"."position" between 0 and 49),
	CONSTRAINT "catalog_lesson_title" CHECK (length(trim("catalog_lessons"."title")) between 1 and 120),
	CONSTRAINT "catalog_lesson_body" CHECK (jsonb_typeof("catalog_lessons"."body") = 'object' and octet_length("catalog_lessons"."body"::text) <= 32000)
);
--> statement-breakpoint
CREATE TABLE "community_product_links" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "community_product_links_tenant_id_community_id_item_id_pk" PRIMARY KEY("tenant_id","community_id","item_id"),
	CONSTRAINT "community_product_position" CHECK ("community_product_links"."position" between 0 and 1000)
);
--> statement-breakpoint
ALTER TABLE "entitlements" DROP CONSTRAINT "entitlement_resource_type";--> statement-breakpoint
ALTER TABLE "entitlements" DROP CONSTRAINT "entitlement_source";--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "catalog_item_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_enrolments" ADD CONSTRAINT "catalog_enrolments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_enrolments" ADD CONSTRAINT "catalog_enrolments_tenant_id_item_id_catalog_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_files" ADD CONSTRAINT "catalog_files_tenant_id_item_id_kind_catalog_items_tenant_id_id_kind_fk" FOREIGN KEY ("tenant_id","item_id","kind") REFERENCES "public"."catalog_items"("tenant_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "catalog_files" ADD CONSTRAINT "catalog_files_tenant_id_file_id_files_tenant_id_id_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_lessons" ADD CONSTRAINT "catalog_lessons_tenant_id_item_id_kind_catalog_items_tenant_id_id_kind_fk" FOREIGN KEY ("tenant_id","item_id","kind") REFERENCES "public"."catalog_items"("tenant_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_product_links" ADD CONSTRAINT "community_product_links_tenant_id_item_id_catalog_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_product_links" ADD CONSTRAINT "community_product_links_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_tenant_id_catalog_item_id_user_id_catalog_enrolments_tenant_id_item_id_user_id_fk" FOREIGN KEY ("tenant_id","catalog_item_id","user_id") REFERENCES "public"."catalog_enrolments"("tenant_id","item_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_free_enrolment_idx" ON "entitlements" USING btree ("tenant_id","catalog_item_id","user_id") WHERE "entitlements"."source" = 'free_enrolment';--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlement_catalog_link" CHECK (("entitlements"."resource_type" = 'community' and "entitlements"."catalog_item_id" is null and "entitlements"."source" <> 'free_enrolment') or
    ("entitlements"."resource_type" in ('course','product') and "entitlements"."catalog_item_id" is not null and "entitlements"."catalog_item_id" = "entitlements"."resource_id" and "entitlements"."source" = 'free_enrolment'));--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlement_resource_type" CHECK ("entitlements"."resource_type" in ('community','course','product'));--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlement_source" CHECK ("entitlements"."source" in ('community_free_join', 'admin_grant', 'invitation', 'application', 'product_purchase', 'bundle', 'subscription', 'free_enrolment'));
--> statement-breakpoint
-- The app sees metadata in its verified ministry. Only its owner/admin can read editor content or change it.
CREATE FUNCTION public.catalog_staff(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=p_tenant
      AND m.user_id=nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner','admin'))
$$;
REVOKE ALL ON FUNCTION public.catalog_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_staff(uuid) TO harvest_app;

DO $$ DECLARE rel text; BEGIN
  FOREACH rel IN ARRAY ARRAY['catalog_items','catalog_lessons','catalog_files','catalog_enrolments','community_product_links'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', rel);
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['catalog_items','catalog_lessons','catalog_files','community_product_links'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO harvest_app', rel);
    EXECUTE format('CREATE POLICY catalog_staff_write ON public.%I TO harvest_app USING (public.catalog_staff(tenant_id)) WITH CHECK (public.catalog_staff(tenant_id))', rel);
  END LOOP;
  GRANT DELETE ON public.catalog_lessons, public.catalog_files, public.community_product_links TO harvest_app;
  FOREACH rel IN ARRAY ARRAY['catalog_lessons','catalog_files','catalog_enrolments'] LOOP
    EXECUTE format($p$CREATE POLICY catalog_resolver_scope ON public.%I TO %I
      USING (tenant_id=nullif(current_setting('app.catalog_tenant', true), '')::uuid)
      WITH CHECK (tenant_id=nullif(current_setting('app.catalog_tenant', true), '')::uuid)$p$, rel, current_user);
  END LOOP;
  EXECUTE format($p$CREATE POLICY catalog_resolver_item ON public.catalog_items FOR SELECT TO %I
    USING (slug=nullif(current_setting('app.catalog_slug', true), '')
      OR tenant_id=nullif(current_setting('app.catalog_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY catalog_resolver_lock ON public.catalog_items FOR UPDATE TO %I
    USING (slug=nullif(current_setting('app.catalog_slug', true), '')) WITH CHECK (false)$p$, current_user);
  EXECUTE format($p$CREATE POLICY catalog_resolver_entitlement ON public.entitlements TO %I
    USING (resource_type IN ('course','product') AND tenant_id=nullif(current_setting('app.catalog_tenant',true),'')::uuid)
    WITH CHECK (resource_type IN ('course','product') AND tenant_id=nullif(current_setting('app.catalog_tenant',true),'')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY catalog_resolver_file ON public.files FOR SELECT TO %I
    USING (tenant_id=nullif(current_setting('app.catalog_tenant',true),'')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY catalog_resolver_audit ON public.audit_logs FOR INSERT TO %I
    WITH CHECK (tenant_id=nullif(current_setting('app.catalog_tenant',true),'')::uuid AND action='catalog.enrol')$p$, current_user);
END $$;

CREATE POLICY catalog_metadata ON public.catalog_items FOR SELECT TO harvest_app
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=catalog_items.tenant_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'')
  ));
ALTER POLICY entitlements_staff ON public.entitlements
  USING (resource_type='community' AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (resource_type='community' AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER POLICY community_definer_tenant ON public.entitlements
  USING (resource_type='community' AND tenant_id=nullif(current_setting('app.community_definer_tenant',true),'')::uuid)
  WITH CHECK (resource_type='community' AND tenant_id=nullif(current_setting('app.community_definer_tenant',true),'')::uuid);

CREATE OR REPLACE FUNCTION public.entitlements_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.resource_type = 'community' AND NOT EXISTS (
    SELECT FROM public.communities c WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.resource_id) THEN
    RAISE EXCEPTION 'entitlement resource must belong to the same ministry' USING ERRCODE = '23503';
  END IF;
  IF NEW.resource_type IN ('course','product') AND NOT EXISTS (
    SELECT FROM public.catalog_items i WHERE i.tenant_id=NEW.tenant_id AND i.id=NEW.resource_id
      AND (CASE WHEN i.kind='course' THEN 'course' ELSE 'product' END)=NEW.resource_type) THEN
    RAISE EXCEPTION 'entitlement resource must match its catalogue item' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'entitlement revocation is final' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- One public projection, and separate identity-bound operations. Private storage keys only leave
-- this function for a ready linked file after a valid grant; the HTTP layer signs the key.
CREATE FUNCTION public.catalog_access(p_slug text, p_action text, p_file uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE item public.catalog_items%ROWTYPE;
  actor text := nullif(current_setting('app.user_id',true),'');
  resource_type text;
  metadata jsonb;
  result jsonb;
BEGIN
  PERFORM set_config('app.catalog_tenant','',true);
  <<resolve>>
  BEGIN
    IF p_action IS NULL OR p_action NOT IN ('metadata','enrol','content','file') OR
       (p_action <> 'metadata' AND actor IS NULL) THEN EXIT resolve; END IF;

    PERFORM set_config('app.catalog_slug',coalesce(p_slug,''),true);
    -- Authoring takes an exclusive row lock before editing children and publishing. The share
    -- lock keeps publication and access coherent with concurrent enrollment and file selection.
    SELECT * INTO item FROM public.catalog_items i
      WHERE i.slug=p_slug AND i.state='published' AND i.visibility IN ('listed','unlisted') FOR SHARE;
    IF NOT FOUND THEN EXIT resolve; END IF;
    metadata := jsonb_build_object('slug',item.slug,'title',item.title,'summary',item.summary,'kind',item.kind);
    IF p_action='metadata' THEN result := metadata; EXIT resolve; END IF;

    PERFORM set_config('app.catalog_tenant',item.tenant_id::text,true);
    resource_type := CASE WHEN item.kind='course' THEN 'course' ELSE 'product' END;
    IF p_action='enrol' THEN
      INSERT INTO public.catalog_enrolments(tenant_id,item_id,user_id) VALUES(item.tenant_id,item.id,actor)
        ON CONFLICT DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.entitlements(tenant_id,user_id,resource_type,resource_id,catalog_item_id,source)
          VALUES(item.tenant_id,actor,resource_type,item.id,item.id,'free_enrolment');
        INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id)
          VALUES(item.tenant_id,actor,'catalog.enrol',item.id::text);
      END IF;
    END IF;

    IF NOT EXISTS (SELECT FROM public.entitlements e WHERE e.tenant_id=item.tenant_id
      AND e.catalog_item_id=item.id AND e.user_id=actor AND e.revoked_at IS NULL AND e.valid_from<=now()
      AND (e.valid_until IS NULL OR e.valid_until>now())) THEN EXIT resolve; END IF;
    IF p_action='enrol' THEN result := jsonb_build_object('enrolled',true); EXIT resolve; END IF;
    IF p_action='file' THEN
      result := (SELECT jsonb_build_object('key',f.key,'name',f.name)
        FROM public.catalog_files l JOIN public.files f ON f.tenant_id=l.tenant_id AND f.id=l.file_id
        WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND l.file_id=p_file
          AND f.visibility='private' AND f.status='ready');
      EXIT resolve;
    END IF;
    result := metadata || jsonb_build_object(
      'lessons', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'body',l.body) ORDER BY l.position),'[]'::jsonb)
        FROM public.catalog_lessons l WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND l.published),
      'files', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) ORDER BY l.position),'[]'::jsonb)
        FROM public.catalog_files l JOIN public.files f ON f.tenant_id=l.tenant_id AND f.id=l.file_id
        WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND f.visibility='private' AND f.status='ready'));
  END resolve;
  PERFORM set_config('app.catalog_slug','',true);
  PERFORM set_config('app.catalog_tenant','',true);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.catalog_access(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_access(text,text,uuid) TO harvest_app;
