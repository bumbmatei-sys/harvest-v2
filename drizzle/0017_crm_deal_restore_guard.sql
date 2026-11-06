-- CRM-04 review fix: a deal can only be live in a live stage of a live pipeline.
-- Restoring an archived deal (archived_at -> NULL) now locks and checks its stage and
-- pipeline, in the same order the archive paths take, so a concurrent archive and
-- restore can never leave a live deal under an archived parent. Otherwise identical
-- to the 0016 guard.
CREATE OR REPLACE FUNCTION public.guard_opportunity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE stage record; becomes_live boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid deal provenance'; END IF;
  ELSIF (NEW.tenant_id, NEW.id, NEW.pipeline_id, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.pipeline_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'deal identity is immutable';
  END IF;
  becomes_live := NEW.archived_at IS NULL AND (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL);
  SELECT kind, archived_at INTO stage FROM public.crm_pipeline_stages
    WHERE tenant_id = NEW.tenant_id AND pipeline_id = NEW.pipeline_id AND id = NEW.stage_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stage is unavailable'; END IF;
  IF stage.archived_at IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN RAISE EXCEPTION 'stage is archived'; END IF;
    IF becomes_live THEN RAISE EXCEPTION 'restore the stage first'; END IF;
  END IF;
  IF becomes_live OR TG_OP = 'INSERT' THEN
    PERFORM 1 FROM public.crm_pipelines WHERE tenant_id = NEW.tenant_id AND id = NEW.pipeline_id AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'pipeline is unavailable'; END IF;
      RAISE EXCEPTION 'restore the pipeline first';
    END IF;
  END IF;
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
