CREATE TABLE "blog_posts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"excerpt" text,
	"body" jsonb NOT NULL,
	"image_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"cover_file_id" uuid,
	"share_file_id" uuid,
	"seo_title" text,
	"seo_description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"publish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	"scheduled_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_posts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "blog_posts_slug" CHECK ("blog_posts"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$' and position('--' in "blog_posts"."slug") = 0 and "blog_posts"."slug" not in ('rss', 'feed', 'images', 'page')),
	CONSTRAINT "blog_posts_title" CHECK (length("blog_posts"."title") <= 200 and "blog_posts"."title" = btrim("blog_posts"."title")),
	CONSTRAINT "blog_posts_text" CHECK (("blog_posts"."excerpt" is null or (length("blog_posts"."excerpt") between 1 and 300 and "blog_posts"."excerpt" = btrim("blog_posts"."excerpt") and "blog_posts"."excerpt" !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')) and ("blog_posts"."seo_title" is null or (length("blog_posts"."seo_title") between 1 and 70 and "blog_posts"."seo_title" = btrim("blog_posts"."seo_title") and "blog_posts"."seo_title" !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')) and ("blog_posts"."seo_description" is null or (length("blog_posts"."seo_description") between 1 and 160 and "blog_posts"."seo_description" = btrim("blog_posts"."seo_description") and "blog_posts"."seo_description" !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'))),
	CONSTRAINT "blog_posts_body" CHECK (jsonb_typeof("blog_posts"."body") = 'object' and "blog_posts"."body"->>'type' = 'doc' and pg_column_size("blog_posts"."body") <= 524288),
	CONSTRAINT "blog_posts_images" CHECK (cardinality("blog_posts"."image_ids") <= 50 and array_position("blog_posts"."image_ids", null) is null),
	CONSTRAINT "blog_posts_status" CHECK ("blog_posts"."status" in ('draft', 'scheduled', 'published')
    and (("blog_posts"."status" = 'scheduled') = ("blog_posts"."publish_at" is not null))
    and (("blog_posts"."status" = 'published') = ("blog_posts"."published_at" is not null))
    and ("blog_posts"."status" = 'draft' or "blog_posts"."first_published_at" is not null or "blog_posts"."status" = 'scheduled')),
	CONSTRAINT "blog_posts_version" CHECK ("blog_posts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "blog_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"title" text NOT NULL,
	"intro" text,
	"version" integer DEFAULT 1 NOT NULL,
	"first_published_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_settings_handle" CHECK ("blog_settings"."handle" ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$' and position('--' in "blog_settings"."handle") = 0 and "blog_settings"."handle" not in ('account', 'admin', 'api', 'app', 'articles', 'assets', 'auth', 'bio', 'blog', 'blogs', 'c', 'click', 'communities', 'connect', 'discover', 'edit', 'f', 'feed', 'harvest', 'health', 'help', 'images', 'l', 'link', 'links', 'login', 'message', 'messages', 'new', 'newsletter', 'photo', 'preview', 'profile', 'resources', 'rss', 's', 'settings', 'sign-in', 'subscribe', 'support', 'workspace', 'workspaces', 'www')),
	CONSTRAINT "blog_settings_title" CHECK (length("blog_settings"."title") between 1 and 100 and "blog_settings"."title" = btrim("blog_settings"."title")),
	CONSTRAINT "blog_settings_intro" CHECK (("blog_settings"."intro" is null or (length("blog_settings"."intro") between 1 and 500 and "blog_settings"."intro" = btrim("blog_settings"."intro") and "blog_settings"."intro" !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'))),
	CONSTRAINT "blog_settings_version" CHECK ("blog_settings"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_tenant_id_blog_settings_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."blog_settings"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_share_file_id_files_id_fk" FOREIGN KEY ("share_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_scheduled_by_users_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_settings" ADD CONSTRAINT "blog_settings_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_settings" ADD CONSTRAINT "blog_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blog_posts_slug_idx" ON "blog_posts" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "blog_posts_public_idx" ON "blog_posts" USING btree ("tenant_id","published_at","id") WHERE "blog_posts"."status" = 'published';--> statement-breakpoint
CREATE INDEX "blog_posts_due_idx" ON "blog_posts" USING btree ("publish_at","tenant_id","id") WHERE "blog_posts"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "blog_posts_list_idx" ON "blog_posts" USING btree ("tenant_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "blog_settings_handle_idx" ON "blog_settings" USING btree ("handle");--> statement-breakpoint
-- Native blog (founder decision 25 Nov; kit items approved 27 Nov). One blog per ministry at /blog/<handle>, articles at /blog/<handle>/<slug>.
-- Owners and admins manage it (a collaborator with Website at manage reads as admin through public.access_role); members, viewers and guests never read a
-- draft. FORCE RLS on both tables. Visitors read only published articles through the SECURITY DEFINER functions below (allow-listed jsonb). A scheduled
-- article is published by the worker role (blog_publish_due), never by a visitor read. No backfill: both tables start empty.
CREATE FUNCTION public.blog_can(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(pg_catalog.current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant AND m.user_id = nullif(pg_catalog.current_setting('app.user_id', true), '')
      AND public.access_role(m.tenant_id, m.user_id, 'website', m.role_id) IN ('owner', 'admin'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_can(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.blog_can(uuid) TO harvest_app;--> statement-breakpoint
ALTER TABLE public.blog_settings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.blog_settings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.blog_posts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.blog_settings, public.blog_posts FROM PUBLIC, harvest_app;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'harvest_worker') THEN EXECUTE 'REVOKE ALL ON public.blog_settings, public.blog_posts FROM harvest_worker'; END IF;
END $$;--> statement-breakpoint
GRANT SELECT, INSERT ON public.blog_settings TO harvest_app;--> statement-breakpoint
GRANT UPDATE (handle, title, intro, version, updated_at, first_published_at) ON public.blog_settings TO harvest_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.blog_posts TO harvest_app;--> statement-breakpoint
GRANT UPDATE (slug, title, excerpt, body, image_ids, cover_file_id, share_file_id, seo_title, seo_description, status, publish_at, published_at, scheduled_by,
  version, updated_by, updated_at) ON public.blog_posts TO harvest_app;--> statement-breakpoint
CREATE POLICY blog_settings_read ON public.blog_settings FOR SELECT TO harvest_app USING (public.blog_can(tenant_id));--> statement-breakpoint
CREATE POLICY blog_settings_create ON public.blog_settings FOR INSERT TO harvest_app
  WITH CHECK (public.blog_can(tenant_id) AND created_by = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY blog_settings_update ON public.blog_settings FOR UPDATE TO harvest_app USING (public.blog_can(tenant_id)) WITH CHECK (public.blog_can(tenant_id));--> statement-breakpoint
CREATE POLICY blog_posts_read ON public.blog_posts FOR SELECT TO harvest_app USING (public.blog_can(tenant_id));--> statement-breakpoint
CREATE POLICY blog_posts_create ON public.blog_posts FOR INSERT TO harvest_app
  WITH CHECK (public.blog_can(tenant_id) AND created_by = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY blog_posts_update ON public.blog_posts FOR UPDATE TO harvest_app USING (public.blog_can(tenant_id)) WITH CHECK (public.blog_can(tenant_id));--> statement-breakpoint
CREATE POLICY blog_posts_remove ON public.blog_posts FOR DELETE TO harvest_app USING (public.blog_can(tenant_id));--> statement-breakpoint
-- The blog: the ministry and creator never change; the version moves forward by one; the address is fixed once any article has been published.
CREATE FUNCTION public.blog_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id <> OLD.tenant_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'invalid blog update' USING ERRCODE = '23514';
    END IF;
    -- The marker: set once, by the article trigger below, when the blog's first article is first published; never changed or cleared afterwards, so
    -- deleting every article later does not free the address. Setting it alone does not move the version (the owner's open settings stay current).
    IF NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
      IF OLD.first_published_at IS NOT NULL OR NEW.first_published_at IS NULL OR NOT EXISTS (SELECT FROM public.blog_posts p
          WHERE p.tenant_id = OLD.tenant_id AND p.first_published_at IS NOT NULL) THEN
        RAISE EXCEPTION 'invalid blog update' USING ERRCODE = '23514';
      END IF;
      IF NEW.version <> OLD.version OR NEW.handle <> OLD.handle OR NEW.title <> OLD.title OR NEW.intro IS DISTINCT FROM OLD.intro THEN
        RAISE EXCEPTION 'invalid blog update' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'invalid blog update' USING ERRCODE = '23514'; END IF;
    -- A first publish updates this row (the marker) in its own transaction, so a concurrent address change waits for it and then sees the marker.
    IF NEW.handle <> OLD.handle AND OLD.first_published_at IS NOT NULL THEN
      RAISE EXCEPTION 'the blog address is fixed once an article is published' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.version <> 1 OR NEW.first_published_at IS NOT NULL THEN
    RAISE EXCEPTION 'invalid blog' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_settings_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER blog_settings_guard BEFORE INSERT OR UPDATE ON public.blog_settings FOR EACH ROW EXECUTE FUNCTION public.blog_settings_guard();--> statement-breakpoint
-- An article. Key, ministry, creator and creation time never change; the version moves forward by one. first_published_at is set here on the first publish and
-- never changes again, and the address (slug) is fixed from then on (the community address rule). Allowed moves: a new article is a draft; draft <->
-- scheduled; draft or scheduled -> published; published -> draft (unpublish). Only the worker role moves scheduled -> published on its own (blog_publish_due),
-- and only once the time has come. The cover, share picture and every picture in the body are ready image files of the same ministry, as the caller sees them.
CREATE FUNCTION public.blog_posts_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE worker boolean := pg_catalog.current_setting('app.blog_publish', true) = 'on' AND session_user = 'harvest_worker'; file uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'draft' OR NEW.first_published_at IS NOT NULL OR NEW.published_at IS NOT NULL OR NEW.publish_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new article starts as a draft' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'invalid article update' USING ERRCODE = '23514';
    END IF;
    IF NEW.slug <> OLD.slug AND OLD.first_published_at IS NOT NULL THEN
      RAISE EXCEPTION 'the article address is fixed once published' USING ERRCODE = '23514';
    END IF;
    IF worker THEN
      IF NOT (OLD.status = 'scheduled' AND NEW.status = 'published' AND OLD.publish_at <= pg_catalog.now()) THEN
        RAISE EXCEPTION 'the worker only publishes due articles' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status = 'draft' AND NEW.status IN ('scheduled', 'published'))
        OR (OLD.status = 'scheduled' AND NEW.status IN ('draft', 'published')) OR (OLD.status = 'published' AND NEW.status = 'draft')) THEN
      RAISE EXCEPTION 'article state cannot change that way' USING ERRCODE = '23514';
    END IF;
    -- A manual publish is stamped with the database clock, whatever the caller sent.
    IF NOT worker AND NEW.status = 'published' AND OLD.status <> 'published' THEN NEW.published_at := pg_catalog.now(); END IF;
    IF NOT worker AND NEW.status = 'scheduled' AND NEW.publish_at IS DISTINCT FROM OLD.publish_at
      AND (NEW.publish_at <= pg_catalog.now() OR NEW.publish_at > pg_catalog.now() + interval '366 days') THEN
      RAISE EXCEPTION 'the publish time must be in the coming year' USING ERRCODE = '23514';
    END IF;
    NEW.first_published_at := coalesce(OLD.first_published_at, CASE WHEN NEW.status = 'published' THEN NEW.published_at END);
  END IF;
  IF NEW.image_ids IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.image_ids END)
    OR NEW.cover_file_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.cover_file_id END)
    OR NEW.share_file_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.share_file_id END) THEN
    FOREACH file IN ARRAY NEW.image_ids || ARRAY[NEW.cover_file_id, NEW.share_file_id] LOOP
      CONTINUE WHEN file IS NULL;
      IF TG_OP = 'UPDATE' AND (file = ANY (OLD.image_ids) OR file = OLD.cover_file_id OR file = OLD.share_file_id) THEN CONTINUE; END IF;
      IF NOT EXISTS (SELECT FROM public.files f WHERE f.id = file AND f.tenant_id = NEW.tenant_id AND f.status = 'ready' AND NOT f.social_upload
        AND f.mime IN ('image/jpeg', 'image/png', 'image/webp')) THEN
        RAISE EXCEPTION 'picture does not belong to this ministry or is unavailable' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_posts_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER blog_posts_guard BEFORE INSERT OR UPDATE ON public.blog_posts FOR EACH ROW EXECUTE FUNCTION public.blog_posts_guard();--> statement-breakpoint
-- After an article's first publish (by the app or the worker), mark the blog: its address is fixed from now on, even if every article is deleted later.
CREATE FUNCTION public.blog_posts_mark_blog() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.blog_settings SET first_published_at = NEW.first_published_at WHERE tenant_id = NEW.tenant_id AND first_published_at IS NULL;
  RETURN NULL;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_posts_mark_blog() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER blog_posts_mark_blog AFTER UPDATE OF status ON public.blog_posts FOR EACH ROW
  WHEN (OLD.first_published_at IS NULL AND NEW.first_published_at IS NOT NULL) EXECUTE FUNCTION public.blog_posts_mark_blog();--> statement-breakpoint
-- Owner-role policies for the public definers: each reads only what the transaction-local flags its entry function set name (one blog by its address or
-- ministry, that ministry's published articles, one picture of them). The entry functions clear every app.* flag first and restore them afterwards.
DO $$
DECLARE scope text := $s$tenant_id = nullif(current_setting('app.blog_public_tenant', true), '')::uuid$s$;
BEGIN
  EXECUTE format($p$CREATE POLICY blog_public_definer ON public.blog_settings FOR SELECT TO %I
    USING (handle = nullif(current_setting('app.blog_public_handle', true), '') OR %s)$p$, current_user, scope);
  EXECUTE format($p$CREATE POLICY blog_public_definer ON public.blog_posts FOR SELECT TO %I USING (%s AND status = 'published')$p$, current_user, scope);
  EXECUTE format($p$CREATE POLICY blog_public_definer ON public.files FOR SELECT TO %I
    USING (%s AND id = nullif(current_setting('app.blog_public_file', true), '')::uuid AND status = 'ready' AND NOT social_upload
      AND mime IN ('image/jpeg', 'image/png', 'image/webp') AND EXISTS (SELECT FROM public.blog_posts p WHERE p.tenant_id = files.tenant_id AND p.status = 'published'
        AND (p.cover_file_id = files.id OR p.share_file_id = files.id OR files.id = ANY (p.image_ids))))$p$, current_user, scope);
END $$;--> statement-breakpoint
-- The worker publishes due articles only while blog_publish_due has switched app.blog_publish on, only in the worker's own session.
-- Reading covers both states: an updated row must stay visible to the reader (PostgreSQL checks the new row against SELECT policies too).
CREATE POLICY blog_publish_read ON public.blog_posts FOR SELECT TO PUBLIC
  USING (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.blog_publish', true) = 'on' AND status IN ('scheduled', 'published'));--> statement-breakpoint
-- The worker's first publish also sets the blog's marker (blog_posts_mark_blog); it may read and mark the blogs of the articles it publishes, nothing else.
CREATE POLICY blog_publish_mark_read ON public.blog_settings FOR SELECT TO PUBLIC
  USING (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.blog_publish', true) = 'on');--> statement-breakpoint
CREATE POLICY blog_publish_mark ON public.blog_settings FOR UPDATE TO PUBLIC
  USING (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.blog_publish', true) = 'on' AND first_published_at IS NULL)
  WITH CHECK (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.blog_publish', true) = 'on' AND first_published_at IS NOT NULL);--> statement-breakpoint
CREATE POLICY blog_publish_write ON public.blog_posts FOR UPDATE TO PUBLIC
  USING (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.blog_publish', true) = 'on' AND status = 'scheduled')
  WITH CHECK (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.blog_publish', true) = 'on' AND status = 'published');--> statement-breakpoint
-- Internal (not granted): save and clear every app.* setting an owner-role policy reads (an explicit list: custom settings are not reliably listed in
-- pg_settings), and put them back afterwards (clearing this file's own flags first). The list is checked against pg_policies by an integration test.
CREATE FUNCTION public.blog_scope_clear() RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := '{}'::jsonb; key text;
BEGIN
  FOREACH key IN ARRAY ARRAY['app.blog_public_handle','app.blog_public_tenant','app.blog_public_file','app.blog_publish','app.access_tenant','app.access_token',
      'app.ads_definer','app.bio_handle','app.bio_tenant','app.campaign_budget_tenant','app.campaign_invite_tenant','app.campaign_invite_token',
      'app.catalog_slug','app.catalog_tenant','app.catalog_learner_tenant','app.catalog_my_notes','app.catalog_progress_tenant','app.chat_purge','app.chat_settings','app.community_definer_tenant','app.community_email_worker',
      'app.community_purge','app.community_resolve_email','app.community_resolve_ids','app.community_resolve_invite','app.community_resolve_slug',
      'app.community_resolve_user','app.community_stats_write','app.connect_campaign','app.connect_flow','app.connect_intake_mode',
      'app.connect_invite_id','app.connect_invite_token','app.connect_invite_worker','app.connect_landing_link','app.connect_metrics',
      'app.connect_purge','app.connect_receipt','app.connect_resolve_code','app.connect_resolve_tenant','app.connect_retention',
      'app.connect_version','app.crm_forms_slug','app.crm_forms_tenant','app.discover_platform','app.discover_read','app.dm_evidence_report',
      'app.dm_purge','app.docs_purge','app.event_cover_cleanup','app.events_tenant','app.give_public_fundraising','app.give_public_slug',
      'app.give_public_tenant','app.giving_definer','app.giving_definer_tenant','app.giving_public_tenant','app.live_community',
      'app.newsletter_erasure_contact','app.newsletter_erasure_tenant','app.nl','app.nl_auto_private','app.nl_forms_tenant','app.nl_growth_scan',
      'app.nl_send_insight','app.nl_send_tenant','app.nl_send_worker','app.office_erasure_contact','app.platform_staff',
      'app.social_analytics_worker','app.social_approval_definer','app.social_auto_dm_worker','app.social_definer','app.social_inbox_worker',
      'app.social_media_tenant','app.social_upload_cleanup','app.tenant_id','app.user_id'] LOOP
    prior := prior || pg_catalog.jsonb_build_object(key, coalesce(pg_catalog.current_setting(key, true), ''));
    PERFORM pg_catalog.set_config(key, '', true);
  END LOOP;
  RETURN prior;
END $$;--> statement-breakpoint
CREATE FUNCTION public.blog_scope_restore(p_prior jsonb) RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE entry record;
BEGIN
  PERFORM pg_catalog.set_config(name, '', true) FROM pg_catalog.unnest(ARRAY['app.blog_public_handle', 'app.blog_public_tenant', 'app.blog_public_file', 'app.blog_publish']) AS name;
  FOR entry IN SELECT key, value FROM pg_catalog.jsonb_each_text(coalesce(p_prior, '{}'::jsonb)) LOOP PERFORM pg_catalog.set_config(entry.key, entry.value, true); END LOOP;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_scope_clear(), public.blog_scope_restore(jsonb) FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Internal (not granted): the blog behind an address, leaving its ministry in the flag for the caller's next reads; NULL for an unknown or malformed address.
CREATE FUNCTION public.blog_scoped(p_handle text) RETURNS public.blog_settings LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE blog public.blog_settings;
BEGIN
  IF p_handle IS NULL OR p_handle !~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$' THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.blog_public_handle', p_handle, true);
  SELECT * INTO blog FROM public.blog_settings b WHERE b.handle = p_handle;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.blog_public_tenant', blog.tenant_id::text, true);
  RETURN blog;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_scoped(text) FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Internal (not granted): the allow-listed card of a published article (no body, no author, no internal id).
CREATE FUNCTION public.blog_card(p public.blog_posts) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE body text := pg_catalog.btrim(pg_catalog.array_to_string(ARRAY(SELECT t #>> '{}' FROM pg_catalog.jsonb_path_query(p.body, 'strict $.**.text') AS t), ' '));
BEGIN
  RETURN pg_catalog.jsonb_build_object('slug', p.slug, 'title', p.title, 'excerpt', p.excerpt, 'publishedAt', p.published_at, 'coverId', p.cover_file_id,
    'lead', pg_catalog.left(body, 400), 'words', CASE WHEN body = '' THEN 0 ELSE pg_catalog.cardinality(pg_catalog.regexp_split_to_array(body, '\s+')) END);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_card(public.blog_posts) FROM PUBLIC, harvest_app;--> statement-breakpoint
-- A blog's index page: title, intro, total of published articles and one page of cards, newest first. NULL for an unknown address.
CREATE FUNCTION public.blog_public_index(p_handle text, p_page integer, p_size integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_scope_clear(); blog public.blog_settings; result jsonb; total integer;
  size integer := least(greatest(coalesce(p_size, 12), 1), 50); page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
BEGIN
  blog := public.blog_scoped(p_handle);
  IF blog.tenant_id IS NOT NULL THEN
    SELECT count(*)::integer INTO total FROM public.blog_posts p WHERE p.tenant_id = blog.tenant_id AND p.status = 'published';
    result := pg_catalog.jsonb_build_object('handle', blog.handle, 'title', blog.title, 'intro', blog.intro, 'total', total,
      'posts', coalesce((SELECT pg_catalog.jsonb_agg(public.blog_card(p) ORDER BY p.published_at DESC, p.id) FROM (SELECT * FROM public.blog_posts p
        WHERE p.tenant_id = blog.tenant_id AND p.status = 'published' ORDER BY p.published_at DESC, p.id LIMIT size OFFSET (page - 1) * size) p), '[]'::jsonb));
  END IF;
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
-- One published article (body, SEO fields, share picture) with up to three more recent articles of the same blog. NULL when not published.
CREATE FUNCTION public.blog_public_post(p_handle text, p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_scope_clear(); blog public.blog_settings; post public.blog_posts; result jsonb;
BEGIN
  blog := public.blog_scoped(p_handle);
  IF blog.tenant_id IS NOT NULL AND p_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$' THEN
    SELECT * INTO post FROM public.blog_posts p WHERE p.tenant_id = blog.tenant_id AND p.slug = p_slug AND p.status = 'published';
    IF FOUND THEN
      result := public.blog_card(post) || pg_catalog.jsonb_build_object('body', post.body, 'seoTitle', post.seo_title, 'seoDescription', post.seo_description,
        'shareId', post.share_file_id, 'updatedAt', post.updated_at, 'blog', pg_catalog.jsonb_build_object('handle', blog.handle, 'title', blog.title),
        'more', coalesce((SELECT pg_catalog.jsonb_agg(public.blog_card(m) ORDER BY m.published_at DESC, m.id) FROM (SELECT * FROM public.blog_posts m
          WHERE m.tenant_id = blog.tenant_id AND m.status = 'published' AND m.id <> post.id ORDER BY m.published_at DESC, m.id LIMIT 3) m), '[]'::jsonb));
    END IF;
  END IF;
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
-- The feed: the blog and its newest published articles with their bodies (for RSS). NULL for an unknown address.
CREATE FUNCTION public.blog_public_feed(p_handle text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_scope_clear(); blog public.blog_settings; result jsonb; size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
BEGIN
  blog := public.blog_scoped(p_handle);
  IF blog.tenant_id IS NOT NULL THEN
    result := pg_catalog.jsonb_build_object('handle', blog.handle, 'title', blog.title, 'intro', blog.intro,
      'items', coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('slug', p.slug, 'title', p.title, 'excerpt', p.excerpt, 'publishedAt', p.published_at,
        'updatedAt', p.updated_at, 'body', p.body) ORDER BY p.published_at DESC, p.id) FROM (SELECT * FROM public.blog_posts p
        WHERE p.tenant_id = blog.tenant_id AND p.status = 'published' ORDER BY p.published_at DESC, p.id LIMIT size) p), '[]'::jsonb));
  END IF;
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
-- A picture of a published article (its cover, share picture or one in its body) for the short signed redirect: storage key, name and type, or NULL.
CREATE FUNCTION public.blog_public_image(p_handle text, p_file uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_scope_clear(); blog public.blog_settings; result jsonb;
BEGIN
  blog := public.blog_scoped(p_handle);
  IF blog.tenant_id IS NOT NULL AND p_file IS NOT NULL AND EXISTS (SELECT FROM public.blog_posts p WHERE p.tenant_id = blog.tenant_id AND p.status = 'published'
      AND (p.cover_file_id = p_file OR p.share_file_id = p_file OR p_file = ANY (p.image_ids))) THEN
    PERFORM pg_catalog.set_config('app.blog_public_file', p_file::text, true);
    SELECT pg_catalog.jsonb_build_object('key', f.key, 'name', f.name, 'mime', f.mime) INTO result FROM public.files f
      WHERE f.tenant_id = blog.tenant_id AND f.id = p_file AND f.status = 'ready' AND f.mime IN ('image/jpeg', 'image/png', 'image/webp');
  END IF;
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
-- For the link-in-bio "blog" block: a ministry's newest published articles, or the chosen ones (published only, in the given order), as cards with the
-- blog's address. An empty array when the ministry has no blog or nothing matches. Only published content, so it serves the public page and the editor alike.
CREATE FUNCTION public.blog_public_latest(p_tenant uuid, p_limit integer, p_slugs text[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_scope_clear(); blog public.blog_settings; result jsonb := '[]'::jsonb; size integer := least(greatest(coalesce(p_limit, 3), 1), 12);
BEGIN
  IF p_tenant IS NOT NULL AND coalesce(cardinality(p_slugs), 0) <= 12 THEN
    PERFORM pg_catalog.set_config('app.blog_public_tenant', p_tenant::text, true);
    SELECT * INTO blog FROM public.blog_settings b WHERE b.tenant_id = p_tenant;
    IF FOUND THEN
      IF p_slugs IS NULL OR cardinality(p_slugs) = 0 THEN
        SELECT coalesce(pg_catalog.jsonb_agg(public.blog_card(p) || pg_catalog.jsonb_build_object('handle', blog.handle) ORDER BY p.published_at DESC, p.id), '[]'::jsonb) INTO result
          FROM (SELECT * FROM public.blog_posts p WHERE p.tenant_id = p_tenant AND p.status = 'published' ORDER BY p.published_at DESC, p.id LIMIT size) p;
      ELSE
        SELECT coalesce(pg_catalog.jsonb_agg(public.blog_card(p) || pg_catalog.jsonb_build_object('handle', blog.handle) ORDER BY s.ord), '[]'::jsonb) INTO result
          FROM pg_catalog.unnest(p_slugs) WITH ORDINALITY AS s(slug, ord) JOIN public.blog_posts p ON p.tenant_id = p_tenant AND p.slug = s.slug AND p.status = 'published';
      END IF;
    END IF;
  END IF;
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_public_index(text, integer, integer), public.blog_public_post(text, text), public.blog_public_feed(text, integer),
  public.blog_public_image(text, uuid), public.blog_public_latest(uuid, integer, text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.blog_public_index(text, integer, integer), public.blog_public_post(text, text), public.blog_public_feed(text, integer),
  public.blog_public_image(text, uuid), public.blog_public_latest(uuid, integer, text[]) TO harvest_app;--> statement-breakpoint
-- The scheduled-publish job (worker role only): publishes up to p_limit articles whose time has come, oldest first, at their scheduled time. Skips rows another
-- run holds. Sends nothing anywhere. Returns how many it published.
CREATE FUNCTION public.blog_publish_due(p_limit integer) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb; due record; published integer := 0;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE invalid_parameter_value; END IF;
  prior := public.blog_scope_clear();
  PERFORM pg_catalog.set_config('app.blog_publish', 'on', true);
  FOR due IN SELECT p.tenant_id, p.id, p.publish_at FROM public.blog_posts p WHERE p.status = 'scheduled' AND p.publish_at <= pg_catalog.now()
      ORDER BY p.publish_at, p.id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.blog_posts SET status = 'published', published_at = due.publish_at, publish_at = NULL, version = version + 1, updated_at = pg_catalog.now()
      WHERE tenant_id = due.tenant_id AND id = due.id AND status = 'scheduled';
    published := published + 1;
  END LOOP;
  PERFORM public.blog_scope_restore(prior);
  RETURN published;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_publish_due(integer) FROM PUBLIC, harvest_app;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.blog_publish_due(integer) TO harvest_worker;
  END IF;
END $$;
