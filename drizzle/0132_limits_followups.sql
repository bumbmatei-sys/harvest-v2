-- Founder decisions, 27 Nov 2026.
-- 1. Auto-DM limits count a rolling 24 hours instead of the calendar day in the Inbox time zone, so a recipient who was just messaged
--    before midnight is not messaged again a minute later. social_auto_dm_begin is the 0071 body as rewritten by 0113 (access_role);
--    only the cutoff changes, plus an explicit entry reset of the app.* flags. The cutoff is shared by the per-recipient and the per-rule
--    count, so both are rolling. h.timezone is still read with the hours revision and is no longer used for the cutoff.
CREATE OR REPLACE FUNCTION public.social_auto_dm_begin(p_tenant uuid, p_job uuid, p_lease uuid, p_recipient text, p_conversation text, p_deadline timestamp with time zone, p_policy integer, p_variant text, p_request_hash text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE j record; r public.social_auto_dm_rules%ROWTYPE; c record; h record; person uuid; item record; purpose text; cutoff timestamptz;
BEGIN
  -- Entry reset: clear the app.* flags that owner policies on the tables read here are keyed on, so a value the caller set cannot widen
  -- what this definer reads; then set its own three. app.tenant_id and app.user_id stay (access_role reads app.tenant_id).
  PERFORM pg_catalog.set_config(n, '', true) FROM pg_catalog.unnest(ARRAY['app.catalog_tenant','app.social_media_tenant','app.social_upload_cleanup',
    'app.nl_send_tenant','app.nl_send_worker','app.nl_send_insight','app.community_definer_tenant','app.events_tenant','app.crm_forms_tenant',
    'app.campaign_budget_tenant','app.campaign_invite_tenant','app.access_tenant']) AS n;
  PERFORM set_config('app.social_auto_dm_worker','on',true);
  PERFORM set_config('app.social_definer','on',true);
  PERFORM set_config('app.social_inbox_worker','on',true);
  SELECT * INTO j FROM public.social_auto_dm_jobs WHERE (tenant_id,id,lease)=(p_tenant,p_job,p_lease) AND state='leased';
  IF NOT FOUND OR p_recipient !~ '^[a-f0-9]{64}$' OR p_recipient IS NULL OR p_deadline IS NULL OR p_deadline<=clock_timestamp()
    OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_variant IS NULL OR p_variant NOT IN ('rule','away') THEN RETURN 'ineligible'; END IF;
  SELECT status,health,health_code INTO c FROM public.social_connections WHERE (tenant_id,id)=(p_tenant,j.connection_id) FOR SHARE;
  IF NOT FOUND OR c.status<>'active' OR c.health='failing' OR coalesce(c.health_code,'') ~ 'expired|token_revoked|reauth' THEN RETURN 'ineligible'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.social_webhook_events e WHERE (e.tenant_id,e.id)=(p_tenant,j.event_id)
    AND p_deadline <= e.occurred_at + CASE WHEN e.event_type='comment.received' THEN interval '7 days' ELSE interval '24 hours' END
    -- Defence in depth: the worker-supplied conversation must be the signed event's own subject.
    AND CASE WHEN e.event_type='message.received' THEN e.subject_ref IS NOT DISTINCT FROM p_conversation
      ELSE (p_conversation IS NULL OR p_conversation = e.subject_ref) END)
    THEN RETURN 'ineligible'; END IF;
  -- One transaction per connection serializes cap reservations across concurrent rules.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || j.connection_id::text,713));
  SELECT * INTO r FROM public.social_auto_dm_rules WHERE (tenant_id,id)=(p_tenant,j.rule_id) FOR SHARE;
  IF NOT FOUND OR NOT r.enabled OR r.version<>j.rule_version THEN RETURN 'ineligible'; END IF;
  IF j.step='primary' AND p_variant='rule' AND r.rule#>>'{response,fileId}' IS NOT NULL THEN
    PERFORM 1 FROM public.files f WHERE f.tenant_id=p_tenant AND f.id::text=r.rule#>>'{response,fileId}'
      AND f.social_upload AND f.status='ready' AND f.social_retired_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RETURN 'ineligible'; END IF;
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE (tenant_id,user_id)=(p_tenant,r.enabled_by) AND public.access_role(tenant_id, user_id, 'social', role_id) IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RETURN 'ineligible'; END IF;
  SELECT id,contact_id,assignee_id INTO item FROM public.social_inbox_items
    WHERE (tenant_id,connection_id,provider_ref,kind)=(p_tenant,j.connection_id,p_conversation,'dm') FOR SHARE;
  IF item.assignee_id IS NOT NULL THEN RETURN 'ineligible'; END IF;
  purpose := r.rule->>'purpose';
  IF item.contact_id IS NOT NULL THEN
    SELECT id INTO person FROM public.contacts WHERE (tenant_id,id)=(p_tenant,item.contact_id) AND erased_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN 'suppressed'; END IF;
    IF purpose='service' AND EXISTS (
      SELECT 1 FROM public.contact_consents w
      WHERE (w.tenant_id,w.contact_id,w.purpose)=(p_tenant,person,'messaging') AND w.status='withdrawn' AND w.redacted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.contact_consents g
          WHERE (g.tenant_id,g.contact_id,g.purpose,g.channel)=(w.tenant_id,w.contact_id,w.purpose,w.channel)
            AND g.status='granted' AND g.redacted_at IS NULL AND g.occurred_at>w.occurred_at AND g.recorded_at>w.recorded_at)
    ) THEN RETURN 'suppressed'; END IF;
  END IF;
  IF purpose<>'service' AND (person IS NULL OR purpose NOT IN ('marketing','outreach_follow_up','account_communications','messaging')
    OR NOT public.social_auto_dm_consent(p_tenant,person,purpose)) THEN RETURN 'suppressed'; END IF;
  IF purpose='service' AND coalesce((r.rule->>'serviceOnly')::boolean,false)=false THEN RETURN 'suppressed'; END IF;
  SELECT version,timezone INTO h FROM public.social_inbox_hours WHERE (tenant_id,connection_id)=(p_tenant,j.connection_id) FOR SHARE;
  IF coalesce(h.version,0) IS DISTINCT FROM p_policy THEN RETURN 'outside_hours'; END IF;
  IF j.recipient_key IS NOT NULL AND (j.recipient_key,j.prefix,j.policy_version,j.request_hash) IS DISTINCT FROM (p_recipient,p_variant,p_policy,p_request_hash)
    THEN RETURN 'ineligible'; END IF;
  IF j.step='primary' THEN
    IF EXISTS (SELECT 1 FROM public.social_auto_dm_jobs x WHERE (x.tenant_id,x.connection_id,x.event_id)=(p_tenant,j.connection_id,j.event_id)
      AND x.id<>j.id AND x.step='primary' AND x.first_attempt_at IS NOT NULL) THEN RETURN 'cooldown'; END IF;
    IF EXISTS (SELECT 1 FROM public.social_auto_dm_jobs x WHERE (x.tenant_id,x.rule_id,x.recipient_key)=(p_tenant,j.rule_id,p_recipient)
      AND x.id<>j.id AND x.step='primary' AND x.first_attempt_at>now()-make_interval(mins=>coalesce((r.rule->>'cooldownMinutes')::integer,43200)))
    THEN RETURN 'cooldown'; END IF;
    cutoff := pg_catalog.now() - interval '24 hours';
    IF (SELECT count(*) FROM public.social_auto_dm_jobs x WHERE (x.tenant_id,x.rule_id)=(p_tenant,j.rule_id)
          AND x.id<>j.id AND x.step='primary' AND x.first_attempt_at>=cutoff) >= coalesce((r.rule->>'ruleDaily')::integer,0)
       OR (SELECT count(*) FROM public.social_auto_dm_jobs x WHERE (x.tenant_id,x.rule_id,x.recipient_key)=(p_tenant,j.rule_id,p_recipient)
          AND x.id<>j.id AND x.step='primary' AND x.first_attempt_at>=cutoff) >= coalesce((r.rule->>'recipientDaily')::integer,0)
    THEN RETURN 'limit'; END IF;
  END IF;
  UPDATE public.social_auto_dm_jobs SET state='dispatching',recipient_key=p_recipient,prefix=p_variant,policy_version=p_policy,request_hash=p_request_hash,attempts=attempts+1,
    first_attempt_at=coalesce(first_attempt_at,clock_timestamp())
  WHERE (tenant_id,id,lease)=(p_tenant,p_job,p_lease) AND state='leased' AND leased_until>clock_timestamp()
    AND p_deadline>clock_timestamp() AND attempts<3;
  RETURN CASE WHEN FOUND THEN 'dispatch' ELSE 'ineligible' END;
END $function$;
--> statement-breakpoint
-- 2. Community write limits (0129) no longer apply to the community's owner, admins (hosts) and moderators: the same active-membership role
--    test as community_is_host and the moderation definers, applied to the row's own author column, which the definers set from app.user_id.
--    Members keep the limits. The trigger stays SECURITY INVOKER and sets no app.* flag: it runs inside the caller's (definer's) scope and
--    clearing that scope here would break the calling definer. Same body as 0129 otherwise.
CREATE OR REPLACE FUNCTION public.community_write_rate_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_actor text := pg_catalog.to_jsonb(NEW) ->> TG_ARGV[0]; v_limit integer := TG_ARGV[1]::integer; v_count integer;
BEGIN
  IF v_actor IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.community_memberships m WHERE m.tenant_id = NEW.tenant_id AND m.community_id = NEW.community_id
      AND m.user_id = v_actor AND m.status = 'active' AND m.role IN ('owner', 'admin', 'moderator')) THEN RETURN NEW; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('community_write_rate:' || TG_TABLE_NAME || ':' || NEW.community_id::text || ':' || v_actor));
  EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I WHERE community_id = $1 AND %I = $2 AND created_at > pg_catalog.now() - interval ''10 minutes''',
    TG_TABLE_NAME, TG_ARGV[0]) INTO v_count USING NEW.community_id, v_actor;
  IF v_count >= v_limit THEN RAISE EXCEPTION 'community_rate_limited' USING ERRCODE = 'P0429'; END IF;
  RETURN NEW;
END $$;
