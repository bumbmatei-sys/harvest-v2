CREATE TABLE "church_directory_entries" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"opted_in" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "church_directory_entries" ADD CONSTRAINT "church_directory_entries_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE public.church_directory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_directory_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.church_directory_entries FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$
DECLARE item record; original text; patched text; anchor text := '''app.community_stats_write''';
  replacement text := anchor || ',''app.church_directory_read''';
BEGIN
  FOR item IN SELECT unnest(ARRAY['public.blog_scope_clear()', 'public.account_self_reset()', 'public.community_definer_reset()']) AS signature LOOP
    original := pg_catalog.pg_get_functiondef(item.signature::regprocedure);
    patched := pg_catalog.replace(original, anchor, replacement);
    IF pg_catalog.length(patched) - pg_catalog.length(original) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
      RAISE EXCEPTION 'Expected one reset insertion point in %', item.signature;
    END IF;
    EXECUTE patched;
  END LOOP;

  EXECUTE format($p$CREATE POLICY church_directory_manage ON public.church_directory_entries TO %I
    USING (tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY church_directory_list ON public.church_directory_entries FOR SELECT TO %I
    USING (current_setting('app.church_directory_read', true) = 'on' AND opted_in AND verified_at IS NOT NULL)$p$, current_user);
  EXECUTE format($p$CREATE POLICY church_directory_list ON public.ministry_profiles FOR SELECT TO %I
    USING (current_setting('app.church_directory_read', true) = 'on' AND published)$p$, current_user);
  EXECUTE format($p$CREATE POLICY church_directory_list ON public.ministry_profile_fields FOR SELECT TO %I
    USING (current_setting('app.church_directory_read', true) = 'on' AND visibility = 'public')$p$, current_user);
  EXECUTE format($p$CREATE POLICY church_directory_list ON public.ministry_locations FOR SELECT TO %I
    USING (current_setting('app.church_directory_read', true) = 'on' AND visibility = 'public')$p$, current_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.church_directory_opt_in(p_tenant uuid, p_opted_in boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
DECLARE allowed boolean;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM public.community_definer_reset();
  IF actor IS NULL OR p_tenant IS NULL OR p_opted_in IS NULL THEN RETURN false; END IF;

  PERFORM set_config('app.access_tenant', p_tenant::text, true);
  PERFORM 1 FROM public.workspace_members m
    WHERE m.tenant_id = p_tenant AND m.user_id = actor AND m.role_id = 'owner' FOR SHARE;
  allowed := FOUND;
  IF allowed THEN
    INSERT INTO public.church_directory_entries (tenant_id, opted_in) VALUES (p_tenant, p_opted_in)
    ON CONFLICT (tenant_id) DO UPDATE SET opted_in = excluded.opted_in;
  END IF;
  PERFORM set_config('app.access_tenant', '', true);
  RETURN allowed;
END $$;
REVOKE ALL ON FUNCTION public.church_directory_opt_in(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.church_directory_opt_in(uuid,boolean) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.church_directory_search(p_name text, p_city_region text, p_after uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM public.community_definer_reset();
  IF length(p_name) > 120 OR length(p_city_region) > 120 THEN RETURN '[]'::jsonb; END IF;
  PERFORM set_config('app.church_directory_read', 'on', true);
  WITH matches AS MATERIALIZED (
    SELECT e.tenant_id, n.value #>> '{}' AS name
    FROM public.church_directory_entries e
    JOIN public.ministry_profiles p ON p.tenant_id = e.tenant_id AND p.published
    JOIN public.ministry_profile_fields n ON n.tenant_id = e.tenant_id AND n.field = 'name' AND n.visibility = 'public'
    WHERE e.opted_in AND e.verified_at IS NOT NULL AND (p_after IS NULL OR e.tenant_id > p_after)
      AND (p_name IS NULL OR strpos(lower(n.value #>> '{}'), lower(p_name)) > 0)
      AND (p_city_region IS NULL OR EXISTS (
        SELECT FROM public.ministry_locations l WHERE l.tenant_id = e.tenant_id AND l.visibility = 'public'
          AND (strpos(lower(l.city), lower(p_city_region)) > 0 OR strpos(lower(l.region), lower(p_city_region)) > 0)))
    ORDER BY e.tenant_id LIMIT 51
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('ministryId', m.tenant_id, 'name', m.name,
    'fields', coalesce((SELECT jsonb_object_agg(f.field, f.value) FROM public.ministry_profile_fields f
      WHERE f.tenant_id = m.tenant_id AND f.visibility = 'public'
        AND f.field IN ('description','tradition','website','email','phone','socialLinks','serviceTimes')), '{}'),
    'locations', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'name', l.name, 'city', l.city, 'region', l.region, 'country', l.country,
      'serviceTimes', l.service_times) ORDER BY l.is_primary DESC, l.name, l.id)
      FROM public.ministry_locations l WHERE l.tenant_id = m.tenant_id AND l.visibility = 'public'), '[]')
    ) ORDER BY m.tenant_id), '[]')
  INTO result FROM matches m;

  PERFORM set_config('app.church_directory_read', '', true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.church_directory_search(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.church_directory_search(text,text,uuid) TO harvest_app;
