CREATE TABLE "community_post_details" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"details" jsonb NOT NULL,
	CONSTRAINT "community_post_details_object" CHECK (jsonb_typeof("community_post_details"."details") = 'object')
);
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "forum_posting" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_post_details" ADD CONSTRAINT "community_post_details_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_details" ADD CONSTRAINT "community_post_details_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_forum_posting" CHECK ("communities"."forum_posting" in ('everyone', 'hosts'));
--> statement-breakpoint
ALTER TABLE public.community_post_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_details FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_post_details FROM PUBLIC, harvest_app;
DO $$
BEGIN
  EXECUTE format($policy$CREATE POLICY forum_details_owner ON public.community_post_details TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid AND EXISTS (
      SELECT FROM public.community_posts p WHERE p.id = community_post_details.post_id
        AND p.tenant_id = community_post_details.tenant_id AND p.community_id = community_post_details.community_id
    ))$policy$, current_user);
END $$;
--> statement-breakpoint
-- The forum already holds the established community scope. Clear additional domain scopes
-- on entry and exit, including when a caller supplied them before reaching the definer.
CREATE FUNCTION public.community_forum_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_definer_reset();
  SELECT set_config(name, '', true) FROM unnest(ARRAY['app.catalog_slug', 'app.crm_forms_tenant', 'app.crm_forms_slug',
    'app.blog_public_tenant', 'app.blog_public_handle', 'app.blog_public_file']) AS name;
$$;
REVOKE ALL ON FUNCTION public.community_forum_reset() FROM PUBLIC;
--> statement-breakpoint
-- Invoker rights, used only by forum definers. All five branches project existing rows;
-- the same visibility predicate applies when picking, saving and reading a reference.
CREATE FUNCTION public.community_forum_items(p_tenant uuid, p_slug text, p_kind text, p_id uuid, p_query text, p_offset integer)
RETURNS TABLE(id uuid, title text, href text, cover text, price text)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF p_kind IN ('course','product') THEN
    PERFORM set_config('app.catalog_tenant', p_tenant::text, true);
    RETURN QUERY SELECT i.id, i.title, (CASE WHEN p_kind='course' THEN '/courses/' ELSE '/products/' END) || i.slug, NULL::text, 'free'::text
      FROM public.catalog_items i WHERE i.tenant_id=p_tenant AND i.kind=(CASE WHEN p_kind='course' THEN 'course' ELSE 'download' END)
      AND i.state='published' AND i.visibility IN ('listed','unlisted') AND (p_id IS NULL OR i.id=p_id)
      AND strpos(lower(i.title), lower(p_query))>0
      ORDER BY lower(i.title), i.id LIMIT 26 OFFSET p_offset;
    PERFORM set_config('app.catalog_tenant', '', true);
  ELSIF p_kind='event' THEN
    PERFORM set_config('app.events_tenant', p_tenant::text, true);
    RETURN QUERY SELECT e.id, e.title, '/communities/' || p_slug || '/events/' || e.id::text,
      CASE WHEN e.cover_file_id IS NOT NULL THEN '/api/workspaces/' || p_tenant::text || '/events/' || e.id::text || '/cover' END, NULL::text
      FROM public.events e WHERE e.tenant_id=p_tenant AND e.status='published' AND e.published_at IS NOT NULL AND (p_id IS NULL OR e.id=p_id)
      AND (EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=actor AND public.access_role(m.tenant_id,m.user_id,'owner_admin',m.role_id) IN ('owner','admin'))
        OR public.events_sources(p_tenant,e.id,actor,now())<>'{}'::jsonb)
      AND strpos(lower(e.title), lower(p_query))>0
      ORDER BY lower(e.title), e.id LIMIT 26 OFFSET p_offset;
    PERFORM set_config('app.events_tenant', '', true);
  ELSIF p_kind='form' THEN
    PERFORM set_config('app.crm_forms_tenant', p_tenant::text, true);
    RETURN QUERY SELECT f.id, coalesce(pub.definition->>'title', f.name), '/f/' || a.slug, NULL::text, NULL::text
      FROM public.forms f JOIN public.crm_form_addresses a ON a.tenant_id=f.tenant_id AND a.form_id=f.id
      JOIN public.crm_form_publications pub ON pub.tenant_id=a.tenant_id AND pub.form_id=a.form_id AND pub.version_id=a.version_id
      WHERE f.tenant_id=p_tenant AND f.archived_at IS NULL AND a.retired_at IS NULL AND (p_id IS NULL OR f.id=p_id)
      AND strpos(lower(coalesce(pub.definition->>'title', f.name)), lower(p_query))>0
      ORDER BY lower(coalesce(pub.definition->>'title', f.name)), f.id LIMIT 26 OFFSET p_offset;
    PERFORM set_config('app.crm_forms_tenant', '', true);
  ELSIF p_kind='article' AND to_regclass('public.blog_posts') IS NOT NULL AND to_regclass('public.blog_settings') IS NOT NULL THEN
    -- Native blog ships independently. Its published owner policy uses this existing tenant scope.
    PERFORM set_config('app.blog_public_tenant', p_tenant::text, true);
    RETURN QUERY EXECUTE $query$
      SELECT p.id, p.title, '/blog/' || b.handle || '/' || p.slug,
        CASE WHEN p.cover_file_id IS NOT NULL THEN '/blog/' || b.handle || '/images/' || p.cover_file_id::text END, NULL::text
      FROM public.blog_posts p JOIN public.blog_settings b ON b.tenant_id=p.tenant_id
      WHERE p.tenant_id=$1 AND p.status='published' AND p.published_at IS NOT NULL AND ($2 IS NULL OR p.id=$2)
        AND strpos(lower(p.title), lower($3))>0
      ORDER BY lower(p.title), p.id LIMIT 26 OFFSET $4
    $query$ USING p_tenant, p_id, p_query, p_offset;
    PERFORM set_config('app.blog_public_tenant', '', true);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.community_forum_items(uuid,text,text,uuid,text,integer) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.community_forum_picker(p_slug text, p_kind text, p_query text, p_page integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ctx record; items jsonb;
BEGIN
  PERFORM public.community_forum_reset();
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF ctx.o_role NOT IN ('owner','admin','moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('course','product','event','article','form') OR p_page IS NULL
    OR p_page NOT BETWEEN 1 AND 1000 OR length(coalesce(p_query,''))>100 THEN
    RETURN public.community_forum_done('invalid');
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY lower(q.title),q.id),'[]'::jsonb) INTO items
    FROM public.community_forum_items(ctx.o_tenant,p_slug,p_kind,NULL,coalesce(p_query,''),(p_page-1)*25) q;
  PERFORM public.community_forum_reset();
  RETURN jsonb_build_object('outcome','ok','items',items);
END $$;
REVOKE ALL ON FUNCTION public.community_forum_picker(text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_forum_picker(text,text,text,integer) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.community_forum_details_valid(p_slug text, p_tenant uuid, p_community uuid, p_role text, p_details jsonb) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ref jsonb; mention text;
BEGIN
  IF jsonb_typeof(p_details) IS DISTINCT FROM 'object' OR octet_length(p_details::text)>10000 THEN RETURN 'invalid'; END IF;
  IF p_details - ARRAY['photoIds','mentionIds','linkedItems','location','feeling'] <> '{}'::jsonb
    OR jsonb_typeof(p_details->'photoIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_details->'mentionIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_details->'linkedItems') IS DISTINCT FROM 'array'
    OR coalesce(jsonb_typeof(p_details->'location'),'null') NOT IN ('string','null')
    OR coalesce(jsonb_typeof(p_details->'feeling'),'null') NOT IN ('string','null') THEN RETURN 'invalid'; END IF;
  IF jsonb_array_length(p_details->'photoIds')>10 OR jsonb_array_length(p_details->'mentionIds')>10
    OR jsonb_array_length(p_details->'linkedItems')>5 THEN RETURN 'invalid'; END IF;
  IF p_details->>'location' IS NOT NULL AND (
    length(btrim(p_details->>'location')) NOT BETWEEN 1 AND 240 OR p_details->>'location' ~ '[[:cntrl:]]'
  ) THEN RETURN 'invalid'; END IF;
  IF p_details->>'feeling' IS NOT NULL AND p_details->>'feeling' NOT IN
    ('grateful','hopeful','joyful','encouraged','thoughtful','sad','praying','celebrating','learning','serving') THEN RETURN 'invalid'; END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(p_details->'photoIds') x WHERE jsonb_typeof(x) <> 'string')
    OR EXISTS (SELECT FROM jsonb_array_elements(p_details->'mentionIds') x WHERE jsonb_typeof(x) <> 'string') THEN RETURN 'invalid'; END IF;
  IF jsonb_array_length(p_details->'mentionIds') <>
    (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_details->'mentionIds') x) THEN RETURN 'invalid'; END IF;
  FOR mention IN SELECT x FROM jsonb_array_elements_text(p_details->'mentionIds') x LOOP
    IF length(mention) NOT BETWEEN 1 AND 200 OR mention=actor OR NOT EXISTS (
      SELECT FROM public.community_memberships m
      WHERE m.tenant_id=p_tenant AND m.community_id=p_community AND m.user_id=mention AND m.status='active'
    ) OR public.community_dm_blocked(p_tenant,p_community,actor,mention) THEN RETURN 'invalid'; END IF;
  END LOOP;
  IF jsonb_array_length(p_details->'linkedItems') > 0 AND p_role NOT IN ('owner','admin','moderator') THEN RETURN 'forbidden'; END IF;
  IF jsonb_array_length(p_details->'linkedItems') <>
    (SELECT count(DISTINCT x) FROM jsonb_array_elements(p_details->'linkedItems') x) THEN RETURN 'invalid'; END IF;
  FOR ref IN SELECT x FROM jsonb_array_elements(p_details->'linkedItems') x LOOP
    IF jsonb_typeof(ref) <> 'object' OR ref-ARRAY['kind','id']<>'{}'::jsonb
      OR jsonb_typeof(ref->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(ref->'id') IS DISTINCT FROM 'string'
      OR NOT EXISTS (SELECT FROM public.community_forum_items(p_tenant,p_slug,ref->>'kind',(ref->>'id')::uuid,'',0))
      THEN RETURN 'invalid'; END IF;
  END LOOP;
  RETURN 'ok';
EXCEPTION WHEN invalid_text_representation THEN RETURN 'invalid';
END $$;
REVOKE ALL ON FUNCTION public.community_forum_details_valid(text,uuid,uuid,text,jsonb) FROM PUBLIC;
--> statement-breakpoint
-- Restrict the independent projection to the same readable posts as the feed/detail paths.
CREATE FUNCTION public.community_forum_read_details(p_slug text, p_posts uuid[]) RETURNS TABLE(post_id uuid, details jsonb, former_member boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ctx record; actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  PERFORM public.community_forum_reset();
  IF p_posts IS NULL OR cardinality(p_posts)>50 THEN RETURN; END IF;
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN PERFORM public.community_forum_reset(); RETURN; END IF;
  RETURN QUERY
    SELECT p.id, jsonb_build_object(
      'location', d.details->'location',
      'feeling', d.details->'feeling',
      'photos', coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',f.size) ORDER BY x.position)
        FROM jsonb_array_elements_text(d.details->'photoIds') WITH ORDINALITY x(id,position)
        JOIN public.community_files f ON f.tenant_id=p.tenant_id AND f.community_id=p.community_id AND f.post_id=p.id
          AND f.id=x.id::uuid AND f.status='ready'),'[]'::jsonb),
      'mentions', coalesce((SELECT jsonb_agg(jsonb_build_object('userId',m.user_id,'name',u.name) ORDER BY x.position)
        FROM jsonb_array_elements_text(d.details->'mentionIds') WITH ORDINALITY x(id,position)
        JOIN public.community_memberships m ON m.tenant_id=p.tenant_id AND m.community_id=p.community_id AND m.user_id=x.id AND m.status='active'
        JOIN public.users u ON u.id=m.user_id
        WHERE NOT public.community_dm_blocked(p.tenant_id,p.community_id,actor,m.user_id)),'[]'::jsonb),
      'linkedItems', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', x.ref->>'kind', 'id',x.ref->>'id') ||
          coalesce(to_jsonb(item), '{}'::jsonb) || jsonb_build_object('available',item.id IS NOT NULL) ORDER BY x.position)
        FROM jsonb_array_elements(d.details->'linkedItems') WITH ORDINALITY x(ref,position)
        LEFT JOIN LATERAL public.community_forum_items(p.tenant_id,p_slug,x.ref->>'kind',(x.ref->>'id')::uuid,'',0) item ON true),'[]'::jsonb)
      ),
      p.author_id IS NULL OR NOT EXISTS (
        SELECT FROM public.community_memberships m WHERE m.tenant_id=p.tenant_id AND m.community_id=p.community_id
          AND m.user_id=p.author_id AND m.status='active')
    FROM public.community_posts p LEFT JOIN public.community_post_details d ON d.post_id=p.id AND d.tenant_id=p.tenant_id AND d.community_id=p.community_id
    WHERE p.tenant_id=ctx.o_tenant AND p.community_id=ctx.o_community AND p.id=ANY(p_posts) AND p.removed_at IS NULL
      AND (p.held_at IS NULL OR p.author_id=actor OR ctx.o_role IN ('owner','admin','moderator'));
  PERFORM public.community_forum_reset();
END $$;
REVOKE ALL ON FUNCTION public.community_forum_read_details(text,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_forum_read_details(text,uuid[]) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.community_post_save_details(p_slug text, p_post_id uuid, p_category_id uuid, p_title text, p_body jsonb, p_body_text text,
  p_video_url text, p_cover_file_id uuid, p_attachment_ids uuid[], p_comments_off boolean, p_likes_off boolean, p_details jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; cat record; v_post uuid := p_post_id; existing record;
  attachments uuid[] := coalesce(p_attachment_ids, ARRAY[]::uuid[]); usable integer; expected integer; v_hold text;
  photos uuid[] := ARRAY[]::uuid[]; all_files uuid[]; v_details jsonb; details_result text; posting text; photo_count integer;
BEGIN
  PERFORM public.community_forum_reset();
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF public.community_is_muted(ctx.o_tenant, ctx.o_community) THEN RETURN public.community_forum_done('muted'); END IF;
  SELECT * INTO cat FROM public.community_categories WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_category_id;
  IF NOT FOUND THEN RETURN public.community_forum_done('invalid'); END IF;
  IF cat.hosts_only AND ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF v_post IS NULL AND ctx.o_role NOT IN ('owner','admin','moderator') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('forum_posting:' || ctx.o_community::text, 0));
    SELECT forum_posting INTO posting FROM public.communities WHERE tenant_id=ctx.o_tenant AND id=ctx.o_community;
    IF posting IS DISTINCT FROM 'everyone' THEN RETURN public.community_forum_done('forbidden'); END IF;
  END IF;
  IF cardinality(attachments) > 5 OR cardinality(attachments) <> (SELECT count(DISTINCT a) FROM unnest(attachments) a) THEN RETURN public.community_forum_done('invalid'); END IF;
  IF v_post IS NOT NULL THEN
    SELECT * INTO existing FROM public.community_posts WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = v_post AND removed_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
    IF existing.author_id IS DISTINCT FROM actor THEN RETURN public.community_forum_done('forbidden'); END IF;
  END IF;
  IF p_details IS NOT NULL THEN
    details_result := public.community_forum_details_valid(p_slug,ctx.o_tenant,ctx.o_community,ctx.o_role,p_details);
    IF details_result <> 'ok' THEN RETURN public.community_forum_done(details_result); END IF;
    v_details := p_details;
  ELSIF v_post IS NOT NULL THEN
    SELECT details INTO v_details FROM public.community_post_details WHERE post_id=v_post AND tenant_id=ctx.o_tenant AND community_id=ctx.o_community;
  END IF;
  BEGIN
    photos := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(v_details->'photoIds') x);
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public.community_forum_done('invalid');
  END;
  all_files := attachments || photos;
  IF cardinality(all_files) <> (SELECT count(DISTINCT a) FROM unnest(all_files) a) THEN RETURN public.community_forum_done('invalid'); END IF;
  IF cardinality(photos)>0 AND cardinality(photos) <> (
    SELECT count(*) FROM public.community_files f WHERE f.id=ANY(photos) AND f.tenant_id=ctx.o_tenant AND f.community_id=ctx.o_community
      AND f.mime IN ('image/jpeg','image/png','image/webp')
  ) THEN RETURN public.community_forum_done('invalid'); END IF;
  -- Lock the candidate files before checking that another post has not already claimed them.
  PERFORM 1 FROM public.community_files f WHERE f.tenant_id=ctx.o_tenant AND f.community_id=ctx.o_community
    AND (f.id=ANY(all_files) OR f.id=p_cover_file_id) ORDER BY f.id FOR UPDATE;
  SELECT count(*) FILTER (WHERE f.id=ANY(all_files) AND f.mime IN ('image/jpeg','image/png','image/webp')),
    count(*) INTO photo_count, usable FROM public.community_files f WHERE f.tenant_id = ctx.o_tenant AND f.community_id = ctx.o_community
    AND f.uploader_id = actor AND f.status = 'ready' AND (f.post_id IS NULL OR f.post_id = v_post)
    AND ((f.id = p_cover_file_id AND f.kind = 'cover') OR (f.id = ANY (all_files) AND f.kind = 'attachment'));
  -- Computed first: PL/pgSQL ends an IF condition at the first THEN, including one inside CASE.
  expected := cardinality(all_files) + (CASE WHEN p_cover_file_id IS NULL THEN 0 ELSE 1 END);
  IF usable <> expected OR photo_count > 10 THEN RETURN public.community_forum_done('invalid'); END IF;
  v_hold := public.community_hold_reason(ctx.o_tenant, ctx.o_community, ctx.o_role, coalesce(p_title, '') || ' ' || coalesce(p_body_text, ''), v_post IS NULL);
  IF v_post IS NULL THEN
    INSERT INTO public.community_posts (tenant_id, community_id, category_id, author_id, title, body, body_text, video_url, cover_file_id, comments_off, likes_off,
        held_at, held_reason)
      VALUES (ctx.o_tenant, ctx.o_community, p_category_id, actor, p_title, p_body, coalesce(p_body_text, ''), p_video_url, p_cover_file_id,
        coalesce(p_comments_off, false), coalesce(p_likes_off, false), CASE WHEN v_hold IS NULL THEN NULL ELSE now() END, v_hold) RETURNING id INTO v_post;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.post_create', v_post::text);
    IF v_hold IS NOT NULL THEN PERFORM public.community_notify_hosts(ctx.o_tenant, ctx.o_community, NULL); END IF;
  ELSE
    -- A clean edit never releases a held post; a banned word in an edit holds a published one.
    IF existing.title IS DISTINCT FROM p_title OR existing.body IS DISTINCT FROM p_body OR existing.body_text IS DISTINCT FROM coalesce(p_body_text, '') THEN
      INSERT INTO public.community_post_revisions (tenant_id, community_id, post_id, title, body, body_text, saved_at)
        VALUES (ctx.o_tenant, ctx.o_community, v_post, existing.title, existing.body, existing.body_text, coalesce(existing.edited_at, existing.created_at));
      DELETE FROM public.community_post_revisions r WHERE r.post_id = v_post
        AND r.id NOT IN (SELECT x.id FROM public.community_post_revisions x WHERE x.post_id = v_post ORDER BY x.created_at DESC, x.id LIMIT 50);
    END IF;
    UPDATE public.community_posts SET category_id = p_category_id, title = p_title, body = p_body, body_text = coalesce(p_body_text, ''), video_url = p_video_url,
      cover_file_id = p_cover_file_id, comments_off = coalesce(p_comments_off, false), likes_off = coalesce(p_likes_off, false), edited_at = now(), updated_at = now(),
      held_at = CASE WHEN held_at IS NULL AND v_hold IS NOT NULL THEN now() ELSE held_at END,
      held_reason = CASE WHEN held_at IS NULL AND v_hold IS NOT NULL THEN v_hold ELSE held_reason END
      WHERE id = v_post;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.post_edit', v_post::text);
    IF existing.held_at IS NULL AND v_hold IS NOT NULL THEN PERFORM public.community_notify_hosts(ctx.o_tenant, ctx.o_community, NULL); END IF;
  END IF;
  UPDATE public.community_files SET post_id = NULL, updated_at = now()
    WHERE tenant_id = ctx.o_tenant AND post_id = v_post AND id <> ALL (all_files) AND id IS DISTINCT FROM p_cover_file_id;
  UPDATE public.community_files SET post_id = v_post, updated_at = now()
    WHERE tenant_id = ctx.o_tenant AND (id = ANY (all_files) OR id = p_cover_file_id);
  IF p_details IS NOT NULL THEN
    INSERT INTO public.community_post_details(post_id,tenant_id,community_id,details)
      VALUES (v_post,ctx.o_tenant,ctx.o_community,v_details)
      ON CONFLICT (post_id) DO UPDATE SET details=excluded.details;
  END IF;
  PERFORM public.community_forum_reset();
  RETURN public.community_forum_done(CASE WHEN v_hold IS NOT NULL AND p_post_id IS NULL THEN 'held' ELSE 'ok' END, v_post);
END $$;
REVOKE ALL ON FUNCTION public.community_post_save_details(text,uuid,uuid,text,jsonb,text,text,uuid,uuid[],boolean,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_post_save_details(text,uuid,uuid,text,jsonb,text,text,uuid,uuid[],boolean,boolean,jsonb) TO harvest_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_post_save(p_slug text, p_post_id uuid, p_category_id uuid, p_title text, p_body jsonb, p_body_text text,
  p_video_url text, p_cover_file_id uuid, p_attachment_ids uuid[], p_comments_off boolean, p_likes_off boolean) RETURNS jsonb
LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_post_save_details(p_slug,p_post_id,p_category_id,p_title,p_body,p_body_text,
    p_video_url,p_cover_file_id,p_attachment_ids,p_comments_off,p_likes_off,NULL)
$$;

--> statement-breakpoint
CREATE FUNCTION public.community_forum_lock_posting_setting() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.forum_posting IS DISTINCT FROM OLD.forum_posting THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('forum_posting:' || OLD.id::text, 0));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.community_forum_lock_posting_setting() FROM PUBLIC;
CREATE TRIGGER community_forum_lock_posting_setting BEFORE UPDATE OF forum_posting ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.community_forum_lock_posting_setting();
