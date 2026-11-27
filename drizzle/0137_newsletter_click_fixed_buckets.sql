-- Publish only range-independent UTC-day cells. A report may sum eligible cells, but a different
-- date range cannot change which cells it may see. Withhold a campaign day if any of its
-- links is below five, so day totals cannot disclose a small link by subtraction.
CREATE OR REPLACE FUNCTION public.newsletter_click_report(p_tenant uuid,p_campaign uuid,p_from date,p_until date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM pg_catalog.set_config('app.nl_send_tenant','',true);
  IF p_tenant IS DISTINCT FROM nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.newsletter_capability(public.access_role(m.tenant_id,m.user_id,'owner_admin',m.role_id),'newsletter:analytics')) THEN
    RAISE insufficient_privilege;
  END IF;
  IF p_until IS NULL OR p_from IS NULL OR p_until-p_from NOT BETWEEN 1 AND 90 THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  WITH raw AS (
    SELECT k.campaign_id,k.revision,(k.clicked_at AT TIME ZONE 'UTC')::date AS day,k.link_index,count(*)::bigint AS n
    FROM public.newsletter_clicks k WHERE k.tenant_id=p_tenant AND (p_campaign IS NULL OR k.campaign_id=p_campaign)
      AND k.clicked_at>=p_from::timestamp AT TIME ZONE 'UTC' AND k.clicked_at<p_until::timestamp AT TIME ZONE 'UTC'
    GROUP BY 1,2,3,4
    UNION ALL
    SELECT a.campaign_id,a.revision,a.day,a.link_index,a.count FROM public.newsletter_click_counts a
    WHERE a.tenant_id=p_tenant AND (p_campaign IS NULL OR a.campaign_id=p_campaign) AND a.day>=p_from AND a.day<p_until
  ), cells AS (
    SELECT campaign_id,revision,day,link_index,sum(n)::bigint AS n FROM raw GROUP BY 1,2,3,4
  ), small_cohorts AS (
    SELECT x.campaign_id FROM (
      SELECT d.campaign_id,count(*)::bigint AS n FROM public.newsletter_deliveries d
        WHERE d.tenant_id=p_tenant AND d.campaign_id IN (SELECT campaign_id FROM raw) GROUP BY 1
      UNION ALL
      SELECT a.campaign_id,a.count FROM public.newsletter_archived_counts a
        WHERE a.tenant_id=p_tenant AND a.metric='selected' AND a.campaign_id IN (SELECT campaign_id FROM raw)
    ) x GROUP BY 1 HAVING sum(x.n)<5
  ), campaign_day AS (
    -- Each link is deduplicated per delivery. Summing different links cannot prove five people.
    SELECT campaign_id,day,sum(n)::bigint AS n,
      min(n)<5 OR campaign_id IN (SELECT campaign_id FROM small_cohorts) AS withheld
    FROM cells GROUP BY 1,2
  ), daily AS (
    SELECT day,sum(n)::bigint AS n,bool_or(withheld) AS withheld FROM campaign_day GROUP BY 1
  ), per_campaign AS (
    SELECT campaign_id,sum(n)::bigint AS n,bool_or(withheld) AS withheld FROM campaign_day GROUP BY 1
  ), shown AS (
    SELECT c.campaign_id,c.revision,c.link_index,sum(c.n)::bigint AS n
    FROM cells c JOIN campaign_day d USING (campaign_id,day)
    WHERE p_campaign IS NOT NULL AND NOT d.withheld GROUP BY 1,2,3
  )
  SELECT jsonb_build_object(
    'total',CASE WHEN EXISTS (SELECT FROM daily WHERE withheld) THEN NULL ELSE coalesce((SELECT sum(n) FROM daily),0) END,
    'days',coalesce((SELECT jsonb_agg(jsonb_build_object('day',pg_catalog.to_char(d.day,'YYYY-MM-DD'),
      'clicks',CASE WHEN d.withheld THEN NULL ELSE d.n END) ORDER BY d.day) FROM daily d),'[]'::jsonb),
    'campaigns',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.campaign_id,
      'clicks',CASE WHEN c.withheld THEN NULL ELSE c.n END) ORDER BY c.campaign_id) FROM per_campaign c),'[]'::jsonb),
    'links',coalesce((SELECT jsonb_agg(jsonb_build_object('url',u.url,'clicks',t.n) ORDER BY t.n DESC,u.url)
      FROM (SELECT * FROM shown ORDER BY n DESC,revision,link_index LIMIT 10) t JOIN public.newsletter_click_links u
        ON u.tenant_id=p_tenant AND u.campaign_id=t.campaign_id AND u.revision=t.revision AND u.link_index=t.link_index),'[]'::jsonb)
  ) INTO result;
  PERFORM pg_catalog.set_config('app.nl_send_tenant','',true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_click_report(uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_click_report(uuid,uuid,date,date) TO harvest_app;
--> statement-breakpoint
-- The automation report uses the same fixed cells, with the step in the campaign's place. A cell is one step, one UTC day and one link. A step-day is
-- withheld when any of its link cells is under five or the step's emails reached fewer than five people, and withholding depends only on that step-day,
-- never on the requested range. Day, step and period totals are withheld whenever they would include a withheld step-day; link totals add only cells
-- of step-days that are shown. Two overlapping ranges therefore differ only by whole shown cells, each at least five. Owners and admins only.
CREATE OR REPLACE FUNCTION public.newsletter_automation_click_report(p_tenant uuid,p_automation uuid,p_from date,p_until date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true);
  prior_private text:=pg_catalog.current_setting('app.nl_auto_private',true); result jsonb;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.newsletter_capability(public.access_role(m.tenant_id,m.user_id,'owner_admin',m.role_id),'newsletter:analytics')) THEN
    RAISE insufficient_privilege;
  END IF;
  IF p_automation IS NULL OR p_until IS NULL OR p_from IS NULL OR p_until-p_from NOT BETWEEN 1 AND 90 THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  PERFORM pg_catalog.set_config('app.nl_auto_private','on',true);
  WITH raw AS (
    SELECT k.step_index AS step,(k.clicked_at AT TIME ZONE 'UTC')::date AS day,k.link_index,count(*)::bigint AS n
    FROM public.newsletter_automation_clicks k WHERE k.tenant_id=p_tenant AND k.automation_id=p_automation
      AND k.clicked_at>=p_from::timestamp AT TIME ZONE 'UTC' AND k.clicked_at<p_until::timestamp AT TIME ZONE 'UTC'
    GROUP BY 1,2,3
    UNION ALL
    SELECT a.step_index,a.day,a.link_index,a.count FROM public.newsletter_automation_click_counts a
    WHERE a.tenant_id=p_tenant AND a.automation_id=p_automation AND a.day>=p_from AND a.day<p_until
  ), cells AS (
    SELECT step,day,link_index,sum(n)::bigint AS n FROM raw GROUP BY 1,2,3
  ), small_cohorts AS (
    SELECT s.step FROM (SELECT DISTINCT step FROM cells) s WHERE (
      SELECT count(*) FROM public.newsletter_automation_log l JOIN public.newsletter_automation_runs ru ON ru.tenant_id=l.tenant_id AND ru.id=l.run_id
      WHERE l.tenant_id=p_tenant AND ru.automation_id=p_automation AND l.step_type='email' AND l.outcome='sent' AND l.step_index=s.step)<5
  ), step_day AS (
    -- Each link is deduplicated per email. Summing different links cannot prove five people.
    SELECT step,day,sum(n)::bigint AS n,min(n)<5 OR step IN (SELECT step FROM small_cohorts) AS withheld
    FROM cells GROUP BY 1,2
  ), daily AS (
    SELECT day,sum(n)::bigint AS n,bool_or(withheld) AS withheld FROM step_day GROUP BY 1
  ), per_step AS (
    SELECT step,sum(n)::bigint AS n,bool_or(withheld) AS withheld FROM step_day GROUP BY 1
  ), shown AS (
    SELECT c.link_index,sum(c.n)::bigint AS n FROM cells c JOIN step_day d USING (step,day) WHERE NOT d.withheld GROUP BY 1
  )
  SELECT pg_catalog.jsonb_build_object(
    'total',CASE WHEN EXISTS (SELECT FROM daily WHERE withheld) THEN NULL ELSE coalesce((SELECT sum(n) FROM daily),0) END,
    'days',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day',pg_catalog.to_char(d.day,'YYYY-MM-DD'),
      'clicks',CASE WHEN d.withheld THEN NULL ELSE d.n END) ORDER BY d.day) FROM daily d),'[]'::jsonb),
    'steps',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('step',s.step,
      'clicks',CASE WHEN s.withheld THEN NULL ELSE s.n END) ORDER BY s.step) FROM per_step s),'[]'::jsonb),
    'links',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('url',u.url,'clicks',t.n) ORDER BY t.n DESC,u.url)
      FROM (SELECT * FROM shown ORDER BY n DESC,link_index LIMIT 10) t JOIN public.newsletter_automation_click_links u
        ON u.tenant_id=p_tenant AND u.automation_id=p_automation AND u.link_index=t.link_index),'[]'::jsonb)
  ) INTO result;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  PERFORM pg_catalog.set_config('app.nl_auto_private',coalesce(prior_private,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_click_report(uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_automation_click_report(uuid,uuid,date,date) TO harvest_app;
