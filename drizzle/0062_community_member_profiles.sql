CREATE FUNCTION public.community_member_profile_links_valid(p_links jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
DECLARE item jsonb;
BEGIN
  IF jsonb_typeof(p_links) <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p_links) > 3 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_links) LOOP
    IF jsonb_typeof(item) <> 'object' THEN RETURN false; END IF;
    IF (item - 'label' - 'url') <> '{}'::jsonb OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'url') IS DISTINCT FROM 'string'
      OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 40
      OR length(item->>'url') > 2048
      OR (item->>'url') !~ '^https://[^/?#@[:space:]]+([/?#]|$)'
      OR (item->>'url') ~ '[[:space:][:cntrl:]]' OR strpos(item->>'url',chr(92)) > 0
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.community_member_profile_links_valid(jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE "community_member_profiles" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text,
	"bio" text,
	"language" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text DEFAULT 'members' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_member_profiles_tenant_id_community_id_user_id_pk" PRIMARY KEY("tenant_id","community_id","user_id"),
	CONSTRAINT "community_member_profile_display_name" CHECK (length(btrim("community_member_profiles"."display_name")) between 1 and 100),
	CONSTRAINT "community_member_profile_bio" CHECK (length("community_member_profiles"."bio") <= 500),
	CONSTRAINT "community_member_profile_language" CHECK (length(btrim("community_member_profiles"."language")) between 1 and 80),
	CONSTRAINT "community_member_profile_links" CHECK (public.community_member_profile_links_valid("community_member_profiles"."links")),
	CONSTRAINT "community_member_profile_visibility" CHECK ("community_member_profiles"."visibility" in ('members','unlisted','private')),
	CONSTRAINT "community_member_profile_version" CHECK ("community_member_profiles"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_system_actor";--> statement-breakpoint
ALTER TABLE "community_member_profiles" ADD CONSTRAINT "community_member_profiles_tenant_id_community_id_user_id_community_memberships_tenant_id_community_id_user_id_fk" FOREIGN KEY ("tenant_id","community_id","user_id") REFERENCES "public"."community_memberships"("tenant_id","community_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_system_actor" CHECK ("audit_logs"."actor_id" is not null or "audit_logs"."action" in ('followup.case.withdraw', 'followup.case.revoke', 'community.live.auto_close', 'community.moderation_report_expire', 'newsletter.signup.confirmed', 'newsletter.unsubscribe.list', 'newsletter.unsubscribe.all', 'newsletter.withdrawal.propagated', 'community.profile_save', 'community.profile_withdraw', 'community.profile_erase'));
--> statement-breakpoint
ALTER TABLE public.community_member_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_member_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_member_profiles FROM PUBLIC, harvest_app;
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY member_profiles_scoped_owner ON public.community_member_profiles TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_member_profile_fields(p public.community_member_profiles) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('displayName', p.display_name, 'bio', p.bio, 'language', p.language,
    'links', coalesce(p.links, '[]'::jsonb), 'visibility', coalesce(p.visibility, 'members'))
$$;
REVOKE ALL ON FUNCTION public.community_member_profile_fields(public.community_member_profiles) FROM PUBLIC;

CREATE FUNCTION public.community_member_profile_read(p_slug text, p_target text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; result jsonb;
BEGIN
  IF actor IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NOT NULL THEN
    SELECT jsonb_build_object(
      'member', jsonb_build_object('userId', m.user_id, 'name', coalesce(p.display_name, u.name),
        'role', m.role, 'joinedAt', m.joined_at),
      'profile', public.community_member_profile_fields(p))
      INTO result
    FROM public.community_memberships m JOIN public.users u ON u.id = m.user_id
    LEFT JOIN public.community_member_profiles p
      ON (p.tenant_id, p.community_id, p.user_id) = (m.tenant_id, m.community_id, m.user_id)
    WHERE m.tenant_id = ctx.o_tenant AND m.community_id = ctx.o_community AND m.user_id = p_target
      AND public.community_user_can_read(m.tenant_id, m.community_id, m.user_id)
      AND (p.visibility IS DISTINCT FROM 'private' OR m.user_id = actor OR ctx.o_role IN ('owner','admin'));
  END IF;
  PERFORM public.community_definer_reset();
  RETURN result;
END $$;

-- Keep the directory's existing metadata projection. Apply visibility before ordering and limiting.
CREATE OR REPLACE FUNCTION public.community_member_directory(p_slug text) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ctx record;
BEGIN
  IF nullif(current_setting('app.user_id', true), '') IS NULL THEN RETURN; END IF;
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NOT NULL THEN
    RETURN QUERY SELECT jsonb_build_object('userId', m.user_id, 'name', u.name, 'role', m.role, 'joinedAt', m.joined_at)
    FROM public.community_memberships m JOIN public.users u ON u.id = m.user_id
    LEFT JOIN public.community_member_profiles p
      ON (p.tenant_id, p.community_id, p.user_id) = (m.tenant_id, m.community_id, m.user_id)
    WHERE m.tenant_id = ctx.o_tenant AND m.community_id = ctx.o_community
      AND coalesce(p.visibility, 'members') = 'members' AND public.community_user_can_read(m.tenant_id, m.community_id, m.user_id)
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 WHEN 'contributor' THEN 3 ELSE 4 END,
      m.joined_at NULLS LAST, m.user_id
    LIMIT 1000;
  END IF;
  PERFORM public.community_definer_reset();
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_member_profile_self(p_slug text, p_action text, p_expected integer,
  p_name text, p_bio text, p_language text, p_links jsonb, p_visibility text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
  c public.communities%ROWTYPE; item public.community_member_profiles%ROWTYPE;
  readable boolean; v integer;
BEGIN
  IF actor IS NULL OR p_action IS NULL OR p_action NOT IN ('get','save','withdraw','erase') THEN
    RETURN public.community_chat_done('{"outcome":"not_found"}');
  END IF;
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT * INTO c FROM public.communities WHERE slug = p_slug;
  IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  IF p_action <> 'get' THEN
    PERFORM 1 FROM public.community_memberships
      WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor FOR UPDATE;
    IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  END IF;
  SELECT * INTO item FROM public.community_member_profiles WHERE tenant_id=c.tenant_id AND community_id=c.id AND user_id=actor;
  readable := c.status='published' AND public.community_user_can_read(c.tenant_id,c.id,actor);
  IF (item.user_id IS NULL OR p_action = 'save') AND NOT readable THEN
    RETURN public.community_chat_done('{"outcome":"not_found"}');
  END IF;
  v := coalesce(item.version, 0);
  IF p_action = 'get' THEN
    RETURN public.community_chat_done(jsonb_build_object('outcome','ok','data',
      public.community_member_profile_fields(item) || jsonb_build_object('version',v)));
  END IF;
  IF p_expected IS DISTINCT FROM v OR v >= 2147483647 THEN
    RETURN public.community_chat_done('{"outcome":"conflict"}');
  END IF;

  IF p_action = 'save' THEN
    IF p_visibility IS NULL OR p_visibility NOT IN ('members','unlisted','private') OR p_links IS NULL
      OR NOT public.community_member_profile_links_valid(p_links)
      OR (p_name IS NOT NULL AND length(btrim(p_name)) NOT BETWEEN 1 AND 100)
      OR length(p_bio) > 500
      OR (p_language IS NOT NULL AND length(btrim(p_language)) NOT BETWEEN 1 AND 80) THEN
      RETURN public.community_chat_done('{"outcome":"invalid"}');
    END IF;
  ELSE
    p_visibility := 'private';
    p_name := CASE WHEN p_action='withdraw' THEN item.display_name END;
    p_bio := CASE WHEN p_action='withdraw' THEN item.bio END;
    p_language := CASE WHEN p_action='withdraw' THEN item.language END;
    p_links := CASE WHEN p_action='withdraw' THEN coalesce(item.links,'[]'::jsonb) ELSE '[]'::jsonb END;
  END IF;

  INSERT INTO public.community_member_profiles(tenant_id,community_id,user_id,display_name,bio,language,links,visibility,version)
    VALUES(c.tenant_id,c.id,actor,p_name,p_bio,p_language,p_links,p_visibility,v+1)
    ON CONFLICT (tenant_id,community_id,user_id) DO UPDATE SET
      display_name=EXCLUDED.display_name, bio=EXCLUDED.bio, language=EXCLUDED.language, links=EXCLUDED.links,
      visibility=EXCLUDED.visibility, version=EXCLUDED.version, updated_at=now()
    RETURNING * INTO item;
  -- Use the same account-deletion cascade as membership. The audit metadata keeps no subject FK.
  INSERT INTO public.audit_logs(tenant_id,action,target_id,metadata)
    VALUES(c.tenant_id,'community.profile_' || p_action,c.id::text,jsonb_build_object('version',item.version::text));
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','data',
    public.community_member_profile_fields(item) || jsonb_build_object('version',item.version)));
END $$;

REVOKE ALL ON FUNCTION public.community_member_profile_read(text,text), public.community_member_profile_self(text,text,integer,text,text,text,jsonb,text),
  public.community_member_directory(text) FROM PUBLIC, harvest_app;
GRANT EXECUTE ON FUNCTION public.community_member_profile_read(text,text), public.community_member_profile_self(text,text,integer,text,text,text,jsonb,text),
  public.community_member_directory(text) TO harvest_app;
