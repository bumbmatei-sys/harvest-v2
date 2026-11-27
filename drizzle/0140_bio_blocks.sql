-- Link in bio rework, PR 2 (founder decision 25 Nov 2026): new block types. Video, contact, location, Live now and testimonials live in the page's JSON
-- only. Products and courses, PDFs and ebooks (download products) and hosted forms point at the ministry's own records, so the public read resolves them
-- here, and a block whose record is unpublished, hidden or retired never reaches a visitor. No column changes.

-- Every app.* flag an owner-role policy reached from the bio definers reads. 0124's list plus the free catalog's resolver flags (catalog_resolver_item
-- on catalog_items reads app.catalog_slug and app.catalog_tenant), which bio_public_page_scoped now sets. Same signature, owner and grants.
CREATE OR REPLACE FUNCTION public.bio_scope_clear(p_keep_user boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := '{}'::jsonb; key text;
BEGIN
  FOREACH key IN ARRAY ARRAY['app.bio_handle','app.bio_tenant','app.tenant_id','app.community_definer_tenant','app.crm_forms_slug','app.user_id',
      'app.giving_definer','app.giving_definer_tenant','app.giving_public_tenant','app.give_public_slug','app.give_public_tenant','app.give_public_fundraising',
      'app.catalog_slug','app.catalog_tenant'] LOOP
    prior := prior || pg_catalog.jsonb_build_object(key, coalesce(pg_catalog.current_setting(key, true), ''));
    IF key <> 'app.user_id' OR NOT p_keep_user THEN PERFORM pg_catalog.set_config(key, '', true); END IF;
  END LOOP;
  RETURN prior;
END $$;
--> statement-breakpoint
-- The published page as a visitor may see it. 0094's body plus two lookups:
--   catalog: products and courses of this ministry that are published and not hidden (unlisted and listed both have a public page), for `catalog` and
--            `files` blocks. Only the public fields: kind, slug, title, summary.
--   forms:   hosted forms of this ministry whose address is live, for `form` blocks (the button text is the owner's; nothing of the form is read).
-- Called only by the definer bio_public_page, which clears and restores the app.* scope around it (bio_scope_clear above lists app.catalog_tenant).
CREATE OR REPLACE FUNCTION public.bio_public_page_scoped(p_handle text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE page public.bio_pages; ministry record; communities jsonb := '{}'::jsonb; signups jsonb := '[]'::jsonb; catalog jsonb := '{}'::jsonb; forms jsonb := '[]'::jsonb;
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
  RETURN pg_catalog.jsonb_build_object('handle', page.handle, 'ministryName', ministry.name, 'brandTheme', ministry.brand_theme, 'definition', page.published,
    'hasPhoto', page.published_photo_file_id IS NOT NULL, 'hasCover', page.published_cover_file_id IS NOT NULL, 'communities', communities, 'signups', signups,
    'catalog', catalog, 'forms', forms);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bio_public_page_scoped(text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- Clicks: the new blocks that lead somewhere are counted too (one count per block, never per item or person). A Live now block counts only while it is on.
CREATE OR REPLACE FUNCTION public.bio_record_click_scoped(p_handle text, p_block text, p_visitor text) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE page public.bio_pages; minute_start timestamptz := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp());
BEGIN
  IF public.valid_bio_handle(p_handle) IS NOT TRUE OR p_block !~ '^[a-z0-9]{8}$' OR p_visitor !~ '^[a-f0-9]{64}$' THEN RETURN 'not_found'; END IF;
  PERFORM pg_catalog.set_config('app.bio_handle', p_handle, true);
  SELECT * INTO page FROM public.bio_pages WHERE handle = p_handle AND status = 'published';
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  PERFORM pg_catalog.set_config('app.bio_tenant', page.tenant_id::text, true);
  IF NOT EXISTS (SELECT FROM pg_catalog.jsonb_array_elements(page.published->'blocks') b WHERE b->>'id' = p_block AND public.bio_block_shown(page.published, b)
      AND b->>'type' IN ('link','event','community','catalog','files','form','video','contact','location','live')
      AND (b->>'type' <> 'live' OR (b->>'on') = 'true')) THEN RETURN 'not_found'; END IF;
  DELETE FROM public.bio_quotas WHERE minute < minute_start - interval '2 minutes';
  IF NOT public.bio_charge('click:' || p_visitor || ':' || page.id, 60, minute_start) OR NOT public.bio_charge('click:' || page.id, 600, minute_start) THEN RETURN 'limited'; END IF;
  INSERT INTO public.bio_clicks (tenant_id, page_id, block_id, day, clicks) VALUES (page.tenant_id, page.id, p_block, (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (page_id, block_id, day) DO UPDATE SET clicks = public.bio_clicks.clicks + 1;
  RETURN 'ok';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bio_record_click_scoped(text, text, text) FROM PUBLIC, harvest_app;
