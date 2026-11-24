-- Newsletter sender setup: an owner or admin can ask for a sending-domain check from the screen.
-- The server asks the provider port first and passes the answer in; the worker keeps its own scheduled recheck.
-- SYNTHETIC-ONLY: 0073 made domain verification outcomes worker-only. This web-callable function is acceptable only because it
-- hard-codes the '[.]example[.]test$' clause below (no real domain can ever verify through it). Before the live adapter it must be
-- removed or moved to the worker path; relaxing that clause without revisiting this grant is a defect (tests/unit/newsletter-synthetic-guard.test.ts).
CREATE FUNCTION public.newsletter_verify_domain(p_tenant uuid,p_id uuid,p_version integer,
  p_ownership boolean,p_spf boolean,p_dkim boolean,p_bounce boolean,p_dmarc boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior text:=current_setting('app.nl_send_tenant',true); current_domain text; owns boolean; updated integer;
  has_spf boolean:=coalesce(p_spf,false); has_dkim boolean:=coalesce(p_dkim,false);
  has_bounce boolean:=coalesce(p_bounce,false); has_dmarc boolean:=coalesce(p_dmarc,false);
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'')
      AND public.newsletter_capability(role_id,'newsletter:delivery')) THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT domain INTO current_domain FROM public.newsletter_connections WHERE tenant_id=p_tenant AND id=p_id;
  IF NOT FOUND THEN PERFORM set_config('app.nl_send_tenant',coalesce(prior,''),true); RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(current_domain,0));
  -- Re-read under the lock: a concurrent check or change since the caller's read makes the version stale.
  PERFORM 1 FROM public.newsletter_connections WHERE tenant_id=p_tenant AND id=p_id AND version=p_version FOR UPDATE;
  IF NOT FOUND THEN PERFORM set_config('app.nl_send_tenant',coalesce(prior,''),true); RETURN false; END IF;
  owns:=coalesce(p_ownership,false) AND current_domain ~ '[.]example[.]test$'
    AND current_domain<>'newsletter.example.test' AND NOT EXISTS (
      SELECT FROM public.newsletter_connections other WHERE other.domain=current_domain AND other.tenant_id<>p_tenant
        AND other.ownership AND other.spf AND other.dkim AND other.bounce AND other.dmarc);
  UPDATE public.newsletter_connections c SET checked_at=clock_timestamp(),ownership=owns,spf=has_spf,
    dkim=has_dkim,bounce=has_bounce,dmarc=has_dmarc,
    version=c.version+((c.ownership,c.spf,c.dkim,c.bounce,c.dmarc) IS DISTINCT FROM
      (owns,has_spf,has_dkim,has_bounce,has_dmarc))::integer
  WHERE c.tenant_id=p_tenant AND c.id=p_id AND c.version=p_version;
  GET DIAGNOSTICS updated=ROW_COUNT;
  PERFORM set_config('app.nl_send_tenant',coalesce(prior,''),true);
  RETURN updated>0;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.newsletter_verify_domain(uuid,uuid,integer,boolean,boolean,boolean,boolean,boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.newsletter_verify_domain(uuid,uuid,integer,boolean,boolean,boolean,boolean,boolean) TO harvest_app;
