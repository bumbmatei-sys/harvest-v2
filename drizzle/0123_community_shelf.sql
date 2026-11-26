-- C13 classroom and C16 products shelf (founder decisions 26 Nov). A shelf link points at the canonical catalogue item and grants nothing: opening an
-- item still needs the person's own free enrolment (public.catalog_access). Each link records its shelf (the item's kind, held by a foreign key), its
-- position and at most one featured item per community and shelf.
-- Founder, 26 Nov: a hidden item may be published; it is then seen only through community shelves (see catalog_access below).
ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_item_publication";--> statement-breakpoint
ALTER TABLE "community_product_links" ADD COLUMN "kind" text;--> statement-breakpoint
-- Backfill. The owner runs under FORCE row security (0061), which hides every link and item, so both tables are relaxed for this
-- block only and put back exactly as found (the 0091 pattern).
DO $$
DECLARE r regclass; forced regclass[];
BEGIN
  SELECT coalesce(array_agg(c.oid::regclass), '{}') INTO forced FROM pg_class c
    WHERE c.relforcerowsecurity AND c.oid IN ('public.community_product_links'::regclass, 'public.catalog_items'::regclass);
  FOREACH r IN ARRAY forced LOOP EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', r); END LOOP;
  UPDATE public.community_product_links l SET kind = i.kind FROM public.catalog_items i WHERE i.tenant_id = l.tenant_id AND i.id = l.item_id;
  FOREACH r IN ARRAY forced LOOP EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', r); END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "community_product_links" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "community_product_links" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community_product_links" ADD CONSTRAINT "community_product_links_tenant_id_item_id_kind_catalog_items_tenant_id_id_kind_fk" FOREIGN KEY ("tenant_id","item_id","kind") REFERENCES "public"."catalog_items"("tenant_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_product_featured" ON "community_product_links" USING btree ("tenant_id","community_id","kind") WHERE "community_product_links"."featured";--> statement-breakpoint
-- Members read the links of a published community they can read (active membership with a valid grant, or a community host role: the forum's test).
CREATE POLICY community_shelf_member ON public.community_product_links FOR SELECT TO harvest_app
  USING (public.community_can_read(tenant_id, community_id) AND EXISTS (
    SELECT FROM public.communities c WHERE c.tenant_id = community_product_links.tenant_id AND c.id = community_product_links.community_id AND c.status = 'published'));--> statement-breakpoint
-- ...and the published items on such a shelf, hidden ones included: a hidden item is seen only through the shelves of its own ministry's communities.
CREATE POLICY catalog_community_shelf ON public.catalog_items FOR SELECT TO harvest_app
  USING (state = 'published' AND EXISTS (
    SELECT FROM public.community_product_links l JOIN public.communities c ON c.tenant_id = l.tenant_id AND c.id = l.community_id AND c.status = 'published'
    WHERE l.tenant_id = catalog_items.tenant_id AND l.item_id = catalog_items.id AND public.community_can_read(l.tenant_id, l.community_id)));--> statement-breakpoint
-- The catalogue definer reads a hidden item's shelf links in its own ministry only (keyed on the setting it sets and clears itself).
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY catalog_resolver_shelf ON public.community_product_links FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.catalog_tenant', true), '')::uuid)$p$, current_user);
END $$;--> statement-breakpoint
-- catalog_access from 0061, plus hidden items: a hidden published item resolves (metadata, enrol, content, file) only for a signed-in member of a
-- published community of the same ministry whose shelf shows it. Anonymous callers, everyone else and Discover never see it. The community
-- settings it needs are cleared on entry and on exit, so a value the app pre-set is never trusted.
CREATE OR REPLACE FUNCTION public.catalog_access(p_slug text, p_action text, p_file uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE item public.catalog_items%ROWTYPE;
  actor text := nullif(current_setting('app.user_id',true),'');
  resource_type text;
  metadata jsonb;
  result jsonb;
  shelved boolean;
BEGIN
  PERFORM set_config('app.catalog_tenant','',true);
  PERFORM public.community_definer_reset();
  <<resolve>>
  BEGIN
    IF p_action IS NULL OR p_action NOT IN ('metadata','enrol','content','file') OR
       (p_action <> 'metadata' AND actor IS NULL) THEN EXIT resolve; END IF;

    PERFORM set_config('app.catalog_slug',coalesce(p_slug,''),true);
    SELECT * INTO item FROM public.catalog_items i
      WHERE i.slug=p_slug AND i.state='published' AND i.visibility IN ('listed','unlisted','hidden') FOR SHARE;
    IF NOT FOUND THEN EXIT resolve; END IF;
    IF item.visibility='hidden' THEN
      IF actor IS NULL THEN EXIT resolve; END IF;
      PERFORM set_config('app.catalog_tenant',item.tenant_id::text,true);
      PERFORM set_config('app.community_definer_tenant',item.tenant_id::text,true);
      shelved := EXISTS (SELECT FROM public.community_product_links l
        JOIN public.communities c ON c.tenant_id=l.tenant_id AND c.id=l.community_id AND c.status='published'
        WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND public.community_can_read(l.tenant_id,l.community_id));
      PERFORM public.community_definer_reset();
      PERFORM set_config('app.catalog_tenant','',true);
      IF NOT shelved THEN EXIT resolve; END IF;
    END IF;
    metadata := jsonb_build_object('slug',item.slug,'title',item.title,'summary',item.summary,'kind',item.kind);
    IF p_action='metadata' THEN result := metadata; EXIT resolve; END IF;

    PERFORM set_config('app.catalog_tenant',item.tenant_id::text,true);
    resource_type := CASE WHEN item.kind='course' THEN 'course' ELSE 'product' END;
    IF p_action='enrol' THEN
      INSERT INTO public.catalog_enrolments(tenant_id,item_id,user_id) VALUES(item.tenant_id,item.id,actor)
        ON CONFLICT DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.entitlements(tenant_id,user_id,resource_type,resource_id,catalog_item_id,source)
          VALUES(item.tenant_id,actor,resource_type,item.id,item.id,'free_enrolment');
        INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id)
          VALUES(item.tenant_id,actor,'catalog.enrol',item.id::text);
      END IF;
    END IF;

    IF NOT EXISTS (SELECT FROM public.entitlements e WHERE e.tenant_id=item.tenant_id
      AND e.catalog_item_id=item.id AND e.user_id=actor AND e.revoked_at IS NULL AND e.valid_from<=now()
      AND (e.valid_until IS NULL OR e.valid_until>now())) THEN EXIT resolve; END IF;
    IF p_action='enrol' THEN result := jsonb_build_object('enrolled',true); EXIT resolve; END IF;
    IF p_action='file' THEN
      result := (SELECT jsonb_build_object('key',f.key,'name',f.name)
        FROM public.catalog_files l JOIN public.files f ON f.tenant_id=l.tenant_id AND f.id=l.file_id
        WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND l.file_id=p_file
          AND f.visibility='private' AND f.status='ready');
      EXIT resolve;
    END IF;
    result := metadata || jsonb_build_object(
      'lessons', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'body',l.body) ORDER BY l.position),'[]'::jsonb)
        FROM public.catalog_lessons l WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND l.published),
      'files', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) ORDER BY l.position),'[]'::jsonb)
        FROM public.catalog_files l JOIN public.files f ON f.tenant_id=l.tenant_id AND f.id=l.file_id
        WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND f.visibility='private' AND f.status='ready'));
  END resolve;
  PERFORM public.community_definer_reset();
  PERFORM set_config('app.catalog_slug','',true);
  PERFORM set_config('app.catalog_tenant','',true);
  RETURN result;
END $$;
