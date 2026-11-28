-- Daily Connect chart data stays behind the existing metrics access rule.
-- Completed UTC days form fixed cells. A complementary cell is suppressed
-- when the existing campaign total could otherwise reveal a small remainder.
CREATE FUNCTION public.connect_campaign_chart(p_tenant uuid, p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous jsonb; actor text := nullif(current_setting('app.user_id',true),'');
  tenant text := current_setting('app.tenant_id',true);
  stop_day date := (statement_timestamp() AT TIME ZONE 'UTC')::date;
  minimum integer := (SELECT small_group_min FROM public.connect_retention_policy()); result jsonb;
BEGIN
  previous := public.blog_scope_clear();
  PERFORM public.account_self_reset();
  IF actor IS NOT NULL AND p_tenant::text = tenant THEN
    PERFORM set_config('app.user_id',actor,true);
    PERFORM set_config('app.tenant_id',tenant,true);
    IF public.followup_actor_role(p_tenant) IN ('owner','admin') AND EXISTS (
      SELECT FROM public.campaigns c WHERE c.tenant_id=p_tenant AND c.id=p_campaign
    ) THEN
      PERFORM set_config('app.connect_metrics','on',true);
      WITH cells AS (
        SELECT 'scans' AS metric, s.day, s.count::bigint AS n FROM public.campaign_scan_days s
          WHERE s.tenant_id=p_tenant AND s.campaign_id=p_campaign AND s.day>=stop_day-30 AND s.day<stop_day
        UNION ALL
        SELECT 'responses', (r.submitted_at AT TIME ZONE 'UTC')::date, count(*)
          FROM public.campaign_responses r WHERE r.tenant_id=p_tenant AND r.campaign_id=p_campaign
            AND r.submitted_at >= ((stop_day-30)::timestamp AT TIME ZONE 'UTC')
            AND r.submitted_at < (stop_day::timestamp AT TIME ZONE 'UTC') GROUP BY 2
      ), ranked AS (
        SELECT *, coalesce(sum(n) FILTER (WHERE n BETWEEN 1 AND minimum-1) OVER (PARTITION BY metric),0) AS hidden,
          row_number() OVER (PARTITION BY metric ORDER BY CASE WHEN n>=minimum THEN n END NULLS LAST,day) AS complementary
        FROM cells
      ), days AS (
        SELECT (stop_day-day_offset)::date AS day FROM generate_series(30,1,-1) AS day_offset
      )
      SELECT jsonb_object_agg(m.metric, (
        SELECT jsonb_agg(jsonb_build_object('date',d.day,'value',
          CASE WHEN c.n>=minimum AND NOT (c.hidden BETWEEN 1 AND minimum-1 AND c.complementary=1) THEN c.n END) ORDER BY d.day)
        FROM days d LEFT JOIN ranked c ON c.day=d.day AND c.metric=m.metric
      )) INTO result FROM (VALUES ('scans'),('responses')) m(metric);
    END IF;
  END IF;
  PERFORM public.blog_scope_clear();
  PERFORM public.blog_scope_restore(previous);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.connect_campaign_chart(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_campaign_chart(uuid,uuid) TO harvest_app;
--> statement-breakpoint
-- Event metadata uses the same visibility as Events. Sign-up totals use the
-- canonical eligible-going count and are available only where the roster is.
CREATE FUNCTION public.workspace_event_chart(p_tenant uuid, p_campaign uuid, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous jsonb; actor text := nullif(current_setting('app.user_id',true),'');
  tenant text := current_setting('app.tenant_id',true); stored_role text; area_role text;
  minimum integer := (SELECT small_group_min FROM public.connect_retention_policy()); result jsonb;
BEGIN
  previous := public.blog_scope_clear();
  PERFORM public.account_self_reset();
  <<read_chart>>
  BEGIN
    IF actor IS NULL OR p_tenant::text IS DISTINCT FROM tenant THEN EXIT read_chart; END IF;
    PERFORM set_config('app.user_id',actor,true);
    PERFORM set_config('app.tenant_id',tenant,true);
    PERFORM set_config('app.events_tenant',tenant,true);
    PERFORM set_config('app.community_definer_tenant',tenant,true);
    SELECT role_id INTO stored_role FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=actor FOR SHARE;
    area_role := public.access_role(p_tenant,actor,'communities',stored_role);
    IF area_role IS NULL OR area_role NOT IN ('owner','admin','member','viewer') THEN EXIT read_chart; END IF;
    IF p_campaign IS NULL THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'title',q.title,'startsAt',q.starts_at,'timeZone',q.time_zone)
          ORDER BY q.starts_at,q.id),'[]'::jsonb) INTO result
      FROM (SELECT e.id,e.title,e.starts_at,e.time_zone FROM public.events e
        WHERE e.tenant_id=p_tenant AND e.starts_at>=p_now AND e.status='published' AND e.published_at IS NOT NULL
          AND (area_role IN ('owner','admin') OR public.events_sources(p_tenant,e.id,actor,p_now)<>'{}'::jsonb)
        ORDER BY e.starts_at,e.id LIMIT 5) q;
    ELSIF area_role IN ('owner','admin') AND public.access_role(p_tenant,actor,'campaigns',stored_role) IN ('owner','admin','member','viewer') THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('date',q.day,'value',CASE WHEN q.n>=minimum THEN q.n END) ORDER BY q.day),'[]'::jsonb)
        INTO result FROM (
          SELECT (e.starts_at AT TIME ZONE 'UTC')::date AS day, sum(public.events_occupied(p_tenant,e.id,p_now)) AS n
          FROM public.campaign_event_links c JOIN public.events e ON e.tenant_id=c.tenant_id AND e.id=c.event_id
          WHERE c.tenant_id=p_tenant AND c.campaign_id=p_campaign AND e.status='published' AND e.published_at IS NOT NULL
          GROUP BY 1
        ) q;
    END IF;
  END read_chart;
  PERFORM public.blog_scope_clear();
  PERFORM public.blog_scope_restore(previous);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.workspace_event_chart(uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspace_event_chart(uuid,uuid,timestamptz) TO harvest_app;
