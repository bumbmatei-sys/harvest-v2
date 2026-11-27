-- Link in bio rework, PR 1 (founder decision 25 Nov 2026): up to six renameable tabs or a single page with no tabs, a cover the owner can switch off,
-- a required profile photo placed left or centre, and one icon style per page. The page definition is JSON checked by the application schema, so no
-- column changes. Two database functions follow the new definition. Neither is a SECURITY DEFINER and neither tests a role, so the owner, grants,
-- search_path and the definer wrappers (bio_public_photo, bio_record_click, bio_transition, bio_public_giving, bio_report_giving) are unchanged.

-- A block is shown to visitors when it is not hidden and, in the tabs layout, its tab exists and is not hidden. In the single-page layout tabs are
-- ignored. A page saved before the layout existed has no `layout` key and keeps the tabs rule. Same signature, owner and grants as 0094.
CREATE OR REPLACE FUNCTION public.bio_block_shown(p_published jsonb, p_block jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT (p_block->>'hidden') = 'false' AND (coalesce(p_published->>'layout', 'tabs') = 'single' OR EXISTS (
    SELECT FROM jsonb_array_elements(coalesce(p_published->'tabs', '[]'::jsonb)) t
    WHERE t->>'id' = coalesce(p_block->>'tab', 'home') AND (t->>'hidden') = 'false'))
$$;
--> statement-breakpoint
-- The published photo or cover. A cover the owner switched off is not served even while its file stays attached (it comes back when switched on
-- and published again). Called only by the definer bio_public_photo, which clears and restores the app.* scope around it.
CREATE OR REPLACE FUNCTION public.bio_public_photo_scoped(p_handle text, p_kind text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE page public.bio_pages; file public.bio_files;
BEGIN
  IF public.valid_bio_handle(p_handle) IS NOT TRUE THEN RETURN NULL; END IF;
  PERFORM set_config('app.bio_handle', p_handle, true);
  SELECT * INTO page FROM public.bio_pages WHERE handle = p_handle AND status = 'published' AND CASE WHEN p_kind = 'cover' THEN published_cover_file_id ELSE published_photo_file_id END IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_kind = 'cover' AND (page.published->>'cover') = 'false' THEN RETURN NULL; END IF;
  PERFORM set_config('app.bio_tenant', page.tenant_id::text, true);
  SELECT * INTO file FROM public.bio_files WHERE tenant_id = page.tenant_id AND page_id = page.id AND id = CASE WHEN p_kind = 'cover' THEN page.published_cover_file_id ELSE page.published_photo_file_id END AND kind = CASE WHEN p_kind = 'cover' THEN 'cover' ELSE 'photo' END AND status = 'ready';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('key', file.key, 'name', file.name, 'mime', file.mime);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bio_public_photo_scoped(text, text) FROM PUBLIC, harvest_app;
