-- Physical CRM access is separate from the consent ledger's privileged text.
-- The grant on safe columns applies to all app connections. Only the fixed
-- definer below reads source and evidence under a checked owner/admin session.
REVOKE SELECT ON public.contact_consents FROM harvest_app;
GRANT SELECT (tenant_id, id, contact_id, channel, status, purpose, notice_version,
  recorded_by, occurred_at, recorded_at, redacted_at) ON public.contact_consents TO harvest_app;

DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['contacts', 'contact_identifiers', 'contact_consents'] LOOP
    EXECUTE format($policy$CREATE POLICY crm_visibility ON public.%I AS RESTRICTIVE FOR SELECT TO harvest_app USING (
      EXISTS (SELECT FROM public.workspace_members m
        WHERE m.tenant_id = %I.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
        AND (m.role_id IN ('owner', 'admin', 'member')
          OR (m.role_id = 'collaborator' AND public.access_role(m.tenant_id, m.user_id, 'crm', m.role_id) IN ('viewer', 'admin'))))
    )$policy$, relation_name, relation_name);
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['contact_source_events', 'contact_first_sources', 'contact_form_sources'] LOOP
    EXECUTE format($policy$CREATE POLICY crm_source_visibility ON public.%I AS RESTRICTIVE FOR SELECT TO harvest_app USING (
      EXISTS (SELECT FROM public.workspace_members m
        WHERE m.tenant_id = %I.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
        AND m.role_id IN ('owner', 'admin'))
    )$policy$, relation_name, relation_name);
  END LOOP;
END $$;

CREATE FUNCTION public.crm_consent_evidence(p_tenant uuid, p_contact uuid)
RETURNS TABLE(id uuid, source text, evidence text)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  -- The owner RLS policies already constrain these reads to the caller's tenant.
  IF actor IS NULL OR p_tenant IS DISTINCT FROM nullif(pg_catalog.current_setting('app.tenant_id', true), '')::uuid THEN RETURN; END IF;
  IF NOT EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = p_tenant
    AND m.user_id = actor AND m.role_id IN ('owner', 'admin')) THEN RETURN; END IF;
  RETURN QUERY SELECT c.id, c.source, c.evidence FROM public.contact_consents c
    WHERE c.tenant_id = p_tenant AND c.contact_id = p_contact AND c.redacted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.crm_consent_evidence(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_consent_evidence(uuid, uuid) TO harvest_app;
--> statement-breakpoint
-- The source-label capability must use the stored role, just like source RLS.
DO $$
DECLARE def text; patched text;
  old_role text := $old$public.access_role(tenant_id, user_id, 'crm', role_id) IN ('owner','admin')$old$;
  new_role text := $new$role_id IN ('owner','admin')$new$;
BEGIN
  def := pg_catalog.pg_get_functiondef('public.contact_connect_source_label(uuid,uuid)'::regprocedure);
  patched := pg_catalog.replace(def, old_role, new_role);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(new_role) - pg_catalog.length(old_role) THEN
    RAISE EXCEPTION 'contact_connect_source_label: expected exactly one role check';
  END IF;
  EXECUTE patched;
END $$;
--> statement-breakpoint
CREATE TABLE public.crm_rights_requests (
  tenant_id uuid NOT NULL REFERENCES public.workspaces(tenant_id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  handler_id text REFERENCES public.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('access', 'erasure', 'correction')),
  verification text NOT NULL CHECK (verification IN ('pending', 'verified', 'failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  deadline timestamptz NOT NULL,
  outcome text CHECK (outcome IN ('fulfilled', 'refused', 'withdrawn')),
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  CHECK (deadline >= received_at),
  CHECK ((outcome IS NULL) = (closed_at IS NULL)),
  CHECK (outcome IS DISTINCT FROM 'fulfilled' OR verification = 'verified')
);
ALTER TABLE public.crm_rights_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_rights_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_rights_requests FROM PUBLIC, harvest_app;
GRANT SELECT, INSERT, UPDATE ON public.crm_rights_requests TO harvest_app;
CREATE POLICY crm_rights_requests_staff ON public.crm_rights_requests TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = crm_rights_requests.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND handler_id = nullif(current_setting('app.user_id', true), '')
    AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = crm_rights_requests.tenant_id
      AND m.user_id = handler_id AND m.role_id IN ('owner', 'admin')));

CREATE FUNCTION public.crm_audit_rights_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- Account removal nulls the handler through the FK without identifying that user in a fresh audit row.
  IF TG_OP = 'UPDATE' AND NEW.handler_id IS NULL
    AND (pg_catalog.to_jsonb(NEW) - 'handler_id') = (pg_catalog.to_jsonb(OLD) - 'handler_id') THEN RETURN NEW; END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (NEW.tenant_id, NEW.handler_id, CASE TG_OP WHEN 'INSERT' THEN 'privacy.rights_create' ELSE 'privacy.rights_update' END,
      NEW.id::text, pg_catalog.jsonb_build_object('version', NEW.version::text, 'type', NEW.kind,
        'verification', NEW.verification, 'outcome', coalesce(NEW.outcome, 'open')));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_audit_rights_change() FROM PUBLIC;
CREATE TRIGGER crm_audit_rights_change AFTER INSERT OR UPDATE ON public.crm_rights_requests
  FOR EACH ROW EXECUTE FUNCTION public.crm_audit_rights_change();

CREATE TABLE public.audit_retention_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  succeeded boolean NOT NULL,
  audit_deleted integer NOT NULL CHECK (audit_deleted BETWEEN 0 AND 1000),
  rights_deleted integer NOT NULL CHECK (rights_deleted BETWEEN 0 AND 1000)
);
ALTER TABLE public.audit_retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_retention_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_retention_runs FROM PUBLIC, harvest_app;
CREATE INDEX audit_retention_due ON public.audit_logs (created_at, id);
CREATE INDEX crm_rights_retention_due ON public.crm_rights_requests (closed_at, tenant_id, id) WHERE closed_at IS NOT NULL;
--> statement-breakpoint
DO $retention$
DECLARE target text; def text; patched text;
  old_entry text := '''app.event_cover_cleanup'',';
  new_entry text := '''app.audit_retention'',''app.event_cover_cleanup'',';
  worker_scope text := $p$session_user = 'harvest_worker' AND current_setting('app.audit_retention', true) = 'on'$p$;
BEGIN
  FOREACH target IN ARRAY ARRAY['public.blog_scope_clear()', 'public.account_self_reset()'] LOOP
    def := pg_catalog.pg_get_functiondef(target::regprocedure);
    patched := pg_catalog.replace(def, old_entry, new_entry);
    IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(new_entry) - pg_catalog.length(old_entry) THEN
      RAISE EXCEPTION '%: expected exactly one event cover cleanup entry', target;
    END IF;
    EXECUTE patched;
  END LOOP;
  EXECUTE format('CREATE POLICY audit_retention_read ON public.audit_logs FOR SELECT TO %I USING (%s AND created_at < statement_timestamp() - interval ''12 months'')', current_user, worker_scope);
  EXECUTE format('CREATE POLICY audit_retention_delete ON public.audit_logs FOR DELETE TO %I USING (%s AND created_at < statement_timestamp() - interval ''12 months'')', current_user, worker_scope);
  EXECUTE format('CREATE POLICY rights_retention_read ON public.crm_rights_requests FOR SELECT TO %I USING (%s AND closed_at < statement_timestamp() - interval ''3 years'')', current_user, worker_scope);
  EXECUTE format('CREATE POLICY rights_retention_delete ON public.crm_rights_requests FOR DELETE TO %I USING (%s AND closed_at < statement_timestamp() - interval ''3 years'')', current_user, worker_scope);
  EXECUTE format('CREATE POLICY audit_retention_log ON public.audit_retention_runs TO %I USING (%s) WITH CHECK (%s)', current_user, worker_scope, worker_scope);
  EXECUTE format($policy$CREATE FUNCTION public.audit_retention_guard_delete() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $body$
    BEGIN
      IF session_user = 'harvest_worker' AND current_user = %L AND current_setting('app.audit_retention', true) = 'on'
        AND OLD.created_at < statement_timestamp() - interval '12 months' THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'audit_logs are append-only';
    END $body$$policy$, current_user);
END $retention$;
DROP TRIGGER audit_append_only ON public.audit_logs;
CREATE TRIGGER audit_append_only BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER audit_retention_guard_delete BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_retention_guard_delete();
REVOKE ALL ON FUNCTION public.audit_retention_guard_delete() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.audit_retention_run(p_limit integer, p_record_failure boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := pg_catalog.current_setting('app.audit_retention', true);
  audits integer := 0; rights integer := 0;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_record_failure IS NULL THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.audit_retention', 'on', true);
  IF NOT p_record_failure THEN
    WITH due AS (
      SELECT id FROM public.audit_logs WHERE created_at < pg_catalog.statement_timestamp() - interval '12 months'
      ORDER BY created_at, id LIMIT p_limit
    )
    DELETE FROM public.audit_logs a USING due WHERE a.id = due.id;
    GET DIAGNOSTICS audits = ROW_COUNT;
    WITH due AS (
      SELECT tenant_id, id FROM public.crm_rights_requests WHERE closed_at < pg_catalog.statement_timestamp() - interval '3 years'
      ORDER BY closed_at, tenant_id, id LIMIT p_limit
    )
    DELETE FROM public.crm_rights_requests r USING due WHERE r.tenant_id = due.tenant_id AND r.id = due.id
      AND r.closed_at < pg_catalog.statement_timestamp() - interval '3 years';
    GET DIAGNOSTICS rights = ROW_COUNT;
  END IF;
  INSERT INTO public.audit_retention_runs (succeeded, audit_deleted, rights_deleted) VALUES (NOT p_record_failure, audits, rights);
  DELETE FROM public.audit_retention_runs WHERE finished_at < pg_catalog.statement_timestamp() - interval '90 days';
  PERFORM pg_catalog.set_config('app.audit_retention', coalesce(prior, ''), true);
  RETURN pg_catalog.jsonb_build_object('audits', audits, 'rightsRequests', rights);
END $$;

CREATE FUNCTION public.audit_retention_health() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := pg_catalog.current_setting('app.audit_retention', true); healthy boolean;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM pg_catalog.set_config('app.audit_retention', 'on', true);
  SELECT succeeded AND finished_at > pg_catalog.statement_timestamp() - interval '26 hours'
    INTO healthy FROM public.audit_retention_runs ORDER BY finished_at DESC, id DESC LIMIT 1;
  PERFORM pg_catalog.set_config('app.audit_retention', coalesce(prior, ''), true);
  RETURN coalesce(healthy, false);
END $$;
REVOKE ALL ON FUNCTION public.audit_retention_run(integer, boolean), public.audit_retention_health() FROM PUBLIC, harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.audit_retention_run(integer, boolean), public.audit_retention_health() TO harvest_worker;
  END IF;
END $$;
