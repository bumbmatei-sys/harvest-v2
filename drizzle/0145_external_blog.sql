CREATE TABLE "blog_external_assets" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_external_asset_file" UNIQUE("tenant_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "blog_external_deliveries" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"requested_at" timestamp with time zone,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"remote_id" text,
	"remote_url" text,
	"content_hash" text,
	"pushed_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pushed_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	CONSTRAINT "blog_external_deliveries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "blog_external_delivery_target" UNIQUE("tenant_id","post_id","destination_id"),
	CONSTRAINT "blog_external_delivery_state" CHECK (("blog_external_deliveries"."mode" in ('draft','same_time','own_time')) and (("blog_external_deliveries"."mode" = 'draft') = ("blog_external_deliveries"."requested_at" is null))
    and "blog_external_deliveries"."status" in ('queued','scheduled_on_blog','published','draft_on_blog','failed','changed_on_blog')
    and (("blog_external_deliveries"."status" = 'failed') = ("blog_external_deliveries"."reason" is not null))
    and ("blog_external_deliveries"."reason" is null or "blog_external_deliveries"."reason" in ('disconnected','authorization','unavailable','invalid_request','remote_missing','outcome_unknown','unsupported'))
    and ("blog_external_deliveries"."content_hash" is null or "blog_external_deliveries"."content_hash" ~ '^[0-9a-f]{64}$')
    and ("blog_external_deliveries"."remote_id" is null or length("blog_external_deliveries"."remote_id") between 1 and 200)
    and ("blog_external_deliveries"."remote_url" is null or (length("blog_external_deliveries"."remote_url") <= 2000 and "blog_external_deliveries"."remote_url" like 'https://%')))
);
--> statement-breakpoint
CREATE TABLE "blog_external_destinations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"blog_ref" text NOT NULL,
	"title" text NOT NULL,
	"platform" text NOT NULL,
	"health" text NOT NULL,
	"authorization" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_external_destinations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "blog_external_destination_ref" UNIQUE("tenant_id","connection_id","blog_ref"),
	CONSTRAINT "blog_external_destination_fields" CHECK (length("blog_external_destinations"."blog_ref") between 1 and 200 and length("blog_external_destinations"."title") between 1 and 200
    and "blog_external_destinations"."platform" in ('wordpress','shopify','wix','webflow') and "blog_external_destinations"."health" in ('unknown','healthy','degraded','failing')
    and "blog_external_destinations"."authorization" in ('authorized','unavailable'))
);
--> statement-breakpoint
CREATE TABLE "blog_external_jobs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"post_version" integer NOT NULL,
	"payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease" uuid,
	"lease_until" timestamp with time zone,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "blog_external_jobs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "blog_external_job_state" CHECK ("blog_external_jobs"."operation" in ('push','update','check') and "blog_external_jobs"."attempts" between 0 and 4
    and ("blog_external_jobs"."operation" = 'check' or "blog_external_jobs"."payload" is not null or "blog_external_jobs"."finished_at" is not null)
    and ("blog_external_jobs"."payload" is null or (jsonb_typeof("blog_external_jobs"."payload") = 'object' and pg_column_size("blog_external_jobs"."payload") <= 2097152))
    and (("blog_external_jobs"."lease" is null) = ("blog_external_jobs"."lease_until" is null)))
);
--> statement-breakpoint
CREATE TABLE "blog_external_scope_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"backend_pid" integer NOT NULL,
	"purpose" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_system_actor";--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN "harvest_page" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_external_assets" ADD CONSTRAINT "blog_external_assets_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_external_assets" ADD CONSTRAINT "blog_external_assets_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_external_deliveries" ADD CONSTRAINT "blog_external_delivery_post" FOREIGN KEY ("tenant_id","post_id") REFERENCES "public"."blog_posts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_external_deliveries" ADD CONSTRAINT "blog_external_delivery_destination" FOREIGN KEY ("tenant_id","destination_id") REFERENCES "public"."blog_external_destinations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_external_destinations" ADD CONSTRAINT "blog_external_destination_connection" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_external_jobs" ADD CONSTRAINT "blog_external_job_delivery" FOREIGN KEY ("tenant_id","delivery_id") REFERENCES "public"."blog_external_deliveries"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blog_external_pending_job" ON "blog_external_jobs" USING btree ("tenant_id","delivery_id") WHERE "blog_external_jobs"."finished_at" is null;--> statement-breakpoint
CREATE INDEX "blog_external_due_job" ON "blog_external_jobs" USING btree ("next_at","id") WHERE "blog_external_jobs"."finished_at" is null;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_system_actor" CHECK ("audit_logs"."actor_id" is not null or "audit_logs"."action" in ('followup.case.withdraw', 'followup.case.revoke', 'community.live.auto_close', 'community.moderation_report_expire', 'newsletter.signup.confirmed', 'newsletter.unsubscribe.list', 'newsletter.unsubscribe.all', 'newsletter.withdrawal.propagated', 'community.profile_save', 'community.profile_withdraw', 'community.profile_erase', 'crm.form.submit', 'bio.message.submit', 'docs.trash.purge', 'blog.external.outcome'));--> statement-breakpoint
GRANT UPDATE (harvest_page) ON public.blog_posts TO harvest_app;--> statement-breakpoint
ALTER POLICY blog_public_definer ON public.blog_posts
  USING (tenant_id = nullif(current_setting('app.blog_public_tenant', true), '')::uuid AND harvest_page AND status = 'published');--> statement-breakpoint
ALTER POLICY blog_public_definer ON public.files
  USING (tenant_id = nullif(current_setting('app.blog_public_tenant', true), '')::uuid
    AND id = nullif(current_setting('app.blog_public_file', true), '')::uuid AND status = 'ready' AND NOT social_upload
    AND mime IN ('image/jpeg', 'image/png', 'image/webp') AND EXISTS (
      SELECT FROM public.blog_posts p WHERE p.tenant_id = files.tenant_id AND p.harvest_page AND p.status = 'published'
        AND (p.cover_file_id = files.id OR p.share_file_id = files.id OR files.id = ANY (p.image_ids))));--> statement-breakpoint
-- Private articles retain their editorial timeline for "same time" and the planner.
-- Public article queries also check the switch explicitly, including under a BYPASSRLS migration owner.
CREATE OR REPLACE FUNCTION public.blog_public_index(p_handle text, p_page integer, p_size integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_scope_clear(); blog public.blog_settings; result jsonb; total integer;
  size integer := least(greatest(coalesce(p_size, 12), 1), 50); page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
BEGIN
  blog := public.blog_scoped(p_handle);
  IF blog.tenant_id IS NOT NULL THEN
    SELECT count(*)::integer INTO total FROM public.blog_posts p WHERE p.tenant_id = blog.tenant_id AND p.status = 'published' AND p.harvest_page;
    result := pg_catalog.jsonb_build_object('handle', blog.handle, 'title', blog.title, 'intro', blog.intro, 'total', total,
      'posts', coalesce((SELECT pg_catalog.jsonb_agg(public.blog_card(p) ORDER BY p.published_at DESC, p.id) FROM (SELECT * FROM public.blog_posts p
        WHERE p.tenant_id = blog.tenant_id AND p.status = 'published' AND p.harvest_page ORDER BY p.published_at DESC, p.id LIMIT size OFFSET (page - 1) * size) p), '[]'::jsonb));
  END IF;
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.blog_public_post(p_handle text, p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_scope_clear(); blog public.blog_settings; post public.blog_posts; result jsonb;
BEGIN
  blog := public.blog_scoped(p_handle);
  IF blog.tenant_id IS NOT NULL AND p_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$' THEN
    SELECT * INTO post FROM public.blog_posts p WHERE p.tenant_id = blog.tenant_id AND p.slug = p_slug AND p.status = 'published' AND p.harvest_page;
    IF FOUND THEN
      result := public.blog_card(post) || pg_catalog.jsonb_build_object('body', post.body, 'seoTitle', post.seo_title, 'seoDescription', post.seo_description,
        'shareId', post.share_file_id, 'updatedAt', post.updated_at, 'blog', pg_catalog.jsonb_build_object('handle', blog.handle, 'title', blog.title),
        'more', coalesce((SELECT pg_catalog.jsonb_agg(public.blog_card(m) ORDER BY m.published_at DESC, m.id) FROM (SELECT * FROM public.blog_posts m
          WHERE m.tenant_id = blog.tenant_id AND m.status = 'published' AND m.harvest_page AND m.id <> post.id ORDER BY m.published_at DESC, m.id LIMIT 3) m), '[]'::jsonb));
    END IF;
  END IF;
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.blog_public_feed(p_handle text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_scope_clear(); blog public.blog_settings; result jsonb; size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
BEGIN
  blog := public.blog_scoped(p_handle);
  IF blog.tenant_id IS NOT NULL THEN
    result := pg_catalog.jsonb_build_object('handle', blog.handle, 'title', blog.title, 'intro', blog.intro,
      'items', coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('slug', p.slug, 'title', p.title, 'excerpt', p.excerpt, 'publishedAt', p.published_at,
        'updatedAt', p.updated_at, 'body', p.body) ORDER BY p.published_at DESC, p.id) FROM (SELECT * FROM public.blog_posts p
        WHERE p.tenant_id = blog.tenant_id AND p.status = 'published' AND p.harvest_page ORDER BY p.published_at DESC, p.id LIMIT size) p), '[]'::jsonb));
  END IF;
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.blog_public_image(p_handle text, p_file uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_scope_clear(); blog public.blog_settings; result jsonb;
BEGIN
  blog := public.blog_scoped(p_handle);
  IF blog.tenant_id IS NOT NULL AND p_file IS NOT NULL AND EXISTS (SELECT FROM public.blog_posts p WHERE p.tenant_id = blog.tenant_id AND p.status = 'published' AND p.harvest_page
      AND (p.cover_file_id = p_file OR p.share_file_id = p_file OR p_file = ANY (p.image_ids))) THEN
    PERFORM pg_catalog.set_config('app.blog_public_file', p_file::text, true);
    SELECT pg_catalog.jsonb_build_object('key', f.key, 'name', f.name, 'mime', f.mime) INTO result FROM public.files f
      WHERE f.tenant_id = blog.tenant_id AND f.id = p_file AND f.status = 'ready' AND f.mime IN ('image/jpeg', 'image/png', 'image/webp');
  END IF;
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.blog_public_latest(p_tenant uuid, p_limit integer, p_slugs text[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_scope_clear(); blog public.blog_settings; result jsonb := '[]'::jsonb; size integer := least(greatest(coalesce(p_limit, 3), 1), 12);
BEGIN
  IF p_tenant IS NOT NULL AND coalesce(cardinality(p_slugs), 0) <= 12 THEN
    PERFORM pg_catalog.set_config('app.blog_public_tenant', p_tenant::text, true);
    SELECT * INTO blog FROM public.blog_settings b WHERE b.tenant_id = p_tenant;
    IF FOUND THEN
      IF p_slugs IS NULL OR cardinality(p_slugs) = 0 THEN
        SELECT coalesce(pg_catalog.jsonb_agg(public.blog_card(p) || pg_catalog.jsonb_build_object('handle', blog.handle) ORDER BY p.published_at DESC, p.id), '[]'::jsonb) INTO result
          FROM (SELECT * FROM public.blog_posts p WHERE p.tenant_id = p_tenant AND p.status = 'published' AND p.harvest_page ORDER BY p.published_at DESC, p.id LIMIT size) p;
      ELSE
        SELECT coalesce(pg_catalog.jsonb_agg(public.blog_card(p) || pg_catalog.jsonb_build_object('handle', blog.handle) ORDER BY s.ord), '[]'::jsonb) INTO result
          FROM pg_catalog.unnest(p_slugs) WITH ORDINALITY AS s(slug, ord) JOIN public.blog_posts p ON p.tenant_id = p_tenant AND p.slug = s.slug AND p.status = 'published' AND p.harvest_page;
      END IF;
    END IF;
  END IF;
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint

DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['blog_external_destinations','blog_external_deliveries','blog_external_jobs','blog_external_assets','blog_external_scope_tokens'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', rel);
  END LOOP;
  EXECUTE format('CREATE POLICY blog_external_tokens_owner ON public.blog_external_scope_tokens TO %I
    USING (backend_pid = pg_catalog.pg_backend_pid() AND id::text = current_setting(''app.social_definer'', true))
    WITH CHECK (backend_pid = pg_catalog.pg_backend_pid() AND id::text = current_setting(''app.social_definer'', true))', current_user);
END $$;--> statement-breakpoint

GRANT SELECT, INSERT ON public.blog_external_destinations TO harvest_app;--> statement-breakpoint
GRANT UPDATE (title, health, "authorization", checked_at) ON public.blog_external_destinations TO harvest_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.blog_external_deliveries TO harvest_app;--> statement-breakpoint
GRANT UPDATE (mode, requested_at, status, reason, updated_at) ON public.blog_external_deliveries TO harvest_app;--> statement-breakpoint
GRANT SELECT (tenant_id, id, delivery_id, finished_at), INSERT (tenant_id, delivery_id, operation, post_version, payload) ON public.blog_external_jobs TO harvest_app;--> statement-breakpoint
GRANT SELECT, INSERT (tenant_id, file_id) ON public.blog_external_assets TO harvest_app;--> statement-breakpoint

CREATE POLICY blog_external_destinations_read ON public.blog_external_destinations FOR SELECT TO harvest_app
  USING (public.blog_can(tenant_id));--> statement-breakpoint
CREATE POLICY blog_external_destinations_manage ON public.blog_external_destinations TO harvest_app
  USING (public.blog_can(tenant_id) AND EXISTS (
    SELECT FROM public.social_connections c WHERE (c.tenant_id,c.id,c.platform) = (blog_external_destinations.tenant_id,connection_id,blog_external_destinations.platform)
  ))
  WITH CHECK (public.blog_can(tenant_id) AND EXISTS (
    SELECT FROM public.social_connections c
    WHERE (c.tenant_id,c.id,c.platform) = (blog_external_destinations.tenant_id,connection_id,blog_external_destinations.platform)
      AND c.status = 'active'
  ));--> statement-breakpoint
CREATE POLICY blog_external_deliveries_app ON public.blog_external_deliveries TO harvest_app
  USING (public.blog_can(tenant_id))
  WITH CHECK (public.blog_can(tenant_id) AND status = 'queued' AND reason IS NULL);--> statement-breakpoint
REVOKE INSERT ON public.blog_external_deliveries FROM harvest_app;--> statement-breakpoint
GRANT INSERT (tenant_id, post_id, destination_id, mode, requested_at) ON public.blog_external_deliveries TO harvest_app;--> statement-breakpoint
CREATE POLICY blog_external_jobs_app ON public.blog_external_jobs TO harvest_app
  USING (public.blog_can(tenant_id))
  WITH CHECK (public.blog_can(tenant_id) AND EXISTS (
    SELECT FROM public.blog_external_deliveries d
      JOIN public.blog_external_destinations b ON (b.tenant_id,b.id) = (d.tenant_id,d.destination_id)
      WHERE (d.tenant_id,d.id) = (blog_external_jobs.tenant_id,delivery_id)
        AND b.authorization = 'authorized' AND b.health <> 'failing'
        AND (operation = 'check' OR (operation = 'push') = (d.remote_id IS NULL))));--> statement-breakpoint
CREATE POLICY blog_external_assets_app ON public.blog_external_assets TO harvest_app
  USING (public.blog_can(tenant_id))
  WITH CHECK (public.blog_can(tenant_id) AND EXISTS (
    SELECT FROM public.blog_posts p WHERE p.tenant_id = blog_external_assets.tenant_id
      AND (p.cover_file_id = file_id OR file_id = ANY(p.image_ids))));--> statement-breakpoint

CREATE FUNCTION public.blog_external_clear() RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb;
  newsletter jsonb := pg_catalog.jsonb_build_object(
    'app.nl02_tenant', coalesce(current_setting('app.nl02_tenant', true), ''),
    'app.nl02_private', coalesce(current_setting('app.nl02_private', true), ''));
BEGIN
  -- 0146 adds both flags to the inherited reset. Keep 0145 independent and preserve their original values.
  prior := public.blog_scope_clear() || newsletter;
  PERFORM pg_catalog.set_config('app.nl02_tenant', '', true);
  PERFORM pg_catalog.set_config('app.nl02_private', '', true);
  RETURN prior;
END $$;--> statement-breakpoint

-- A boolean-only policy predicate. Alternate definer owners can evaluate the audit policy without access to scope tokens.
CREATE FUNCTION public.blog_external_audit_token(p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb; active boolean;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9-]{36}$' THEN RETURN false; END IF;
  prior := public.blog_external_clear();
  PERFORM pg_catalog.set_config('app.social_definer', p_token, true);
  SELECT EXISTS (SELECT FROM public.blog_external_scope_tokens t
    WHERE t.id::text = p_token AND t.backend_pid = pg_catalog.pg_backend_pid() AND t.purpose IN ('worker','disconnect')) INTO active;
  PERFORM public.blog_scope_restore(prior);
  RETURN active;
END $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.blog_external_audit_token(text) TO PUBLIC;--> statement-breakpoint

-- Use an existing cleared setting with a UUID value. The social policies require the literal 'on'.
-- The token is private, backend-bound, short-lived, and specific to the operation.
DO $$
DECLARE scope text := $s$EXISTS (SELECT FROM public.blog_external_scope_tokens t
  WHERE t.id::text = current_setting('app.social_definer', true)
    AND t.backend_pid = pg_catalog.pg_backend_pid() AND t.purpose = ANY (%s))$s$;
  worker text;
  jobs text;
  media text;
BEGIN
  worker := format(scope, 'ARRAY[''worker'']');
  jobs := format(scope, 'ARRAY[''worker'',''disconnect'']');
  media := format(scope, 'ARRAY[''media'']');
  EXECUTE format('CREATE POLICY blog_external_destination_owner ON public.blog_external_destinations TO %I USING (%s) WITH CHECK (%s)', current_user, jobs, jobs);
  EXECUTE format('CREATE POLICY blog_external_delivery_owner ON public.blog_external_deliveries TO %I USING (%s) WITH CHECK (%s)', current_user, jobs, jobs);
  EXECUTE format('CREATE POLICY blog_external_job_owner ON public.blog_external_jobs TO %I USING (%s) WITH CHECK (%s)', current_user, jobs, jobs);
  EXECUTE format('CREATE POLICY blog_external_connection_owner ON public.social_connections FOR SELECT TO %I USING (%s AND platform IN (''wordpress'',''shopify'',''wix'',''webflow''))', current_user, worker);
  EXECUTE format('CREATE POLICY blog_external_asset_owner ON public.blog_external_assets FOR SELECT TO %I USING (%s)', current_user, media);
  EXECUTE format('CREATE POLICY blog_external_file_owner ON public.files FOR SELECT TO %I USING (%s AND status = ''ready'' AND NOT social_upload
    AND mime IN (''image/jpeg'',''image/png'',''image/webp'') AND size <= 10485760)', current_user, media);
  EXECUTE format('CREATE POLICY blog_external_audit_owner ON public.audit_logs FOR INSERT TO %I
    WITH CHECK (action = ''blog.external.outcome'' AND actor_id IS NULL
      AND public.blog_external_audit_token(current_setting(''app.social_definer'', true)))', current_user);
END $$;--> statement-breakpoint

CREATE FUNCTION public.blog_external_open(p_purpose text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_external_clear(); token uuid := pg_catalog.gen_random_uuid();
BEGIN
  PERFORM pg_catalog.set_config('app.social_definer', token::text, true);
  INSERT INTO public.blog_external_scope_tokens VALUES (token, pg_catalog.pg_backend_pid(), p_purpose);
  RETURN prior;
END $$;--> statement-breakpoint

CREATE FUNCTION public.blog_external_close(p_prior jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  DELETE FROM public.blog_external_scope_tokens WHERE id::text = current_setting('app.social_definer', true) AND backend_pid = pg_catalog.pg_backend_pid();
  PERFORM public.blog_scope_restore(p_prior);
END $$;--> statement-breakpoint

CREATE FUNCTION public.blog_external_disconnect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_external_open('disconnect');
BEGIN
  UPDATE public.blog_external_destinations SET "authorization" = 'unavailable', checked_at = now()
    WHERE tenant_id = NEW.tenant_id AND connection_id = NEW.id;
  WITH cancelled AS (
    UPDATE public.blog_external_jobs j SET finished_at = now(), payload = NULL, lease = NULL, lease_until = NULL
    FROM public.blog_external_deliveries d JOIN public.blog_external_destinations b ON (b.tenant_id,b.id) = (d.tenant_id,d.destination_id)
    WHERE (j.tenant_id,j.delivery_id) = (d.tenant_id,d.id) AND b.tenant_id = NEW.tenant_id AND b.connection_id = NEW.id AND j.finished_at IS NULL
    RETURNING j.tenant_id,j.delivery_id,j.operation,j.attempts,j.id,j.post_version
  ), outcomes AS (
    UPDATE public.blog_external_deliveries d SET status = 'failed',
      reason = CASE WHEN j.operation = 'push' AND j.attempts > 0 THEN 'outcome_unknown' ELSE 'disconnected' END,
      updated_at = now()
      FROM cancelled j WHERE (j.tenant_id,j.delivery_id) = (d.tenant_id,d.id)
      RETURNING d.tenant_id,d.id,d.reason,j.id as job_id,j.post_version
  )
  INSERT INTO public.audit_logs (tenant_id,action,target_id,metadata)
    SELECT tenant_id,'blog.external.outcome',id,jsonb_build_object(
      'jobId',job_id,'version',post_version::text,'outcome','failed','reason',reason) FROM outcomes;
  PERFORM public.blog_external_close(prior);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER blog_external_disconnect AFTER UPDATE OF status ON public.social_connections
  FOR EACH ROW WHEN (OLD.status = 'active' AND NEW.status <> 'active') EXECUTE FUNCTION public.blog_external_disconnect();--> statement-breakpoint

CREATE FUNCTION public.blog_external_claim() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb; claim jsonb; picked record;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  prior := public.blog_external_open('worker');
  SELECT j.tenant_id,j.id,j.attempts INTO picked
    FROM public.blog_external_jobs j
    JOIN public.blog_external_deliveries d ON (d.tenant_id,d.id) = (j.tenant_id,j.delivery_id)
    JOIN public.blog_external_destinations b ON (b.tenant_id,b.id) = (d.tenant_id,d.destination_id)
    JOIN public.social_connections c ON (c.tenant_id,c.id) = (b.tenant_id,b.connection_id)
    WHERE j.finished_at IS NULL AND j.next_at <= now() AND (j.lease_until IS NULL OR j.lease_until <= now())
      AND c.status = 'active'
    ORDER BY j.next_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
  IF FOUND THEN
    UPDATE public.blog_external_jobs j SET lease = pg_catalog.gen_random_uuid(), lease_until = now() + interval '5 minutes',
      attempts = least(j.attempts + 1,4)
      FROM public.blog_external_deliveries d, public.blog_external_destinations b, public.social_connections c
      WHERE (j.tenant_id,j.id) = (picked.tenant_id,picked.id)
        AND (d.tenant_id,d.id) = (j.tenant_id,j.delivery_id) AND (b.tenant_id,b.id) = (d.tenant_id,d.destination_id)
        AND (c.tenant_id,c.id) = (b.tenant_id,b.connection_id)
      RETURNING jsonb_build_object('tenantId',j.tenant_id,'id',j.id,'lease',j.lease,'attempt',j.attempts,
        'exhausted',picked.attempts = 4 OR (j.operation = 'push' AND picked.attempts > 0 AND d.updated_at <= now() - interval '23 hours'),
        'operation',j.operation,'payload',j.payload,'postId',d.post_id,
        'remoteId',d.remote_id,'contentHash',d.content_hash,'requestedAt',d.requested_at,'platform',b.platform,'blogRef',b.blog_ref,
        'connectionId',c.id,'provider',c.provider,'accountRef',c.external_account_ref,'credentialEnvelope',c.credential_envelope,
        'authorized',b.authorization = 'authorized' AND b.health <> 'failing')
      INTO claim;
  END IF;
  PERFORM public.blog_external_close(prior);
  RETURN claim;
END $$;--> statement-breakpoint

CREATE FUNCTION public.blog_external_finish(p_tenant uuid,p_job uuid,p_lease uuid,p_status text,p_reason text,p_remote text,p_url text,p_hash text,p_backoff integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb; job public.blog_external_jobs; changed boolean;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  prior := public.blog_external_open('worker');
  SELECT * INTO job FROM public.blog_external_jobs
    WHERE (tenant_id,id,lease) = (p_tenant,p_job,p_lease) AND finished_at IS NULL AND lease_until > now() FOR UPDATE;
  changed := FOUND;
  IF changed THEN
    IF p_backoff BETWEEN 1 AND 300 AND job.attempts < 4 THEN
      UPDATE public.blog_external_jobs SET lease = NULL, lease_until = NULL, next_at = now() + pg_catalog.make_interval(secs => p_backoff)
        WHERE (tenant_id,id) = (p_tenant,p_job);
    ELSE
      IF p_status NOT IN ('failed','published','scheduled_on_blog','draft_on_blog','changed_on_blog') OR p_status IS NULL THEN RAISE invalid_parameter_value; END IF;
      UPDATE public.blog_external_jobs SET lease = NULL, lease_until = NULL, finished_at = now(), payload = NULL WHERE (tenant_id,id) = (p_tenant,p_job);
      UPDATE public.blog_external_deliveries SET status = p_status, reason = p_reason,
        remote_id = coalesce(p_remote,remote_id),
        remote_url = CASE WHEN p_remote IS NOT NULL THEN p_url ELSE remote_url END,
        content_hash = CASE WHEN job.operation <> 'check' THEN coalesce(p_hash,content_hash) ELSE coalesce(content_hash,p_hash) END,
        pushed_version = CASE WHEN job.operation <> 'check' AND p_hash IS NOT NULL THEN job.post_version ELSE pushed_version END,
        pushed_at = CASE WHEN job.operation <> 'check' AND p_hash IS NOT NULL THEN now() ELSE pushed_at END,
        checked_at = now(), updated_at = now()
        WHERE (tenant_id,id) = (p_tenant,job.delivery_id);
      INSERT INTO public.audit_logs (tenant_id,action,target_id,metadata)
        VALUES (p_tenant,'blog.external.outcome',job.delivery_id,jsonb_strip_nulls(jsonb_build_object(
          'jobId',p_job,'version',job.post_version::text,'outcome',p_status,'reason',p_reason)));
    END IF;
  END IF;
  PERFORM public.blog_external_close(prior);
  RETURN changed;
END $$;--> statement-breakpoint

CREATE FUNCTION public.blog_external_asset(p_id uuid) RETURNS TABLE (object_key text,mime text,size bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.blog_external_open('media');
BEGIN
  RETURN QUERY SELECT f.key,f.mime,f.size::bigint FROM public.blog_external_assets a JOIN public.files f
    ON (f.tenant_id,f.id) = (a.tenant_id,a.file_id)
    WHERE a.id = p_id AND f.status = 'ready' AND NOT f.social_upload AND f.mime IN ('image/jpeg','image/png','image/webp') AND f.size <= 10485760;
  PERFORM public.blog_external_close(prior);
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.blog_external_clear(), public.blog_external_open(text), public.blog_external_close(jsonb), public.blog_external_disconnect(),
  public.blog_external_claim(), public.blog_external_finish(uuid,uuid,uuid,text,text,text,text,text,integer),
  public.blog_external_asset(uuid) FROM PUBLIC, harvest_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.blog_external_asset(uuid) TO harvest_app;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.blog_external_claim(),
      public.blog_external_finish(uuid,uuid,uuid,text,text,text,text,text,integer) TO harvest_worker;
  END IF;
END $$;
