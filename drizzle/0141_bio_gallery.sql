-- Link in bio rework, PR 3 (founder decision 25 Nov 2026): a photo gallery block. Gallery pictures are bio_files of kind 'gallery', uploaded through the same
-- private upload, verification and scan path as the profile photo; a gallery block lists their ids. Visitors reach a picture only through bio_public_gallery,
-- which checks that the page is published and that a shown gallery block of its published copy lists that ready picture.
ALTER TABLE "bio_files" DROP CONSTRAINT "bio_file_kind";--> statement-breakpoint
ALTER TABLE "bio_files" ADD CONSTRAINT "bio_file_kind" CHECK ("bio_files"."kind" in ('photo','cover','gallery'));--> statement-breakpoint
-- The owner's upload and preview path (0094 body as rewritten by 0113 for access_role, plus the gallery kind). Same name, signature, owner and grants.
CREATE OR REPLACE FUNCTION public.bio_photo_perform(p_tenant uuid, p_action text, p_file uuid, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); page public.bio_pages; file public.bio_files; requested_status text; expected integer; previous uuid; kind_name text := CASE p_input->>'kind' WHEN 'cover' THEN 'cover' WHEN 'gallery' THEN 'gallery' ELSE 'photo' END; current_id uuid; published_id uuid;
  missing jsonb := '{"outcome":"not_found"}';
BEGIN
  IF actor IS NULL OR p_tenant IS NULL OR p_action NOT IN ('serve','create','inspect','status','set') THEN RETURN missing; END IF;
  PERFORM set_config('app.bio_tenant', p_tenant::text, true);
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND public.bio_role_can(public.access_role(tenant_id, user_id, 'website', role_id)) FOR SHARE;
  IF NOT FOUND THEN RETURN missing; END IF;
  SELECT * INTO page FROM public.bio_pages WHERE tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN missing; END IF;
  current_id := CASE kind_name WHEN 'cover' THEN page.cover_file_id WHEN 'photo' THEN page.photo_file_id END;
  published_id := CASE kind_name WHEN 'cover' THEN page.published_cover_file_id WHEN 'photo' THEN page.published_photo_file_id END;
  -- 0136 gallery pictures: never "set" on the page (a gallery block lists them); served to the owner by id; at most 60 in use per page.
  IF kind_name = 'gallery' THEN
    IF p_action = 'set' THEN RETURN '{"outcome":"invalid"}'; END IF;
    IF p_action = 'serve' THEN
      SELECT * INTO file FROM public.bio_files WHERE tenant_id = p_tenant AND page_id = page.id AND id = p_file AND kind = 'gallery' AND status = 'ready' AND retired_at IS NULL;
      IF NOT FOUND THEN RETURN missing; END IF;
      RETURN jsonb_build_object('outcome', 'ok', 'data', jsonb_build_object('key', file.key, 'name', file.name, 'mime', file.mime));
    END IF;
    -- The cap counts pictures a gallery block of the draft or the published copy lists, plus uploads of the last hour still waiting for their upload or scan
    -- (the editor adds a picture to its block once it is ready). Pictures removed from every block no longer count.
    IF p_action = 'create' AND (SELECT count(*) FROM public.bio_files f WHERE f.tenant_id = p_tenant AND f.page_id = page.id AND f.kind = 'gallery' AND f.retired_at IS NULL
        AND ((f.status IN ('pending','uploaded') AND f.created_at > pg_catalog.clock_timestamp() - interval '1 hour') OR f.id::text IN (
          SELECT i FROM pg_catalog.jsonb_array_elements(coalesce(page.draft->'blocks', '[]'::jsonb) || coalesce(page.published->'blocks', '[]'::jsonb)) b,
            pg_catalog.jsonb_array_elements_text(b->'fileIds') i WHERE b->>'type' = 'gallery'))) >= 60 THEN
      RETURN '{"outcome":"invalid"}';
    END IF;
  END IF;
  IF p_action = 'serve' THEN
    SELECT * INTO file FROM public.bio_files WHERE tenant_id = p_tenant AND page_id = page.id AND id = current_id AND kind = kind_name AND status = 'ready' AND retired_at IS NULL;
    IF NOT FOUND THEN RETURN missing; END IF;
    RETURN jsonb_build_object('outcome', 'ok', 'data', jsonb_build_object('key', file.key, 'name', file.name, 'mime', file.mime));
  END IF;
  IF p_action = 'set' THEN
    expected := (p_input->>'version')::integer;
    IF expected IS NULL OR expected < 1 THEN RETURN '{"outcome":"invalid"}'; END IF;
    IF page.version <> expected THEN RETURN '{"outcome":"conflict"}'; END IF;
    IF current_id IS DISTINCT FROM p_file THEN
      IF p_file IS NOT NULL AND NOT EXISTS (SELECT FROM public.bio_files f WHERE f.tenant_id = p_tenant AND f.page_id = page.id AND f.id = p_file AND f.kind = kind_name AND f.status = 'ready' AND f.retired_at IS NULL) THEN RETURN missing; END IF;
      previous := current_id;
      IF kind_name = 'cover' THEN UPDATE public.bio_pages SET cover_file_id = p_file, version = version + 1, updated_at = clock_timestamp() WHERE tenant_id = p_tenant RETURNING * INTO page;
      ELSE UPDATE public.bio_pages SET photo_file_id = p_file, version = version + 1, updated_at = clock_timestamp() WHERE tenant_id = p_tenant RETURNING * INTO page; END IF;
      IF previous IS NOT NULL THEN UPDATE public.bio_files SET retired_at = clock_timestamp() WHERE tenant_id = p_tenant AND page_id = page.id AND id = previous AND id IS DISTINCT FROM published_id; END IF;
      INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata) VALUES (p_tenant, actor, 'bio.' || kind_name || '_change', page.id::text, jsonb_build_object('version', page.version));
    END IF;
    RETURN jsonb_build_object('outcome', 'ok', 'data', jsonb_build_object('photoFileId', CASE WHEN kind_name = 'cover' THEN page.cover_file_id ELSE page.photo_file_id END, 'version', page.version));
  END IF;
  IF p_file IS NULL THEN RETURN missing; END IF;
  IF p_action = 'create' THEN
    INSERT INTO public.bio_files (id, tenant_id, page_id, uploader_id, kind, key, name, mime, size, checksum)
      VALUES (p_file, p_tenant, page.id, actor, kind_name, 'workspaces/' || p_tenant::text || '/bio/' || page.id::text || '/files/' || p_file::text, p_input->>'name', p_input->>'mime', (p_input->>'size')::integer, p_input->>'checksum')
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
END $function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bio_photo_perform(uuid, text, uuid, jsonb) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- The published page: 0135's body plus the gallery list.
CREATE OR REPLACE FUNCTION public.bio_public_page_scoped(p_handle text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE page public.bio_pages; ministry record; communities jsonb := '{}'::jsonb; signups jsonb := '[]'::jsonb; catalog jsonb := '{}'::jsonb; forms jsonb := '[]'::jsonb; gallery jsonb := '[]'::jsonb;
  block jsonb; card jsonb; item_id text;
BEGIN
  IF public.valid_bio_handle(p_handle) IS NOT TRUE THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.bio_handle', p_handle, true);
  SELECT * INTO page FROM public.bio_pages WHERE handle = p_handle AND status = 'published';
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.bio_tenant', page.tenant_id::text, true);
  PERFORM pg_catalog.set_config('app.tenant_id', page.tenant_id::text, true);
  PERFORM pg_catalog.set_config('app.community_definer_tenant', page.tenant_id::text, true);
  SELECT w.name, w.brand_theme INTO ministry FROM public.workspaces w WHERE w.tenant_id = page.tenant_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  FOR block IN SELECT b FROM pg_catalog.jsonb_array_elements(page.published->'blocks') b WHERE b->>'type' = 'community' AND (b->>'hidden') = 'false' LOOP
    SELECT pg_catalog.jsonb_build_object('name', c.name, 'tagline', c.tagline, 'slug', c.slug) INTO card FROM public.communities c
      WHERE c.tenant_id = page.tenant_id AND c.id = (block->>'communityId')::uuid AND c.status = 'published' AND c.visibility <> 'hidden';
    IF FOUND THEN communities := communities || pg_catalog.jsonb_build_object(block->>'communityId', card); END IF;
  END LOOP;
  FOR block IN SELECT b FROM pg_catalog.jsonb_array_elements(page.published->'blocks') b WHERE b->>'type' IN ('newsletter','form') AND (b->>'hidden') = 'false' LOOP
    PERFORM pg_catalog.set_config('app.crm_forms_slug', block->>'slug', true);
    IF block->>'type' = 'newsletter' THEN
      IF EXISTS (SELECT FROM public.crm_form_addresses a WHERE a.tenant_id = page.tenant_id AND a.slug = block->>'slug' AND a.version_id IS NOT NULL AND a.retired_at IS NULL) THEN
        signups := signups || pg_catalog.to_jsonb(block->>'slug');
      END IF;
    ELSIF EXISTS (SELECT FROM public.crm_form_addresses a WHERE a.tenant_id = page.tenant_id AND a.slug = block->>'slug' AND a.version_id IS NOT NULL AND a.retired_at IS NULL) THEN
      forms := forms || pg_catalog.to_jsonb(block->>'slug');
    END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('app.crm_forms_slug', '', true);
  PERFORM pg_catalog.set_config('app.catalog_tenant', page.tenant_id::text, true);
  FOR item_id IN SELECT DISTINCT i FROM pg_catalog.jsonb_array_elements(page.published->'blocks') b, pg_catalog.jsonb_array_elements_text(b->'itemIds') i
      WHERE b->>'type' IN ('catalog','files') AND (b->>'hidden') = 'false' AND i ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' LOOP
    SELECT pg_catalog.jsonb_build_object('kind', c.kind, 'slug', c.slug, 'title', c.title, 'summary', pg_catalog.left(c.summary, 300)) INTO card FROM public.catalog_items c
      WHERE c.tenant_id = page.tenant_id AND c.id = item_id::uuid AND c.state = 'published' AND c.visibility <> 'hidden';
    IF FOUND THEN catalog := catalog || pg_catalog.jsonb_build_object(item_id, card); END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('app.catalog_tenant', '', true);
  -- 0136: the ready gallery pictures of this page that a gallery block of the published copy lists (bio_files is scoped by app.bio_tenant, set above).
  SELECT coalesce(pg_catalog.jsonb_agg(f.id::text), '[]'::jsonb) INTO gallery FROM public.bio_files f
    WHERE f.tenant_id = page.tenant_id AND f.page_id = page.id AND f.kind = 'gallery' AND f.status = 'ready'
      AND f.id::text IN (SELECT i FROM pg_catalog.jsonb_array_elements(page.published->'blocks') b, pg_catalog.jsonb_array_elements_text(b->'fileIds') i
        WHERE b->>'type' = 'gallery' AND (b->>'hidden') = 'false');
  RETURN pg_catalog.jsonb_build_object('handle', page.handle, 'ministryName', ministry.name, 'brandTheme', ministry.brand_theme, 'definition', page.published,
    'hasPhoto', page.published_photo_file_id IS NOT NULL, 'hasCover', page.published_cover_file_id IS NOT NULL, 'communities', communities, 'signups', signups,
    'catalog', catalog, 'forms', forms, 'gallery', gallery);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bio_public_page_scoped(text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- One gallery picture for a visitor: the storage key of a ready gallery file that a shown gallery block of the published copy lists, or NULL.
CREATE FUNCTION public.bio_public_gallery_scoped(p_handle text, p_file uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE page public.bio_pages; file public.bio_files;
BEGIN
  IF public.valid_bio_handle(p_handle) IS NOT TRUE OR p_file IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.bio_handle', p_handle, true);
  SELECT * INTO page FROM public.bio_pages WHERE handle = p_handle AND status = 'published';
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.jsonb_array_elements(page.published->'blocks') b WHERE b->>'type' = 'gallery' AND public.bio_block_shown(page.published, b)
      AND (b->'fileIds') ? p_file::text) THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.bio_tenant', page.tenant_id::text, true);
  SELECT * INTO file FROM public.bio_files WHERE tenant_id = page.tenant_id AND page_id = page.id AND id = p_file AND kind = 'gallery' AND status = 'ready';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pg_catalog.jsonb_build_object('key', file.key, 'name', file.name, 'mime', file.mime);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bio_public_gallery_scoped(text, uuid) FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.bio_public_gallery(p_handle text, p_file uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(false); result jsonb;
BEGIN
  result := public.bio_public_gallery_scoped(p_handle, p_file);
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bio_public_gallery(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.bio_public_gallery(text, uuid) TO harvest_app;
