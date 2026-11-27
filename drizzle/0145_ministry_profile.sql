CREATE TABLE "ministry_locations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address1" text NOT NULL,
	"address2" text,
	"city" text NOT NULL,
	"region" text,
	"postal_code" text,
	"country" text NOT NULL,
	"service_times" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"visibility" text DEFAULT 'staff' NOT NULL,
	CONSTRAINT "ministry_locations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ministry_location_visibility" CHECK ("ministry_locations"."visibility" in ('public','members','staff'))
);
--> statement-breakpoint
CREATE TABLE "ministry_profile_fields" (
	"tenant_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"visibility" text DEFAULT 'staff' NOT NULL,
	CONSTRAINT "ministry_profile_fields_tenant_id_field_pk" PRIMARY KEY("tenant_id","field"),
	CONSTRAINT "ministry_profile_field_name" CHECK ("ministry_profile_fields"."field" in ('name','description','logo','cover','tradition','website','email','phone','socialLinks','serviceTimes')),
	CONSTRAINT "ministry_profile_field_visibility" CHECK ("ministry_profile_fields"."visibility" in ('public','members','staff'))
);
--> statement-breakpoint
CREATE TABLE "ministry_profile_read_grants" (
	"backend" integer PRIMARY KEY NOT NULL,
	"transaction" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ministry_profiles" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ministry_profile_version" CHECK ("ministry_profiles"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "ministry_locations" ADD CONSTRAINT "ministry_locations_tenant_id_ministry_profiles_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."ministry_profiles"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_profile_fields" ADD CONSTRAINT "ministry_profile_fields_tenant_id_ministry_profiles_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."ministry_profiles"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_profiles" ADD CONSTRAINT "ministry_profiles_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ministry_locations_one_primary" ON "ministry_locations" USING btree ("tenant_id") WHERE "ministry_locations"."is_primary";--> statement-breakpoint
-- The session actor is established by withUser. A scope alone grants no access.
CREATE FUNCTION public.ministry_profile_role(p_tenant uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT role_id FROM public.workspace_members
  WHERE tenant_id = p_tenant AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = nullif(current_setting('app.user_id', true), '')
$$;
REVOKE ALL ON FUNCTION public.ministry_profile_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ministry_profile_role(uuid) TO harvest_app;
--> statement-breakpoint
ALTER TABLE public.ministry_profile_read_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ministry_profile_read_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ministry_profile_read_grants FROM PUBLIC, harvest_app;
DO $$
DECLARE tbl text;
DECLARE staff text := 'public.ministry_profile_role(tenant_id) IN (''owner'',''admin'')';
DECLARE scoped text := 'tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid AND EXISTS (
  SELECT FROM public.ministry_profile_read_grants g WHERE g.tenant_id = tenant_id AND g.backend = pg_backend_pid()
    AND g.transaction = pg_current_xact_id_if_assigned()::text)';
BEGIN
  EXECUTE format($p$CREATE POLICY ministry_profile_grant ON public.ministry_profile_read_grants TO %I
    USING (backend = pg_backend_pid() AND transaction = pg_current_xact_id_if_assigned()::text
      AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, current_user);
  FOREACH tbl IN ARRAY ARRAY['ministry_profiles', 'ministry_profile_fields', 'ministry_locations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO harvest_app', tbl);
    EXECUTE format('CREATE POLICY profile_staff ON public.%I TO harvest_app USING (%s) WITH CHECK (%s)', tbl, staff, staff);
    EXECUTE format('CREATE POLICY profile_public_projection ON public.%I FOR SELECT TO %I USING (%s AND %s)',
      tbl, current_user, replace(scoped, 'g.tenant_id = tenant_id', format('g.tenant_id = %I.tenant_id', tbl)),
      CASE WHEN tbl = 'ministry_profiles' THEN 'published' ELSE 'visibility = ''public'' AND EXISTS (SELECT FROM public.ministry_profiles p WHERE p.tenant_id = ' || tbl || '.tenant_id)' END);
    IF tbl <> 'ministry_profiles' THEN
      EXECUTE format('CREATE POLICY profile_member ON public.%I FOR SELECT TO harvest_app
        USING (visibility IN (''public'',''members'') AND public.ministry_profile_role(tenant_id) = ''member''
          AND EXISTS (SELECT FROM public.ministry_profiles p WHERE p.tenant_id = %I.tenant_id AND p.published))', tbl, tbl);
    END IF;
  END LOOP;
  EXECUTE format('CREATE POLICY profile_member ON public.ministry_profiles FOR SELECT TO harvest_app
    USING (published AND public.ministry_profile_role(tenant_id) = ''member'')');
  EXECUTE format($p$CREATE POLICY profile_public_image ON public.files FOR SELECT TO %I USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND status = 'ready' AND NOT social_upload
    AND visibility = 'private' AND mime IN ('image/jpeg','image/png','image/webp') AND EXISTS (
      SELECT FROM public.ministry_profile_read_grants g WHERE g.tenant_id = files.tenant_id AND g.asset_id = files.id
        AND g.backend = pg_backend_pid() AND g.transaction = pg_current_xact_id_if_assigned()::text))$p$, current_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.ministry_profile_contact_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user <> 'harvest_app' OR public.ministry_profile_role(coalesce(NEW.tenant_id, OLD.tenant_id)) = 'owner' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.field IN ('email', 'phone') AND NEW.visibility = 'public' THEN
    IF TG_OP = 'INSERT' THEN RAISE insufficient_privilege; END IF;
    IF NEW IS DISTINCT FROM OLD THEN RAISE insufficient_privilege; END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION public.ministry_profile_contact_guard() FROM PUBLIC;
CREATE TRIGGER ministry_profile_contact_guard BEFORE INSERT OR UPDATE ON public.ministry_profile_fields
  FOR EACH ROW EXECUTE FUNCTION public.ministry_profile_contact_guard();
--> statement-breakpoint
CREATE FUNCTION public.ministry_public_profile(p_tenant uuid, p_image text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb;
DECLARE result jsonb;
DECLARE file_id uuid;
BEGIN
  IF p_image IS NOT NULL AND p_image NOT IN ('logo','cover') THEN RETURN NULL; END IF;
  prior := public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  INSERT INTO public.ministry_profile_read_grants VALUES (pg_backend_pid(), pg_current_xact_id()::text, p_tenant, NULL);
  IF p_image IS NULL THEN
    SELECT jsonb_build_object(
      'fields', coalesce((SELECT jsonb_object_agg(field, CASE WHEN field IN ('logo','cover') THEN 'true'::jsonb ELSE value END)
        FROM public.ministry_profile_fields WHERE tenant_id = p_tenant), '{}'::jsonb),
      'locations', coalesce((SELECT jsonb_agg(to_jsonb(l) - 'tenant_id' - 'visibility' ORDER BY l.is_primary DESC, l.name, l.id)
        FROM public.ministry_locations l WHERE l.tenant_id = p_tenant), '[]'::jsonb))
    INTO result FROM public.ministry_profiles p WHERE p.tenant_id = p_tenant AND p.published;
  ELSE
    SELECT (value #>> '{}')::uuid INTO file_id FROM public.ministry_profile_fields WHERE tenant_id = p_tenant AND field = p_image;
    IF file_id IS NOT NULL THEN
      UPDATE public.ministry_profile_read_grants SET asset_id = file_id WHERE backend = pg_backend_pid();
      SELECT jsonb_build_object('key', f.key, 'name', f.name, 'mime', f.mime) INTO result
      FROM public.files f WHERE f.id = file_id AND f.tenant_id = p_tenant AND f.status = 'ready' AND f.visibility = 'private'
        AND NOT f.social_upload AND f.mime IN ('image/jpeg','image/png','image/webp');
    END IF;
  END IF;
  DELETE FROM public.ministry_profile_read_grants WHERE backend = pg_backend_pid();
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ministry_public_profile(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ministry_public_profile(uuid,text) TO harvest_app;
