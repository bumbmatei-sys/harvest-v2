CREATE TABLE "campaign_scan_days" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "campaign_scan_days_tenant_id_campaign_id_day_pk" PRIMARY KEY("tenant_id","campaign_id","day"),
	CONSTRAINT "campaign_scan_count" CHECK ("campaign_scan_days"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "campaign_scan_days" ADD CONSTRAINT "campaign_scan_days_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.campaign_scan_days ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.campaign_scan_days FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.campaign_scan_days FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Only definers can access counters; no visitor-level event is ever stored.
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY metrics_counter_owner ON public.campaign_scan_days TO %I
    USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY metrics_response_owner ON public.campaign_responses FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.connect_metrics',true)='on')$p$, current_user);
END $$;--> statement-breakpoint
-- Complementary suppression: hide the entire related vector when any nonzero cell or pairwise difference is below five.
-- No total is returned. This intentionally over-suppresses rather than exposing a complementary cell through subtraction.
CREATE FUNCTION public.connect_suppress_metrics(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE a bigint; hidden boolean := false; out jsonb := '{}'; cell record; sums bigint[] := ARRAY[0::bigint];
BEGIN
  FOR a IN SELECT value::bigint FROM jsonb_each_text(v) LOOP
    IF a < 0 OR a > 692861481133922 OR public.connect_suppress_small(least(a,2147483647)::integer) IS NULL THEN hidden := true; END IF;
    IF NOT hidden THEN
      SELECT array_agg(DISTINCT n) INTO sums FROM unnest(sums || ARRAY(SELECT x+a FROM unnest(sums) x)) n;
    END IF;
  END LOOP;
  IF NOT hidden THEN
    SELECT EXISTS(SELECT 1 FROM (SELECT n-lag(n) OVER(ORDER BY n) AS delta FROM unnest(sums) n) diffs
      WHERE delta IS NOT NULL AND public.connect_suppress_small(least(delta,2147483647)::integer) IS NULL) INTO hidden;
  END IF;
  FOR cell IN SELECT key,value::bigint AS n FROM jsonb_each_text(v) LOOP
    out := out || jsonb_build_object(cell.key, CASE WHEN hidden THEN NULL ELSE cell.n END);
  END LOOP;
  RETURN out;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.connect_suppress_metrics(jsonb) FROM PUBLIC, harvest_app;--> statement-breakpoint
CREATE FUNCTION public.connect_campaign_metrics(p_tenant uuid, p_campaign uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor_role text; counts jsonb; result jsonb;
BEGIN
  actor_role := public.followup_actor_role(p_tenant);
  IF actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'metrics access denied' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.campaigns WHERE tenant_id=p_tenant AND id=p_campaign) THEN RAISE EXCEPTION 'campaign unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM set_config('app.connect_metrics','on',true);
  SELECT jsonb_build_object(
    'scans', (SELECT coalesce(sum(count),0) FROM public.campaign_scan_days WHERE tenant_id=p_tenant AND campaign_id=p_campaign),
    'pending', count(*) FILTER (WHERE status='pending'),
    'associated', count(*) FILTER (WHERE status='associated'),
    'erased', count(*) FILTER (WHERE status='erased'),
    'verifiedClaims', count(*) FILTER (WHERE status='associated')) INTO counts
    FROM public.campaign_responses WHERE tenant_id=p_tenant AND campaign_id=p_campaign;
  SELECT counts || jsonb_build_object(
    'awaiting_assignment',count(*) FILTER(WHERE state='awaiting_assignment'), 'no_response',count(*) FILTER(WHERE state='no_response'),
    'requested',count(*) FILTER(WHERE state='requested'), 'assigned',count(*) FILTER(WHERE state='assigned'),
    'attempted',count(*) FILTER(WHERE state='attempted'), 'connected',count(*) FILTER(WHERE state='connected'),
    'closed',count(*) FILTER(WHERE state='closed'), 'withdrawn',count(*) FILTER(WHERE state='withdrawn')) INTO counts
    FROM public.followup_cases WHERE tenant_id=p_tenant AND campaign_id=p_campaign;
  result := public.connect_suppress_metrics(counts);
  PERFORM set_config('app.connect_metrics','',true);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.connect_campaign_metrics(uuid,uuid) FROM PUBLIC, harvest_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.connect_campaign_metrics(uuid,uuid) TO harvest_app;
--> statement-breakpoint
-- Synthetic-only scan capture. Code resolves the campaign; no caller-supplied tenant, day, person or headers.
CREATE FUNCTION public.connect_record_scan(p_kind text,p_code text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE target record;
BEGIN
  IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN false; END IF;
  IF p_kind NOT IN ('qr','short') OR p_code IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.connect_resolve_code',p_code,true);
  SELECT tenant_id,campaign_id INTO target FROM public.campaign_response_links
    WHERE ((p_kind='qr' AND public_code=p_code) OR (p_kind='short' AND short_code=p_code))
      AND status='published' AND (expires_at IS NULL OR expires_at>now());
  PERFORM set_config('app.connect_resolve_code','',true);
  IF target.tenant_id IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.connect_resolve_tenant',target.tenant_id::text,true);
  IF NOT EXISTS(SELECT 1 FROM public.campaigns WHERE tenant_id=target.tenant_id AND id=target.campaign_id AND status<>'archived') THEN
    PERFORM set_config('app.connect_resolve_tenant','',true); RETURN false;
  END IF;
  PERFORM set_config('app.connect_resolve_tenant','',true);
  PERFORM set_config('app.tenant_id',target.tenant_id::text,true);
  INSERT INTO public.campaign_scan_days(tenant_id,campaign_id,day,count) VALUES(target.tenant_id,target.campaign_id,(now() AT TIME ZONE 'UTC')::date,1)
    ON CONFLICT(tenant_id,campaign_id,day) DO UPDATE SET count=public.campaign_scan_days.count+1;
  PERFORM set_config('app.tenant_id','',true);
  RETURN true;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.connect_record_scan(text,text) FROM PUBLIC,harvest_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.connect_record_scan(text,text) TO harvest_app;
