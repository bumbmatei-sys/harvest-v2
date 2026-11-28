-- Preserve the ministry key when a referenced image is deleted. Repair stale
-- pointers first because earlier landings had no foreign key.
DO $$
BEGIN
  ALTER TABLE public.catalog_landings NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.files NO FORCE ROW LEVEL SECURITY;
  UPDATE public.catalog_landings l SET about_photo_id = NULL
    WHERE l.about_photo_id IS NOT NULL AND NOT EXISTS (
      SELECT FROM public.files f WHERE f.tenant_id = l.tenant_id AND f.id = l.about_photo_id
    );
  ALTER TABLE public.files FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.catalog_landings FORCE ROW LEVEL SECURITY;
END $$;--> statement-breakpoint
ALTER TABLE public.catalog_landings ADD CONSTRAINT catalog_landing_about_photo_fk
  FOREIGN KEY (tenant_id, about_photo_id) REFERENCES public.files (tenant_id, id)
  ON DELETE SET NULL (about_photo_id);--> statement-breakpoint

-- Shared pricing projection. Callers supply the clock and hold their existing
-- visibility checks; this function has no table access.
CREATE FUNCTION public.catalog_display_price(
  price integer, currency text, sale integer, starts_at timestamptz, ends_at timestamptz, at_time timestamptz
) RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN price IS NOT NULL THEN jsonb_build_object(
    'currency', currency, 'cents', CASE WHEN active THEN sale ELSE price END,
    'oldCents', CASE WHEN active THEN price END, 'saleEndsAt', CASE WHEN active THEN ends_at END
  ) END
  FROM (SELECT sale IS NOT NULL AND at_time >= starts_at AND at_time < ends_at AS active) s
$$;
REVOKE ALL ON FUNCTION public.catalog_display_price(integer,text,integer,timestamptz,timestamptz,timestamptz) FROM PUBLIC;--> statement-breakpoint
DO $$
DECLARE fn regprocedure; def text; patched text;
  anchor constant text := $old$AND f.status = 'ready' AND f.mime IN ('image/jpeg','image/png','image/webp')$old$;
  replacement constant text := $new$AND f.status = 'ready' AND f.visibility = 'private' AND NOT f.social_upload AND f.mime IN ('image/jpeg','image/png','image/webp')$new$;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.catalog_landing(text)'::regprocedure, 'public.catalog_landing_photo(text)'::regprocedure] LOOP
    def := pg_catalog.pg_get_functiondef(fn);
    patched := pg_catalog.replace(def, anchor, replacement);
    IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
      RAISE EXCEPTION 'Expected one photo predicate in %', fn;
    END IF;
    EXECUTE patched;
  END LOOP;
END $$;--> statement-breakpoint
DO $$
DECLARE def text; patched text; anchor text; replacement text;
BEGIN
  def := pg_catalog.pg_get_functiondef('public.catalog_landing(text)'::regprocedure);
  anchor := $old$CASE WHEN g.price_cents IS NULL THEN NULL ELSE jsonb_build_object('currency', g.currency,
      'cents', CASE WHEN on_sale THEN g.sale_cents ELSE g.price_cents END, 'oldCents', CASE WHEN on_sale THEN g.price_cents END,
      'saleEndsAt', CASE WHEN on_sale THEN g.sale_ends_at END) END$old$;
  replacement := 'public.catalog_display_price(g.price_cents,g.currency,g.sale_cents,g.sale_starts_at,g.sale_ends_at,statement_timestamp())';
  patched := pg_catalog.replace(def, anchor, replacement);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'Expected one catalogue landing price projection';
  END IF;
  def := patched;
  anchor := '  on_sale boolean; people integer;';
  replacement := '  people integer;';
  patched := pg_catalog.replace(def, anchor, replacement);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'Expected one catalogue landing sale variable';
  END IF;
  def := patched;
  anchor := $old$  on_sale := g.sale_cents IS NOT NULL AND clock_timestamp() >= g.sale_starts_at AND clock_timestamp() < g.sale_ends_at;$old$;
  replacement := '  -- Price is projected by catalog_display_price.';
  patched := pg_catalog.replace(def, anchor, replacement);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'Expected one catalogue landing sale predicate';
  END IF;
  EXECUTE patched;

  def := pg_catalog.pg_get_functiondef('public.catalog_access(text,text,uuid)'::regprocedure);
  anchor := $old$result := metadata || jsonb_build_object('priceLabel',item.price_label,'hasCover',item.cover_file_id IS NOT NULL);$old$;
  replacement := $new$PERFORM set_config('app.catalog_tenant',item.tenant_id::text,true);
      result := metadata || jsonb_build_object('priceLabel',item.price_label,'hasCover',item.cover_file_id IS NOT NULL,
        'price', (SELECT public.catalog_display_price(g.price_cents,g.currency,g.sale_cents,g.sale_starts_at,g.sale_ends_at,statement_timestamp())
          FROM public.catalog_landings g WHERE g.tenant_id=item.tenant_id AND g.item_id=item.id));$new$;
  patched := pg_catalog.replace(def, anchor, replacement);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'Expected one catalogue metadata projection';
  END IF;
  EXECUTE patched;

  def := pg_catalog.pg_get_functiondef('public.catalog_directory(uuid,text,uuid,integer)'::regprocedure);
  anchor := $old$i.price_label, i.cover_file_id$old$;
  replacement := $new$i.price_label,
      public.catalog_display_price(g.price_cents,g.currency,g.sale_cents,g.sale_starts_at,g.sale_ends_at,statement_timestamp()) AS price,
      i.cover_file_id$new$;
  patched := pg_catalog.replace(def, anchor, replacement);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'Expected one catalogue candidate projection';
  END IF;
  def := patched;
  anchor := 'FROM public.catalog_items i';
  replacement := $new$FROM public.catalog_items i
    LEFT JOIN public.catalog_landings g ON g.tenant_id = i.tenant_id AND g.item_id = i.id$new$;
  patched := pg_catalog.replace(def, anchor, replacement);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'Expected one catalogue candidate source';
  END IF;
  def := patched;
  anchor := $old$'priceLabel',price_label$old$;
  replacement := $new$'priceLabel',price_label,'price',price$new$;
  patched := pg_catalog.replace(def, anchor, replacement);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'Expected one catalogue directory price projection';
  END IF;
  EXECUTE patched;
END $$;
--> statement-breakpoint
-- Staff card readers may see prices for items they already see in the ministry
-- list. Keep the remaining landing columns on the existing staff-only policy.
CREATE FUNCTION public.catalog_staff_card_prices(p_tenant uuid, p_items uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id',true),'');
  tenant text := current_setting('app.tenant_id',true); prior jsonb; role text; result jsonb;
BEGIN
  prior := public.blog_scope_clear();
  PERFORM public.account_self_reset();
  IF actor IS NOT NULL AND p_tenant::text = tenant AND cardinality(p_items) BETWEEN 1 AND 500 THEN
    PERFORM set_config('app.tenant_id',tenant,true);
    PERFORM set_config('app.user_id',actor,true);
    SELECT public.access_role(m.tenant_id,m.user_id,'catalog',m.role_id) INTO role
      FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=actor;
    IF role IN ('owner','admin','member','viewer') THEN
      PERFORM set_config('app.catalog_tenant',tenant,true);
      PERFORM set_config('app.community_definer_tenant',tenant,true);
      SELECT jsonb_object_agg(g.item_id,public.catalog_display_price(
        g.price_cents,g.currency,g.sale_cents,g.sale_starts_at,g.sale_ends_at,statement_timestamp())) INTO result
      FROM public.catalog_landings g JOIN public.catalog_items i ON (i.tenant_id,i.id)=(g.tenant_id,g.item_id)
      WHERE g.tenant_id=p_tenant AND g.item_id=ANY(p_items) AND g.price_cents IS NOT NULL
        AND (role IN ('owner','admin') OR (i.state <> 'draft' AND i.visibility <> 'community')
          OR (i.state='published' AND EXISTS (
            SELECT FROM public.community_product_links l JOIN public.communities c
              ON c.tenant_id=l.tenant_id AND c.id=l.community_id AND c.status='published'
            WHERE l.tenant_id=i.tenant_id AND l.item_id=i.id AND public.community_can_read(l.tenant_id,l.community_id)
          )));
    END IF;
  END IF;
  PERFORM public.blog_scope_clear();
  PERFORM public.blog_scope_restore(prior);
  RETURN coalesce(result,'{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.catalog_staff_card_prices(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_staff_card_prices(uuid,uuid[]) TO harvest_app;
