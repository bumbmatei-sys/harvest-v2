CREATE FUNCTION public.valid_bio_handle(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
  SELECT value ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' AND value NOT LIKE '%--%' AND value NOT IN ('account','admin','api','app','assets','auth','bio','c','click','communities','connect','discover','edit','f','harvest','health','help','l','link','links','login','message','messages','new','newsletter','photo','preview','profile','resources','s','settings','sign-in','subscribe','support','workspace','workspaces','www')
$$;
--> statement-breakpoint
CREATE TABLE "bio_clicks" (
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"day" date NOT NULL,
	"clicks" integer NOT NULL,
	CONSTRAINT "bio_clicks_page_id_block_id_day_pk" PRIMARY KEY("page_id","block_id","day"),
	CONSTRAINT "bio_clicks_block" CHECK ("bio_clicks"."block_id" ~ '^[a-z0-9]{8}$'),
	CONSTRAINT "bio_clicks_count" CHECK ("bio_clicks"."clicks" > 0)
);
--> statement-breakpoint
CREATE TABLE "bio_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"uploader_id" text,
	"key" text NOT NULL,
	"kind" text DEFAULT 'photo' NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"checksum" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bio_files_key_unique" UNIQUE("key"),
	CONSTRAINT "bio_file_kind" CHECK ("bio_files"."kind"='photo'),
	CONSTRAINT "bio_file_mime" CHECK ("bio_files"."mime" in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "bio_file_name" CHECK (length(btrim("bio_files"."name")) between 1 and 200),
	CONSTRAINT "bio_file_size" CHECK ("bio_files"."size" between 1 and 10485760),
	CONSTRAINT "bio_file_checksum" CHECK ("bio_files"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "bio_file_status" CHECK ("bio_files"."status" in ('pending','uploaded','quarantined','ready')),
	CONSTRAINT "bio_file_key" CHECK ("bio_files"."key" = 'workspaces/' || "bio_files"."tenant_id"::text || '/bio/' || "bio_files"."page_id"::text || '/files/' || "bio_files"."id"::text)
);
--> statement-breakpoint
CREATE TABLE "bio_messages" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"body" text NOT NULL,
	"notice" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"request_hash" text NOT NULL,
	"created_contact" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bio_messages_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "bio_messages_status" CHECK ("bio_messages"."status" in ('new','handled')),
	CONSTRAINT "bio_messages_hash" CHECK ("bio_messages"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "bio_messages_lengths" CHECK (length("bio_messages"."name") between 1 and 100 and length("bio_messages"."email") between 3 and 254 and length("bio_messages"."body") between 1 and 2000),
	CONSTRAINT "bio_messages_expiry" CHECK ("bio_messages"."expires_at" > "bio_messages"."created_at")
);
--> statement-breakpoint
CREATE TABLE "bio_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"photo_file_id" uuid,
	"published" jsonb,
	"published_photo_file_id" uuid,
	"published_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bio_pages_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "bio_pages_tenant_uq" UNIQUE("tenant_id"),
	CONSTRAINT "bio_pages_handle" CHECK (public.valid_bio_handle("bio_pages"."handle")),
	CONSTRAINT "bio_pages_status" CHECK ("bio_pages"."status" in ('draft','published')),
	CONSTRAINT "bio_pages_draft" CHECK (jsonb_typeof("bio_pages"."draft")='object' and "bio_pages"."draft"->>'kind'='bio-v1' and pg_column_size("bio_pages"."draft")<=65536),
	CONSTRAINT "bio_pages_published" CHECK (("bio_pages"."status"='published') = ("bio_pages"."published" is not null) and ("bio_pages"."published" is null or (jsonb_typeof("bio_pages"."published")='object' and pg_column_size("bio_pages"."published")<=65536)))
);
--> statement-breakpoint
CREATE TABLE "bio_quotas" (
	"scope" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "bio_quotas_scope_minute_pk" PRIMARY KEY("scope","minute")
);
--> statement-breakpoint
CREATE TABLE "bio_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bio_clicks" ADD CONSTRAINT "bio_clicks_tenant_id_page_id_bio_pages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","page_id") REFERENCES "public"."bio_pages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bio_files" ADD CONSTRAINT "bio_files_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bio_files" ADD CONSTRAINT "bio_files_tenant_id_page_id_bio_pages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","page_id") REFERENCES "public"."bio_pages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bio_messages" ADD CONSTRAINT "bio_messages_tenant_id_page_id_bio_pages_tenant_id_id_fk" FOREIGN KEY ("tenant_id","page_id") REFERENCES "public"."bio_pages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bio_messages" ADD CONSTRAINT "bio_messages_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bio_pages" ADD CONSTRAINT "bio_pages_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bio_pages" ADD CONSTRAINT "bio_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bio_files_page" ON "bio_files" USING btree ("tenant_id","page_id");--> statement-breakpoint
CREATE INDEX "bio_messages_listing_idx" ON "bio_messages" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "bio_messages_contact_idx" ON "bio_messages" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bio_pages_handle_uq" ON "bio_pages" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "bio_quota_expiry_idx" ON "bio_quotas" USING btree ("minute");--> statement-breakpoint
CREATE INDEX "bio_receipt_expiry_idx" ON "bio_receipts" USING btree ("expires_at");
--> statement-breakpoint
-- The only system-attributed audit row of this feature: a "Message me" submission (no actor, ids only).
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_system_actor";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_system_actor" CHECK ("audit_logs"."actor_id" is not null or "audit_logs"."action" in ('followup.case.withdraw', 'followup.case.revoke', 'community.live.auto_close', 'community.moderation_report_expire', 'newsletter.signup.confirmed', 'newsletter.unsubscribe.list', 'newsletter.unsubscribe.all', 'newsletter.withdrawal.propagated', 'community.profile_save', 'community.profile_withdraw', 'community.profile_erase', 'crm.form.submit', 'bio.message.submit'));
--> statement-breakpoint
-- Link in bio: owners and admins manage the page, its clicks and its messages. Members and viewers see none of it. Anonymous access exists only through the
-- SECURITY DEFINER functions below (public page, photo, click, message); they set and clear their own scope settings and no harvest_app policy reads those.
CREATE FUNCTION public.bio_role_can(p_role text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT p_role IN ('owner','admin') $$;
REVOKE ALL ON FUNCTION public.bio_role_can(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bio_role_can(text) TO harvest_app;
--> statement-breakpoint
DO $$
DECLARE rel text;
  scope text := $s$tenant_id = nullif(current_setting('app.bio_tenant', true), '')::uuid$s$;
  resolved text := $s$nullif(current_setting('app.bio_tenant', true), '') IS NOT NULL$s$;
  manager text := $s$tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id = %I.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.bio_role_can(m.role_id))$s$;
BEGIN
  FOREACH rel IN ARRAY ARRAY['bio_pages','bio_files','bio_clicks','bio_messages','bio_quotas','bio_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', rel);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN EXECUTE format('REVOKE ALL ON public.%I FROM harvest_worker', rel); END IF;
  END LOOP;
  -- Managers (the app role).
  EXECUTE format('CREATE POLICY bio_manage_read ON public.bio_pages FOR SELECT TO harvest_app USING (' || manager || ')', 'bio_pages');
  EXECUTE format('CREATE POLICY bio_manage_insert ON public.bio_pages FOR INSERT TO harvest_app WITH CHECK (created_by = nullif(current_setting(''app.user_id'', true), '''') AND ' || manager || ')', 'bio_pages');
  EXECUTE format('CREATE POLICY bio_manage_update ON public.bio_pages FOR UPDATE TO harvest_app USING (' || manager || ') WITH CHECK (' || manager || ')', 'bio_pages', 'bio_pages');
  EXECUTE format('CREATE POLICY bio_manage_read ON public.bio_clicks FOR SELECT TO harvest_app USING (' || manager || ')', 'bio_clicks');
  EXECUTE format('CREATE POLICY bio_manage_read ON public.bio_messages FOR SELECT TO harvest_app USING (expires_at > now() AND ' || manager || ')', 'bio_messages');
  EXECUTE format('CREATE POLICY bio_manage_update ON public.bio_messages FOR UPDATE TO harvest_app USING (expires_at > now() AND ' || manager || ') WITH CHECK (' || manager || ')', 'bio_messages', 'bio_messages');
  EXECUTE format('CREATE POLICY bio_manage_delete ON public.bio_messages FOR DELETE TO harvest_app USING (' || manager || ')', 'bio_messages');
  -- The definer functions run as the migration owner (never harvest_app, which has no write grant on these tables), scoped by settings they set themselves.
  -- The policies are not bound to a named owner role: a restricted owner (as on Neon) is covered the same way, and harvest_app is excluded explicitly.
  EXECUTE format('CREATE POLICY bio_definer_read ON public.bio_pages FOR SELECT TO PUBLIC USING (current_user <> ''harvest_app'' AND (handle = nullif(current_setting(''app.bio_handle'', true), '''') OR %s))', scope);
  EXECUTE format('CREATE POLICY bio_definer_update ON public.bio_pages FOR UPDATE TO PUBLIC USING (current_user <> ''harvest_app'' AND %s) WITH CHECK (current_user <> ''harvest_app'' AND %s)', scope, scope);
  FOREACH rel IN ARRAY ARRAY['bio_files','bio_clicks','bio_messages'] LOOP
    EXECUTE format('CREATE POLICY bio_definer_scope ON public.%I TO PUBLIC USING (current_user <> ''harvest_app'' AND %s) WITH CHECK (current_user <> ''harvest_app'' AND %s)', rel, scope, scope);
  END LOOP;
  EXECUTE format('CREATE POLICY bio_quota_access ON public.bio_quotas TO PUBLIC USING (current_user <> ''harvest_app'' AND %s) WITH CHECK (current_user <> ''harvest_app'' AND %s)', resolved, resolved);
  EXECUTE format('CREATE POLICY bio_receipt_access ON public.bio_receipts TO PUBLIC USING (current_user <> ''harvest_app'' AND %s) WITH CHECK (current_user <> ''harvest_app'' AND %s)', resolved, resolved);
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.bio_pages TO harvest_app;
GRANT UPDATE (handle, draft, version, updated_at) ON public.bio_pages TO harvest_app;
GRANT SELECT ON public.bio_clicks TO harvest_app;
GRANT SELECT, DELETE ON public.bio_messages TO harvest_app;
GRANT UPDATE (status) ON public.bio_messages TO harvest_app;
--> statement-breakpoint
-- A published address cannot change; unpublish first.
CREATE FUNCTION public.bio_guard_page() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.status = 'published' AND NEW.handle IS DISTINCT FROM OLD.handle THEN RAISE EXCEPTION 'a published link in bio address cannot change' USING ERRCODE = '23514'; END IF;
  IF (NEW.tenant_id, NEW.id) IS DISTINCT FROM (OLD.tenant_id, OLD.id) THEN RAISE EXCEPTION 'link in bio identity is immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bio_guard_page() FROM PUBLIC, harvest_app;
CREATE TRIGGER bio_guard_page BEFORE UPDATE ON public.bio_pages FOR EACH ROW EXECUTE FUNCTION public.bio_guard_page();
--> statement-breakpoint
-- A photo must be a ready, current file of the same page.
CREATE FUNCTION public.bio_guard_photo() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE wanted uuid;
BEGIN
  FOREACH wanted IN ARRAY ARRAY[NEW.photo_file_id, NEW.published_photo_file_id] LOOP
    IF wanted IS NOT NULL AND NOT EXISTS (SELECT FROM public.bio_files f WHERE f.id = wanted AND f.tenant_id = NEW.tenant_id AND f.page_id = NEW.id AND f.status = 'ready') THEN
      RAISE EXCEPTION 'photo does not belong to this page or is unavailable' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bio_guard_photo() FROM PUBLIC, harvest_app;
CREATE TRIGGER bio_guard_photo BEFORE INSERT OR UPDATE OF photo_file_id, published_photo_file_id ON public.bio_pages FOR EACH ROW EXECUTE FUNCTION public.bio_guard_photo();
--> statement-breakpoint
-- Scope helpers: remember and clear the settings a definer reads, restore them afterwards.
CREATE FUNCTION public.bio_scope_clear(p_keep_user boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := '{}'::jsonb; key text;
BEGIN
  FOREACH key IN ARRAY ARRAY['app.bio_handle','app.bio_tenant','app.tenant_id','app.community_definer_tenant','app.crm_forms_slug','app.user_id'] LOOP
    prior := prior || jsonb_build_object(key, coalesce(current_setting(key, true), ''));
    IF key <> 'app.user_id' OR NOT p_keep_user THEN PERFORM set_config(key, '', true); END IF;
  END LOOP;
  RETURN prior;
END $$;
CREATE FUNCTION public.bio_scope_restore(p_prior jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE entry record;
BEGIN
  FOR entry IN SELECT key, value FROM jsonb_each_text(p_prior) LOOP PERFORM set_config(entry.key, entry.value, true); END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.bio_scope_clear(boolean), public.bio_scope_restore(jsonb) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- Minute buckets shared by clicks and messages. Returns true while the bucket is within its limit.
CREATE FUNCTION public.bio_charge(p_scope text, p_limit integer, p_minute timestamptz) RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE used integer;
BEGIN
  INSERT INTO public.bio_quotas (scope, minute, attempts) VALUES (p_scope, p_minute, 1)
    ON CONFLICT (scope, minute) DO UPDATE SET attempts = least(public.bio_quotas.attempts + 1, p_limit + 1) RETURNING attempts INTO used;
  RETURN used <= p_limit;
END $$;
REVOKE ALL ON FUNCTION public.bio_charge(text, integer, timestamptz) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- The published page, as a visitor may see it (an explicit allow-list: no draft, no ids of people). Unpublished and missing handles answer NULL alike.
CREATE FUNCTION public.bio_public_page_scoped(p_handle text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE page public.bio_pages; ministry record; communities jsonb := '{}'::jsonb; signups jsonb := '[]'::jsonb; block jsonb; card jsonb;
BEGIN
  IF public.valid_bio_handle(p_handle) IS NOT TRUE THEN RETURN NULL; END IF;
  PERFORM set_config('app.bio_handle', p_handle, true);
  SELECT * INTO page FROM public.bio_pages WHERE handle = p_handle AND status = 'published';
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM set_config('app.bio_tenant', page.tenant_id::text, true);
  PERFORM set_config('app.tenant_id', page.tenant_id::text, true);
  PERFORM set_config('app.community_definer_tenant', page.tenant_id::text, true);
  SELECT w.name, w.brand_theme INTO ministry FROM public.workspaces w WHERE w.tenant_id = page.tenant_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOR block IN SELECT b FROM jsonb_array_elements(page.published->'blocks') b WHERE b->>'type' = 'community' AND (b->>'hidden') = 'false' LOOP
    SELECT jsonb_build_object('name', c.name, 'tagline', c.tagline, 'slug', c.slug) INTO card FROM public.communities c
      WHERE c.tenant_id = page.tenant_id AND c.id = (block->>'communityId')::uuid AND c.status = 'published' AND c.visibility <> 'hidden';
    IF FOUND THEN communities := communities || jsonb_build_object(block->>'communityId', card); END IF;
  END LOOP;
  FOR block IN SELECT b FROM jsonb_array_elements(page.published->'blocks') b WHERE b->>'type' = 'newsletter' AND (b->>'hidden') = 'false' LOOP
    PERFORM set_config('app.crm_forms_slug', block->>'slug', true);
    IF EXISTS (SELECT FROM public.crm_form_addresses a WHERE a.tenant_id = page.tenant_id AND a.slug = block->>'slug' AND a.version_id IS NOT NULL AND a.retired_at IS NULL) THEN
      signups := signups || to_jsonb(block->>'slug');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('handle', page.handle, 'ministryName', ministry.name, 'brandTheme', ministry.brand_theme, 'definition', page.published,
    'hasPhoto', page.published_photo_file_id IS NOT NULL, 'communities', communities, 'signups', signups);
END $$;
REVOKE ALL ON FUNCTION public.bio_public_page_scoped(text) FROM PUBLIC, harvest_app;
CREATE FUNCTION public.bio_public_page(p_handle text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(false); result jsonb;
BEGIN
  result := public.bio_public_page_scoped(p_handle);
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.bio_public_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bio_public_page(text) TO harvest_app;
--> statement-breakpoint
-- The published photo's storage key (the route signs a short-lived address from it).
CREATE FUNCTION public.bio_public_photo_scoped(p_handle text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE page public.bio_pages; file public.bio_files;
BEGIN
  IF public.valid_bio_handle(p_handle) IS NOT TRUE THEN RETURN NULL; END IF;
  PERFORM set_config('app.bio_handle', p_handle, true);
  SELECT * INTO page FROM public.bio_pages WHERE handle = p_handle AND status = 'published' AND published_photo_file_id IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM set_config('app.bio_tenant', page.tenant_id::text, true);
  SELECT * INTO file FROM public.bio_files WHERE tenant_id = page.tenant_id AND page_id = page.id AND id = page.published_photo_file_id AND status = 'ready';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('key', file.key, 'name', file.name, 'mime', file.mime);
END $$;
REVOKE ALL ON FUNCTION public.bio_public_photo_scoped(text) FROM PUBLIC, harvest_app;
CREATE FUNCTION public.bio_public_photo(p_handle text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(false); result jsonb;
BEGIN
  result := public.bio_public_photo_scoped(p_handle);
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.bio_public_photo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bio_public_photo(text) TO harvest_app;
--> statement-breakpoint
-- A click: a block of a published page, one more for today. Rate limited per visitor and page; nothing about the visitor is kept (the visitor key lives in the minute bucket only).
CREATE FUNCTION public.bio_record_click_scoped(p_handle text, p_block text, p_visitor text) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE page public.bio_pages; minute_start timestamptz := date_trunc('minute', clock_timestamp());
BEGIN
  IF public.valid_bio_handle(p_handle) IS NOT TRUE OR p_block !~ '^[a-z0-9]{8}$' OR p_visitor !~ '^[a-f0-9]{64}$' THEN RETURN 'not_found'; END IF;
  PERFORM set_config('app.bio_handle', p_handle, true);
  SELECT * INTO page FROM public.bio_pages WHERE handle = p_handle AND status = 'published';
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  PERFORM set_config('app.bio_tenant', page.tenant_id::text, true);
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(page.published->'blocks') b WHERE b->>'id' = p_block AND (b->>'hidden') = 'false' AND b->>'type' IN ('link','event','community')) THEN RETURN 'not_found'; END IF;
  DELETE FROM public.bio_quotas WHERE minute < minute_start - interval '2 minutes';
  IF NOT public.bio_charge('click:' || p_visitor || ':' || page.id, 60, minute_start) OR NOT public.bio_charge('click:' || page.id, 600, minute_start) THEN RETURN 'limited'; END IF;
  INSERT INTO public.bio_clicks (tenant_id, page_id, block_id, day, clicks) VALUES (page.tenant_id, page.id, p_block, (clock_timestamp() AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (page_id, block_id, day) DO UPDATE SET clicks = public.bio_clicks.clicks + 1;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.bio_record_click_scoped(text, text, text) FROM PUBLIC, harvest_app;
CREATE FUNCTION public.bio_record_click(p_handle text, p_block text, p_visitor text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(false); result text;
BEGIN
  result := public.bio_record_click_scoped(p_handle, p_block, p_visitor);
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.bio_record_click(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bio_record_click(text, text, text) TO harvest_app;
--> statement-breakpoint
-- "Message me". Synthetic-only like the hosted forms: only a harvest_test database and an @example.test address are accepted, and nothing is sent. The page must have an
-- enabled message block in its published copy. The person is created or reused by email; a name on an existing person is never overwritten.
CREATE FUNCTION public.bio_submit_message_scoped(p_handle text, p_receipt uuid, p_proof_expiry timestamptz, p_name text, p_email text, p_body text, p_request_hash text, p_visitor text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE page public.bio_pages; tenant uuid; ministry text; person uuid; matching uuid[]; address_email text := lower(btrim(p_email)); person_name text := btrim(p_name);
  was_created boolean := false; existing_hash text; at_time timestamptz := clock_timestamp(); minute_start timestamptz := date_trunc('minute', clock_timestamp());
BEGIN
  IF current_database() !~ '^harvest_test(_|$)' OR public.valid_bio_handle(p_handle) IS NOT TRUE OR p_visitor !~ '^[a-f0-9]{64}$' THEN RETURN 'not_found'; END IF;
  PERFORM set_config('app.bio_handle', p_handle, true);
  SELECT * INTO page FROM public.bio_pages WHERE handle = p_handle AND status = 'published';
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  tenant := page.tenant_id;
  PERFORM set_config('app.bio_tenant', tenant::text, true);
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(page.published->'blocks') b WHERE b->>'type' = 'message' AND (b->>'hidden') = 'false') THEN RETURN 'not_found'; END IF;
  DELETE FROM public.bio_quotas WHERE minute < minute_start - interval '2 minutes';
  IF NOT public.bio_charge('msg:' || p_visitor || ':' || page.id, 5, minute_start) OR NOT public.bio_charge('msg:' || p_visitor, 20, minute_start)
    OR NOT public.bio_charge('msg-page:' || page.id, 60, minute_start) OR NOT public.bio_charge('msg-all', 600, minute_start) THEN RETURN 'limited'; END IF;
  IF p_receipt IS NULL OR p_proof_expiry IS NULL OR p_proof_expiry <= at_time OR p_proof_expiry > at_time + interval '10 minutes' OR (p_request_hash ~ '^[a-f0-9]{64}$') IS NOT TRUE
    OR person_name IS NULL OR length(person_name) NOT BETWEEN 1 AND 100 OR length(btrim(p_body)) NOT BETWEEN 1 AND 2000
    OR length(address_email) > 254 OR address_email !~ '^[^@[:space:]]+@example[.]test$' THEN RETURN 'invalid'; END IF;
  PERFORM set_config('app.tenant_id', tenant::text, true);
  SELECT w.name INTO ministry FROM public.workspaces w WHERE w.tenant_id = tenant;
  -- A receipt is a random nonce: replaying a proof never creates a second message.
  DELETE FROM public.bio_receipts WHERE expires_at <= at_time;
  INSERT INTO public.bio_receipts (id, expires_at) VALUES (p_receipt, p_proof_expiry) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT m.request_hash INTO existing_hash FROM public.bio_messages m WHERE m.tenant_id = tenant AND m.id = p_receipt;
    IF NOT FOUND OR existing_hash = p_request_hash THEN RETURN 'ok'; END IF;
    RETURN 'conflict';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(tenant || ':email:' || address_email, 0));
  SELECT array_agg(id ORDER BY id) INTO matching FROM (
    SELECT c.id FROM public.contacts c WHERE c.tenant_id = tenant AND c.erased_at IS NULL AND EXISTS (
      SELECT FROM public.contact_identifiers i WHERE i.tenant_id = tenant AND i.contact_id = c.id AND i.kind = 'email' AND i.normalized_value = address_email)
    ORDER BY c.id FOR UPDATE) matched;
  IF cardinality(matching) > 1 THEN RETURN 'conflict'; END IF;
  person := matching[1];
  IF person IS NULL THEN
    INSERT INTO public.contacts (tenant_id, name, notes) VALUES (tenant, person_name, '') RETURNING id INTO person;
    INSERT INTO public.contact_identifiers (tenant_id, contact_id, kind, value, normalized_value) VALUES (tenant, person, 'email', address_email, address_email);
    was_created := true;
  END IF;
  INSERT INTO public.bio_messages (tenant_id, id, page_id, contact_id, name, email, body, notice, request_hash, created_contact, created_at, expires_at)
    VALUES (tenant, p_receipt, page.id, person, person_name, address_email, btrim(p_body),
      'Your details go to ' || coalesce(nullif(btrim(ministry), ''), 'the ministry') || '. You can ask them to delete them.', p_request_hash, was_created, at_time, at_time + interval '90 days');
  INSERT INTO public.audit_logs (tenant_id, action, target_id, metadata) VALUES (tenant, 'bio.message.submit', page.id::text, '{}'::jsonb);
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.bio_submit_message_scoped(text, uuid, timestamptz, text, text, text, text, text) FROM PUBLIC, harvest_app;
CREATE FUNCTION public.bio_submit_message(p_handle text, p_receipt uuid, p_proof_expiry timestamptz, p_name text, p_email text, p_body text, p_request_hash text, p_visitor text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(false); result text;
BEGIN
  result := public.bio_submit_message_scoped(p_handle, p_receipt, p_proof_expiry, p_name, p_email, p_body, p_request_hash, p_visitor);
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.bio_submit_message(text, uuid, timestamptz, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bio_submit_message(text, uuid, timestamptz, text, text, text, text, text) TO harvest_app;
--> statement-breakpoint
-- Publish and unpublish: owners and admins, against the version the editor loaded. Publishing copies the draft (and its ready photo) into the immutable published copy.
CREATE FUNCTION public.bio_transition_scoped(p_tenant uuid, p_action text, p_version integer) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); page public.bio_pages;
BEGIN
  IF actor IS NULL OR p_tenant IS NULL OR p_action NOT IN ('publish','unpublish') THEN RETURN 'not_found'; END IF;
  PERFORM set_config('app.bio_tenant', p_tenant::text, true);
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND public.bio_role_can(role_id) FOR SHARE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT * INTO page FROM public.bio_pages WHERE tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF p_action = 'publish' THEN
    IF page.version IS DISTINCT FROM p_version THEN RETURN 'stale'; END IF;
    IF btrim(coalesce(page.draft->>'name', '')) = '' OR NOT EXISTS (SELECT FROM jsonb_array_elements(page.draft->'blocks') b WHERE (b->>'hidden') = 'false') THEN RETURN 'invalid'; END IF;
    UPDATE public.bio_pages SET status = 'published', published = draft, published_photo_file_id = photo_file_id, published_at = clock_timestamp(), updated_at = clock_timestamp() WHERE tenant_id = p_tenant;
  ELSE
    IF page.status <> 'published' THEN RETURN 'unchanged'; END IF;
    UPDATE public.bio_pages SET status = 'draft', published = NULL, published_photo_file_id = NULL, published_at = NULL, updated_at = clock_timestamp() WHERE tenant_id = p_tenant;
  END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata) VALUES (p_tenant, actor, 'bio.' || p_action, page.id::text, jsonb_build_object('version', page.version));
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.bio_transition_scoped(uuid, text, integer) FROM PUBLIC, harvest_app;
CREATE FUNCTION public.bio_transition(p_tenant uuid, p_action text, p_version integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(true); result text;
BEGIN
  result := public.bio_transition_scoped(p_tenant, p_action, p_version);
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.bio_transition(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bio_transition(uuid, text, integer) TO harvest_app;
--> statement-breakpoint
-- The profile photo: create, inspect, status, set and serve, modelled on the event cover (the file is private until the scan releases it; setting it bumps the page version).
CREATE FUNCTION public.bio_photo_perform(p_tenant uuid, p_action text, p_file uuid, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); page public.bio_pages; file public.bio_files; requested_status text; expected integer; previous uuid;
  missing jsonb := '{"outcome":"not_found"}';
BEGIN
  IF actor IS NULL OR p_tenant IS NULL OR p_action NOT IN ('serve','create','inspect','status','set') THEN RETURN missing; END IF;
  PERFORM set_config('app.bio_tenant', p_tenant::text, true);
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND public.bio_role_can(role_id) FOR SHARE;
  IF NOT FOUND THEN RETURN missing; END IF;
  SELECT * INTO page FROM public.bio_pages WHERE tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN missing; END IF;
  IF p_action = 'serve' THEN
    SELECT * INTO file FROM public.bio_files WHERE tenant_id = p_tenant AND page_id = page.id AND id = page.photo_file_id AND status = 'ready' AND retired_at IS NULL;
    IF NOT FOUND THEN RETURN missing; END IF;
    RETURN jsonb_build_object('outcome', 'ok', 'data', jsonb_build_object('key', file.key, 'name', file.name, 'mime', file.mime));
  END IF;
  IF p_action = 'set' THEN
    expected := (p_input->>'version')::integer;
    IF expected IS NULL OR expected < 1 THEN RETURN '{"outcome":"invalid"}'; END IF;
    IF page.version <> expected THEN RETURN '{"outcome":"conflict"}'; END IF;
    IF page.photo_file_id IS DISTINCT FROM p_file THEN
      IF p_file IS NOT NULL AND NOT EXISTS (SELECT FROM public.bio_files f WHERE f.tenant_id = p_tenant AND f.page_id = page.id AND f.id = p_file AND f.status = 'ready' AND f.retired_at IS NULL) THEN RETURN missing; END IF;
      previous := page.photo_file_id;
      UPDATE public.bio_pages SET photo_file_id = p_file, version = version + 1, updated_at = clock_timestamp() WHERE tenant_id = p_tenant RETURNING * INTO page;
      IF previous IS NOT NULL THEN UPDATE public.bio_files SET retired_at = clock_timestamp() WHERE tenant_id = p_tenant AND page_id = page.id AND id = previous AND id IS DISTINCT FROM page.published_photo_file_id; END IF;
      INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata) VALUES (p_tenant, actor, 'bio.photo_change', page.id::text, jsonb_build_object('version', page.version));
    END IF;
    RETURN jsonb_build_object('outcome', 'ok', 'data', jsonb_build_object('photoFileId', page.photo_file_id, 'version', page.version));
  END IF;
  IF p_file IS NULL THEN RETURN missing; END IF;
  IF p_action = 'create' THEN
    INSERT INTO public.bio_files (id, tenant_id, page_id, uploader_id, key, name, mime, size, checksum)
      VALUES (p_file, p_tenant, page.id, actor, 'workspaces/' || p_tenant::text || '/bio/' || page.id::text || '/files/' || p_file::text, p_input->>'name', p_input->>'mime', (p_input->>'size')::integer, p_input->>'checksum')
      RETURNING * INTO file;
  ELSE
    SELECT * INTO file FROM public.bio_files WHERE tenant_id = p_tenant AND page_id = page.id AND id = p_file AND uploader_id = actor AND retired_at IS NULL;
    IF NOT FOUND THEN RETURN missing; END IF;
    IF p_action = 'status' THEN
      requested_status := p_input->>'status';
      IF (file.status = 'pending' AND requested_status IN ('uploaded','quarantined')) OR (file.status = 'uploaded' AND requested_status IN ('ready','quarantined')) THEN
        UPDATE public.bio_files SET status = requested_status WHERE id = file.id RETURNING * INTO file;
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('outcome', 'ok', 'data', jsonb_build_object('id', file.id, 'key', file.key, 'name', file.name, 'mime', file.mime, 'size', file.size, 'status', file.status, 'checksum', file.checksum, 'kind', file.kind));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN
  RETURN '{"outcome":"invalid"}';
END $$;
REVOKE ALL ON FUNCTION public.bio_photo_perform(uuid, text, uuid, jsonb) FROM PUBLIC, harvest_app;
CREATE FUNCTION public.bio_photo_operate(p_tenant uuid, p_action text, p_file uuid, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(true); result jsonb;
BEGIN
  result := public.bio_photo_perform(p_tenant, p_action, p_file, p_input);
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.bio_photo_operate(uuid, text, uuid, jsonb) FROM PUBLIC, harvest_app;
GRANT EXECUTE ON FUNCTION public.bio_photo_operate(uuid, text, uuid, jsonb) TO harvest_app;
--> statement-breakpoint
-- Expired messages (90 days) are removed in small batches by an owner or admin's own request; the screen calls this before it lists.
CREATE FUNCTION public.bio_purge_expired_scoped(p_tenant uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); removed integer;
BEGIN
  IF actor IS NULL OR p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.bio_tenant', p_tenant::text, true);
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND public.bio_role_can(role_id) FOR SHARE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  DELETE FROM public.bio_messages m WHERE m.tenant_id = p_tenant AND m.id IN (SELECT id FROM public.bio_messages WHERE tenant_id = p_tenant AND expires_at <= now() ORDER BY expires_at, id LIMIT 100 FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed > 0 THEN INSERT INTO public.audit_logs (tenant_id, actor_id, action, metadata) VALUES (p_tenant, actor, 'bio.messages_purge', jsonb_build_object('count', removed)); END IF;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.bio_purge_expired_scoped(uuid) FROM PUBLIC, harvest_app;
CREATE FUNCTION public.bio_purge_expired(p_tenant uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(true); result integer;
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  result := public.bio_purge_expired_scoped(p_tenant);
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.bio_purge_expired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bio_purge_expired(uuid) TO harvest_app;
--> statement-breakpoint
-- Erasing a person removes what they wrote here (the row would otherwise block the key change); a merge moves their messages to the kept person.
CREATE FUNCTION public.bio_contact_before_erase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := current_setting('app.bio_tenant', true);
BEGIN
  PERFORM set_config('app.bio_tenant', OLD.tenant_id::text, true);
  DELETE FROM public.bio_messages WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id;
  PERFORM set_config('app.bio_tenant', coalesce(previous, ''), true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bio_contact_before_erase() FROM PUBLIC, harvest_app;
CREATE TRIGGER bio_contact_before_erase BEFORE UPDATE ON public.contacts FOR EACH ROW
  WHEN ((OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL) OR (OLD.id IS DISTINCT FROM NEW.id AND NEW.erased_at IS NOT NULL))
  EXECUTE FUNCTION public.bio_contact_before_erase();
--> statement-breakpoint
-- NOTE: patches the text of merge_contacts_scoped (see migration 0082). It adds the message repoint after the CRM form response repoint; port it if that function is redefined.
DO $$
DECLARE def text; patched text;
  hook text := '  UPDATE public.crm_form_responses SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;';
BEGIN
  def := pg_get_functiondef('public.merge_contacts_scoped(uuid, uuid, uuid)'::regprocedure);
  patched := replace(def, hook, hook || '
  PERFORM set_config(''app.bio_merge_prior'', coalesce(current_setting(''app.bio_tenant'', true), ''''), true);
  PERFORM set_config(''app.bio_tenant'', p_tenant::text, true);
  UPDATE public.bio_messages SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  PERFORM set_config(''app.bio_tenant'', current_setting(''app.bio_merge_prior'', true), true);');
  IF patched = def THEN RAISE EXCEPTION 'merge hook not found'; END IF;
  EXECUTE patched;
END $$;
--> statement-breakpoint
-- Handle availability for the editor: a yes or no, never the owner. Signed-in owners and admins only reach it through the app role's own grant.
CREATE FUNCTION public.bio_handle_taken_scoped(p_handle text, p_tenant uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.valid_bio_handle(p_handle) IS NOT TRUE THEN RETURN false; END IF;
  PERFORM set_config('app.bio_handle', p_handle, true);
  RETURN EXISTS (SELECT FROM public.bio_pages WHERE handle = p_handle AND tenant_id IS DISTINCT FROM p_tenant);
END $$;
REVOKE ALL ON FUNCTION public.bio_handle_taken_scoped(text, uuid) FROM PUBLIC, harvest_app;
CREATE FUNCTION public.bio_handle_taken(p_handle text, p_tenant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(true); result boolean;
BEGIN
  IF nullif(current_setting('app.user_id', true), '') IS NULL THEN PERFORM public.bio_scope_restore(prior); RETURN true; END IF;
  result := public.bio_handle_taken_scoped(p_handle, p_tenant);
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.bio_handle_taken(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bio_handle_taken(text, uuid) TO harvest_app;
