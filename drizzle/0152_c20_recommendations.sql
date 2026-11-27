CREATE TABLE "connect_community_join_counts" (
	"tenant_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"joins" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "connect_community_join_counts_tenant_id_link_id_community_id_pk" PRIMARY KEY("tenant_id","link_id","community_id"),
	CONSTRAINT "connect_community_join_counts_joins" CHECK ("connect_community_join_counts"."joins" >= 0)
);
--> statement-breakpoint
ALTER TABLE "connect_community_join_counts" ADD CONSTRAINT "connect_community_join_counts_link_fk" FOREIGN KEY ("tenant_id","link_id") REFERENCES "public"."campaign_response_links"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connect_community_join_counts" ADD CONSTRAINT "connect_community_join_counts_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- C20 (Communities: Discover recommendations and the Harvest Connect community link).
-- 1. The QR landing definition may name ONE recommended community by id. Older snapshots (no key) stay valid. The guest page resolves the id at read time
--    (published, listed, same ministry, not suspended by Harvest), so the stored id never shows a community that stopped qualifying.
CREATE OR REPLACE FUNCTION public.valid_connect_landing(d jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE card jsonb; value text;
BEGIN
  IF d IS NULL OR jsonb_typeof(d) <> 'object' OR NOT (d ?& ARRAY['heading','message','cards'])
    OR (d - ARRAY['heading','message','cards','communityId']) <> '{}'::jsonb
    OR (d ? 'communityId' AND (jsonb_typeof(d->'communityId') <> 'string' OR d->>'communityId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    OR jsonb_typeof(d->'heading') <> 'string' OR length(d->>'heading') > 120
    OR jsonb_typeof(d->'message') <> 'string' OR length(d->>'message') > 600
    OR jsonb_typeof(d->'cards') <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(d->'cards') > 8 THEN RETURN false; END IF;
  FOR card IN SELECT * FROM jsonb_array_elements(d->'cards') LOOP
    IF jsonb_typeof(card) <> 'object' THEN RETURN false; END IF;
    IF card->>'kind' = 'resource' THEN
      IF NOT (card ?& ARRAY['kind','resourceId']) OR (card - ARRAY['kind','resourceId']) <> '{}'::jsonb
        OR card->>'resourceId' NOT IN ('first-reading','common-questions','keep-exploring') THEN RETURN false; END IF;
    ELSIF card->>'kind' = 'external' THEN
      IF NOT (card ?& ARRAY['kind','category','title','description','url','price'])
        OR (card - ARRAY['kind','category','title','description','url','price']) <> '{}'::jsonb
        OR card->>'category' NOT IN ('community','course','product') OR card->>'price' NOT IN ('free','paid')
        OR (card->>'category' = 'community' AND card->>'price' <> 'free')
        OR jsonb_typeof(card->'title') <> 'string' OR length(btrim(card->>'title')) NOT BETWEEN 1 AND 120 OR length(card->>'title') > 120
        OR jsonb_typeof(card->'description') <> 'string' OR length(card->>'description') > 300
        OR jsonb_typeof(card->'url') <> 'string' OR NOT public.valid_connect_landing_url(card->>'url') THEN RETURN false; END IF;
    ELSE RETURN false; END IF;
    -- Require string types even for enum fields (including JSON null).
    FOR value IN SELECT v FROM jsonb_each_text(card) AS e(k,v) LOOP
      IF value IS NULL THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  -- Plain text only: React escapes markup. Reject non-display controls; allow tabs/newlines.
  FOR value IN SELECT d->>'heading' UNION ALL SELECT d->>'message'
    UNION ALL SELECT c->>'title' FROM jsonb_array_elements(d->'cards') c WHERE c->>'kind'='external'
    UNION ALL SELECT c->>'description' FROM jsonb_array_elements(d->'cards') c WHERE c->>'kind'='external' LOOP
    IF regexp_replace(value, E'[\t\n\r]', '', 'g') ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint
-- 2. Count-only attribution. Staff of the ministry read their own counts; nobody writes except the definer below. No person column exists.
ALTER TABLE public.connect_community_join_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_community_join_counts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.connect_community_join_counts FROM PUBLIC, harvest_app;
GRANT SELECT ON public.connect_community_join_counts TO harvest_app;
CREATE POLICY connect_join_counts_staff_read ON public.connect_community_join_counts FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = connect_community_join_counts.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND public.access_role(m.tenant_id, m.user_id, 'connect', m.role_id) IN ('owner','admin','member')));
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY connect_join_counts_definer ON public.connect_community_join_counts TO %I
    USING (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.connect_join_tenant', true), '')::uuid)
    WITH CHECK (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.connect_join_tenant', true), '')::uuid)$p$, current_user);
END $$;
--> statement-breakpoint
-- 3. Guest page: the recommended community of the CURRENT published snapshot, only while it is published, listed, in the same ministry and not suspended
--    by Harvest (listing or ministry standing). Returns public fields only; no id, tenant, revision or campaign field. Every app.* setting it sets is cleared.
CREATE FUNCTION public.resolve_connect_landing_community(p_kind text, p_code text) RETURNS TABLE(community_slug text, community_name text, community_tagline text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE l record; campaign_live boolean; target text; c record; blocked boolean := true;
BEGIN
  IF NOT coalesce((p_kind='qr' AND p_code ~ '^[a-f0-9]{32}$') OR (p_kind='short' AND p_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),false) THEN RETURN; END IF;
  PERFORM set_config('app.connect_resolve_code',p_code,true);
  SELECT x.tenant_id,x.id,x.campaign_id INTO l FROM public.campaign_response_links x
    WHERE (CASE WHEN p_kind='qr' THEN x.public_code=p_code ELSE x.short_code=p_code END)
      AND x.status='published' AND (x.expires_at IS NULL OR x.expires_at>clock_timestamp());
  PERFORM set_config('app.connect_resolve_code','',true);
  IF l.id IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.connect_resolve_tenant',l.tenant_id::text,true);
  PERFORM set_config('app.connect_landing_link',l.id::text,true);
  SELECT x.archived_at IS NULL INTO campaign_live FROM public.campaigns x WHERE x.tenant_id=l.tenant_id AND x.id=l.campaign_id;
  IF campaign_live IS TRUE THEN
    SELECT v.definition->>'communityId' INTO target FROM public.connect_landing_states s
      JOIN public.connect_landing_versions v ON v.tenant_id=s.tenant_id AND v.link_id=s.link_id AND v.revision=s.published_revision
      WHERE s.tenant_id=l.tenant_id AND s.link_id=l.id;
  END IF;
  PERFORM set_config('app.connect_resolve_tenant','',true);
  PERFORM set_config('app.connect_landing_link','',true);
  IF target IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.community_resolve_ids',target,true);
  SELECT x.id,x.tenant_id,x.slug,x.name,x.tagline INTO c FROM public.communities x
    WHERE x.tenant_id=l.tenant_id AND x.id=target::uuid AND x.status='published' AND x.visibility='listed';
  IF c.id IS NOT NULL THEN
    PERFORM set_config('app.discover_read','on',true);
    blocked := EXISTS (SELECT 1 FROM public.discover_controls d WHERE d.tenant_id=c.tenant_id AND d.resource_type='community' AND d.resource_id=c.id AND d.review_state='suspended')
      OR EXISTS (SELECT 1 FROM public.discover_ministry_standing s WHERE s.tenant_id=c.tenant_id AND s.suspended);
  END IF;
  PERFORM public.community_definer_reset();
  IF c.id IS NOT NULL AND NOT blocked THEN RETURN QUERY SELECT c.slug::text, c.name::text, c.tagline::text; END IF;
END $$;
REVOKE ALL ON FUNCTION public.resolve_connect_landing_community(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_connect_landing_community(text,text) TO harvest_app;
--> statement-breakpoint
-- 4. Adds one to the count, only in the transaction that just created the caller's active membership (joined_at = now()), only when the code's current
--    published snapshot recommends exactly that community, and at most once per transaction. Stores no person, time or response. Never raises for bad input.
CREATE FUNCTION public.connect_count_community_join(p_code text, p_slug text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id',true),''); kind text; l record; campaign_live boolean; target text; c record; fresh boolean := false;
BEGIN
  IF actor IS NULL OR p_code IS NULL OR p_slug IS NULL OR current_setting('app.connect_join_counted',true) = 'on' THEN RETURN false; END IF;
  kind := CASE WHEN p_code ~ '^[a-f0-9]{32}$' THEN 'qr' WHEN p_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$' THEN 'short' END;
  IF kind IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.connect_resolve_code',p_code,true);
  SELECT x.tenant_id,x.id,x.campaign_id INTO l FROM public.campaign_response_links x
    WHERE (CASE WHEN kind='qr' THEN x.public_code=p_code ELSE x.short_code=p_code END)
      AND x.status='published' AND (x.expires_at IS NULL OR x.expires_at>clock_timestamp());
  PERFORM set_config('app.connect_resolve_code','',true);
  IF l.id IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.connect_resolve_tenant',l.tenant_id::text,true);
  PERFORM set_config('app.connect_landing_link',l.id::text,true);
  SELECT x.archived_at IS NULL INTO campaign_live FROM public.campaigns x WHERE x.tenant_id=l.tenant_id AND x.id=l.campaign_id;
  IF campaign_live IS TRUE THEN
    SELECT v.definition->>'communityId' INTO target FROM public.connect_landing_states s
      JOIN public.connect_landing_versions v ON v.tenant_id=s.tenant_id AND v.link_id=s.link_id AND v.revision=s.published_revision
      WHERE s.tenant_id=l.tenant_id AND s.link_id=l.id;
  END IF;
  PERFORM set_config('app.connect_resolve_tenant','',true);
  PERFORM set_config('app.connect_landing_link','',true);
  IF target IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.community_definer_tenant',l.tenant_id::text,true);
  SELECT x.id,x.tenant_id INTO c FROM public.communities x
    WHERE x.tenant_id=l.tenant_id AND x.id=target::uuid AND x.slug=p_slug AND x.status='published' AND x.visibility='listed';
  IF c.id IS NOT NULL THEN
    fresh := EXISTS (SELECT 1 FROM public.community_memberships m WHERE m.tenant_id=c.tenant_id AND m.community_id=c.id AND m.user_id=actor
      AND m.status='active' AND m.joined_at = now());
  END IF;
  PERFORM public.community_definer_reset();
  IF NOT fresh THEN RETURN false; END IF;
  PERFORM set_config('app.connect_join_tenant',l.tenant_id::text,true);
  INSERT INTO public.connect_community_join_counts(tenant_id,link_id,community_id,joins) VALUES (l.tenant_id,l.id,c.id,1)
    ON CONFLICT (tenant_id,link_id,community_id) DO UPDATE SET joins = connect_community_join_counts.joins + 1;
  PERFORM set_config('app.connect_join_tenant','',true);
  -- Deliberately left on until the transaction ends: it is the once-per-transaction guard, not a read scope.
  PERFORM set_config('app.connect_join_counted','on',true);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.connect_count_community_join(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_count_community_join(text,text) TO harvest_app;
--> statement-breakpoint
-- 5. Discover recommendations. Same visibility rule as discover_search (published, listed, opted in, approved for exactly the current fields, ministry not
--    suspended), applied again here. The only personal input is p_seed: the caller's OWN joined/enrolled resource ids, read by the app under the caller's own
--    row policy. A seed contributes only the category of its own approved public listing (so a hidden seed adds nothing), and seeds are left out of the result.
--    Ranking: category overlap first, then the listing's last public change. No member count, other person's join or private field is read.
CREATE FUNCTION public.discover_recommend(p_type text, p_seed uuid[], p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE lim integer := least(greatest(coalesce(p_limit, 6), 1), 12); seed uuid[] := coalesce(p_seed, ARRAY[]::uuid[]); result jsonb;
BEGIN
  IF p_type IS NOT NULL AND p_type NOT IN ('community','course','product') THEN RAISE EXCEPTION 'invalid type'; END IF;
  IF cardinality(seed) > 500 THEN seed := seed[1:500]; END IF;
  PERFORM set_config('app.discover_read', 'on', true);
  WITH visible AS (
    SELECT d.* FROM public.discover_listings d
      JOIN public.discover_controls c ON (c.tenant_id, c.resource_type, c.resource_id) = (d.tenant_id, d.resource_type, d.resource_id)
      LEFT JOIN public.discover_ministry_standing s ON s.tenant_id = d.tenant_id
    WHERE c.review_state = 'approved' AND c.reviewed_hash IS NOT NULL AND c.reviewed_hash = d.content_hash AND coalesce(s.suspended, false) = false
  ), interests AS (SELECT DISTINCT v.category FROM visible v WHERE v.resource_id = ANY (seed) AND v.category IS NOT NULL),
  ranked AS (
    SELECT v.*, row_number() OVER (ORDER BY coalesce(v.category IN (SELECT i.category FROM interests i), false) DESC, v.updated_at DESC, v.resource_id DESC) AS rn
    FROM visible v WHERE (p_type IS NULL OR v.resource_type = p_type) AND NOT (v.resource_id = ANY (seed))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', x.resource_type, 'id', x.resource_id, 'slug', x.slug, 'name', x.name, 'summary', coalesce(x.summary, x.tagline), 'hostName', x.host_name,
      'category', x.category, 'language', x.language, 'audience', x.audience, 'free', x.is_free, 'pricing', x.pricing, 'admission', CASE WHEN x.resource_type = 'community' THEN to_jsonb(x.admission) ELSE NULL END,
      'updatedAt', x.updated_at) ORDER BY x.rn), '[]'::jsonb) INTO result
  FROM (SELECT * FROM ranked WHERE rn <= lim) x;
  PERFORM public.community_definer_reset();
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.discover_recommend(text,uuid[],integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discover_recommend(text,uuid[],integer) TO harvest_app;
