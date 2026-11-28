-- The classroom reports published lessons and the signed-in learner's progress only for an active enrolment on this shelf.
CREATE FUNCTION public.catalog_shelf_counts(p_tenant uuid, p_community uuid, p_items uuid[])
RETURNS TABLE(item_id uuid, lesson_count integer, completed_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  PERFORM public.community_definer_reset();
  PERFORM set_config('app.catalog_slug', '', true);
  PERFORM set_config('app.catalog_tenant', '', true);
  PERFORM set_config('app.catalog_learner_tenant', '', true);
  PERFORM set_config('app.catalog_my_notes', '', true);
  PERFORM set_config('app.catalog_progress_tenant', '', true);
  IF actor IS NULL OR p_tenant IS NULL OR p_community IS NULL OR cardinality(p_items) NOT BETWEEN 1 AND 200 THEN RETURN; END IF;

  PERFORM set_config('app.community_definer_tenant', p_tenant::text, true);
  IF EXISTS (SELECT FROM public.communities c WHERE c.tenant_id = p_tenant AND c.id = p_community AND c.status = 'published')
    AND public.community_can_read(p_tenant, p_community) THEN
    PERFORM set_config('app.catalog_tenant', p_tenant::text, true);
    PERFORM set_config('app.catalog_learner_tenant', p_tenant::text, true);
    RETURN QUERY
      SELECT i.id, count(l.id)::integer, count(progress.lesson_id)::integer
      FROM public.catalog_items i
      JOIN public.community_product_links link ON link.tenant_id = i.tenant_id AND link.item_id = i.id AND link.community_id = p_community
      LEFT JOIN public.catalog_lessons l ON l.tenant_id = i.tenant_id AND l.item_id = i.id AND l.published
      LEFT JOIN public.catalog_progress progress ON progress.tenant_id = l.tenant_id AND progress.item_id = l.item_id
        AND progress.lesson_id = l.id AND progress.user_id = actor
      WHERE i.tenant_id = p_tenant AND i.id = ANY(p_items) AND i.kind = 'course' AND i.state = 'published'
        AND EXISTS (SELECT FROM public.entitlements e WHERE e.tenant_id = i.tenant_id AND e.catalog_item_id = i.id
          AND e.user_id = actor AND e.resource_type = 'course' AND e.revoked_at IS NULL AND e.valid_from <= now()
          AND (e.valid_until IS NULL OR e.valid_until > now()))
      GROUP BY i.id;
  END IF;
  PERFORM public.community_definer_reset();
  PERFORM set_config('app.catalog_tenant', '', true);
  PERFORM set_config('app.catalog_learner_tenant', '', true);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_shelf_counts(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_shelf_counts(uuid, uuid, uuid[]) TO harvest_app;--> statement-breakpoint

-- Volunteers is a dedicated grant. The payout-account authority stays with the owner.
ALTER TABLE public.workspace_member_access DROP CONSTRAINT workspace_member_access_area,
  ADD CONSTRAINT workspace_member_access_area CHECK (area IN ('crm','giving','campaigns','communities','catalog','social','newsletter','website','office','connect','settings','volunteers'));--> statement-breakpoint
DO $$
DECLARE patch record; def text; updated text;
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    ('public.access_grants_text(text,jsonb)', '''connect'',''settings''', '''connect'',''settings'',''volunteers'''),
    ('public.volunteer_role(uuid)', 'user_id,''owner_admin'',role_id', 'user_id,''volunteers'',role_id'),
    ('public.volunteer_change(uuid,text,uuid,text,uuid,timestamptz)', 'm.user_id,''owner_admin'',m.role_id', 'm.user_id,''volunteers'',m.role_id')
  ) AS p(signature, needle, replacement)
  LOOP
    def := pg_get_functiondef(patch.signature::regprocedure);
    updated := replace(def, patch.needle, patch.replacement);
    IF length(updated) - length(def) <> length(patch.replacement) - length(patch.needle) THEN
      RAISE EXCEPTION 'Expected one access mapping in %', patch.signature;
    END IF;
    EXECUTE updated;
  END LOOP;
END $$;
