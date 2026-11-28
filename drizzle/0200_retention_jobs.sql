CREATE TABLE public.retention_rule_status (
  rule text PRIMARY KEY,
  interval_hours integer NOT NULL CHECK (interval_hours > 0),
  last_run_at timestamptz,
  last_error_code text,
  incident_claimed_at timestamptz
);
INSERT INTO public.retention_rule_status (rule, interval_hours)
SELECT rule, 24 FROM unnest(ARRAY[
  'connect_responses','connect_tombstones','hosted_form_responses','verified_contact_review','closed_followup_cases',
  'newsletter_deliveries','newsletter_clicks','newsletter_automation_clicks','community_applications',
  'community_channel_messages','community_direct_messages','audit_logs','retention_run_logs'
]) AS rule;

CREATE TABLE public.retention_rule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule text NOT NULL CONSTRAINT retention_rule_runs_rule_retention_rule_status_rule_fk REFERENCES public.retention_rule_status(rule),
  finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  deleted integer NOT NULL CHECK (deleted >= 0),
  anonymised integer NOT NULL CHECK (anonymised >= 0),
  flagged integer NOT NULL CHECK (flagged >= 0),
  error_code text CHECK (error_code IN ('row_failed','batch_limit','database_error'))
);
CREATE INDEX retention_rule_runs_expiry ON public.retention_rule_runs(finished_at, id);

-- Keep evidence that a response was verified independently of the response's short-lived tombstone.
CREATE TABLE public.retention_contact_reviews (
  tenant_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  verified_at timestamptz NOT NULL,
  review_due boolean NOT NULL DEFAULT false,
  CONSTRAINT retention_contact_reviews_tenant_id_contact_id_pk PRIMARY KEY (tenant_id, contact_id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES public.contacts(tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE
);
--> statement-breakpoint
DO $$
DECLARE patch record; def text; updated text;
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    ('public.blog_scope_clear()', '''app.connect_retention'','),
    ('public.account_self_reset()', '''app.connect_retention'','),
    ('public.community_definer_reset()', '''app.account_export'',')
  ) AS p(signature, needle)
  LOOP
    def := pg_get_functiondef(patch.signature::regprocedure);
    updated := replace(def, patch.needle, patch.needle || '''app.retention_jobs'',');
    IF length(updated) - length(def) <> length('''app.retention_jobs'',') THEN
      RAISE EXCEPTION 'Expected one retention scope anchor in %', patch.signature;
    END IF;
    EXECUTE updated;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['retention_rule_status','retention_rule_runs','retention_contact_reviews'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, harvest_app', relation);
    EXECUTE format($p$CREATE POLICY retention_owner ON public.%I TO %I
      USING (current_setting('app.retention_jobs',true) = 'on')
      WITH CHECK (current_setting('app.retention_jobs',true) = 'on')$p$, relation, current_user);
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['contacts','contact_consents','crm_notes','crm_tasks','crm_associations','contact_source_events','campaign_responses'] LOOP
    EXECUTE format($p$CREATE POLICY retention_read ON public.%I FOR SELECT TO %I
      USING (current_setting('app.retention_jobs',true) = 'on')$p$, relation, current_user);
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['crm_form_responses','followup_cases','audit_logs','platform_staff_audit','connect_retention_runs',
                                   'newsletter_retention_runs','community_chat_purge_runs'] LOOP
    EXECUTE format($p$CREATE POLICY retention_read ON public.%I FOR SELECT TO %I
      USING (current_setting('app.retention_jobs',true) = 'on')$p$, relation, current_user);
    EXECUTE format($p$CREATE POLICY retention_delete ON public.%I FOR DELETE TO %I
      USING (current_setting('app.retention_jobs',true) = 'on')$p$, relation, current_user);
    EXECUTE format($p$CREATE POLICY retention_lock ON public.%I FOR UPDATE TO %I
      USING (current_setting('app.retention_jobs',true) = 'on') WITH CHECK (false)$p$, relation, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
-- Associate only after Connect has verified the recipient. Account-only claims have no CRM consent row.
CREATE FUNCTION public.retention_track_verified_contact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb;
BEGIN
  prior := public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.retention_jobs','on',true);
  INSERT INTO public.retention_contact_reviews(tenant_id, contact_id, verified_at)
  VALUES (NEW.tenant_id, NEW.contact_id, NEW.associated_at)
  ON CONFLICT (tenant_id, contact_id) DO UPDATE SET verified_at = greatest(public.retention_contact_reviews.verified_at, EXCLUDED.verified_at),
    review_due = false;
  PERFORM public.blog_scope_restore(prior - 'app.retention_jobs');
  PERFORM set_config('app.retention_jobs','',true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.retention_track_verified_contact() FROM PUBLIC, harvest_app;
CREATE TRIGGER retention_track_verified_contact AFTER UPDATE OF status ON public.campaign_responses
  FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status = 'associated')
  EXECUTE FUNCTION public.retention_track_verified_contact();
--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('app.retention_jobs','on',true);
  INSERT INTO public.retention_contact_reviews (tenant_id, contact_id, verified_at)
  SELECT tenant_id, contact_id, max(verified_at) FROM (
    SELECT tenant_id, contact_id, associated_at AS verified_at FROM public.campaign_responses WHERE status = 'associated'
    UNION ALL
    SELECT tenant_id, contact_id, recorded_at FROM public.contact_consents
      WHERE notice_version = 'connect-immutable' AND redacted_at IS NULL
  ) verified GROUP BY tenant_id, contact_id;
  PERFORM set_config('app.retention_jobs','',true);
END $$;
--> statement-breakpoint
-- Erasure removes the review marker in the transaction that rekeys the contact.
CREATE FUNCTION public.retention_forget_erased_contact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb;
BEGIN
  prior := public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.retention_jobs','on',true);
  DELETE FROM public.retention_contact_reviews WHERE tenant_id = NEW.tenant_id AND contact_id IN (OLD.id, NEW.id);
  PERFORM public.blog_scope_restore(prior - 'app.retention_jobs');
  PERFORM set_config('app.retention_jobs','',true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.retention_forget_erased_contact() FROM PUBLIC, harvest_app;
CREATE TRIGGER retention_forget_erased_contact AFTER UPDATE OF erased_at ON public.contacts
  FOR EACH ROW WHEN (OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL)
  EXECUTE FUNCTION public.retention_forget_erased_contact();
--> statement-breakpoint
-- Transfer verified status in the existing merge transaction before the source is erased.
CREATE FUNCTION public.retention_move_verified_contact(p_tenant uuid, p_target uuid, p_source uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.retention_jobs','on',true);
  INSERT INTO public.retention_contact_reviews(tenant_id, contact_id, verified_at)
    SELECT tenant_id, p_target, verified_at FROM public.retention_contact_reviews
    WHERE tenant_id = p_tenant AND contact_id = p_source
  ON CONFLICT (tenant_id, contact_id) DO UPDATE SET verified_at = greatest(public.retention_contact_reviews.verified_at, EXCLUDED.verified_at),
    review_due = false;
  PERFORM set_config('app.retention_jobs','',true);
END $$;
REVOKE ALL ON FUNCTION public.retention_move_verified_contact(uuid,uuid,uuid) FROM PUBLIC, harvest_app;
DO $$
DECLARE def text; updated text;
  needle constant text := 'PERFORM public.erase_contact(p_tenant, p_source);';
  added constant text := 'PERFORM public.retention_move_verified_contact(p_tenant, p_target, p_source); ';
BEGIN
  def := pg_get_functiondef('public.merge_contacts_before_nl02(uuid,uuid,uuid)'::regprocedure);
  updated := replace(def, needle, added || needle);
  IF length(updated) - length(def) <> length(added) THEN
    RAISE EXCEPTION 'Expected one contact merge erasure hook';
  END IF;
  EXECUTE updated;
END $$;
--> statement-breakpoint
-- Retention is a bounded exception to the append-only audit and response-scrub guards.
CREATE OR REPLACE FUNCTION public.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND session_user = 'harvest_worker' AND current_user <> session_user
    AND current_setting('app.retention_jobs',true) = 'on' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'audit_logs are append-only';
END $$;
--> statement-breakpoint
DO $$
DECLARE def text; updated text;
  needle constant text := 'IF TG_OP = ''DELETE'' THEN';
  replacement constant text := 'IF TG_OP = ''DELETE'' THEN
    IF session_user = ''harvest_worker'' AND current_user <> session_user
      AND current_setting(''app.retention_jobs'',true) = ''on'' AND OLD.state = ''closed''
      AND OLD.state_changed_at <= now() - interval ''12 months'' THEN RETURN OLD; END IF;';
BEGIN
  def := pg_get_functiondef('public.guard_followup_case()'::regprocedure);
  updated := replace(def, needle, replacement);
  IF length(updated) - length(def) <> length(replacement) - length(needle) THEN
    RAISE EXCEPTION 'Expected one follow-up deletion guard';
  END IF;
  EXECUTE updated;
END $$;
--> statement-breakpoint
CREATE INDEX retention_audit_expiry ON public.audit_logs(created_at, id);
CREATE INDEX retention_platform_audit_expiry ON public.platform_staff_audit(created_at, id);
CREATE INDEX retention_followup_closed ON public.followup_cases(state_changed_at, tenant_id, id) WHERE state = 'closed';
--> statement-breakpoint
-- Reuse 0043's row handling and legacy entry point. The consolidated runner can select either lane
-- so an error in one rule does not make the other rule fail its health check.
DO $$
DECLARE patch record; def text; updated text;
BEGIN
  def := pg_get_functiondef('public.connect_retention_sweep(integer)'::regprocedure);
  FOR patch IN SELECT * FROM (VALUES
    ('WHERE status IN (''pending'', ''associated'') AND expires_at <= now()', 'connect_tombstones'),
    ('WHERE status = ''erased'' AND erased_at <= now() - make_interval(days => v_tombstone_days)', 'connect_responses')
  ) AS p(needle, excluded_rule)
  LOOP
    updated := replace(def, patch.needle, replace(patch.needle, 'WHERE ',
      format('WHERE current_setting(''app.retention_jobs'', true) IS DISTINCT FROM %L AND ', patch.excluded_rule)));
    IF length(updated) - length(def) <> length(format('current_setting(''app.retention_jobs'', true) IS DISTINCT FROM %L AND ', patch.excluded_rule)) THEN
      RAISE EXCEPTION 'Expected one Connect retention lane for %', patch.excluded_rule;
    END IF;
    def := updated;
  END LOOP;
  EXECUTE def;
END $$;
--> statement-breakpoint
-- Only the enclosing worker definer can call this invoker helper. It reuses the established purges and anonymisers.
CREATE FUNCTION public.retention_rule_batch(p_rule text, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE deleted integer := 0; anonymised integer := 0; flagged integer := 0; more integer := 0;
  outcome jsonb; relation text; time_field text;
  -- Founder decision 28 Nov 2026: gift, payment and consent audit records are kept 10 years; every other
  -- audit row (audit_logs and platform_staff_audit) is deleted after 12 months. The class is an explicit
  -- allow-list derived from the actions the code writes; docs/acceptance/retention-jobs.md mirrors it.
  kept_10y_exact constant text[] := ARRAY[
    -- Consent history
    'contact.consent_record',            -- CRM consent grants and withdrawals
    'association.record',                -- verified Connect claim linked to a CRM person
    'followup.case.withdraw',            -- follow-up consent withdrawal propagated to a case
    'newsletter.signup.confirmed',       -- double opt-in confirmation
    'newsletter.subscription.set',       -- list subscribe or unsubscribe with its consent reference
    'newsletter.subscriber.create',      -- subscriber source record
    'newsletter.subscriber.update',      -- suppression changes
    'newsletter.withdrawal.propagated',  -- newsletter withdrawal applied to CRM consent
    'community.email_unsubscribe',       -- community email withdrawal
    'community.email_prefs'              -- community email consent preferences
  ];
  kept_10y_prefix constant text[] := ARRAY[
    'giving.',                           -- gifts, corrections, pledges, ways to give, donor reads, giving standing and reports
    'fundraising.',                      -- fundraising campaigns and give pages
    'ministry.payments.',                -- ministry payment account connect, sync, disconnect and pricing
    'connect.response.',                 -- Connect consent withdrawal, erasure and purge
    'newsletter.unsubscribe.'            -- one-click unsubscribe (all lists or one list)
  ];
BEGIN
  CASE p_rule
  WHEN 'connect_responses','connect_tombstones' THEN
    PERFORM set_config('app.retention_jobs',p_rule,true);
    outcome := public.connect_retention_sweep(p_limit);
    PERFORM set_config('app.retention_jobs','on',true);
    RETURN outcome;
  WHEN 'hosted_form_responses' THEN
    WITH candidates AS (
      SELECT tenant_id,id FROM public.crm_form_responses WHERE expires_at <= now()
      ORDER BY expires_at,tenant_id,id LIMIT p_limit FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.crm_form_responses t USING candidates c WHERE (t.tenant_id,t.id) = (c.tenant_id,c.id);
    GET DIAGNOSTICS deleted = ROW_COUNT;
  WHEN 'verified_contact_review' THEN
    WITH candidates AS (
      SELECT r.tenant_id, r.contact_id, activity.due
      FROM public.retention_contact_reviews r
      JOIN public.contacts c ON (c.tenant_id,c.id) = (r.tenant_id,r.contact_id)
      CROSS JOIN LATERAL (SELECT greatest(c.updated_at, r.verified_at,
        (SELECT max(greatest(n.occurred_at,n.recorded_at)) FROM public.contact_consents n WHERE (n.tenant_id,n.contact_id) = (c.tenant_id,c.id) AND n.redacted_at IS NULL),
        (SELECT max(n.updated_at) FROM public.crm_notes n WHERE (n.tenant_id,n.contact_id) = (c.tenant_id,c.id)),
        (SELECT max(n.updated_at) FROM public.crm_tasks n WHERE (n.tenant_id,n.contact_id) = (c.tenant_id,c.id)),
        (SELECT max(greatest(n.occurred_at,n.created_at)) FROM public.crm_associations n WHERE (n.tenant_id,n.contact_id) = (c.tenant_id,c.id) AND n.redacted_at IS NULL),
        (SELECT max(n.occurred_at) FROM public.contact_source_events n WHERE (n.tenant_id,n.contact_id) = (c.tenant_id,c.id) AND n.reverted_at IS NULL)
      ) <= now() - interval '24 months' AS due) activity
      WHERE c.erased_at IS NULL AND r.review_due IS DISTINCT FROM activity.due
      ORDER BY r.tenant_id, r.contact_id LIMIT p_limit FOR UPDATE OF r SKIP LOCKED
    ), changed AS (
      UPDATE public.retention_contact_reviews r SET review_due = c.due FROM candidates c
      WHERE (r.tenant_id,r.contact_id) = (c.tenant_id,c.contact_id) RETURNING r.review_due
    )
    SELECT count(*)::integer, count(*) FILTER (WHERE review_due)::integer INTO more, flagged FROM changed;
  WHEN 'closed_followup_cases' THEN
    WITH candidates AS (
      SELECT tenant_id,id FROM public.followup_cases WHERE state = 'closed' AND state_changed_at <= now() - interval '12 months'
      ORDER BY state_changed_at,tenant_id,id LIMIT p_limit FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.followup_cases t USING candidates c WHERE (t.tenant_id,t.id) = (c.tenant_id,c.id);
    GET DIAGNOSTICS deleted = ROW_COUNT;
  WHEN 'newsletter_deliveries' THEN
    anonymised := public.newsletter_purge_deliveries(p_limit);
  WHEN 'newsletter_clicks' THEN
    anonymised := public.newsletter_purge_clicks(p_limit);
  WHEN 'newsletter_automation_clicks' THEN
    anonymised := public.newsletter_purge_automation_clicks(p_limit);
  WHEN 'community_applications' THEN
    deleted := public.community_purge_applications(p_limit);
  WHEN 'community_channel_messages' THEN
    deleted := (public.community_chat_purge_channels(p_limit)->>'deleted')::integer;
  WHEN 'community_direct_messages' THEN
    outcome := public.community_chat_purge_dm(p_limit);
    deleted := (outcome->>'deleted')::integer + (outcome->>'conversations')::integer + (outcome->>'evidence')::integer;
    more := (outcome->>'expired')::integer + (outcome->>'reminded')::integer;
  WHEN 'audit_logs' THEN
    FOREACH relation IN ARRAY ARRAY['audit_logs','platform_staff_audit'] LOOP
      EXECUTE format('WITH candidates AS (SELECT ctid FROM public.%1$I WHERE created_at <= now() - interval ''12 months''
          AND (created_at <= now() - interval ''10 years''
            OR NOT (action = ANY($2) OR EXISTS (SELECT FROM unnest($3) AS kept(prefix) WHERE starts_with(action, kept.prefix))))
          ORDER BY created_at, ctid LIMIT $1 FOR UPDATE SKIP LOCKED)
        DELETE FROM public.%1$I t USING candidates c WHERE t.ctid = c.ctid', relation)
        USING p_limit, kept_10y_exact, kept_10y_prefix;
      GET DIAGNOSTICS more = ROW_COUNT;
      deleted := deleted + more;
    END LOOP;
    more := 0;
  WHEN 'retention_run_logs' THEN
    FOR relation, time_field IN
      SELECT t.relation, t.time_field FROM (VALUES
        ('retention_rule_runs','finished_at'), ('connect_retention_runs','finished_at'),
        ('newsletter_retention_runs','ran_at'), ('community_chat_purge_runs','created_at')
      ) AS t(relation,time_field)
    LOOP
      EXECUTE format('WITH candidates AS (SELECT ctid FROM public.%1$I WHERE %2$I <= now() - interval ''90 days'' ORDER BY %2$I, ctid LIMIT $1 FOR UPDATE SKIP LOCKED)
        DELETE FROM public.%1$I t USING candidates c WHERE t.ctid = c.ctid', relation, time_field)
        USING p_limit;
      GET DIAGNOSTICS more = ROW_COUNT;
      deleted := deleted + more;
    END LOOP;
    more := 0;
  END CASE;
  RETURN jsonb_build_object('deleted',deleted,'anonymised',anonymised,'flagged',flagged,'more',deleted+anonymised+more);
END $$;
REVOKE ALL ON FUNCTION public.retention_rule_batch(text,integer) FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.retention_run_rule(p_rule text, p_record_failure boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE started timestamptz := clock_timestamp(); elapsed integer;
DECLARE deleted integer := 0; anonymised integer := 0; flagged integer := 0;
DECLARE outcome jsonb; error_code text;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM public.community_definer_reset();
  IF session_user <> 'harvest_worker' OR p_rule IS NULL THEN RAISE insufficient_privilege; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('retention:' || p_rule, 0));
  PERFORM set_config('app.retention_jobs','on',true);
  IF NOT EXISTS (SELECT FROM public.retention_rule_status WHERE rule = p_rule) THEN RAISE invalid_parameter_value; END IF;
  IF p_record_failure THEN error_code := 'database_error'; END IF;
  FOR batch IN 1..CASE WHEN p_record_failure THEN 0 ELSE 50 END LOOP
    BEGIN
      PERFORM set_config('app.retention_jobs','on',true);
      outcome := public.retention_rule_batch(p_rule, 250);
      deleted := deleted + (outcome->>'deleted')::integer;
      anonymised := anonymised + coalesce((outcome->>'anonymised')::integer,(outcome->>'erased')::integer);
      flagged := flagged + coalesce((outcome->>'flagged')::integer,0);
      IF coalesce((outcome->>'failed')::integer,0) > 0 THEN error_code := 'row_failed'; EXIT; END IF;
      IF coalesce((outcome->>'more')::integer,(outcome->>'deleted')::integer + (outcome->>'erased')::integer) = 0 THEN EXIT; END IF;
      IF batch = 50 THEN error_code := 'batch_limit'; END IF;
    EXCEPTION WHEN OTHERS THEN
      error_code := 'database_error';
      EXIT;
    END;
  END LOOP;
  -- Some existing purges reset the community flags when they return.
  PERFORM set_config('app.retention_jobs','on',true);
  elapsed := round(extract(epoch FROM clock_timestamp() - started) * 1000)::integer;
  INSERT INTO public.retention_rule_runs(rule,duration_ms,deleted,anonymised,flagged,error_code)
    VALUES (p_rule, elapsed, deleted, anonymised, flagged, error_code);
  UPDATE public.retention_rule_status SET last_run_at = clock_timestamp(), last_error_code = error_code,
    incident_claimed_at = CASE WHEN error_code IS NULL THEN NULL ELSE incident_claimed_at END
    WHERE rule = p_rule;
  PERFORM set_config('app.retention_jobs','',true);
  RETURN jsonb_build_object('rule',p_rule,'deleted',deleted,'anonymised',anonymised,'flagged',flagged,'durationMs',elapsed,'errorCode',error_code);
END $$;
REVOKE ALL ON FUNCTION public.retention_run_rule(text,boolean) FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.retention_job_health(p_claim boolean)
RETURNS TABLE(rule_name text, last_run_at timestamptz, error_code text, stale boolean, alert_claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM public.community_definer_reset();
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.retention_jobs','on',true);
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.retention_rule_status r SET incident_claimed_at = clock_timestamp()
      WHERE p_claim AND r.incident_claimed_at IS NULL
        AND (r.last_error_code IS NOT NULL OR r.last_run_at IS NULL OR r.last_run_at < now() - make_interval(hours => 2*r.interval_hours))
      RETURNING r.rule
  )
  SELECT r.rule, r.last_run_at, r.last_error_code,
    r.last_run_at IS NULL OR r.last_run_at < now() - make_interval(hours => 2*r.interval_hours),
    c.rule IS NOT NULL
  FROM public.retention_rule_status r LEFT JOIN claimed c ON r.rule = c.rule ORDER BY r.rule;
  PERFORM set_config('app.retention_jobs','',true);
END $$;
REVOKE ALL ON FUNCTION public.retention_job_health(boolean) FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN RETURN; END IF;
  IF EXISTS (SELECT FROM pg_roles r WHERE r.rolname = 'harvest_worker'
    AND (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication
      OR EXISTS (SELECT FROM pg_auth_members WHERE member = r.oid)))
  THEN RAISE EXCEPTION 'harvest_worker must be unprivileged'; END IF;
  GRANT EXECUTE ON FUNCTION public.retention_run_rule(text,boolean), public.retention_job_health(boolean) TO harvest_worker;
END $$;
