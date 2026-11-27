CREATE TABLE "catalog_asset_grants" (
	"token" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_lesson_attachments" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "catalog_lesson_attachments_tenant_id_item_id_lesson_id_file_id_pk" PRIMARY KEY("tenant_id","item_id","lesson_id","file_id"),
	CONSTRAINT "catalog_lesson_attachments_tenant_id_item_id_lesson_id_position_unique" UNIQUE("tenant_id","item_id","lesson_id","position"),
	CONSTRAINT "catalog_lesson_attachment_position" CHECK ("catalog_lesson_attachments"."position" between 0 and 19)
);
--> statement-breakpoint
ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_item_visibility";--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "cover_file_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "price_label" text DEFAULT 'Free' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_lesson_attachments" ADD CONSTRAINT "catalog_lesson_attachments_tenant_id_item_id_lesson_id_catalog_lessons_tenant_id_item_id_id_fk" FOREIGN KEY ("tenant_id","item_id","lesson_id") REFERENCES "public"."catalog_lessons"("tenant_id","item_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_lesson_attachments" ADD CONSTRAINT "catalog_lesson_attachments_tenant_id_file_id_files_tenant_id_id_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_cover_file_id_files_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cover_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_item_free_price" CHECK ("catalog_items"."price_label" = 'Free');--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_item_visibility" CHECK ("catalog_items"."visibility" in ('hidden','unlisted','listed','community','public'));
--> statement-breakpoint
ALTER TABLE public.catalog_asset_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_asset_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_lesson_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_lesson_attachments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_asset_grants, public.catalog_lesson_attachments FROM PUBLIC, harvest_app;
GRANT SELECT, INSERT, DELETE ON public.catalog_lesson_attachments TO harvest_app;
CREATE POLICY catalog_attachment_staff ON public.catalog_lesson_attachments TO harvest_app
  USING (public.catalog_staff(tenant_id)) WITH CHECK (public.catalog_staff(tenant_id));
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY catalog_asset_grant_scope ON public.catalog_asset_grants TO %I
    USING (token::text = current_setting('app.access_token', true) AND issued_at = pg_catalog.now()
      AND tenant_id = nullif(current_setting('app.catalog_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY catalog_attachment_read ON public.catalog_lesson_attachments FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.catalog_tenant', true), '')::uuid AND EXISTS (
      SELECT FROM public.catalog_asset_grants g WHERE g.token::text = current_setting('app.access_token', true)
        AND g.tenant_id = catalog_lesson_attachments.tenant_id AND g.issued_at = pg_catalog.now()))$p$, current_user);
END $$;
--> statement-breakpoint
-- A private attachment or cover must already have passed the shared storage confirmation flow.
CREATE FUNCTION public.catalog_guard_asset() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE file_id uuid; needs_image boolean := TG_TABLE_NAME = 'catalog_items';
BEGIN
  IF needs_image THEN
    IF TG_OP = 'UPDATE' AND OLD.cover_file_id IS NOT DISTINCT FROM NEW.cover_file_id THEN RETURN NEW; END IF;
    file_id := NEW.cover_file_id;
  ELSE
    file_id := NEW.file_id;
  END IF;
  IF file_id IS NOT NULL AND NOT EXISTS (SELECT FROM public.files f
    WHERE f.tenant_id = NEW.tenant_id AND f.id = file_id AND f.status = 'ready' AND f.visibility = 'private' AND NOT f.social_upload
      AND (NOT needs_image OR f.mime IN ('image/jpeg','image/png','image/webp')) FOR SHARE) THEN
    RAISE EXCEPTION 'catalogue file unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.catalog_guard_asset() FROM PUBLIC;
CREATE TRIGGER catalog_guard_cover BEFORE INSERT OR UPDATE OF cover_file_id ON public.catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.catalog_guard_asset();
CREATE TRIGGER catalog_guard_attachment BEFORE INSERT ON public.catalog_lesson_attachments
  FOR EACH ROW EXECUTE FUNCTION public.catalog_guard_asset();
--> statement-breakpoint
ALTER POLICY catalog_metadata ON public.catalog_items
  USING (state <> 'draft' AND visibility <> 'community' AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id = catalog_items.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')));
--> statement-breakpoint
-- Keep the existing staff controls for metadata. Course and product opt-in is the ministry owner's decision.
CREATE FUNCTION public.catalog_listing_opt_in_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user <> 'harvest_app' OR NEW.resource_type NOT IN ('course','product') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.owner_opt_in IS NOT DISTINCT FROM OLD.owner_opt_in THEN RETURN NEW; END IF;
  ELSIF NOT NEW.owner_opt_in THEN RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = NEW.tenant_id
    AND m.user_id = nullif(current_setting('app.user_id',true),'')
    AND public.access_role(m.tenant_id,m.user_id,'owner_admin',m.role_id) = 'owner') THEN
    RAISE EXCEPTION 'only the ministry owner can change catalogue opt-in' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.catalog_listing_opt_in_guard() FROM PUBLIC;
CREATE TRIGGER catalog_listing_opt_in_guard BEFORE INSERT OR UPDATE OF owner_opt_in ON public.discover_controls
  FOR EACH ROW EXECUTE FUNCTION public.catalog_listing_opt_in_guard();
--> statement-breakpoint
-- Test the canonical item in addition to the reviewed projection (status can be changed directly through staff RLS).
CREATE FUNCTION public.catalog_discover_current(p_tenant uuid, p_item uuid, p_kind text, p_slug text) RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE old_tenant text := coalesce(current_setting('app.catalog_tenant', true), ''); result boolean;
BEGIN
  PERFORM set_config('app.catalog_tenant', p_tenant::text, true);
  SELECT EXISTS (SELECT FROM public.catalog_items i WHERE i.tenant_id = p_tenant AND i.id = p_item AND i.slug = p_slug
    AND i.kind = CASE p_kind WHEN 'course' THEN 'course' WHEN 'product' THEN 'download' END
    AND i.state = 'published' AND i.visibility IN ('listed','public')) INTO result;
  PERFORM set_config('app.catalog_tenant', old_tenant, true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.catalog_discover_current(uuid, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE live text; changed text; old text; replacement text;
BEGIN
  live := pg_get_functiondef('public.catalog_access(text,text,uuid)'::regprocedure);
  old := $old$BEGIN
  PERFORM set_config('app.catalog_tenant','',true);$old$;
  replacement := $new$BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.user_id',coalesce(actor,''),true);
  PERFORM set_config('app.catalog_tenant','',true);$new$;
  changed := replace(live, old, replacement);
  IF length(changed) <> length(live) - length(old) + length(replacement) THEN RAISE EXCEPTION 'unexpected catalogue resolver entry'; END IF;
  live := changed;
  old := $old$i.visibility IN ('listed','unlisted','hidden')$old$;
  replacement := $new$i.visibility IN ('listed','unlisted','hidden','public','community')$new$;
  changed := replace(live, old, replacement);
  IF length(changed) <> length(live) - length(old) + length(replacement) THEN RAISE EXCEPTION 'unexpected catalogue visibility filter'; END IF;
  live := changed;
  old := $old$IF item.visibility='hidden' THEN$old$;
  replacement := $new$IF item.visibility IN ('hidden','community') THEN$new$;
  changed := replace(live, old, replacement);
  IF length(changed) <> length(live) - length(old) + length(replacement) THEN RAISE EXCEPTION 'unexpected shelf rule'; END IF;
  live := changed;
  old := $old$IF p_action='metadata' THEN result := metadata; EXIT resolve; END IF;$old$;
  replacement := $new$IF p_action='metadata' THEN
      result := metadata || jsonb_build_object('priceLabel',item.price_label,'hasCover',item.cover_file_id IS NOT NULL);
      EXIT resolve;
    END IF;$new$;
  changed := replace(live, old, replacement);
  IF length(changed) <> length(live) - length(old) + length(replacement) THEN RAISE EXCEPTION 'unexpected catalogue metadata'; END IF;
  EXECUTE changed;

  live := pg_get_functiondef('public.discover_search(text,text,text,text,text,boolean,text,integer,integer)'::regprocedure);
  old := $old$      AND (q = '' OR d.search_text LIKE$old$;
  replacement := $new$      AND (d.resource_type = 'community' OR (c.owner_opt_in AND public.catalog_discover_current(d.tenant_id, d.resource_id, d.resource_type, d.slug)))
      AND (q = '' OR d.search_text LIKE$new$;
  changed := replace(live, old, replacement);
  IF length(changed) <> length(live) - length(old) + length(replacement) THEN RAISE EXCEPTION 'unexpected Discover visibility filter'; END IF;
  live := changed;
  old := $old$  PERFORM set_config('app.discover_read', 'on', true);$old$;
  replacement := $new$  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.discover_read', 'on', true);$new$;
  changed := replace(live, old, replacement);
  IF length(changed) <> length(live) - length(old) + length(replacement) THEN RAISE EXCEPTION 'unexpected Discover reset'; END IF;
  EXECUTE changed;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.catalog_directory(p_tenant uuid, p_author text, p_after uuid, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb; lim integer := least(greatest(coalesce(p_limit, 24), 1), 48);
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.catalog_tenant',coalesce(p_tenant::text,''),true);
  PERFORM set_config('app.discover_read','on',true);
  WITH candidates AS (
    SELECT i.id, i.kind, i.slug, i.title, i.summary, i.price_label, i.cover_file_id, u.id AS author_id, nullif(u.name,'') AS author_name
    FROM public.catalog_items i
    JOIN public.discover_listings d ON d.tenant_id = i.tenant_id AND d.resource_id = i.id AND d.slug = i.slug
      AND d.resource_type = CASE i.kind WHEN 'course' THEN 'course' ELSE 'product' END
    JOIN public.discover_controls c ON (c.tenant_id,c.resource_type,c.resource_id) = (d.tenant_id,d.resource_type,d.resource_id)
    LEFT JOIN public.discover_ministry_standing s ON s.tenant_id = i.tenant_id
    LEFT JOIN public.users u ON u.id = i.created_by AND u.name <> ''
    WHERE i.tenant_id = p_tenant AND i.state = 'published' AND i.visibility IN ('public','listed')
      AND c.owner_opt_in AND c.review_state = 'approved' AND c.reviewed_hash = d.content_hash
      AND c.current_hash = d.content_hash AND NOT coalesce(s.suspended,false)
      AND (p_author IS NULL OR u.id = p_author) AND (p_after IS NULL OR i.id > p_after)
    ORDER BY i.id LIMIT lim + 1
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT lim)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',id,'kind',kind,'slug',slug,'title',title,'summary',summary,'priceLabel',price_label,
    'cover',cover_file_id IS NOT NULL,'author',CASE WHEN author_id IS NULL THEN NULL
      ELSE jsonb_build_object('id',author_id,'name',author_name) END) ORDER BY id) FROM page),'[]'::jsonb),
    'next',CASE WHEN (SELECT count(*) FROM candidates) > lim THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) ELSE NULL END)
  INTO result;
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.catalog_directory(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_directory(uuid,text,uuid,integer) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.catalog_assets(p_slug text, p_action text, p_file uuid, p_lesson uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id',true),'');
  item public.catalog_items%ROWTYPE; key uuid := pg_catalog.gen_random_uuid(); result jsonb;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.user_id',coalesce(actor,''),true);
  IF p_action IS NULL OR p_action NOT IN ('cover','resources','attachment') THEN RETURN NULL; END IF;
  IF p_action <> 'cover' AND actor IS NULL THEN RETURN NULL; END IF;
  IF public.catalog_access(p_slug,'metadata') IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.catalog_slug',coalesce(p_slug,''),true);
  SELECT * INTO item FROM public.catalog_items WHERE slug = p_slug AND state = 'published' FOR SHARE;
  IF NOT FOUND THEN
    PERFORM set_config('app.catalog_slug','',true);
    RETURN NULL;
  END IF;
  PERFORM set_config('app.catalog_tenant',item.tenant_id::text,true);
  IF p_action = 'cover' THEN
    SELECT jsonb_build_object('key',f.key,'name',f.name,'mime',f.mime,'size',f.size) INTO result
    FROM public.files f WHERE f.tenant_id = item.tenant_id AND f.id = item.cover_file_id
      AND f.visibility = 'private' AND f.status = 'ready' AND NOT f.social_upload AND f.mime IN ('image/jpeg','image/png','image/webp');
  ELSIF item.kind = 'course' AND EXISTS (SELECT FROM public.entitlements e
      WHERE e.tenant_id=item.tenant_id AND e.catalog_item_id=item.id AND e.user_id=actor AND e.revoked_at IS NULL
        AND e.valid_from<=now() AND (e.valid_until IS NULL OR e.valid_until>now())) THEN
    PERFORM set_config('app.access_token',key::text,true);
    INSERT INTO public.catalog_asset_grants (token,tenant_id) VALUES (key,item.tenant_id);
    WITH ready AS (
      SELECT a.lesson_id,l.title,f.id,f.key,f.name,f.size,f.mime,l.position AS lesson_position,a.position
      FROM public.catalog_lesson_attachments a JOIN public.catalog_lessons l
        ON (l.tenant_id,l.item_id,l.id) = (a.tenant_id,a.item_id,a.lesson_id)
      JOIN public.files f ON (f.tenant_id,f.id) = (a.tenant_id,a.file_id)
      WHERE a.tenant_id = item.tenant_id AND a.item_id = item.id AND l.published AND f.visibility = 'private'
        AND f.status = 'ready' AND NOT f.social_upload
    )
    SELECT CASE p_action WHEN 'resources' THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('lessonId',r.lesson_id,'lessonTitle',r.title,'fileId',r.id,'name',r.name,'size',r.size,'mime',r.mime)
        ORDER BY r.lesson_position,r.position) FROM ready r), '[]'::jsonb)
      ELSE (SELECT jsonb_build_object('key',r.key,'name',r.name,'mime',r.mime,'size',r.size)
        FROM ready r WHERE r.lesson_id=p_lesson AND r.id=p_file) END INTO result;
    DELETE FROM public.catalog_asset_grants g WHERE g.token=key;
  END IF;
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.user_id',coalesce(actor,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.catalog_assets(text,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_assets(text,text,uuid,uuid) TO harvest_app;
