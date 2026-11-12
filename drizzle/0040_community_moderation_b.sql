CREATE TABLE "community_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reply" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_appeal_message" CHECK (length("community_appeals"."message") between 1 and 1000),
	CONSTRAINT "community_appeal_reply" CHECK ("community_appeals"."reply" is null or length("community_appeals"."reply") between 1 and 500),
	CONSTRAINT "community_appeal_status" CHECK ("community_appeals"."status" in ('open', 'approved', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "community_comment_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"body" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_post_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"issued_by" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "community_warning_reason" CHECK (length("community_warnings"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "community_moderation_actions" DROP CONSTRAINT "community_moderation_action";--> statement-breakpoint
ALTER TABLE "community_appeals" ADD CONSTRAINT "community_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_appeals" ADD CONSTRAINT "community_appeals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_appeals" ADD CONSTRAINT "community_appeals_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comment_revisions" ADD CONSTRAINT "community_comment_revisions_comment_id_community_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."community_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comment_revisions" ADD CONSTRAINT "community_comment_revisions_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_revisions" ADD CONSTRAINT "community_post_revisions_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_revisions" ADD CONSTRAINT "community_post_revisions_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_warnings" ADD CONSTRAINT "community_warnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_warnings" ADD CONSTRAINT "community_warnings_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_warnings" ADD CONSTRAINT "community_warnings_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_appeals_open_idx" ON "community_appeals" USING btree ("community_id","user_id") WHERE "community_appeals"."status" = 'open';--> statement-breakpoint
CREATE INDEX "community_appeals_queue_idx" ON "community_appeals" USING btree ("community_id","status","created_at");--> statement-breakpoint
CREATE INDEX "community_comment_revisions_idx" ON "community_comment_revisions" USING btree ("comment_id","created_at");--> statement-breakpoint
CREATE INDEX "community_post_revisions_idx" ON "community_post_revisions" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "community_warnings_user_idx" ON "community_warnings" USING btree ("community_id","user_id","created_at");--> statement-breakpoint
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_action" CHECK ("community_moderation_actions"."action" in ('report_dismiss', 'report_remove', 'held_approve', 'held_reject', 'mute', 'unmute', 'ban', 'unban', 'warn', 'appeal_approve', 'appeal_decline'));
--> statement-breakpoint
-- C12b: warnings, appeals and edit history. Same model as 0039: FORCE RLS, staff and host read policies, owner policies
-- keyed on settings the definers set and clear; the app role has no direct writes.
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['community_warnings','community_appeals','community_post_revisions','community_comment_revisions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', relation_name);
  EXECUTE format('GRANT SELECT ON public.%I TO harvest_app', relation_name);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO harvest_app
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, relation_name || '_staff', relation_name);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO harvest_app USING (public.community_is_host(tenant_id, community_id))$p$,
    relation_name || '_host', relation_name);
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.%I TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, relation_name, current_user);
 END LOOP;
 -- community_my_bans lists the caller's own bans and appeals across ministries (same pattern as applications).
 EXECUTE format($p$CREATE POLICY community_definer_user ON public.community_memberships FOR SELECT TO %I
    USING (user_id = nullif(current_setting('app.community_resolve_user', true), ''))$p$, current_user);
 EXECUTE format($p$CREATE POLICY community_definer_user ON public.community_appeals FOR SELECT TO %I
    USING (user_id = nullif(current_setting('app.community_resolve_user', true), ''))$p$, current_user);
END $$;--> statement-breakpoint
-- Hosts warn a lower-ranked active member (never the owner, never themselves).
CREATE FUNCTION public.community_warn(p_slug text, p_user_id text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; target record; actor_rank integer; target_rank integer;
  v_reason text := btrim(coalesce(p_reason, '')); v_warning uuid;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF length(v_reason) NOT BETWEEN 1 AND 500 THEN RETURN public.community_forum_done('invalid'); END IF;
  SELECT * INTO target FROM public.community_memberships WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  actor_rank := CASE ctx.o_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 1 ELSE 0 END;
  target_rank := CASE target.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 1 ELSE 0 END;
  IF p_user_id = actor OR target.role = 'owner' OR actor_rank <= target_rank THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF target.status <> 'active' THEN RETURN public.community_forum_done('invalid'); END IF;
  INSERT INTO public.community_warnings (tenant_id, community_id, user_id, issued_by, reason)
    VALUES (ctx.o_tenant, ctx.o_community, p_user_id, actor, v_reason) RETURNING id INTO v_warning;
  PERFORM public.community_moderation_log(ctx.o_tenant, ctx.o_community, 'warn', 'member', p_user_id, p_user_id, jsonb_build_object('warningId', v_warning));
  RETURN public.community_forum_done('ok', v_warning);
END $$;--> statement-breakpoint
-- The warned member acknowledges their own warning, once.
CREATE FUNCTION public.community_warning_ack(p_slug text, p_warning_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  UPDATE public.community_warnings SET acknowledged_at = now()
    WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_warning_id AND user_id = actor AND acknowledged_at IS NULL;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.warning_ack', p_warning_id::text);
  RETURN public.community_forum_done('ok', p_warning_id);
END $$;--> statement-breakpoint
-- The member's own unacknowledged warnings. Who issued them is never returned.
CREATE FUNCTION public.community_my_warnings(p_slug text) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN PERFORM public.community_definer_reset(); RETURN; END IF;
  RETURN QUERY SELECT jsonb_build_object('id', w.id, 'reason', w.reason, 'createdAt', w.created_at)
    FROM public.community_warnings w
    WHERE w.tenant_id = ctx.o_tenant AND w.community_id = ctx.o_community AND w.user_id = actor AND w.acknowledged_at IS NULL
    ORDER BY w.created_at LIMIT 20;
  PERFORM public.community_definer_reset();
END $$;--> statement-breakpoint
-- A banned member sends one appeal per ban. Banned people can read nothing, so this resolves the community itself.
CREATE FUNCTION public.community_appeal_submit(p_slug text, p_message text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); c record; m record; v_message text := btrim(coalesce(p_message, '')); v_appeal uuid; v_recent boolean;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT * INTO c FROM public.communities WHERE slug = p_slug AND status = 'published';
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  SELECT * INTO m FROM public.community_memberships WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  IF m.status <> 'banned' THEN RETURN public.community_forum_done('not_found'); END IF;
  IF length(v_message) NOT BETWEEN 1 AND 1000 THEN RETURN public.community_forum_done('invalid'); END IF;
  v_recent := EXISTS (SELECT 1 FROM public.community_appeals a WHERE a.tenant_id = c.tenant_id AND a.community_id = c.id AND a.user_id = actor AND a.created_at >= m.updated_at);
  IF v_recent THEN RETURN public.community_forum_done('duplicate'); END IF;
  INSERT INTO public.community_appeals (tenant_id, community_id, user_id, message) VALUES (c.tenant_id, c.id, actor, v_message)
    ON CONFLICT (community_id, user_id) WHERE status = 'open' DO NOTHING RETURNING id INTO v_appeal;
  IF v_appeal IS NULL THEN RETURN public.community_forum_done('duplicate'); END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (c.tenant_id, actor, 'community.appeal_submit', v_appeal::text);
  RETURN public.community_forum_done('ok', v_appeal);
END $$;--> statement-breakpoint
-- Hosts decide an open appeal. Any host may decline; approving is an unban (membership becomes 'left'), owner or admin only.
CREATE FUNCTION public.community_appeal_decide(p_slug text, p_appeal_id uuid, p_decision text, p_reply text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; a record; m record; v_reply text := nullif(btrim(coalesce(p_reply, '')), ''); v_rank integer;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_decision NOT IN ('approve', 'decline') OR (v_reply IS NOT NULL AND length(v_reply) > 500) THEN RETURN public.community_forum_done('invalid'); END IF;
  v_rank := CASE ctx.o_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 ELSE 1 END;
  IF p_decision = 'approve' AND v_rank < 2 THEN RETURN public.community_forum_done('forbidden'); END IF;
  SELECT * INTO a FROM public.community_appeals WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_appeal_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  SELECT * INTO m FROM public.community_memberships WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = a.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_forum_done('invalid'); END IF;
  IF m.status <> 'banned' THEN RETURN public.community_forum_done('invalid'); END IF;
  IF p_decision = 'approve' THEN
    UPDATE public.community_memberships SET status = 'left', updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = a.user_id;
  END IF;
  UPDATE public.community_appeals SET status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'declined' END, reply = v_reply, decided_by = actor, decided_at = now()
    WHERE id = a.id;
  PERFORM public.community_moderation_log(ctx.o_tenant, ctx.o_community, CASE WHEN p_decision = 'approve' THEN 'appeal_approve' ELSE 'appeal_decline' END,
    'member', a.user_id, a.user_id, jsonb_build_object('appealId', a.id));
  RETURN public.community_forum_done('ok', a.id);
END $$;--> statement-breakpoint
-- The caller's own removals (and approved appeals from the last 30 days) with the latest appeal. Banned people read nothing
-- else, so this definer lists them across ministries; hosts' decision text for them is the reply only.
CREATE FUNCTION public.community_my_bans() RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ids text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.community_resolve_user', actor, true);
  SELECT string_agg(m.community_id::text, ',') INTO ids FROM public.community_memberships m
    WHERE m.user_id = actor AND (m.status = 'banned' OR (m.status = 'left' AND EXISTS (SELECT 1 FROM public.community_appeals a
      WHERE a.tenant_id = m.tenant_id AND a.community_id = m.community_id AND a.user_id = actor AND a.status = 'approved' AND a.decided_at > now() - interval '30 days')));
  PERFORM set_config('app.community_resolve_ids', coalesce(ids, ''), true);
  RETURN QUERY SELECT jsonb_build_object('slug', c.slug, 'name', c.name, 'banned', m.status = 'banned',
      'canAppeal', m.status = 'banned' AND NOT EXISTS (SELECT 1 FROM public.community_appeals x WHERE x.tenant_id = m.tenant_id AND x.community_id = m.community_id
        AND x.user_id = actor AND x.created_at >= m.updated_at),
      'appeal', (SELECT jsonb_build_object('id', a.id, 'status', a.status, 'message', a.message, 'reply', a.reply, 'createdAt', a.created_at, 'decidedAt', a.decided_at)
        FROM public.community_appeals a WHERE a.tenant_id = m.tenant_id AND a.community_id = m.community_id AND a.user_id = actor ORDER BY a.created_at DESC LIMIT 1))
    FROM public.community_memberships m JOIN public.communities c ON c.tenant_id = m.tenant_id AND c.id = m.community_id
    WHERE m.user_id = actor AND c.status = 'published' AND (m.status = 'banned' OR (m.status = 'left' AND EXISTS (SELECT 1 FROM public.community_appeals a
      WHERE a.tenant_id = m.tenant_id AND a.community_id = m.community_id AND a.user_id = actor AND a.status = 'approved' AND a.decided_at > now() - interval '30 days')))
    ORDER BY c.name;
  PERFORM public.community_definer_reset();
END $$;--> statement-breakpoint
-- Changed from 0039 (signatures kept).
-- Changed from 0039: an edit that changes the content keeps the previous version (latest 50) for the hosts.
CREATE OR REPLACE FUNCTION public.community_post_save(p_slug text, p_post_id uuid, p_category_id uuid, p_title text, p_body jsonb, p_body_text text,
  p_video_url text, p_cover_file_id uuid, p_attachment_ids uuid[], p_comments_off boolean, p_likes_off boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; cat record; v_post uuid := p_post_id; existing record;
  attachments uuid[] := coalesce(p_attachment_ids, ARRAY[]::uuid[]); usable integer; expected integer; v_hold text;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF public.community_is_muted(ctx.o_tenant, ctx.o_community) THEN RETURN public.community_forum_done('muted'); END IF;
  SELECT * INTO cat FROM public.community_categories WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_category_id;
  IF NOT FOUND THEN RETURN public.community_forum_done('invalid'); END IF;
  IF cat.hosts_only AND ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF cardinality(attachments) > 5 OR cardinality(attachments) <> (SELECT count(DISTINCT a) FROM unnest(attachments) a) THEN RETURN public.community_forum_done('invalid'); END IF;
  IF v_post IS NOT NULL THEN
    SELECT * INTO existing FROM public.community_posts WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = v_post AND removed_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
    IF existing.author_id IS DISTINCT FROM actor THEN RETURN public.community_forum_done('forbidden'); END IF;
  END IF;
  SELECT count(*) INTO usable FROM public.community_files f WHERE f.tenant_id = ctx.o_tenant AND f.community_id = ctx.o_community
    AND f.uploader_id = actor AND f.status = 'ready' AND (f.post_id IS NULL OR f.post_id = v_post)
    AND ((f.id = p_cover_file_id AND f.kind = 'cover') OR (f.id = ANY (attachments) AND f.kind = 'attachment'));
  -- Computed first: PL/pgSQL ends an IF condition at the first THEN, including one inside CASE.
  expected := cardinality(attachments) + (CASE WHEN p_cover_file_id IS NULL THEN 0 ELSE 1 END);
  IF usable <> expected THEN RETURN public.community_forum_done('invalid'); END IF;
  v_hold := public.community_hold_reason(ctx.o_tenant, ctx.o_community, ctx.o_role, coalesce(p_title, '') || ' ' || coalesce(p_body_text, ''), v_post IS NULL);
  IF v_post IS NULL THEN
    INSERT INTO public.community_posts (tenant_id, community_id, category_id, author_id, title, body, body_text, video_url, cover_file_id, comments_off, likes_off,
        held_at, held_reason)
      VALUES (ctx.o_tenant, ctx.o_community, p_category_id, actor, p_title, p_body, coalesce(p_body_text, ''), p_video_url, p_cover_file_id,
        coalesce(p_comments_off, false), coalesce(p_likes_off, false), CASE WHEN v_hold IS NULL THEN NULL ELSE now() END, v_hold) RETURNING id INTO v_post;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.post_create', v_post::text);
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
  END IF;
  UPDATE public.community_files SET post_id = NULL, updated_at = now()
    WHERE tenant_id = ctx.o_tenant AND post_id = v_post AND id <> ALL (attachments) AND id IS DISTINCT FROM p_cover_file_id;
  UPDATE public.community_files SET post_id = v_post, updated_at = now()
    WHERE tenant_id = ctx.o_tenant AND (id = ANY (attachments) OR id = p_cover_file_id);
  RETURN public.community_forum_done(CASE WHEN v_hold IS NOT NULL AND p_post_id IS NULL THEN 'held' ELSE 'ok' END, v_post);
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_comment_save(p_slug text, p_post_id uuid, p_comment_id uuid, p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; post record; existing record; v_comment uuid := p_comment_id; v_hold text;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF public.community_is_muted(ctx.o_tenant, ctx.o_community) THEN RETURN public.community_forum_done('muted'); END IF;
  SELECT * INTO post FROM public.community_posts WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_post_id
    AND removed_at IS NULL AND held_at IS NULL;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  v_hold := public.community_hold_reason(ctx.o_tenant, ctx.o_community, ctx.o_role, p_body, v_comment IS NULL);
  IF v_comment IS NULL THEN
    IF post.comments_off THEN RETURN public.community_forum_done('forbidden'); END IF;
    INSERT INTO public.community_comments (tenant_id, community_id, post_id, author_id, body, held_at, held_reason)
      VALUES (ctx.o_tenant, ctx.o_community, p_post_id, actor, p_body, CASE WHEN v_hold IS NULL THEN NULL ELSE now() END, v_hold) RETURNING id INTO v_comment;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.comment_create', v_comment::text);
    RETURN public.community_forum_done(CASE WHEN v_hold IS NULL THEN 'ok' ELSE 'held' END, v_comment);
  END IF;
  SELECT * INTO existing FROM public.community_comments WHERE tenant_id = ctx.o_tenant AND post_id = p_post_id AND id = v_comment AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  IF existing.author_id IS DISTINCT FROM actor THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF existing.body IS DISTINCT FROM p_body THEN
    INSERT INTO public.community_comment_revisions (tenant_id, community_id, comment_id, body, saved_at)
      VALUES (ctx.o_tenant, ctx.o_community, v_comment, existing.body,
        coalesce((SELECT max(r.created_at) FROM public.community_comment_revisions r WHERE r.comment_id = v_comment), existing.created_at));
    DELETE FROM public.community_comment_revisions r WHERE r.comment_id = v_comment
      AND r.id NOT IN (SELECT x.id FROM public.community_comment_revisions x WHERE x.comment_id = v_comment ORDER BY x.created_at DESC, x.id LIMIT 50);
  END IF;
  UPDATE public.community_comments SET body = p_body, updated_at = now(),
    held_at = CASE WHEN held_at IS NULL AND v_hold IS NOT NULL THEN now() ELSE held_at END,
    held_reason = CASE WHEN held_at IS NULL AND v_hold IS NOT NULL THEN v_hold ELSE held_reason END
    WHERE id = v_comment;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.comment_edit', v_comment::text);
  RETURN public.community_forum_done('ok', v_comment);
END $$;--> statement-breakpoint
-- Hosts mute (1, 7 or 30 days), unmute, ban and unban members of lower rank (never the owner, never themselves).
-- A ban resets the role to member, revokes the person's grants and declines their open application. Unban (owner or
-- admin only) leaves them free to rejoin through the normal way in.
CREATE OR REPLACE FUNCTION public.community_member_moderate(p_slug text, p_user_id text, p_action text, p_days integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; target record; actor_rank integer; target_rank integer;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_action NOT IN ('mute', 'unmute', 'ban', 'unban') OR (p_action = 'mute' AND coalesce(p_days, 0) NOT IN (1, 7, 30)) THEN
    RETURN public.community_forum_done('invalid');
  END IF;
  SELECT * INTO target FROM public.community_memberships WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  actor_rank := CASE ctx.o_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 1 ELSE 0 END;
  target_rank := CASE target.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 1 ELSE 0 END;
  IF p_user_id = actor OR target.role = 'owner' OR actor_rank <= target_rank THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_action = 'mute' THEN
    IF target.status <> 'active' THEN RETURN public.community_forum_done('invalid'); END IF;
    UPDATE public.community_memberships SET muted_until = now() + make_interval(days => p_days), updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id;
  ELSIF p_action = 'unmute' THEN
    UPDATE public.community_memberships SET muted_until = NULL, updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id;
  ELSIF p_action = 'ban' THEN
    IF target.status = 'banned' THEN RETURN public.community_forum_done('invalid'); END IF;
    UPDATE public.community_memberships SET status = 'banned', role = 'member', muted_until = NULL, updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id;
    UPDATE public.entitlements SET revoked_at = now(), revoked_by = actor
      WHERE tenant_id = ctx.o_tenant AND user_id = p_user_id AND resource_type = 'community' AND resource_id = ctx.o_community AND revoked_at IS NULL;
    UPDATE public.community_applications SET status = 'declined', decided_by = actor, decided_at = now(), updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id AND status IN ('pending', 'info_requested');
  ELSE
    IF target.status <> 'banned' OR actor_rank < 2 THEN RETURN public.community_forum_done(CASE WHEN target.status <> 'banned' THEN 'invalid' ELSE 'forbidden' END); END IF;
    UPDATE public.community_memberships SET status = 'left', updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id;
    -- An unban settles the person's open appeal as approved (C12b).
    UPDATE public.community_appeals SET status = 'approved', decided_by = actor, decided_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id AND status = 'open';
  END IF;
  PERFORM public.community_moderation_log(ctx.o_tenant, ctx.o_community, p_action, 'member', p_user_id, p_user_id,
    CASE WHEN p_action = 'mute' THEN jsonb_build_object('days', p_days) ELSE '{}'::jsonb END);
  RETURN public.community_forum_done('ok');
END $$;--> statement-breakpoint
-- Hosts' member list: active, muted and banned members with names and roles. Never contact details.
CREATE OR REPLACE FUNCTION public.community_moderation_members(p_slug text) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL OR ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN PERFORM public.community_definer_reset(); RETURN; END IF;
  RETURN QUERY SELECT jsonb_build_object('userId', m.user_id, 'name', u.name, 'role', m.role, 'status', m.status, 'joinedAt', m.joined_at,
      'mutedUntil', CASE WHEN m.muted_until > now() THEN m.muted_until END,
      'warnings', (SELECT count(*)::int FROM public.community_warnings w WHERE w.tenant_id = m.tenant_id AND w.community_id = m.community_id AND w.user_id = m.user_id))
    FROM public.community_memberships m JOIN public.users u ON u.id = m.user_id
    WHERE m.tenant_id = ctx.o_tenant AND m.community_id = ctx.o_community AND m.status IN ('active', 'banned')
    ORDER BY m.status, CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 WHEN 'contributor' THEN 3 ELSE 4 END, m.joined_at NULLS LAST
    LIMIT 2000;
  PERFORM public.community_definer_reset();
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_warn(text, text, text), public.community_warning_ack(text, uuid), public.community_my_warnings(text),
  public.community_appeal_submit(text, text), public.community_appeal_decide(text, uuid, text, text), public.community_my_bans() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_warn(text, text, text), public.community_warning_ack(text, uuid), public.community_my_warnings(text),
  public.community_appeal_submit(text, text), public.community_appeal_decide(text, uuid, text, text), public.community_my_bans() TO harvest_app;
