-- CRM-04 tenant policies, grants, guards and erasure. Schema is generated in 0015.
ALTER TABLE crm_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipelines FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_pipelines_tenant ON crm_pipelines TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipeline_stages FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_stages_tenant ON crm_pipeline_stages TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunities_tenant ON opportunities TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- No DELETE grants: pipelines, stages and deals are archived, never deleted.
GRANT SELECT, INSERT ON crm_pipelines TO harvest_app;
GRANT UPDATE (name, is_default, position, archived_at, version, updated_at) ON crm_pipelines TO harvest_app;
GRANT SELECT, INSERT ON crm_pipeline_stages TO harvest_app;
GRANT UPDATE (name, probability, color, position, archived_at, version, updated_at) ON crm_pipeline_stages TO harvest_app;
GRANT SELECT, INSERT ON opportunities TO harvest_app;
GRANT UPDATE (name, stage_id, amount, currency, expected_close_date, owner_user_id, company_id, contact_id, position, closed_reason, stage_changed_at, archived_at, version, updated_at) ON opportunities TO harvest_app;
--> statement-breakpoint
-- The erasure definer unlinks erased people from deals in the tenant (and the deal
-- guard it fires reads the deal's stage).
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['opportunities', 'crm_pipeline_stages'] LOOP
    EXECUTE format($policy$CREATE POLICY erasure_owner_tenant ON public.%I TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, relation_name, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
-- Pipelines: provenance from the verified user; identity immutable.
CREATE FUNCTION public.guard_crm_pipeline() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid pipeline provenance'; END IF;
  ELSIF (NEW.tenant_id, NEW.id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'pipeline identity is immutable';
  ELSIF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL AND EXISTS (
      SELECT 1 FROM public.opportunities o WHERE o.tenant_id = NEW.tenant_id AND o.pipeline_id = NEW.id AND o.archived_at IS NULL) THEN
    RAISE EXCEPTION 'pipeline has deals';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_pipeline_guard BEFORE INSERT OR UPDATE ON public.crm_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_pipeline();
--> statement-breakpoint
-- Stages: key, kind and pipeline are immutable; a stage with live deals cannot be
-- archived (deals must be moved first, so none is ever orphaned).
CREATE FUNCTION public.guard_crm_pipeline_stage() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid stage provenance'; END IF;
    PERFORM 1 FROM public.crm_pipelines WHERE tenant_id = NEW.tenant_id AND id = NEW.pipeline_id AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pipeline is unavailable'; END IF;
  ELSIF (NEW.tenant_id, NEW.id, NEW.pipeline_id, NEW.key, NEW.kind, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.pipeline_id, OLD.key, OLD.kind, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'stage identity is immutable';
  ELSIF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL AND EXISTS (
      SELECT 1 FROM public.opportunities o WHERE o.tenant_id = NEW.tenant_id AND o.stage_id = NEW.id AND o.archived_at IS NULL) THEN
    RAISE EXCEPTION 'stage has deals';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_pipeline_stage_guard BEFORE INSERT OR UPDATE ON public.crm_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_pipeline_stage();
--> statement-breakpoint
-- Deals: provenance; immutable identity and pipeline (no cross-pipeline moves); a
-- new or changed stage must be live; a closed reason only on terminal stages; the
-- person must be live and the owner a member of this workspace.
CREATE FUNCTION public.guard_opportunity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE stage record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid deal provenance'; END IF;
    PERFORM 1 FROM public.crm_pipelines WHERE tenant_id = NEW.tenant_id AND id = NEW.pipeline_id AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'pipeline is unavailable'; END IF;
  ELSIF (NEW.tenant_id, NEW.id, NEW.pipeline_id, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.pipeline_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'deal identity is immutable';
  END IF;
  SELECT kind, archived_at INTO stage FROM public.crm_pipeline_stages
    WHERE tenant_id = NEW.tenant_id AND pipeline_id = NEW.pipeline_id AND id = NEW.stage_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stage is unavailable'; END IF;
  IF stage.archived_at IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id) THEN RAISE EXCEPTION 'stage is archived'; END IF;
  IF stage.kind = 'open' AND NEW.closed_reason IS NOT NULL THEN RAISE EXCEPTION 'closed reason needs a closed stage'; END IF;
  IF NEW.contact_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.contact_id IS DISTINCT FROM OLD.contact_id) THEN
    PERFORM 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
  END IF;
  IF NEW.owner_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id) THEN
    PERFORM 1 FROM public.workspace_members WHERE tenant_id = NEW.tenant_id AND user_id = NEW.owner_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'owner is not a member'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER opportunity_guard BEFORE INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.guard_opportunity();
--> statement-breakpoint
-- CRM-04 erasure: identical to 0014 plus unlinking the person from deals.
CREATE OR REPLACE FUNCTION public.erase_contact(p_tenant uuid, p_contact uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); erased_time timestamptz; tombstone uuid := gen_random_uuid();
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501'; END IF;
  SELECT erased_at INTO erased_time FROM public.contacts WHERE tenant_id = p_tenant AND id = p_contact FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF erased_time IS NULL THEN
    UPDATE public.contacts SET name = 'Erased contact', notes = '', erased_at = now(), updated_at = now() WHERE tenant_id = p_tenant AND id = p_contact;
    DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = p_contact;
  END IF;
  DELETE FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = p_contact;
  -- CRM-04: deals survive (they are the organisation's business records) but lose
  -- the person link before the re-key; the version bump makes open editors stale.
  UPDATE public.opportunities SET contact_id = NULL, version = version + 1, updated_at = now()
    WHERE tenant_id = p_tenant AND contact_id = p_contact;
  -- CRM-03: the person's own custom values, relation values pointing at them, and
  -- saved-view filters naming them all go; no surviving row may reference the person.
  DELETE FROM public.crm_field_values WHERE tenant_id = p_tenant AND (contact_id = p_contact OR relation_contact_id = p_contact);
  UPDATE public.crm_saved_views v SET state = jsonb_set(v.state, '{filters}', coalesce((
      SELECT jsonb_agg(f) FROM jsonb_array_elements(v.state->'filters') f WHERE position(p_contact::text in f::text) = 0), '[]'::jsonb))
    WHERE v.tenant_id = p_tenant AND jsonb_typeof(v.state->'filters') = 'array' AND position(p_contact::text in (v.state->'filters')::text) > 0;
  UPDATE public.audit_logs a SET target_id = NULL, metadata = '{}'::jsonb
    WHERE a.tenant_id = p_tenant AND (a.action LIKE 'contact.%' OR a.action LIKE 'consent.%')
      AND (a.target_id = p_contact::text OR a.metadata->>'contactId' = p_contact::text OR EXISTS (
        SELECT 1 FROM public.contact_consents s WHERE s.tenant_id = p_tenant AND s.contact_id = p_contact
          AND (a.target_id = s.id::text OR a.metadata->>'consentId' = s.id::text)
      ));
  SET CONSTRAINTS public.contact_consents_tenant_id_contact_id_contacts_tenant_id_id_fk DEFERRED;
  UPDATE public.contact_consents SET id = gen_random_uuid(), contact_id = tombstone, recorded_by = NULL,
    channel = NULL, source = NULL, evidence = NULL,
    recorded_at = date_trunc('day', recorded_at, 'UTC'),
    occurred_at = least(date_trunc('day', occurred_at, 'UTC'), date_trunc('day', recorded_at, 'UTC')),
    redacted_at = date_trunc('day', now(), 'UTC')
    WHERE tenant_id = p_tenant AND contact_id = p_contact;
  UPDATE public.contacts SET id = tombstone,
    created_at = date_trunc('day', created_at, 'UTC'), updated_at = date_trunc('day', updated_at, 'UTC'),
    erased_at = date_trunc('day', erased_at, 'UTC') WHERE tenant_id = p_tenant AND id = p_contact;
  SET CONSTRAINTS public.contact_consents_tenant_id_contact_id_contacts_tenant_id_id_fk IMMEDIATE;
  IF erased_time IS NOT NULL THEN RETURN true; END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id)
    VALUES (p_tenant, actor, 'contact.erase', NULL);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.erase_contact(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_contact(uuid, uuid) TO harvest_app;
