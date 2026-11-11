CREATE TABLE "community_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"position" integer DEFAULT 0 NOT NULL,
	"hosts_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_category_name" CHECK (length("community_categories"."name") between 1 and 60),
	CONSTRAINT "community_category_emoji" CHECK ("community_categories"."emoji" is null or length("community_categories"."emoji") between 1 and 16)
);
--> statement-breakpoint
CREATE TABLE "community_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	CONSTRAINT "community_comment_body" CHECK (length("community_comments"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "community_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"uploader_id" text,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"checksum" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"kind" text NOT NULL,
	"post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_file_size" CHECK ("community_files"."size" between 1 and 10485760),
	CONSTRAINT "community_file_checksum" CHECK ("community_files"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "community_file_status" CHECK ("community_files"."status" in ('pending', 'uploaded', 'quarantined', 'ready')),
	CONSTRAINT "community_file_kind" CHECK ("community_files"."kind" in ('cover', 'attachment')),
	CONSTRAINT "community_file_mime" CHECK ("community_files"."mime" in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain') and ("community_files"."kind" = 'attachment' or "community_files"."mime" in ('image/jpeg', 'image/png', 'image/webp'))),
	CONSTRAINT "community_file_key_scope" CHECK ("community_files"."key" = 'communities/' || "community_files"."tenant_id"::text || '/' || "community_files"."community_id"::text || '/files/' || "community_files"."id"::text),
	CONSTRAINT "community_file_name" CHECK (length("community_files"."name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "community_likes" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_likes_target_type_target_id_user_id_pk" PRIMARY KEY("target_type","target_id","user_id"),
	CONSTRAINT "community_like_target" CHECK ("community_likes"."target_type" in ('post', 'comment'))
);
--> statement-breakpoint
CREATE TABLE "community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"author_id" text,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"video_url" text,
	"cover_file_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"comments_off" boolean DEFAULT false NOT NULL,
	"likes_off" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	CONSTRAINT "community_post_title" CHECK (length("community_posts"."title") between 1 and 200),
	CONSTRAINT "community_post_body" CHECK (jsonb_typeof("community_posts"."body") = 'object' and length("community_posts"."body"::text) <= 100000),
	CONSTRAINT "community_post_body_text" CHECK (length("community_posts"."body_text") <= 20000),
	CONSTRAINT "community_post_video" CHECK ("community_posts"."video_url" is null or (length("community_posts"."video_url") <= 500 and "community_posts"."video_url" like 'https://%'))
);
--> statement-breakpoint
ALTER TABLE "community_categories" ADD CONSTRAINT "community_categories_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_files" ADD CONSTRAINT "community_files_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_files" ADD CONSTRAINT "community_files_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_likes" ADD CONSTRAINT "community_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_likes" ADD CONSTRAINT "community_likes_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_category_id_community_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."community_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_cover_file_id_community_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."community_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_categories_order_idx" ON "community_categories" USING btree ("community_id","position");--> statement-breakpoint
CREATE INDEX "community_comments_post_idx" ON "community_comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_files_key_idx" ON "community_files" USING btree ("key");--> statement-breakpoint
CREATE INDEX "community_files_post_idx" ON "community_files" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "community_likes_recent_idx" ON "community_likes" USING btree ("community_id","target_type","created_at");--> statement-breakpoint
CREATE INDEX "community_posts_feed_idx" ON "community_posts" USING btree ("community_id","pinned","created_at");--> statement-breakpoint
ALTER TABLE "community_files" ADD CONSTRAINT "community_files_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE set null;--> statement-breakpoint
-- Every existing community gets a "General" category (policy local to this migration: the owner obeys FORCE RLS).
DO $$ BEGIN
  EXECUTE format('CREATE POLICY community_migration_0038 ON public.communities FOR SELECT TO %I USING (true)', current_user);
  EXECUTE format('CREATE POLICY community_migration_0038 ON public.community_categories FOR INSERT TO %I WITH CHECK (true)', current_user);
END $$;--> statement-breakpoint
INSERT INTO public.community_categories (tenant_id, community_id, name, position) SELECT tenant_id, id, 'General', 0 FROM public.communities;--> statement-breakpoint
DROP POLICY community_migration_0038 ON public.communities;--> statement-breakpoint
DROP POLICY community_migration_0038 ON public.community_categories;--> statement-breakpoint
-- ADR 0013 §4a: one shared, grant-aware read predicate for every member-readable content table. Invoker rights:
-- under harvest_app it relies on the caller's own-row policies on memberships and entitlements.
CREATE FUNCTION public.community_can_read(p_tenant uuid, p_community uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_memberships m
    WHERE m.tenant_id = p_tenant AND m.community_id = p_community AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.status = 'active'
      AND (m.role IN ('owner', 'admin', 'moderator', 'contributor') OR EXISTS (SELECT 1 FROM public.entitlements e
        WHERE e.tenant_id = p_tenant AND e.user_id = m.user_id AND e.resource_type = 'community' AND e.resource_id = p_community
          AND e.revoked_at IS NULL AND e.valid_from <= now() AND (e.valid_until IS NULL OR e.valid_until > now()))))
$$;--> statement-breakpoint
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['community_categories','community_files','community_posts','community_comments','community_likes'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', relation_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO harvest_app', relation_name);
  -- Staff path: ministry roles via withTenant (permission checks in the services).
  EXECUTE format($p$CREATE POLICY %I ON public.%I TO harvest_app
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, relation_name || '_staff', relation_name);
  -- Member path: read only, through the shared predicate. Members never write these tables directly.
  EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO harvest_app USING (public.community_can_read(tenant_id, community_id))$p$,
    relation_name || '_member', relation_name);
  -- Definer owner: keyed on the setting the definers set and clear.
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.%I TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, relation_name, current_user);
 END LOOP;
END $$;--> statement-breakpoint
-- Members see other people's files only once they are verified and released.
DROP POLICY community_files_member ON public.community_files;--> statement-breakpoint
CREATE POLICY community_files_member ON public.community_files FOR SELECT TO harvest_app
  USING (public.community_can_read(tenant_id, community_id) AND (status = 'ready' OR uploader_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
-- Staff may delete an empty category (the service checks it has no posts).
GRANT DELETE ON public.community_categories TO harvest_app;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_can_read(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_can_read(uuid, uuid) TO harvest_app;--> statement-breakpoint
-- Resolves the caller's context for a forum action (not granted; called only inside the definers below).
CREATE FUNCTION public.community_forum_actor(p_slug text, OUT o_tenant uuid, OUT o_community uuid, OUT o_role text)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT c.tenant_id, c.id INTO o_tenant, o_community FROM public.communities c WHERE c.slug = p_slug AND c.status = 'published';
  IF o_tenant IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.community_definer_tenant', o_tenant::text, true);
  IF NOT public.community_can_read(o_tenant, o_community) THEN o_tenant := NULL; o_community := NULL; RETURN; END IF;
  SELECT m.role INTO o_role FROM public.community_memberships m WHERE m.tenant_id = o_tenant AND m.community_id = o_community AND m.user_id = actor;
END $$;--> statement-breakpoint
CREATE FUNCTION public.community_forum_done(p_outcome text, p_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN PERFORM public.community_definer_reset(); RETURN jsonb_build_object('outcome', p_outcome, 'id', p_id); END $$;--> statement-breakpoint
-- Create a post, or edit the caller's own post. Hosts-only categories need a host role. Files must be the caller's own,
-- ready, in this community and not attached to another post.
CREATE FUNCTION public.community_post_save(p_slug text, p_post_id uuid, p_category_id uuid, p_title text, p_body jsonb, p_body_text text,
  p_video_url text, p_cover_file_id uuid, p_attachment_ids uuid[], p_comments_off boolean, p_likes_off boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; cat record; v_post uuid := p_post_id; existing record;
  attachments uuid[] := coalesce(p_attachment_ids, ARRAY[]::uuid[]); usable integer; expected integer;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  SELECT * INTO cat FROM public.community_categories WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_category_id;
  IF NOT FOUND THEN RETURN public.community_forum_done('invalid'); END IF;
  IF cat.hosts_only AND ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF cardinality(attachments) > 5 OR cardinality(attachments) <> (SELECT count(DISTINCT a) FROM unnest(attachments) a) THEN RETURN public.community_forum_done('invalid'); END IF;
  IF v_post IS NOT NULL THEN
    SELECT * INTO existing FROM public.community_posts WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = v_post AND removed_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
    IF existing.author_id IS DISTINCT FROM actor THEN RETURN public.community_forum_done('forbidden'); END IF;
  END IF;
  -- Files: own, ready, right kind, this community, and free or already on this post.
  SELECT count(*) INTO usable FROM public.community_files f WHERE f.tenant_id = ctx.o_tenant AND f.community_id = ctx.o_community
    AND f.uploader_id = actor AND f.status = 'ready' AND (f.post_id IS NULL OR f.post_id = v_post)
    AND ((f.id = p_cover_file_id AND f.kind = 'cover') OR (f.id = ANY (attachments) AND f.kind = 'attachment'));
  -- Computed first: PL/pgSQL ends an IF condition at the first THEN, including one inside CASE.
  expected := cardinality(attachments) + (CASE WHEN p_cover_file_id IS NULL THEN 0 ELSE 1 END);
  IF usable <> expected THEN RETURN public.community_forum_done('invalid'); END IF;
  IF v_post IS NULL THEN
    INSERT INTO public.community_posts (tenant_id, community_id, category_id, author_id, title, body, body_text, video_url, cover_file_id, comments_off, likes_off)
      VALUES (ctx.o_tenant, ctx.o_community, p_category_id, actor, p_title, p_body, coalesce(p_body_text, ''), p_video_url, p_cover_file_id,
        coalesce(p_comments_off, false), coalesce(p_likes_off, false)) RETURNING id INTO v_post;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.post_create', v_post::text);
  ELSE
    UPDATE public.community_posts SET category_id = p_category_id, title = p_title, body = p_body, body_text = coalesce(p_body_text, ''), video_url = p_video_url,
      cover_file_id = p_cover_file_id, comments_off = coalesce(p_comments_off, false), likes_off = coalesce(p_likes_off, false), edited_at = now(), updated_at = now()
      WHERE id = v_post;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.post_edit', v_post::text);
  END IF;
  UPDATE public.community_files SET post_id = NULL, updated_at = now()
    WHERE tenant_id = ctx.o_tenant AND post_id = v_post AND id <> ALL (attachments) AND id IS DISTINCT FROM p_cover_file_id;
  UPDATE public.community_files SET post_id = v_post, updated_at = now()
    WHERE tenant_id = ctx.o_tenant AND (id = ANY (attachments) OR id = p_cover_file_id);
  RETURN public.community_forum_done('ok', v_post);
END $$;--> statement-breakpoint
CREATE FUNCTION public.community_post_delete(p_slug text, p_post_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; existing record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  SELECT * INTO existing FROM public.community_posts WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_post_id AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  IF existing.author_id IS DISTINCT FROM actor THEN RETURN public.community_forum_done('forbidden'); END IF;
  UPDATE public.community_posts SET removed_at = now(), removed_by = actor, updated_at = now() WHERE id = p_post_id;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.post_delete', p_post_id::text);
  RETURN public.community_forum_done('ok', p_post_id);
END $$;--> statement-breakpoint
-- Reply to a post (one level), or edit the caller's own reply. "Turn off comments" stops everyone.
CREATE FUNCTION public.community_comment_save(p_slug text, p_post_id uuid, p_comment_id uuid, p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; post record; existing record; v_comment uuid := p_comment_id;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  SELECT * INTO post FROM public.community_posts WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_post_id AND removed_at IS NULL;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  IF v_comment IS NULL THEN
    IF post.comments_off THEN RETURN public.community_forum_done('forbidden'); END IF;
    INSERT INTO public.community_comments (tenant_id, community_id, post_id, author_id, body) VALUES (ctx.o_tenant, ctx.o_community, p_post_id, actor, p_body) RETURNING id INTO v_comment;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.comment_create', v_comment::text);
  ELSE
    SELECT * INTO existing FROM public.community_comments WHERE tenant_id = ctx.o_tenant AND post_id = p_post_id AND id = v_comment AND removed_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
    IF existing.author_id IS DISTINCT FROM actor THEN RETURN public.community_forum_done('forbidden'); END IF;
    UPDATE public.community_comments SET body = p_body, updated_at = now() WHERE id = v_comment;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.comment_edit', v_comment::text);
  END IF;
  RETURN public.community_forum_done('ok', v_comment);
END $$;--> statement-breakpoint
CREATE FUNCTION public.community_comment_delete(p_slug text, p_comment_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; existing record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  SELECT * INTO existing FROM public.community_comments WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_comment_id AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  IF existing.author_id IS DISTINCT FROM actor THEN RETURN public.community_forum_done('forbidden'); END IF;
  UPDATE public.community_comments SET removed_at = now(), removed_by = actor, updated_at = now() WHERE id = p_comment_id;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.comment_delete', p_comment_id::text);
  RETURN public.community_forum_done('ok', p_comment_id);
END $$;--> statement-breakpoint
-- Like or unlike a post or reply. "Turn off likes" on the post stops likes on it and its replies.
CREATE FUNCTION public.community_like_toggle(p_slug text, p_target_type text, p_target_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; v_likes_off boolean;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF p_target_type = 'post' THEN
    SELECT p.likes_off INTO v_likes_off FROM public.community_posts p WHERE p.tenant_id = ctx.o_tenant AND p.community_id = ctx.o_community AND p.id = p_target_id AND p.removed_at IS NULL;
  ELSIF p_target_type = 'comment' THEN
    SELECT p.likes_off INTO v_likes_off FROM public.community_comments c JOIN public.community_posts p ON p.id = c.post_id
      WHERE c.tenant_id = ctx.o_tenant AND c.community_id = ctx.o_community AND c.id = p_target_id AND c.removed_at IS NULL AND p.removed_at IS NULL;
  END IF;
  IF v_likes_off IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF v_likes_off THEN RETURN public.community_forum_done('forbidden'); END IF;
  DELETE FROM public.community_likes WHERE target_type = p_target_type AND target_id = p_target_id AND user_id = actor;
  IF FOUND THEN RETURN public.community_forum_done('unliked', p_target_id); END IF;
  INSERT INTO public.community_likes (tenant_id, community_id, target_type, target_id, user_id) VALUES (ctx.o_tenant, ctx.o_community, p_target_type, p_target_id, actor)
    ON CONFLICT DO NOTHING;
  RETURN public.community_forum_done('liked', p_target_id);
END $$;--> statement-breakpoint
-- Hosts (community owner, admin, moderator) pin, unpin and remove. Ministry staff use the staff service instead.
CREATE FUNCTION public.community_moderate(p_slug text, p_action text, p_target_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_action IN ('pin', 'unpin', 'remove_post') THEN
    UPDATE public.community_posts SET pinned = CASE p_action WHEN 'pin' THEN true WHEN 'unpin' THEN false ELSE pinned END,
      removed_at = CASE WHEN p_action = 'remove_post' THEN now() ELSE removed_at END, removed_by = CASE WHEN p_action = 'remove_post' THEN actor ELSE removed_by END,
      updated_at = now() WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_target_id AND removed_at IS NULL;
  ELSIF p_action = 'remove_comment' THEN
    UPDATE public.community_comments SET removed_at = now(), removed_by = actor, updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_target_id AND removed_at IS NULL;
  ELSE RETURN public.community_forum_done('invalid');
  END IF;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.' || p_action, p_target_id::text);
  RETURN public.community_forum_done('ok', p_target_id);
END $$;--> statement-breakpoint
-- Member uploads: record the intent, then move it through verification. Only the uploader, only forward.
CREATE FUNCTION public.community_file_create(p_slug text, p_id uuid, p_kind text, p_name text, p_mime text, p_size integer, p_checksum text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  INSERT INTO public.community_files (id, tenant_id, community_id, uploader_id, key, name, mime, size, checksum, kind)
    VALUES (p_id, ctx.o_tenant, ctx.o_community, actor, 'communities/' || ctx.o_tenant::text || '/' || ctx.o_community::text || '/files/' || p_id::text,
      p_name, p_mime, p_size, p_checksum, p_kind);
  RETURN public.community_forum_done('ok', p_id);
END $$;--> statement-breakpoint
CREATE FUNCTION public.community_file_set_status(p_slug text, p_id uuid, p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; current_status text;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  SELECT status INTO current_status FROM public.community_files WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_id AND uploader_id = actor FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  IF NOT ((current_status = 'pending' AND p_status IN ('uploaded', 'quarantined')) OR (current_status = 'uploaded' AND p_status IN ('ready', 'quarantined'))) THEN
    RETURN public.community_forum_done('invalid');
  END IF;
  UPDATE public.community_files SET status = p_status, updated_at = now() WHERE id = p_id;
  RETURN public.community_forum_done('ok', p_id);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_forum_actor(text), public.community_forum_done(text, uuid),
  public.community_post_save(text, uuid, uuid, text, jsonb, text, text, uuid, uuid[], boolean, boolean), public.community_post_delete(text, uuid),
  public.community_comment_save(text, uuid, uuid, text), public.community_comment_delete(text, uuid), public.community_like_toggle(text, text, uuid),
  public.community_moderate(text, text, uuid), public.community_file_create(text, uuid, text, text, text, integer, text),
  public.community_file_set_status(text, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_post_save(text, uuid, uuid, text, jsonb, text, text, uuid, uuid[], boolean, boolean), public.community_post_delete(text, uuid),
  public.community_comment_save(text, uuid, uuid, text), public.community_comment_delete(text, uuid), public.community_like_toggle(text, text, uuid),
  public.community_moderate(text, text, uuid), public.community_file_create(text, uuid, text, text, text, integer, text),
  public.community_file_set_status(text, uuid, text) TO harvest_app;
