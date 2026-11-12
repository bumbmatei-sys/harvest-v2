CREATE TABLE "community_moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"subject_user_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_moderation_action" CHECK ("community_moderation_actions"."action" in ('report_dismiss', 'report_remove', 'held_approve', 'held_reject', 'mute', 'unmute', 'ban', 'unban')),
	CONSTRAINT "community_moderation_target" CHECK ("community_moderation_actions"."target_type" in ('post', 'comment', 'member'))
);
--> statement-breakpoint
CREATE TABLE "community_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"reporter_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_report_target" CHECK ("community_reports"."target_type" in ('post', 'comment', 'member') and length("community_reports"."target_id") between 1 and 200),
	CONSTRAINT "community_report_reason" CHECK ("community_reports"."reason" in ('spam', 'harassment', 'inappropriate', 'other')),
	CONSTRAINT "community_report_note" CHECK ("community_reports"."note" is null or length("community_reports"."note") between 1 and 500),
	CONSTRAINT "community_report_status" CHECK ("community_reports"."status" in ('open', 'dismissed', 'actioned'))
);
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "hold_first_posts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "banned_words" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "community_comments" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_comments" ADD COLUMN "held_reason" text;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN "held_reason" text;--> statement-breakpoint
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_moderation_actions_idx" ON "community_moderation_actions" USING btree ("community_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_reports_open_idx" ON "community_reports" USING btree ("community_id","reporter_id","target_type","target_id") WHERE "community_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "community_reports_queue_idx" ON "community_reports" USING btree ("community_id","status","target_type","target_id");--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_banned_words" CHECK (cardinality("communities"."banned_words") <= 100);--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comment_held" CHECK (("community_comments"."held_at" is null) = ("community_comments"."held_reason" is null) and ("community_comments"."held_reason" is null or "community_comments"."held_reason" in ('first_post', 'banned_word')));--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_post_held" CHECK (("community_posts"."held_at" is null) = ("community_posts"."held_reason" is null) and ("community_posts"."held_reason" is null or "community_posts"."held_reason" in ('first_post', 'banned_word')));--> statement-breakpoint
-- C12a: hosts (community owner, admin, moderator with an active membership). Invoker rights, fixed search_path,
-- relies on the caller's own-row membership policy.
CREATE FUNCTION public.community_is_host(p_tenant uuid, p_community uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_memberships m
    WHERE m.tenant_id = p_tenant AND m.community_id = p_community AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND m.status = 'active' AND m.role IN ('owner', 'admin', 'moderator'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_is_host(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_is_host(uuid, uuid) TO harvest_app;--> statement-breakpoint
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['community_reports','community_moderation_actions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', relation_name);
  -- Read only for the app role: every write goes through the definers below.
  EXECUTE format('GRANT SELECT ON public.%I TO harvest_app', relation_name);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO harvest_app
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, relation_name || '_staff', relation_name);
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO harvest_app USING (public.community_is_host(tenant_id, community_id))$p$,
    relation_name || '_host', relation_name);
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.%I TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, relation_name, current_user);
 END LOOP;
END $$;--> statement-breakpoint
-- Whole-word, case-insensitive match; mirrors matchesBannedWord in src/lib/moderation.ts.
CREATE FUNCTION public.community_banned_word_match(p_text text, p_words text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(coalesce(p_words, ARRAY[]::text[])) w
    WHERE length(w) > 0 AND lower(coalesce(p_text, '')) ~ ('(^|[^[:alnum:]])' || regexp_replace(w, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '($|[^[:alnum:]])'))
$$;--> statement-breakpoint
-- Why a new item (or an edit) should be held, or null. Called only inside the definers (not granted).
CREATE FUNCTION public.community_hold_reason(p_tenant uuid, p_community uuid, p_role text, p_text text, p_check_first boolean) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); c record;
BEGIN
  SELECT hold_first_posts, banned_words INTO c FROM public.communities WHERE tenant_id = p_tenant AND id = p_community;
  IF public.community_banned_word_match(p_text, c.banned_words) THEN RETURN 'banned_word'; END IF;
  IF p_check_first AND c.hold_first_posts AND p_role NOT IN ('owner', 'admin', 'moderator', 'contributor')
    AND NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.tenant_id = p_tenant AND p.community_id = p_community AND p.author_id = actor
      AND p.held_at IS NULL AND p.removed_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.community_comments x WHERE x.tenant_id = p_tenant AND x.community_id = p_community AND x.author_id = actor
      AND x.held_at IS NULL AND x.removed_at IS NULL) THEN
    RETURN 'first_post';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION public.community_is_muted(p_tenant uuid, p_community uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_memberships m WHERE m.tenant_id = p_tenant AND m.community_id = p_community
    AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.muted_until > now())
$$;--> statement-breakpoint
CREATE FUNCTION public.community_moderation_log(p_tenant uuid, p_community uuid, p_action text, p_target_type text, p_target_id text,
  p_subject text, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  INSERT INTO public.community_moderation_actions (tenant_id, community_id, actor_id, action, target_type, target_id, subject_user_id, detail)
    VALUES (p_tenant, p_community, actor, p_action, p_target_type, p_target_id, p_subject, coalesce(p_detail, '{}'::jsonb));
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (p_tenant, actor, 'community.moderation_' || p_action, p_target_id);
END $$;--> statement-breakpoint
-- Changed from 0038: muted members cannot post; new posts may be held (first post, banned word); edits re-check banned words.
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
  UPDATE public.community_comments SET body = p_body, updated_at = now(),
    held_at = CASE WHEN held_at IS NULL AND v_hold IS NOT NULL THEN now() ELSE held_at END,
    held_reason = CASE WHEN held_at IS NULL AND v_hold IS NOT NULL THEN v_hold ELSE held_reason END
    WHERE id = v_comment;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.comment_edit', v_comment::text);
  RETURN public.community_forum_done('ok', v_comment);
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_like_toggle(p_slug text, p_target_type text, p_target_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; v_likes_off boolean;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF public.community_is_muted(ctx.o_tenant, ctx.o_community) THEN RETURN public.community_forum_done('muted'); END IF;
  IF p_target_type = 'post' THEN
    SELECT p.likes_off INTO v_likes_off FROM public.community_posts p WHERE p.tenant_id = ctx.o_tenant AND p.community_id = ctx.o_community AND p.id = p_target_id
      AND p.removed_at IS NULL AND p.held_at IS NULL;
  ELSIF p_target_type = 'comment' THEN
    SELECT p.likes_off INTO v_likes_off FROM public.community_comments c JOIN public.community_posts p ON p.id = c.post_id
      WHERE c.tenant_id = ctx.o_tenant AND c.community_id = ctx.o_community AND c.id = p_target_id AND c.removed_at IS NULL AND c.held_at IS NULL
        AND p.removed_at IS NULL AND p.held_at IS NULL;
  END IF;
  IF v_likes_off IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF v_likes_off THEN RETURN public.community_forum_done('forbidden'); END IF;
  DELETE FROM public.community_likes WHERE target_type = p_target_type AND target_id = p_target_id AND user_id = actor;
  IF FOUND THEN RETURN public.community_forum_done('unliked', p_target_id); END IF;
  INSERT INTO public.community_likes (tenant_id, community_id, target_type, target_id, user_id) VALUES (ctx.o_tenant, ctx.o_community, p_target_type, p_target_id, actor)
    ON CONFLICT DO NOTHING;
  RETURN public.community_forum_done('liked', p_target_id);
END $$;--> statement-breakpoint
-- Report a post, reply or member. Readers only; never one's own content or oneself; one open report per target.
CREATE FUNCTION public.community_report(p_slug text, p_target_type text, p_target_id text, p_reason text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; v_owner text; v_found boolean := false; v_report uuid;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF p_reason NOT IN ('spam', 'harassment', 'inappropriate', 'other') OR (p_note IS NOT NULL AND length(p_note) NOT BETWEEN 1 AND 500) THEN
    RETURN public.community_forum_done('invalid');
  END IF;
  IF p_target_type = 'post' THEN
    SELECT true, p.author_id INTO v_found, v_owner FROM public.community_posts p WHERE p.tenant_id = ctx.o_tenant AND p.community_id = ctx.o_community
      AND p.id::text = p_target_id AND p.removed_at IS NULL AND p.held_at IS NULL;
  ELSIF p_target_type = 'comment' THEN
    SELECT true, c.author_id INTO v_found, v_owner FROM public.community_comments c WHERE c.tenant_id = ctx.o_tenant AND c.community_id = ctx.o_community
      AND c.id::text = p_target_id AND c.removed_at IS NULL AND c.held_at IS NULL;
  ELSIF p_target_type = 'member' THEN
    SELECT true, m.user_id INTO v_found, v_owner FROM public.community_memberships m WHERE m.tenant_id = ctx.o_tenant AND m.community_id = ctx.o_community
      AND m.user_id = p_target_id AND m.status = 'active';
  ELSE RETURN public.community_forum_done('invalid');
  END IF;
  IF NOT coalesce(v_found, false) THEN RETURN public.community_forum_done('not_found'); END IF;
  IF v_owner = actor THEN RETURN public.community_forum_done('forbidden'); END IF;
  INSERT INTO public.community_reports (tenant_id, community_id, reporter_id, target_type, target_id, reason, note)
    VALUES (ctx.o_tenant, ctx.o_community, actor, p_target_type, p_target_id, p_reason, p_note)
    ON CONFLICT (community_id, reporter_id, target_type, target_id) WHERE status = 'open' DO NOTHING RETURNING id INTO v_report;
  IF v_report IS NULL THEN RETURN public.community_forum_done('duplicate'); END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.report', v_report::text);
  RETURN public.community_forum_done('ok', v_report);
END $$;--> statement-breakpoint
-- Hosts decide a report: keep (dismiss) or remove the post/reply. Every open report on the same target closes.
CREATE FUNCTION public.community_report_decide(p_slug text, p_report_id uuid, p_decision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; r record; v_subject text; v_closed integer;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_decision NOT IN ('keep', 'remove') THEN RETURN public.community_forum_done('invalid'); END IF;
  SELECT * INTO r FROM public.community_reports WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_report_id AND status = 'open';
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  IF p_decision = 'remove' AND r.target_type = 'member' THEN RETURN public.community_forum_done('invalid'); END IF;
  IF r.target_type = 'post' THEN
    SELECT author_id INTO v_subject FROM public.community_posts WHERE tenant_id = ctx.o_tenant AND id::text = r.target_id;
    IF p_decision = 'remove' THEN
      UPDATE public.community_posts SET removed_at = now(), removed_by = actor, updated_at = now()
        WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id::text = r.target_id AND removed_at IS NULL;
    END IF;
  ELSIF r.target_type = 'comment' THEN
    SELECT author_id INTO v_subject FROM public.community_comments WHERE tenant_id = ctx.o_tenant AND id::text = r.target_id;
    IF p_decision = 'remove' THEN
      UPDATE public.community_comments SET removed_at = now(), removed_by = actor, updated_at = now()
        WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id::text = r.target_id AND removed_at IS NULL;
    END IF;
  ELSE v_subject := r.target_id;
  END IF;
  UPDATE public.community_reports SET status = CASE WHEN p_decision = 'remove' THEN 'actioned' ELSE 'dismissed' END, decided_by = actor, decided_at = now()
    WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND target_type = r.target_type AND target_id = r.target_id AND status = 'open';
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  PERFORM public.community_moderation_log(ctx.o_tenant, ctx.o_community, CASE WHEN p_decision = 'remove' THEN 'report_remove' ELSE 'report_dismiss' END,
    r.target_type, r.target_id, v_subject, jsonb_build_object('reports', v_closed));
  RETURN public.community_forum_done('ok', p_report_id);
END $$;--> statement-breakpoint
-- Hosts approve or reject a held post/reply.
CREATE FUNCTION public.community_held_decide(p_slug text, p_target_type text, p_id uuid, p_decision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; v_subject text;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN RETURN public.community_forum_done('invalid'); END IF;
  IF p_target_type = 'post' THEN
    UPDATE public.community_posts SET held_at = CASE WHEN p_decision = 'approve' THEN NULL ELSE held_at END,
      held_reason = CASE WHEN p_decision = 'approve' THEN NULL ELSE held_reason END,
      removed_at = CASE WHEN p_decision = 'reject' THEN now() ELSE removed_at END, removed_by = CASE WHEN p_decision = 'reject' THEN actor ELSE removed_by END,
      updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_id AND held_at IS NOT NULL AND removed_at IS NULL RETURNING author_id INTO v_subject;
  ELSIF p_target_type = 'comment' THEN
    UPDATE public.community_comments SET held_at = CASE WHEN p_decision = 'approve' THEN NULL ELSE held_at END,
      held_reason = CASE WHEN p_decision = 'approve' THEN NULL ELSE held_reason END,
      removed_at = CASE WHEN p_decision = 'reject' THEN now() ELSE removed_at END, removed_by = CASE WHEN p_decision = 'reject' THEN actor ELSE removed_by END,
      updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_id AND held_at IS NOT NULL AND removed_at IS NULL RETURNING author_id INTO v_subject;
  ELSE RETURN public.community_forum_done('invalid');
  END IF;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  PERFORM public.community_moderation_log(ctx.o_tenant, ctx.o_community, CASE WHEN p_decision = 'approve' THEN 'held_approve' ELSE 'held_reject' END,
    p_target_type, p_id::text, v_subject);
  RETURN public.community_forum_done('ok', p_id);
END $$;--> statement-breakpoint
-- Hosts mute (1, 7 or 30 days), unmute, ban and unban members of lower rank (never the owner, never themselves).
-- A ban resets the role to member, revokes the person's grants and declines their open application. Unban (owner or
-- admin only) leaves them free to rejoin through the normal way in.
CREATE FUNCTION public.community_member_moderate(p_slug text, p_user_id text, p_action text, p_days integer) RETURNS jsonb
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
  END IF;
  PERFORM public.community_moderation_log(ctx.o_tenant, ctx.o_community, p_action, 'member', p_user_id, p_user_id,
    CASE WHEN p_action = 'mute' THEN jsonb_build_object('days', p_days) ELSE '{}'::jsonb END);
  RETURN public.community_forum_done('ok');
END $$;--> statement-breakpoint
-- Hosts' member list: active, muted and banned members with names and roles. Never contact details.
CREATE FUNCTION public.community_moderation_members(p_slug text) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL OR ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN PERFORM public.community_definer_reset(); RETURN; END IF;
  RETURN QUERY SELECT jsonb_build_object('userId', m.user_id, 'name', u.name, 'role', m.role, 'status', m.status, 'joinedAt', m.joined_at,
      'mutedUntil', CASE WHEN m.muted_until > now() THEN m.muted_until END)
    FROM public.community_memberships m JOIN public.users u ON u.id = m.user_id
    WHERE m.tenant_id = ctx.o_tenant AND m.community_id = ctx.o_community AND m.status IN ('active', 'banned')
    ORDER BY m.status, CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 WHEN 'contributor' THEN 3 ELSE 4 END, m.joined_at NULLS LAST
    LIMIT 2000;
  PERFORM public.community_definer_reset();
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_banned_word_match(text, text[]), public.community_hold_reason(uuid, uuid, text, text, boolean),
  public.community_is_muted(uuid, uuid), public.community_moderation_log(uuid, uuid, text, text, text, text, jsonb),
  public.community_report(text, text, text, text, text), public.community_report_decide(text, uuid, text), public.community_held_decide(text, text, uuid, text),
  public.community_member_moderate(text, text, text, integer), public.community_moderation_members(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_report(text, text, text, text, text), public.community_report_decide(text, uuid, text),
  public.community_held_decide(text, text, uuid, text), public.community_member_moderate(text, text, text, integer),
  public.community_moderation_members(text) TO harvest_app;
