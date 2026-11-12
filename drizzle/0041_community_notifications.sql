CREATE TABLE "community_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"post_id" uuid,
	"actor_id" text,
	"actor_count" integer DEFAULT 1 NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_notification_kind" CHECK ("community_notifications"."kind" in ('reply', 'thread_reply', 'like', 'application', 'warning', 'held_decision', 'appeal_decision', 'host_queue')),
	CONSTRAINT "community_notification_target" CHECK ("community_notifications"."target_type" in ('post', 'comment', 'application', 'warning', 'appeal', 'community') and length("community_notifications"."target_id") between 1 and 200),
	CONSTRAINT "community_notification_count" CHECK ("community_notifications"."actor_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "welcome_message" text;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "intro_category_id" uuid;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "notify_replies" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "notify_likes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "notify_announcements" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "notifications_muted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "notifications_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "welcome_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_notifications" ADD CONSTRAINT "community_notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_notifications" ADD CONSTRAINT "community_notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_notifications" ADD CONSTRAINT "community_notifications_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_notifications_inbox_idx" ON "community_notifications" USING btree ("recipient_id","community_id","read_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "community_notifications_like_group_idx" ON "community_notifications" USING btree ("recipient_id","community_id","target_type","target_id") WHERE "community_notifications"."kind" = 'like' and "community_notifications"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "community_notifications_queue_group_idx" ON "community_notifications" USING btree ("recipient_id","community_id") WHERE "community_notifications"."kind" = 'host_queue' and "community_notifications"."read_at" is null;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_intro_category_id_community_categories_id_fk" FOREIGN KEY ("intro_category_id") REFERENCES "public"."community_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_welcome_message" CHECK ("communities"."welcome_message" is null or length("communities"."welcome_message") between 1 and 1000);
--> statement-breakpoint
-- C15a: in-app notifications. Members read only their own rows; every write is a definer (below) except one staff INSERT:
-- application decisions run in the staff path (withTenant) and insert their own notification under the tenant policy.
ALTER TABLE public.community_notifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.community_notifications FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.community_notifications FROM PUBLIC, harvest_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.community_notifications TO harvest_app;--> statement-breakpoint
-- No staff SELECT policy: notifications are personal (review on #67). Staff only insert application notices below.
CREATE POLICY community_notifications_staff_insert ON public.community_notifications FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND kind = 'application');--> statement-breakpoint
CREATE POLICY community_notifications_recipient ON public.community_notifications FOR SELECT TO harvest_app
  USING (recipient_id = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.community_notifications TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  -- Retention: only the purge definer sets this, and only read notifications older than 90 days qualify. No command
  -- restriction: Postgres requires a DELETE's rows to be visible to SELECT as well.
  EXECUTE format($p$CREATE POLICY community_definer_purge ON public.community_notifications TO %I
    USING (current_setting('app.community_purge', true) = 'on' AND read_at IS NOT NULL AND read_at < now() - interval '90 days')$p$, current_user);
END $$;--> statement-breakpoint
-- The same predicate as community_can_read, for an explicit person (the recipient). Not granted.
CREATE FUNCTION public.community_user_can_read(p_tenant uuid, p_community uuid, p_user text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_memberships m
    WHERE m.tenant_id = p_tenant AND m.community_id = p_community AND m.user_id = p_user AND m.status = 'active'
      AND (m.role IN ('owner', 'admin', 'moderator', 'contributor') OR EXISTS (SELECT 1 FROM public.entitlements e
        WHERE e.tenant_id = p_tenant AND e.user_id = m.user_id AND e.resource_type = 'community' AND e.resource_id = p_community
          AND e.revoked_at IS NULL AND e.valid_from <= now() AND (e.valid_until IS NULL OR e.valid_until > now()))))
$$;--> statement-breakpoint
-- Writes one notification for a recipient. Never the actor; never a member who muted the community or turned the kind off;
-- never someone who can no longer read the community (an appeal decision is the exception: banned people read nothing).
-- Likes and the host queue keep one unread row per recipient and target (or community) with a count. Not granted.
CREATE FUNCTION public.community_notify_as(p_actor text, p_tenant uuid, p_community uuid, p_recipient text, p_kind text, p_target_type text, p_target_id text,
  p_post_id uuid, p_detail jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := p_actor; m record; v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
BEGIN
  IF p_recipient IS NULL OR p_recipient IS NOT DISTINCT FROM actor THEN RETURN; END IF;
  SELECT m2.notify_replies, m2.notify_likes, m2.notifications_muted INTO m FROM public.community_memberships m2
    WHERE m2.tenant_id = p_tenant AND m2.community_id = p_community AND m2.user_id = p_recipient;
  IF FOUND THEN
    -- Appeal decisions are about the member's own ban and ignore mute (founder decision, 12 Nov).
    IF m.notifications_muted AND p_kind <> 'appeal_decision' THEN RETURN; END IF;
    IF p_kind IN ('reply', 'thread_reply') AND NOT m.notify_replies THEN RETURN; END IF;
    IF p_kind = 'like' AND NOT m.notify_likes THEN RETURN; END IF;
  END IF;
  IF p_kind <> 'appeal_decision' AND NOT public.community_user_can_read(p_tenant, p_community, p_recipient) THEN RETURN; END IF;
  IF p_kind = 'like' THEN
    INSERT INTO public.community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, post_id, actor_id, detail)
      VALUES (p_tenant, p_community, p_recipient, p_kind, p_target_type, p_target_id, p_post_id, actor, v_detail)
      ON CONFLICT (recipient_id, community_id, target_type, target_id) WHERE kind = 'like' AND read_at IS NULL
      -- Count distinct people who like it now (since this group started), so like/unlike/like never inflates it (review on #67).
      DO UPDATE SET actor_count = greatest(1, (SELECT count(*)::int FROM public.community_likes l
          WHERE l.target_type = EXCLUDED.target_type AND l.target_id = EXCLUDED.target_id::uuid AND l.user_id IS DISTINCT FROM EXCLUDED.recipient_id
            AND l.created_at >= community_notifications.created_at)),
        actor_id = EXCLUDED.actor_id, updated_at = now();
  ELSIF p_kind = 'host_queue' THEN
    INSERT INTO public.community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, post_id, actor_id, detail)
      VALUES (p_tenant, p_community, p_recipient, p_kind, p_target_type, p_target_id, p_post_id, actor, v_detail)
      ON CONFLICT (recipient_id, community_id) WHERE kind = 'host_queue' AND read_at IS NULL
      DO UPDATE SET actor_count = community_notifications.actor_count + 1, actor_id = EXCLUDED.actor_id, updated_at = now();
  ELSE
    INSERT INTO public.community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, post_id, actor_id, detail)
      VALUES (p_tenant, p_community, p_recipient, p_kind, p_target_type, p_target_id, p_post_id, actor, v_detail);
  END IF;
END $$;--> statement-breakpoint
-- The current user is the actor. Not granted.
CREATE FUNCTION public.community_notify(p_tenant uuid, p_community uuid, p_recipient text, p_kind text, p_target_type text, p_target_id text,
  p_post_id uuid, p_detail jsonb) RETURNS void
LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_notify_as(nullif(current_setting('app.user_id', true), ''), p_tenant, p_community, p_recipient, p_kind, p_target_type, p_target_id, p_post_id, p_detail)
$$;--> statement-breakpoint
-- A visible reply tells the post author ("reply") and up to 50 earlier repliers ("thread_reply"), as the replier.
-- Used when a reply is published and when a held reply is approved (founder decision, 12 Nov). Not granted.
CREATE FUNCTION public.community_notify_reply(p_tenant uuid, p_community uuid, p_post_id uuid, p_comment_id uuid, p_replier text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_post_author text; v_rep record;
BEGIN
  SELECT author_id INTO v_post_author FROM public.community_posts WHERE tenant_id = p_tenant AND id = p_post_id AND removed_at IS NULL AND held_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.community_notify_as(p_replier, p_tenant, p_community, v_post_author, 'reply', 'comment', p_comment_id::text, p_post_id, '{}'::jsonb);
  FOR v_rep IN SELECT c.author_id FROM public.community_comments c
    WHERE c.tenant_id = p_tenant AND c.community_id = p_community AND c.post_id = p_post_id AND c.id <> p_comment_id
      AND c.removed_at IS NULL AND c.held_at IS NULL AND c.author_id IS NOT NULL AND c.author_id IS DISTINCT FROM v_post_author AND c.author_id IS DISTINCT FROM p_replier
    GROUP BY c.author_id ORDER BY max(c.created_at) DESC LIMIT 50 LOOP
    PERFORM public.community_notify_as(p_replier, p_tenant, p_community, v_rep.author_id, 'thread_reply', 'comment', p_comment_id::text, p_post_id, '{}'::jsonb);
  END LOOP;
END $$;--> statement-breakpoint
-- Tells every host (owner, admin, moderator) that something needs review, except the actor and one excluded person. Not granted.
CREATE FUNCTION public.community_notify_hosts(p_tenant uuid, p_community uuid, p_except text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE h record;
BEGIN
  FOR h IN SELECT m.user_id FROM public.community_memberships m WHERE m.tenant_id = p_tenant AND m.community_id = p_community AND m.status = 'active'
    AND m.role IN ('owner', 'admin', 'moderator') AND m.user_id IS DISTINCT FROM p_except LOOP
    PERFORM public.community_notify(p_tenant, p_community, h.user_id, 'host_queue', 'community', p_community::text, NULL, '{}'::jsonb);
  END LOOP;
END $$;
--> statement-breakpoint
-- Changed from 0040 (signatures kept): new held items notify the hosts; replies notify the post's author and earlier repliers.
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
    WHERE tenant_id = ctx.o_tenant AND post_id = v_post AND id <> ALL (attachments) AND id IS DISTINCT FROM p_cover_file_id;
  UPDATE public.community_files SET post_id = v_post, updated_at = now()
    WHERE tenant_id = ctx.o_tenant AND (id = ANY (attachments) OR id = p_cover_file_id);
  RETURN public.community_forum_done(CASE WHEN v_hold IS NOT NULL AND p_post_id IS NULL THEN 'held' ELSE 'ok' END, v_post);
END $$;
--> statement-breakpoint
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
    IF v_hold IS NOT NULL THEN
      PERFORM public.community_notify_hosts(ctx.o_tenant, ctx.o_community, NULL);
    ELSE
      PERFORM public.community_notify_reply(ctx.o_tenant, ctx.o_community, p_post_id, v_comment, actor);
    END IF;
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
  IF existing.held_at IS NULL AND v_hold IS NOT NULL THEN PERFORM public.community_notify_hosts(ctx.o_tenant, ctx.o_community, NULL); END IF;
  RETURN public.community_forum_done('ok', v_comment);
END $$;
--> statement-breakpoint
-- Changed from 0039: a like (never an unlike) notifies the author.
CREATE OR REPLACE FUNCTION public.community_like_toggle(p_slug text, p_target_type text, p_target_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; v_likes_off boolean; v_author text; v_post uuid; v_rows integer;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF public.community_is_muted(ctx.o_tenant, ctx.o_community) THEN RETURN public.community_forum_done('muted'); END IF;
  IF p_target_type = 'post' THEN
    SELECT p.likes_off, p.author_id, p.id INTO v_likes_off, v_author, v_post FROM public.community_posts p WHERE p.tenant_id = ctx.o_tenant AND p.community_id = ctx.o_community AND p.id = p_target_id
      AND p.removed_at IS NULL AND p.held_at IS NULL;
  ELSIF p_target_type = 'comment' THEN
    SELECT p.likes_off, c.author_id, c.post_id INTO v_likes_off, v_author, v_post FROM public.community_comments c JOIN public.community_posts p ON p.id = c.post_id
      WHERE c.tenant_id = ctx.o_tenant AND c.community_id = ctx.o_community AND c.id = p_target_id AND c.removed_at IS NULL AND c.held_at IS NULL
        AND p.removed_at IS NULL AND p.held_at IS NULL;
  END IF;
  IF v_likes_off IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF v_likes_off THEN RETURN public.community_forum_done('forbidden'); END IF;
  DELETE FROM public.community_likes WHERE target_type = p_target_type AND target_id = p_target_id AND user_id = actor;
  IF FOUND THEN RETURN public.community_forum_done('unliked', p_target_id); END IF;
  INSERT INTO public.community_likes (tenant_id, community_id, target_type, target_id, user_id) VALUES (ctx.o_tenant, ctx.o_community, p_target_type, p_target_id, actor)
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    PERFORM public.community_notify(ctx.o_tenant, ctx.o_community, v_author, 'like', p_target_type, p_target_id::text, v_post, '{}'::jsonb);
  END IF;
  RETURN public.community_forum_done('liked', p_target_id);
END $$;
--> statement-breakpoint
-- Changed from 0039: a report notifies the hosts.
CREATE OR REPLACE FUNCTION public.community_report(p_slug text, p_target_type text, p_target_id text, p_reason text, p_note text) RETURNS jsonb
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
  -- Hosts are told, except the person reported (or whose content was reported): they never see that queue item.
  PERFORM public.community_notify_hosts(ctx.o_tenant, ctx.o_community, v_owner);
  RETURN public.community_forum_done('ok', v_report);
END $$;
--> statement-breakpoint
-- Changed from 0039: the author is told the decision.
CREATE OR REPLACE FUNCTION public.community_held_decide(p_slug text, p_target_type text, p_id uuid, p_decision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; v_subject text; v_found boolean; v_post uuid;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_decision NOT IN ('approve', 'reject') OR p_target_type NOT IN ('post', 'comment') THEN RETURN public.community_forum_done('invalid'); END IF;
  IF p_target_type = 'post' THEN
    SELECT true, author_id, id INTO v_found, v_subject, v_post FROM public.community_posts
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_id AND held_at IS NOT NULL AND removed_at IS NULL FOR UPDATE;
  ELSE
    SELECT true, author_id, post_id INTO v_found, v_subject, v_post FROM public.community_comments
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_id AND held_at IS NOT NULL AND removed_at IS NULL FOR UPDATE;
  END IF;
  IF NOT coalesce(v_found, false) THEN RETURN public.community_forum_done('not_found'); END IF;
  IF v_subject = actor THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_decision = 'reject' AND v_subject IS NOT NULL
    AND public.community_member_rank(ctx.o_tenant, ctx.o_community, v_subject) >= public.community_member_rank(ctx.o_tenant, ctx.o_community, actor) THEN
    RETURN public.community_forum_done('forbidden');
  END IF;
  IF p_target_type = 'post' THEN
    UPDATE public.community_posts SET held_at = CASE WHEN p_decision = 'approve' THEN NULL ELSE held_at END,
      held_reason = CASE WHEN p_decision = 'approve' THEN NULL ELSE held_reason END,
      removed_at = CASE WHEN p_decision = 'reject' THEN now() ELSE removed_at END, removed_by = CASE WHEN p_decision = 'reject' THEN actor ELSE removed_by END,
      updated_at = now() WHERE tenant_id = ctx.o_tenant AND id = p_id;
  ELSE
    UPDATE public.community_comments SET held_at = CASE WHEN p_decision = 'approve' THEN NULL ELSE held_at END,
      held_reason = CASE WHEN p_decision = 'approve' THEN NULL ELSE held_reason END,
      removed_at = CASE WHEN p_decision = 'reject' THEN now() ELSE removed_at END, removed_by = CASE WHEN p_decision = 'reject' THEN actor ELSE removed_by END,
      updated_at = now() WHERE tenant_id = ctx.o_tenant AND id = p_id;
  END IF;
  PERFORM public.community_moderation_log(ctx.o_tenant, ctx.o_community, CASE WHEN p_decision = 'approve' THEN 'held_approve' ELSE 'held_reject' END,
    p_target_type, p_id::text, v_subject);
  PERFORM public.community_notify(ctx.o_tenant, ctx.o_community, v_subject, 'held_decision', p_target_type, p_id::text, v_post, jsonb_build_object('decision', p_decision));
  -- An approved reply now shows, so the post author and earlier repliers hear about it as for any reply.
  IF p_decision = 'approve' AND p_target_type = 'comment' AND v_subject IS NOT NULL THEN
    PERFORM public.community_notify_reply(ctx.o_tenant, ctx.o_community, v_post, p_id, v_subject);
  END IF;
  RETURN public.community_forum_done('ok', p_id);
END $$;
--> statement-breakpoint
-- Changed from 0040: the member is told about a warning.
CREATE OR REPLACE FUNCTION public.community_warn(p_slug text, p_user_id text, p_reason text) RETURNS jsonb
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
  PERFORM public.community_notify(ctx.o_tenant, ctx.o_community, p_user_id, 'warning', 'warning', v_warning::text, NULL, '{}'::jsonb);
  RETURN public.community_forum_done('ok', v_warning);
END $$;
--> statement-breakpoint
-- Changed from 0040: hosts are told about an appeal.
CREATE OR REPLACE FUNCTION public.community_appeal_submit(p_slug text, p_message text) RETURNS jsonb
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
  PERFORM public.community_notify_hosts(c.tenant_id, c.id, NULL);
  RETURN public.community_forum_done('ok', v_appeal);
END $$;
--> statement-breakpoint
-- Changed from 0040: the appellant is told the decision (through the account page; banned people read no community).
CREATE OR REPLACE FUNCTION public.community_appeal_decide(p_slug text, p_appeal_id uuid, p_decision text, p_reply text) RETURNS jsonb
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
  PERFORM public.community_notify(ctx.o_tenant, ctx.o_community, a.user_id, 'appeal_decision', 'appeal', a.id::text, NULL, jsonb_build_object('decision', p_decision));
  RETURN public.community_forum_done('ok', a.id);
END $$;
--> statement-breakpoint
-- The caller's notifications and unseen announcements. Announcements are not rows: posts in hosts-only categories and pinned
-- posts created after the member last opened the bell (or joined), at most 20, unless that switch or the community is muted.
CREATE FUNCTION public.community_notifications_list(p_slug text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; m record; v_since timestamptz; v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_announce boolean; v_items jsonb; v_unread integer;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  SELECT * INTO m FROM public.community_memberships WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = actor;
  v_since := coalesce(m.notifications_seen_at, m.joined_at, m.created_at);
  v_announce := m.notify_announcements AND NOT m.notifications_muted;
  WITH n AS (
    SELECT jsonb_build_object('id', x.id, 'kind', x.kind, 'targetType', x.target_type, 'postId', x.post_id, 'actorName', u.name, 'count', x.actor_count,
        'detail', x.detail, 'read', x.read_at IS NOT NULL, 'createdAt', x.updated_at) AS j, x.updated_at AS at
      FROM public.community_notifications x LEFT JOIN public.users u ON u.id = x.actor_id
      WHERE x.tenant_id = ctx.o_tenant AND x.community_id = ctx.o_community AND x.recipient_id = actor
      ORDER BY x.updated_at DESC, x.id LIMIT v_limit),
  a AS (
    SELECT jsonb_build_object('id', 'announcement-' || p.id::text, 'kind', 'announcement', 'targetType', 'post', 'postId', p.id, 'actorName', u.name, 'count', 1,
        'detail', '{}'::jsonb, 'read', false, 'createdAt', p.created_at) AS j, p.created_at AS at
      FROM public.community_posts p JOIN public.community_categories c ON c.id = p.category_id LEFT JOIN public.users u ON u.id = p.author_id
      WHERE v_announce AND p.tenant_id = ctx.o_tenant AND p.community_id = ctx.o_community AND p.removed_at IS NULL AND p.held_at IS NULL
        AND (c.hosts_only OR p.pinned) AND p.created_at > v_since AND p.author_id IS DISTINCT FROM actor
      ORDER BY p.created_at DESC, p.id LIMIT 20)
  SELECT (SELECT coalesce(jsonb_agg(s.j ORDER BY s.at DESC), '[]'::jsonb) FROM (SELECT * FROM n UNION ALL SELECT * FROM a) s),
    (SELECT count(*)::int FROM a) + (SELECT count(*)::int FROM public.community_notifications y WHERE y.tenant_id = ctx.o_tenant AND y.community_id = ctx.o_community
      AND y.recipient_id = actor AND y.read_at IS NULL)
    INTO v_items, v_unread;
  PERFORM public.community_definer_reset();
  RETURN jsonb_build_object('outcome', 'ok', 'items', v_items, 'unread', v_unread);
END $$;--> statement-breakpoint
-- Marks the caller's notifications read: null = all (and the bell counts as seen), a list = those, an empty list = only mark
-- announcements seen (opening the bell).
CREATE FUNCTION public.community_notifications_read(p_slug text, p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF p_ids IS NOT NULL AND cardinality(p_ids) > 100 THEN RETURN public.community_forum_done('invalid'); END IF;
  IF p_ids IS NULL THEN
    UPDATE public.community_notifications SET read_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND recipient_id = actor AND read_at IS NULL;
  ELSIF cardinality(p_ids) > 0 THEN
    UPDATE public.community_notifications SET read_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND recipient_id = actor AND read_at IS NULL AND id = ANY (p_ids);
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    -- Not updated_at: a ban or an unmute is detected from it.
    UPDATE public.community_memberships SET notifications_seen_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = actor;
  END IF;
  RETURN public.community_forum_done('ok');
END $$;--> statement-breakpoint
CREATE FUNCTION public.community_notification_prefs_save(p_slug text, p_replies boolean, p_likes boolean, p_announcements boolean, p_muted boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF p_replies IS NULL OR p_likes IS NULL OR p_announcements IS NULL OR p_muted IS NULL THEN RETURN public.community_forum_done('invalid'); END IF;
  UPDATE public.community_memberships SET notify_replies = p_replies, notify_likes = p_likes, notify_announcements = p_announcements, notifications_muted = p_muted
    WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = actor;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.notification_prefs', ctx.o_community::text);
  RETURN public.community_forum_done('ok');
END $$;--> statement-breakpoint
CREATE FUNCTION public.community_welcome_dismiss(p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  UPDATE public.community_memberships SET welcome_dismissed_at = coalesce(welcome_dismissed_at, now())
    WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = actor;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.welcome_dismiss', ctx.o_community::text);
  RETURN public.community_forum_done('ok');
END $$;--> statement-breakpoint
-- Retention: read notifications are deleted 90 days after they were read (idempotent; scheduling is an activation step).
CREATE FUNCTION public.community_purge_notifications() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE removed integer;
BEGIN
  PERFORM set_config('app.community_purge', 'on', true);
  DELETE FROM public.community_notifications WHERE read_at IS NOT NULL AND read_at < now() - interval '90 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM public.community_definer_reset();
  RETURN removed;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_user_can_read(uuid, uuid, text), public.community_notify(uuid, uuid, text, text, text, text, uuid, jsonb),
  public.community_notify_as(text, uuid, uuid, text, text, text, text, uuid, jsonb), public.community_notify_reply(uuid, uuid, uuid, uuid, text),
  public.community_notify_hosts(uuid, uuid, text), public.community_notifications_list(text, integer), public.community_notifications_read(text, uuid[]),
  public.community_notification_prefs_save(text, boolean, boolean, boolean, boolean), public.community_welcome_dismiss(text), public.community_purge_notifications() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_notifications_list(text, integer), public.community_notifications_read(text, uuid[]),
  public.community_notification_prefs_save(text, boolean, boolean, boolean, boolean), public.community_welcome_dismiss(text), public.community_purge_notifications() TO harvest_app;
