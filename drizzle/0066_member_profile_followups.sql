-- Chat and the members directory share the existing eligibility and ordering.
-- Only the members directory uses the optional profile fields. Chat hides private and unlisted members down to id and role.
CREATE FUNCTION public.community_member_roster(p_slug text, p_chat boolean) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ctx record;
BEGIN
  IF nullif(current_setting('app.user_id', true), '') IS NULL THEN RETURN; END IF;
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NOT NULL AND (NOT p_chat OR EXISTS (
    SELECT FROM public.communities WHERE tenant_id = ctx.o_tenant AND id = ctx.o_community AND chat_enabled
  )) THEN
    -- Chat sees every eligible member, but a member whose profile is private or unlisted (and is not the viewer) is
    -- reduced to an id and a role: no name and no joined date. Community owners and admins keep seeing everyone. That keeps a staff badge resolvable on messages the
    -- viewer can already see without making a hidden member discoverable. The directory still omits hidden members.
    RETURN QUERY SELECT CASE WHEN p_chat AND coalesce(p.visibility, 'members') <> 'members'
        AND m.user_id <> nullif(current_setting('app.user_id', true), '') AND coalesce(ctx.o_role, '') NOT IN ('owner', 'admin')
      THEN jsonb_build_object('userId', m.user_id, 'role', m.role, 'hidden', true)
      ELSE jsonb_build_object('userId', m.user_id,
        'name', CASE WHEN p_chat THEN u.name ELSE coalesce(p.display_name, u.name) END,
        'role', m.role, 'joinedAt', m.joined_at) END
    FROM public.community_memberships m JOIN public.users u ON u.id = m.user_id
    LEFT JOIN public.community_member_profiles p
      ON (p.tenant_id, p.community_id, p.user_id) = (m.tenant_id, m.community_id, m.user_id)
    WHERE m.tenant_id = ctx.o_tenant AND m.community_id = ctx.o_community
      AND (p_chat OR coalesce(p.visibility, 'members') = 'members')
      AND public.community_user_can_read(m.tenant_id, m.community_id, m.user_id)
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 WHEN 'contributor' THEN 3 ELSE 4 END,
      m.joined_at NULLS LAST, m.user_id
    LIMIT 1000;
  END IF;
  PERFORM public.community_definer_reset();
END $$;
REVOKE ALL ON FUNCTION public.community_member_roster(text, boolean) FROM PUBLIC, harvest_app;

CREATE OR REPLACE FUNCTION public.community_member_directory(p_slug text) RETURNS SETOF jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT * FROM public.community_member_roster(p_slug, false)
$$;

CREATE FUNCTION public.community_chat_member_roster(p_slug text) RETURNS SETOF jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT * FROM public.community_member_roster(p_slug, true)
$$;
REVOKE ALL ON FUNCTION public.community_chat_member_roster(text) FROM PUBLIC, harvest_app;
GRANT EXECUTE ON FUNCTION public.community_chat_member_roster(text) TO harvest_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_member_profile_self(p_slug text, p_action text, p_expected integer,
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
    p_visibility := CASE WHEN p_action = 'erase' THEN 'members' ELSE 'private' END;
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
