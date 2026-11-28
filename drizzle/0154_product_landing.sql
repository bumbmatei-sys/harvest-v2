CREATE TABLE "catalog_landings" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"body" jsonb,
	"included" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"about_heading" text DEFAULT '' NOT NULL,
	"about_body" text DEFAULT '' NOT NULL,
	"about_photo_id" uuid,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta_quote" text DEFAULT '' NOT NULL,
	"cta_label" text DEFAULT '' NOT NULL,
	"price_cents" integer,
	"currency" text,
	"sale_cents" integer,
	"sale_starts_at" timestamp with time zone,
	"sale_ends_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_landings_tenant_id_item_id_pk" PRIMARY KEY("tenant_id","item_id"),
	CONSTRAINT "catalog_landing_text" CHECK (length("catalog_landings"."subtitle") <= 160 and length("catalog_landings"."about_heading") <= 120 and length("catalog_landings"."about_body") <= 1500
    and length("catalog_landings"."cta_quote") <= 280 and length("catalog_landings"."cta_label") <= 40 and cardinality("catalog_landings"."included") <= 12),
	CONSTRAINT "catalog_landing_lists" CHECK (jsonb_typeof("catalog_landings"."faq") = 'array' and jsonb_array_length("catalog_landings"."faq") <= 12
    and ("catalog_landings"."body" is null or (jsonb_typeof("catalog_landings"."body") = 'object' and octet_length("catalog_landings"."body"::text) <= 65536))),
	CONSTRAINT "catalog_landing_price" CHECK (("catalog_landings"."price_cents" is null and "catalog_landings"."currency" is null and "catalog_landings"."sale_cents" is null)
    or ("catalog_landings"."price_cents" between 100 and 10000000 and "catalog_landings"."currency" in ('USD','EUR','GBP'))),
	CONSTRAINT "catalog_landing_sale" CHECK (("catalog_landings"."sale_cents" is null and "catalog_landings"."sale_starts_at" is null and "catalog_landings"."sale_ends_at" is null)
    or ("catalog_landings"."sale_cents" > 0 and "catalog_landings"."sale_cents" < "catalog_landings"."price_cents" and "catalog_landings"."sale_starts_at" is not null and "catalog_landings"."sale_ends_at" > "catalog_landings"."sale_starts_at")),
	CONSTRAINT "catalog_landing_version" CHECK ("catalog_landings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_reviews" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_reviews_tenant_id_item_id_user_id_pk" PRIMARY KEY("tenant_id","item_id","user_id"),
	CONSTRAINT "catalog_review_rating" CHECK ("catalog_reviews"."rating" between 1 and 5),
	CONSTRAINT "catalog_review_body" CHECK (length("catalog_reviews"."body") <= 1000 and translate("catalog_reviews"."body", E'\n\r\t', '') !~ '[[:cntrl:]]')
);
--> statement-breakpoint
ALTER TABLE "catalog_landings" ADD CONSTRAINT "catalog_landings_tenant_id_item_id_catalog_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_reviews" ADD CONSTRAINT "catalog_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_reviews" ADD CONSTRAINT "catalog_reviews_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_reviews" ADD CONSTRAINT "catalog_reviews_tenant_id_item_id_catalog_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_reviews_item_idx" ON "catalog_reviews" USING btree ("tenant_id","item_id","updated_at");--> statement-breakpoint
-- Product and course landing page (working number 0190; renumber at merge). Landing content, a shown-only price with an optional sale, reviews by
-- people who have the item, and public stats with small-group masking. No checkout: a priced item cannot be enrolled through the free flow.
-- 1. Row security. Owners and admins (catalog_staff) edit the landing and read and hide reviews; a person reads their own review. Everything public
--    goes through the definers below, which use only the existing catalogue flags (app.catalog_slug, app.catalog_tenant) and community_definer_tenant.
ALTER TABLE public.catalog_landings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.catalog_landings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.catalog_landings FROM PUBLIC, harvest_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.catalog_landings TO harvest_app;--> statement-breakpoint
CREATE POLICY catalog_landings_staff ON public.catalog_landings TO harvest_app
  USING (public.catalog_staff(tenant_id)) WITH CHECK (public.catalog_staff(tenant_id));--> statement-breakpoint
ALTER TABLE public.catalog_reviews ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.catalog_reviews FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.catalog_reviews FROM PUBLIC, harvest_app;--> statement-breakpoint
GRANT SELECT ON public.catalog_reviews TO harvest_app;--> statement-breakpoint
GRANT UPDATE (hidden_at, hidden_by) ON public.catalog_reviews TO harvest_app;--> statement-breakpoint
CREATE POLICY catalog_reviews_staff_read ON public.catalog_reviews FOR SELECT TO harvest_app USING (public.catalog_staff(tenant_id));--> statement-breakpoint
CREATE POLICY catalog_reviews_own_read ON public.catalog_reviews FOR SELECT TO harvest_app
  USING (user_id = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY catalog_reviews_staff_hide ON public.catalog_reviews FOR UPDATE TO harvest_app
  USING (public.catalog_staff(tenant_id)) WITH CHECK (public.catalog_staff(tenant_id));--> statement-breakpoint
DO $$ DECLARE pair text[]; live text := $l$(pg_catalog.current_setting('app.account_erase', true) <> '' AND EXISTS (SELECT 1 FROM public.account_erase_grants g
      WHERE g.token::text = pg_catalog.current_setting('app.account_erase', true) AND g.user_id = nullif(pg_catalog.current_setting('app.user_id', true), '')
        AND g.created_at = pg_catalog.now()))$l$; BEGIN
  EXECUTE format($p$CREATE POLICY catalog_landing_definer ON public.catalog_landings FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.catalog_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY catalog_review_definer ON public.catalog_reviews TO %I
    USING (tenant_id = nullif(current_setting('app.catalog_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.catalog_tenant', true), '')::uuid)$p$, current_user);
  -- Account deletion (0136 pattern): active only while the caller's erase token is live, for the caller's rows.
  FOREACH pair SLICE 1 IN ARRAY ARRAY[ARRAY['catalog_reviews','user_id'], ARRAY['catalog_reviews','hidden_by']] LOOP
    EXECUTE format($p$CREATE POLICY %I ON public.%I TO %I
      USING ((%I IS NULL OR %I = nullif(current_setting('app.user_id', true), '')) AND %s)
      WITH CHECK ((%I IS NULL OR %I = nullif(current_setting('app.user_id', true), '')) AND %s)$p$,
      'account_erase_' || pair[2], pair[1], current_user, pair[2], pair[2], live, pair[2], pair[2], live);
  END LOOP;
END $$;--> statement-breakpoint
-- 2. account_delete() removes the person's reviews and detaches them as the hider. Patched in place (as 0138 patches blog_scope_clear), so entries
--    other migrations add are kept: exact replace of one anchor, raise unless the length grows by exactly the added text.
DO $$
DECLARE def text; patched text;
  anchor constant text := E'  DELETE FROM public.catalog_notes WHERE user_id = actor;\n';
  added constant text := E'  DELETE FROM public.catalog_notes WHERE user_id = actor;\n  DELETE FROM public.catalog_reviews WHERE user_id = actor;\n  UPDATE public.catalog_reviews SET hidden_by = NULL WHERE hidden_by = actor;\n';
BEGIN
  def := pg_catalog.pg_get_functiondef('public.account_delete(text)'::regprocedure);
  patched := pg_catalog.replace(def, anchor, added);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(added) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'account_delete: expected exactly one catalog_notes delete to extend';
  END IF;
  EXECUTE patched;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_delete(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.account_delete(text) TO harvest_app;--> statement-breakpoint
-- 3. A priced item has no free enrolment (checkout stays off): catalog_access('enrol') answers nothing for it. Patched in place, same rule.
DO $$
DECLARE def text; patched text;
  anchor constant text := 'INSERT INTO public.catalog_enrolments(tenant_id,item_id,user_id)';
  added constant text := E'IF EXISTS (SELECT FROM public.catalog_landings g WHERE g.tenant_id=item.tenant_id AND g.item_id=item.id AND g.price_cents IS NOT NULL) THEN EXIT resolve; END IF;\n      INSERT INTO public.catalog_enrolments(tenant_id,item_id,user_id)';
BEGIN
  def := pg_catalog.pg_get_functiondef('public.catalog_access(text,text,uuid)'::regprocedure);
  patched := pg_catalog.replace(def, anchor, added);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(added) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'catalog_access: expected exactly one enrolment insert to guard';
  END IF;
  EXECUTE patched;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_access(text,text,uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_access(text,text,uuid) TO harvest_app;--> statement-breakpoint
-- 4. The public landing of a published, visible item (the same rule as catalog_access 'metadata', which it calls first): landing fields, the current
--    price (the sale only between its start and end), visible reviews with the reviewer's first name, the average and count, and stats with the
--    small-group rule (people who have it under 5 is null). For a signed-in caller: whether they may review and their own review. No tenant id,
--    item id, user id or file id is returned. Every flag it sets is blanked before it returns.
CREATE FUNCTION public.catalog_landing(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); item public.catalog_items%ROWTYPE; g public.catalog_landings%ROWTYPE;
  on_sale boolean; people integer; eligible boolean := false; mine jsonb; host text; photo boolean := false; result jsonb;
BEGIN
  IF public.catalog_access(p_slug, 'metadata') IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.catalog_slug', p_slug, true);
  SELECT * INTO item FROM public.catalog_items i WHERE i.slug = p_slug AND i.state = 'published';
  PERFORM set_config('app.catalog_slug', '', true);
  IF item.id IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.catalog_tenant', item.tenant_id::text, true);
  SELECT * INTO g FROM public.catalog_landings l WHERE l.tenant_id = item.tenant_id AND l.item_id = item.id;
  on_sale := g.sale_cents IS NOT NULL AND clock_timestamp() >= g.sale_starts_at AND clock_timestamp() < g.sale_ends_at;
  photo := g.about_photo_id IS NOT NULL AND EXISTS (SELECT FROM public.files f WHERE f.tenant_id = item.tenant_id AND f.id = g.about_photo_id
    AND f.status = 'ready' AND f.mime IN ('image/jpeg','image/png','image/webp'));
  SELECT count(*)::integer INTO people FROM public.entitlements e WHERE e.tenant_id = item.tenant_id AND e.catalog_item_id = item.id
    AND e.revoked_at IS NULL AND e.valid_from <= now() AND (e.valid_until IS NULL OR e.valid_until > now());
  IF actor IS NOT NULL THEN
    eligible := EXISTS (SELECT FROM public.entitlements e WHERE e.tenant_id = item.tenant_id AND e.catalog_item_id = item.id AND e.user_id = actor
      AND e.revoked_at IS NULL AND e.valid_from <= now() AND (e.valid_until IS NULL OR e.valid_until > now()));
    SELECT jsonb_build_object('rating', r.rating, 'body', r.body, 'hidden', r.hidden_at IS NOT NULL) INTO mine FROM public.catalog_reviews r
      WHERE r.tenant_id = item.tenant_id AND r.item_id = item.id AND r.user_id = actor;
  END IF;
  result := jsonb_build_object('slug', item.slug, 'title', item.title, 'summary', item.summary, 'kind', item.kind,
    'subtitle', coalesce(g.subtitle, ''), 'body', g.body, 'included', to_jsonb(coalesce(g.included, ARRAY[]::text[])),
    'about', jsonb_build_object('heading', coalesce(g.about_heading, ''), 'body', coalesce(g.about_body, ''), 'photo', photo),
    'faq', coalesce(g.faq, '[]'::jsonb), 'cta', jsonb_build_object('quote', coalesce(g.cta_quote, ''), 'label', coalesce(g.cta_label, '')),
    'price', CASE WHEN g.price_cents IS NULL THEN NULL ELSE jsonb_build_object('currency', g.currency,
      'cents', CASE WHEN on_sale THEN g.sale_cents ELSE g.price_cents END, 'oldCents', CASE WHEN on_sale THEN g.price_cents END,
      'saleEndsAt', CASE WHEN on_sale THEN g.sale_ends_at END) END,
    'stats', jsonb_build_object('people', CASE WHEN people >= 5 THEN people END,
      'modules', (SELECT count(*) FROM public.catalog_sections s WHERE s.tenant_id = item.tenant_id AND s.item_id = item.id AND EXISTS (
        SELECT FROM public.catalog_lessons l WHERE l.tenant_id = s.tenant_id AND l.item_id = s.item_id AND l.section_id = s.id AND l.published)),
      'lessons', (SELECT count(*) FROM public.catalog_lessons l WHERE l.tenant_id = item.tenant_id AND l.item_id = item.id AND l.published),
      'files', (SELECT count(*) FROM public.catalog_files c JOIN public.files f ON f.tenant_id = c.tenant_id AND f.id = c.file_id
        WHERE c.tenant_id = item.tenant_id AND c.item_id = item.id AND f.status = 'ready' AND f.visibility = 'private')),
    'reviews', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'rating', x.rating, 'body', x.body, 'updatedAt', x.updated_at)
        ORDER BY x.updated_at DESC, x.rating DESC), '[]'::jsonb)
      FROM (SELECT split_part(btrim(coalesce(u.name, '')), ' ', 1) AS name, r.rating, r.body, r.updated_at FROM public.catalog_reviews r
        JOIN public.users u ON u.id = r.user_id
        WHERE r.tenant_id = item.tenant_id AND r.item_id = item.id AND r.hidden_at IS NULL ORDER BY r.updated_at DESC LIMIT 30) x),
    'rating', (SELECT jsonb_build_object('average', round(avg(r.rating)::numeric, 1), 'count', count(*)) FROM public.catalog_reviews r
      WHERE r.tenant_id = item.tenant_id AND r.item_id = item.id AND r.hidden_at IS NULL),
    'viewer', jsonb_build_object('signedIn', actor IS NOT NULL, 'canReview', eligible, 'review', mine));
  PERFORM set_config('app.community_definer_tenant', item.tenant_id::text, true);
  SELECT w.name INTO host FROM public.workspaces w WHERE w.tenant_id = item.tenant_id;
  PERFORM public.community_definer_reset();
  PERFORM set_config('app.catalog_tenant', '', true);
  RETURN result || jsonb_build_object('host', coalesce(host, ''));
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_landing(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_landing(text) TO harvest_app;--> statement-breakpoint
-- 5. A signed-in person writes or edits their one review of an item they have (active entitlement). Hidden stays hidden after an edit.
CREATE FUNCTION public.catalog_review_save(p_slug text, p_rating integer, p_body text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); item public.catalog_items%ROWTYPE; eligible boolean;
BEGIN
  IF actor IS NULL THEN RETURN 'not_found'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 OR p_body IS NULL OR length(p_body) > 1000
    OR translate(p_body, E'\n\r\t', '') ~ '[[:cntrl:]]' THEN RETURN 'invalid'; END IF;
  IF public.catalog_access(p_slug, 'metadata') IS NULL THEN RETURN 'not_found'; END IF;
  PERFORM set_config('app.catalog_slug', p_slug, true);
  SELECT * INTO item FROM public.catalog_items i WHERE i.slug = p_slug AND i.state = 'published';
  PERFORM set_config('app.catalog_slug', '', true);
  IF item.id IS NULL THEN RETURN 'not_found'; END IF;
  PERFORM set_config('app.catalog_tenant', item.tenant_id::text, true);
  eligible := EXISTS (SELECT FROM public.entitlements e WHERE e.tenant_id = item.tenant_id AND e.catalog_item_id = item.id AND e.user_id = actor
    AND e.revoked_at IS NULL AND e.valid_from <= now() AND (e.valid_until IS NULL OR e.valid_until > now()));
  IF eligible THEN
    INSERT INTO public.catalog_reviews (tenant_id, item_id, user_id, rating, body) VALUES (item.tenant_id, item.id, actor, p_rating, btrim(p_body))
      ON CONFLICT (tenant_id, item_id, user_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, updated_at = now();
  END IF;
  PERFORM set_config('app.catalog_tenant', '', true);
  RETURN CASE WHEN eligible THEN 'saved' ELSE 'not_eligible' END;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_review_save(text, integer, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_review_save(text, integer, text) TO harvest_app;--> statement-breakpoint
-- 6. The about-the-creator photo of a public landing, for the photo route: only a ready image the landing names.
CREATE FUNCTION public.catalog_landing_photo(p_slug text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE item public.catalog_items%ROWTYPE; result jsonb;
BEGIN
  IF public.catalog_access(p_slug, 'metadata') IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.catalog_slug', p_slug, true);
  SELECT * INTO item FROM public.catalog_items i WHERE i.slug = p_slug AND i.state = 'published';
  PERFORM set_config('app.catalog_slug', '', true);
  IF item.id IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.catalog_tenant', item.tenant_id::text, true);
  SELECT jsonb_build_object('key', f.key, 'name', f.name, 'mime', f.mime) INTO result FROM public.catalog_landings l
    JOIN public.files f ON f.tenant_id = l.tenant_id AND f.id = l.about_photo_id
    WHERE l.tenant_id = item.tenant_id AND l.item_id = item.id AND f.status = 'ready' AND f.mime IN ('image/jpeg','image/png','image/webp');
  PERFORM set_config('app.catalog_tenant', '', true);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_landing_photo(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_landing_photo(text) TO harvest_app;
