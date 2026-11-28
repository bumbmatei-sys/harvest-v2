CREATE TABLE public.connect_course_settings (
  tenant_id uuid PRIMARY KEY CONSTRAINT connect_course_settings_tenant_id_workspaces_tenant_id_fk REFERENCES public.workspaces(tenant_id),
  beginner_course_id uuid,
  CONSTRAINT connect_course_settings_course_fk
    FOREIGN KEY (tenant_id, beginner_course_id) REFERENCES public.catalog_items(tenant_id,id)
    ON DELETE SET NULL (beginner_course_id)
);--> statement-breakpoint
ALTER TABLE public.connect_course_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_course_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.connect_course_settings FROM PUBLIC, harvest_app;
DO $$
BEGIN
  EXECUTE pg_catalog.format($p$CREATE POLICY connect_course_settings_definer ON public.connect_course_settings TO %I
    USING (tenant_id = nullif(current_setting('app.catalog_tenant',true),'')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.catalog_tenant',true),'')::uuid)$p$,current_user);
END $$;--> statement-breakpoint

-- Only Connect managers can see or change the setting. A chosen item must be
-- an available, free, guest-visible course in the same ministry.
CREATE FUNCTION public.connect_course_settings_access(p_tenant uuid, p_write boolean, p_item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id',true),'');
  prior text := coalesce(current_setting('app.tenant_id',true),''); result jsonb;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.tenant_id',prior,true);
  PERFORM set_config('app.user_id',coalesce(actor,''),true);
  IF actor IS NULL OR p_tenant::text IS DISTINCT FROM prior THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=actor
    AND public.access_role(m.tenant_id,m.user_id,'connect',m.role_id) IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM set_config('app.catalog_tenant',p_tenant::text,true);
  IF p_write IS NOT TRUE THEN
    SELECT beginner_course_id INTO p_item FROM public.connect_course_settings WHERE tenant_id=p_tenant;
  ELSIF p_item IS NULL OR EXISTS (
    SELECT FROM public.catalog_items i LEFT JOIN public.catalog_landings l ON l.tenant_id=i.tenant_id AND l.item_id=i.id
      WHERE i.tenant_id=p_tenant AND i.id=p_item AND i.kind='course' AND i.state='published'
      AND i.visibility IN ('listed','unlisted','public') AND l.price_cents IS NULL
  ) THEN
    INSERT INTO public.connect_course_settings(tenant_id,beginner_course_id) VALUES(p_tenant,p_item)
      ON CONFLICT(tenant_id) DO UPDATE SET beginner_course_id=excluded.beginner_course_id;
  ELSE
    PERFORM set_config('app.catalog_tenant','',true);
    RETURN NULL;
  END IF;
  result := jsonb_build_object('beginnerCourseId',p_item);
  PERFORM set_config('app.catalog_tenant','',true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.connect_course_settings_access(uuid,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_course_settings_access(uuid,boolean,uuid) TO harvest_app;--> statement-breakpoint

-- Read only receipt and response identity to validate the post-submit step.
-- The course gets neither that identity nor the response, contact or consent.
CREATE FUNCTION public.connect_beginner_course(p_kind text, p_code text, p_hash text, p_action text, p_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id',true),'');
  mode text := current_setting('app.connect_intake_mode',true); s record; item record; result jsonb;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  IF mode IS DISTINCT FROM 'synthetic' OR NOT coalesce(p_hash ~ '^[a-f0-9]{64}$',false)
    OR p_action IS NULL OR p_action NOT IN ('offer','start','enrol') OR (p_action='enrol' AND actor IS NULL) THEN RETURN NULL; END IF;
  PERFORM set_config('app.connect_intake_mode','synthetic',true);
  <<resolve>>
  BEGIN
    SELECT * INTO s FROM public.connect_intake_source(p_kind,p_code);
    IF NOT FOUND THEN EXIT resolve; END IF;
    IF NOT EXISTS (
      SELECT FROM public.connect_intake_receipts x JOIN public.campaign_responses r
        ON (r.tenant_id,r.id)=(x.tenant_id,x.response_id)
      WHERE x.tenant_id=s.tenant AND x.receipt_hash=p_hash AND r.campaign_id=s.campaign AND r.link_id=s.link
        AND r.status='pending' AND r.expires_at>now()
    ) THEN EXIT resolve; END IF;

    PERFORM set_config('app.catalog_tenant',s.tenant::text,true);
    SELECT i.slug,i.title,i.summary,CASE WHEN p_action='start' THEN (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'body',l.body,
        'video',CASE WHEN l.video_id IS NOT NULL THEN jsonb_build_object('provider',l.video_provider,'id',l.video_id) END)
        ORDER BY l.position),'[]'::jsonb)
      FROM public.catalog_lessons l WHERE l.tenant_id=i.tenant_id AND l.item_id=i.id AND l.published
    ) END AS lessons INTO item FROM public.connect_course_settings c
      JOIN public.catalog_items i ON i.tenant_id=c.tenant_id AND i.id=c.beginner_course_id
      LEFT JOIN public.catalog_landings l ON l.tenant_id=i.tenant_id AND l.item_id=i.id
      WHERE c.tenant_id=s.tenant AND i.kind='course' AND i.state='published'
        AND i.visibility IN ('listed','unlisted','public') AND l.price_cents IS NULL;
    IF NOT FOUND OR (p_action <> 'offer' AND item.slug IS DISTINCT FROM p_slug) THEN EXIT resolve; END IF;
    IF p_action='enrol' THEN
      PERFORM set_config('app.user_id',actor,true);
      result := public.catalog_access(item.slug,'enrol');
      EXIT resolve;
    END IF;
    result := jsonb_build_object('slug',item.slug,'title',item.title,'summary',item.summary);
    IF p_action='start' THEN
      result := result || jsonb_build_object('lessons', item.lessons);
    END IF;
  END resolve;
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.connect_beginner_course(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_beginner_course(text,text,text,text,text) TO harvest_app;
