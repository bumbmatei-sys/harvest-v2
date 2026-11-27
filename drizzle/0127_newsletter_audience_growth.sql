CREATE TABLE "newsletter_audience_snapshots" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"subscribed" integer NOT NULL,
	"unsubscribed" integer NOT NULL,
	"suppressed" integer NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_audience_snapshots_tenant_id_day_pk" PRIMARY KEY("tenant_id","day"),
	CONSTRAINT "newsletter_audience_snapshot_counts" CHECK ("newsletter_audience_snapshots"."subscribed" >= 0 and "newsletter_audience_snapshots"."unsubscribed" >= 0 and "newsletter_audience_snapshots"."suppressed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "newsletter_growth_scans" (
	"token" uuid PRIMARY KEY NOT NULL,
	"xact" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_audience_snapshots" ADD CONSTRAINT "newsletter_audience_snapshots_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Audience growth: one row of counts per ministry per UTC day (no person ids). Same grant model as the other newsletter evidence tables:
-- no table privileges for the app or worker roles; the worker writes through newsletter_snapshot_audience and owners/admins read through
-- newsletter_audience_growth (capability `newsletter:analytics`). Groups of 1 to 4 are withheld by the reader.
ALTER TABLE public.newsletter_growth_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_growth_scans FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_growth_scans FROM PUBLIC,harvest_app;
ALTER TABLE public.newsletter_audience_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_audience_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_audience_snapshots FROM PUBLIC,harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='harvest_worker') THEN
    REVOKE ALL ON public.newsletter_audience_snapshots,public.newsletter_growth_scans FROM harvest_worker;
  END IF;
  EXECUTE pg_catalog.format($p$CREATE POLICY newsletter_growth_owner ON public.newsletter_audience_snapshots TO %I
    USING ((session_user='harvest_worker' AND pg_catalog.current_setting('app.nl_send_worker',true)='on')
      OR tenant_id=nullif(pg_catalog.current_setting('app.nl_send_tenant',true),'')::uuid)
    WITH CHECK (session_user='harvest_worker' AND pg_catalog.current_setting('app.nl_send_worker',true)='on'
      AND tenant_id=nullif(pg_catalog.current_setting('app.nl_send_tenant',true),'')::uuid)$p$,current_user);
  -- The snapshot enumerates ministries. The flag alone is not enough: it must name a random token that only the snapshot function inserts,
  -- in the same transaction, and deletes before it returns. A worker session that sets the flag by hand and calls another definer that reads
  -- workspaces matches no token, so this policy opens nothing for it.
  EXECUTE pg_catalog.format($p$CREATE POLICY newsletter_growth_owner ON public.newsletter_growth_scans TO %I
    USING (session_user='harvest_worker') WITH CHECK (session_user='harvest_worker')$p$,current_user);
  EXECUTE pg_catalog.format($p$CREATE POLICY newsletter_growth_ministries ON public.workspaces FOR SELECT TO %I
    USING (session_user='harvest_worker' AND EXISTS (SELECT FROM public.newsletter_growth_scans g
      WHERE g.token::text=pg_catalog.current_setting('app.nl_growth_scan',true) AND g.xact=pg_catalog.pg_current_xact_id()::text))$p$,current_user);
END $$;
--> statement-breakpoint
-- The audience status of every person, the SQL twin of audienceStatusSql (src/server/newsletter-audience.ts): suppressed or bounced first,
-- then a newsletter withdrawal on any channel (do not contact), then an email grant plus a live list, then any list row. Erased people are
-- not counted. Called only by the snapshot function, under the worker's per-ministry read scope.
CREATE FUNCTION public.newsletter_audience_counts(p_tenant uuid)
RETURNS TABLE(subscribed integer,unsubscribed integer,suppressed integer)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  WITH people AS (
    SELECT CASE
      WHEN EXISTS (SELECT FROM public.newsletter_subscribers s WHERE s.tenant_id=p_tenant AND s.contact_id=c.id AND s.suppressed)
        OR EXISTS (SELECT FROM public.newsletter_subscriptions ns
          JOIN public.newsletter_subscribers s ON s.tenant_id=ns.tenant_id AND s.id=ns.subscriber_id
          JOIN public.newsletter_lists l ON l.tenant_id=ns.tenant_id AND l.id=ns.list_id AND l.archived_at IS NULL
          WHERE s.tenant_id=p_tenant AND s.contact_id=c.id AND ns.state IN ('bounced','suppressed')) THEN 'suppressed'
      WHEN EXISTS (SELECT FROM public.contact_consents w WHERE w.tenant_id=p_tenant AND w.contact_id=c.id
          AND w.purpose='newsletter' AND w.status='withdrawn' AND w.redacted_at IS NULL
          AND NOT EXISTS (SELECT FROM public.contact_consents g WHERE g.tenant_id=w.tenant_id AND g.contact_id=w.contact_id
            AND g.channel=w.channel AND g.purpose=w.purpose AND g.status='granted' AND g.redacted_at IS NULL
            AND g.recorded_at>w.recorded_at AND g.occurred_at>w.occurred_at)) THEN 'unsubscribed'
      WHEN (SELECT l.status FROM public.contact_consents l WHERE l.tenant_id=p_tenant AND l.contact_id=c.id
          AND l.channel='email' AND l.purpose='newsletter' AND l.redacted_at IS NULL
          ORDER BY l.recorded_at DESC,l.occurred_at DESC,l.id DESC LIMIT 1)='granted'
        AND EXISTS (SELECT FROM public.newsletter_subscriptions ns
          JOIN public.newsletter_subscribers s ON s.tenant_id=ns.tenant_id AND s.id=ns.subscriber_id
          JOIN public.newsletter_lists l ON l.tenant_id=ns.tenant_id AND l.id=ns.list_id AND l.archived_at IS NULL
          WHERE s.tenant_id=p_tenant AND s.contact_id=c.id AND ns.state='subscribed') THEN 'subscribed'
      WHEN EXISTS (SELECT FROM public.newsletter_subscriptions ns
          JOIN public.newsletter_subscribers s ON s.tenant_id=ns.tenant_id AND s.id=ns.subscriber_id
          JOIN public.newsletter_lists l ON l.tenant_id=ns.tenant_id AND l.id=ns.list_id AND l.archived_at IS NULL
          WHERE s.tenant_id=p_tenant AND s.contact_id=c.id) THEN 'unsubscribed'
      ELSE 'other' END AS status
    FROM public.contacts c WHERE c.tenant_id=p_tenant AND c.erased_at IS NULL
  )
  SELECT (count(*) FILTER (WHERE status='subscribed'))::integer, (count(*) FILTER (WHERE status='unsubscribed'))::integer,
    (count(*) FILTER (WHERE status='suppressed'))::integer FROM people
$$;
REVOKE ALL ON FUNCTION public.newsletter_audience_counts(uuid) FROM PUBLIC,harvest_app;
--> statement-breakpoint
-- One snapshot per ministry per UTC day, idempotent: a ministry that already has today's row is skipped, and a concurrent run's insert wins.
CREATE FUNCTION public.newsletter_snapshot_audience(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE today date:=(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date; ministry uuid; taken integer:=0; added integer; scan uuid:=pg_catalog.gen_random_uuid();
  prior_worker text:=pg_catalog.current_setting('app.nl_send_worker',true);
  prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true);
  prior_scan text:=pg_catalog.current_setting('app.nl_growth_scan',true);
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_worker','on',true);
  INSERT INTO public.newsletter_growth_scans(token,xact) VALUES (scan,pg_catalog.pg_current_xact_id()::text);
  PERFORM pg_catalog.set_config('app.nl_growth_scan',scan::text,true);
  FOR ministry IN SELECT w.tenant_id FROM public.workspaces w WHERE NOT EXISTS (
      SELECT FROM public.newsletter_audience_snapshots s WHERE s.tenant_id=w.tenant_id AND s.day=today)
    ORDER BY w.tenant_id LIMIT p_limit
  LOOP
    PERFORM pg_catalog.set_config('app.nl_send_tenant',ministry::text,true);
    INSERT INTO public.newsletter_audience_snapshots(tenant_id,day,subscribed,unsubscribed,suppressed)
      SELECT ministry,today,n.subscribed,n.unsubscribed,n.suppressed FROM public.newsletter_audience_counts(ministry) n
      ON CONFLICT (tenant_id,day) DO NOTHING;
    GET DIAGNOSTICS added=ROW_COUNT;
    taken:=taken+added;
  END LOOP;
  DELETE FROM public.newsletter_growth_scans WHERE token=scan;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  PERFORM pg_catalog.set_config('app.nl_growth_scan',coalesce(prior_scan,''),true);
  PERFORM pg_catalog.set_config('app.nl_send_worker',coalesce(prior_worker,''),true);
  RETURN taken;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_snapshot_audience(integer) FROM PUBLIC,harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.newsletter_snapshot_audience(integer) TO harvest_worker;
  END IF;
END $$;
--> statement-breakpoint
-- Owners and admins read the daily counts for at most 90 days. A count of 1 to 4 comes back as NULL; a day with no row has no snapshot.
CREATE FUNCTION public.newsletter_audience_growth(p_tenant uuid,p_from date,p_until date)
RETURNS TABLE(day text,subscribed integer,unsubscribed integer,suppressed integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true);
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.newsletter_capability(public.access_role(m.tenant_id,m.user_id,'newsletter',m.role_id),'newsletter:analytics')) THEN
    RAISE insufficient_privilege;
  END IF;
  IF p_until IS NULL OR p_from IS NULL OR p_until-p_from NOT BETWEEN 1 AND 90 THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  RETURN QUERY SELECT pg_catalog.to_char(s.day,'YYYY-MM-DD'),
    CASE WHEN s.subscribed BETWEEN 1 AND 4 THEN NULL ELSE s.subscribed END,
    CASE WHEN s.unsubscribed BETWEEN 1 AND 4 THEN NULL ELSE s.unsubscribed END,
    CASE WHEN s.suppressed BETWEEN 1 AND 4 THEN NULL ELSE s.suppressed END
    FROM public.newsletter_audience_snapshots s WHERE s.tenant_id=p_tenant AND s.day>=p_from AND s.day<p_until ORDER BY s.day;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_audience_growth(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_audience_growth(uuid,date,date) TO harvest_app;
--> statement-breakpoint
-- One campaign's outcomes counted on the UTC day each was recorded (accepted, delivered, bounced, complained, unsubscribed), from the
-- delivery records still kept. Records older than 90 days are rolled up by selection day only, so their outcomes cannot be placed on an
-- outcome day: `archived` says when the campaign has such counts. When any selection day of the campaign is a group under 5, the whole
-- series is withheld (`withheld`, no days), matching the selection-day rule.
CREATE FUNCTION public.newsletter_outcome_days(p_tenant uuid,p_campaign uuid,p_from date,p_until date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true); result jsonb; small boolean; rolled boolean;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.newsletter_capability(public.access_role(m.tenant_id,m.user_id,'newsletter',m.role_id),'newsletter:analytics')) THEN
    RAISE insufficient_privilege;
  END IF;
  IF p_campaign IS NULL OR p_until IS NULL OR p_from IS NULL OR p_until-p_from NOT BETWEEN 1 AND 90 THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT EXISTS (SELECT FROM public.newsletter_archived_counts a WHERE a.tenant_id=p_tenant AND a.campaign_id=p_campaign) INTO rolled;
  SELECT EXISTS (SELECT FROM (
      SELECT (d.selected_at AT TIME ZONE 'UTC')::date AS day,count(*) AS total FROM public.newsletter_deliveries d
        WHERE d.tenant_id=p_tenant AND d.campaign_id=p_campaign GROUP BY 1
      UNION ALL
      SELECT a.day,a.count FROM public.newsletter_archived_counts a WHERE a.tenant_id=p_tenant AND a.campaign_id=p_campaign AND a.metric='selected'
    ) cohorts GROUP BY day HAVING sum(total)<5) INTO small;
  IF small THEN
    result:=jsonb_build_object('withheld',true,'archived',rolled,'days','[]'::jsonb);
  ELSE
    SELECT jsonb_build_object('withheld',false,'archived',rolled,'days',coalesce(jsonb_agg(jsonb_build_object('day',x.day,'metric',x.metric,'count',x.total)
      ORDER BY x.day,x.metric),'[]'::jsonb)) INTO result FROM (
      SELECT pg_catalog.to_char((m.at AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') AS day,m.metric,count(*) AS total
      FROM public.newsletter_deliveries d CROSS JOIN LATERAL (VALUES ('sent',d.accepted_at),('delivered',d.delivered_at),('bounced',d.bounced_at),
        ('complained',d.complained_at),('unsubscribed',d.unsubscribed_at)) AS m(metric,at)
      WHERE d.tenant_id=p_tenant AND d.campaign_id=p_campaign AND m.at IS NOT NULL
        AND m.at>=p_from::timestamp AT TIME ZONE 'UTC' AND m.at<p_until::timestamp AT TIME ZONE 'UTC'
      GROUP BY 1,2) x;
  END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_outcome_days(uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_outcome_days(uuid,uuid,date,date) TO harvest_app;
