-- Newsletter reschedule (feat/b-newsletter). A scheduled campaign that has not started can move to another time in its ministry's zone.
-- Nothing else changes: the frozen revision, the selected recipients, the reviewed identities and the 60-day limit from the original
-- selection stay as they were, and sending stays off (no worker or live provider is installed by this migration).
-- 1. newsletter_input_guard (0073) is replaced with one extra branch: scheduled -> scheduled may change only scheduled_at and timezone,
--    and only under the per-campaign marker that the definer below sets (any role can set a custom setting, so the branch also
--    requires current_user to be the owner of public.newsletter_reschedule_campaign, as 0006 does for erase_contact).
-- 2. public.newsletter_reschedule_campaign checks the caller through public.access_role (0113), locks the campaign and all its
--    deliveries (the worker claims with FOR UPDATE SKIP LOCKED, so it cannot lease one meanwhile), refuses a campaign with any attempted,
--    leased or provider-held delivery, moves the unleased, unattempted queued deliveries' next check to the new time and restores both settings.
CREATE OR REPLACE FUNCTION public.newsletter_input_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='newsletter_lists' THEN
    IF (NEW.tenant_id,NEW.id,NEW.audience_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM
       (OLD.tenant_id,OLD.id,OLD.audience_id,OLD.created_by,OLD.created_at) THEN RAISE check_violation; END IF;
    NEW.version:=OLD.version+1;
  ELSIF TG_TABLE_NAME='newsletter_campaigns' THEN
    IF (NEW.state='reviewed') IS DISTINCT FROM (NEW.review_digest IS NOT NULL AND NEW.review_expires_at IS NOT NULL)
      THEN RAISE check_violation; END IF;
    IF TG_OP='INSERT' THEN
      IF NEW.state<>'draft' OR NEW.version<>1 OR NEW.revision<>1 OR NEW.frozen_at IS NOT NULL OR NEW.review_digest IS NOT NULL
        OR NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'') THEN RAISE check_violation; END IF;
    -- 0122: a scheduled campaign keeps its frozen revision, recipients and identities; only its time and zone move, and only inside
    -- public.newsletter_reschedule_campaign (the definer's owner sets a transaction-local marker for this one campaign; the app role never passes).
    ELSIF OLD.state='scheduled' AND NEW.state='scheduled'
      AND current_user=pg_get_userbyid((SELECT proowner FROM pg_proc
        WHERE oid='public.newsletter_reschedule_campaign(uuid,uuid,integer,timestamptz,text)'::regprocedure))
      AND current_setting('app.nl_reschedule',true)=OLD.tenant_id::text||':'||OLD.id::text THEN
      IF NEW.version<>OLD.version+1 OR NEW.scheduled_at IS NULL OR NEW.timezone IS NULL OR OLD.frozen_at IS NULL
        OR NEW.scheduled_at<=clock_timestamp() OR NEW.scheduled_at>OLD.frozen_at+interval '1440 hours'
        OR (NEW.tenant_id,NEW.id,NEW.name,NEW.created_by,NEW.revision,NEW.review_digest,NEW.review_expires_at,NEW.frozen_at,
            NEW.sender_version,NEW.reply_version,NEW.sender_domain_version)
          IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.name,OLD.created_by,OLD.revision,OLD.review_digest,OLD.review_expires_at,OLD.frozen_at,
            OLD.sender_version,OLD.reply_version,OLD.sender_domain_version)
      THEN RAISE check_violation; END IF;
    ELSIF NEW.version<>OLD.version+1 OR (OLD.frozen_at IS NOT NULL AND
      (NEW.revision,NEW.frozen_at,NEW.scheduled_at,NEW.timezone,NEW.sender_version,NEW.reply_version,NEW.sender_domain_version)
      IS DISTINCT FROM (OLD.revision,OLD.frozen_at,OLD.scheduled_at,OLD.timezone,OLD.sender_version,OLD.reply_version,OLD.sender_domain_version))
      OR NOT (CASE OLD.state
        WHEN 'draft' THEN NEW.state IN ('draft','reviewed','cancelled')
        WHEN 'reviewed' THEN NEW.state IN ('draft','reviewed','scheduled','failed','cancelled')
        WHEN 'scheduled' THEN NEW.state IN ('sending','failed','cancelled')
        WHEN 'sending' THEN NEW.state IN ('sent','partial','failed','cancelled')
        ELSE false END)
      OR (NEW.state='draft' AND NEW.revision<>OLD.revision+1)
      OR (NEW.state<>'draft' AND NEW.revision<>OLD.revision)
      OR (NEW.state='reviewed' AND (NEW.review_expires_at<=clock_timestamp() OR NEW.review_expires_at>clock_timestamp()+interval '10 minutes'))
      OR (OLD.state='reviewed' AND NEW.state IN ('scheduled','failed') AND
        (OLD.review_expires_at<=clock_timestamp() OR NEW.scheduled_at>OLD.review_expires_at-interval '10 minutes'+interval '1440 hours'))
      OR (NEW.state IN ('scheduled','sending','sent','partial','failed') AND
        (NEW.frozen_at IS NULL OR NEW.scheduled_at IS NULL OR NEW.timezone IS NULL))
    THEN RAISE check_violation; END IF;
  ELSIF TG_TABLE_NAME='newsletter_deliveries' THEN
    IF NEW.state NOT IN ('queued','skipped') OR NOT EXISTS (
      SELECT FROM public.newsletter_campaigns c WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.campaign_id
        AND c.revision=NEW.revision AND c.state='reviewed' AND c.review_expires_at>clock_timestamp()
        AND NEW.next_check_at<=c.review_expires_at-interval '10 minutes'+interval '1440 hours')
      OR NEW.subscriber_id IS NULL OR NEW.list_id IS NULL
      OR NOT EXISTS (SELECT FROM public.newsletter_campaign_lists l WHERE l.tenant_id=NEW.tenant_id
        AND l.campaign_id=NEW.campaign_id AND l.revision=NEW.revision AND l.list_id=NEW.list_id)
      THEN RAISE check_violation; END IF;
  ELSIF TG_OP='UPDATE' AND NEW.version<>OLD.version+1 THEN
    RAISE check_violation;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_input_guard() FROM PUBLIC,harvest_app;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_reschedule_campaign(p_tenant uuid,p_campaign uuid,p_version integer,p_at timestamptz,p_timezone text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true);
  prior_marker text:=pg_catalog.current_setting('app.nl_reschedule',true);
  c public.newsletter_campaigns;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.newsletter_capability(public.access_role(m.tenant_id,m.user_id,'newsletter',m.role_id),'newsletter:delivery')) THEN
    RAISE insufficient_privilege;
  END IF;
  IF p_campaign IS NULL OR p_version IS NULL OR p_at IS NULL OR p_timezone IS NULL
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_timezone_names z WHERE z.name=p_timezone) THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT * INTO c FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=p_campaign FOR UPDATE;
  -- Lock every delivery of the campaign before checking them, so a concurrent worker claim cannot lease one between the check and the move.
  PERFORM 1 FROM public.newsletter_deliveries d WHERE d.tenant_id=p_tenant AND d.campaign_id=p_campaign FOR UPDATE;
  IF c.id IS NULL OR c.state<>'scheduled' OR c.version<>p_version OR c.frozen_at IS NULL OR EXISTS (
    SELECT FROM public.newsletter_deliveries d WHERE d.tenant_id=p_tenant AND d.campaign_id=p_campaign
      AND (d.attempted_at IS NOT NULL OR d.lease IS NOT NULL OR d.provider_ref IS NOT NULL OR d.state NOT IN ('queued','skipped'))) THEN
    PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
    RETURN NULL;
  END IF;
  PERFORM pg_catalog.set_config('app.nl_reschedule',p_tenant::text||':'||p_campaign::text,true);
  UPDATE public.newsletter_campaigns SET scheduled_at=p_at,timezone=p_timezone,version=c.version+1
    WHERE tenant_id=p_tenant AND id=p_campaign;
  UPDATE public.newsletter_deliveries SET next_check_at=p_at
    WHERE tenant_id=p_tenant AND campaign_id=p_campaign AND state='queued' AND lease IS NULL AND attempted_at IS NULL;
  PERFORM pg_catalog.set_config('app.nl_reschedule',coalesce(prior_marker,''),true);
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  RETURN c.version+1;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.newsletter_reschedule_campaign(uuid,uuid,integer,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_reschedule_campaign(uuid,uuid,integer,timestamptz,text) TO harvest_app;
