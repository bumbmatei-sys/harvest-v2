-- CRM-06 (ADR 0012): CSV import policies, batch rollback and explicit person merge.
-- Numbered 0023 after 0022_crm_imports; 0021 is reserved for the Campaign Wizard (CW-01).
ALTER TABLE crm_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_imports_tenant ON crm_imports TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE crm_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_import_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_import_rows_tenant ON crm_import_rows TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- No DELETE grants: imports are history; created records leave only through rollback_crm_import.
-- The CSV cells (raw) are never updatable by the app; only erasure empties them.
GRANT SELECT, INSERT ON crm_imports TO harvest_app;
GRANT UPDATE (mapping, on_match, status, stats, version, updated_at, previewed_at, completed_at) ON crm_imports TO harvest_app;
GRANT SELECT, INSERT ON crm_import_rows TO harvest_app;
GRANT UPDATE (match_keys, status, action, error, warning, contact_id, company_id, created, applied, result_version) ON crm_import_rows TO harvest_app;
--> statement-breakpoint
-- The definers (erasure, rollback, merge) act in the caller's tenant only.
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['crm_imports', 'crm_import_rows', 'companies', 'crm_field_definitions'] LOOP
    EXECUTE format($policy$CREATE POLICY erasure_owner_tenant ON public.%I TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, relation_name, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
-- Imports: provenance; the file, its headers and its row count never change.
CREATE FUNCTION public.guard_crm_import() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid import provenance'; END IF;
  ELSIF (NEW.tenant_id, NEW.id, NEW.entity, NEW.client_key, NEW.file_name, NEW.headers, NEW.row_count, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.entity, OLD.client_key, OLD.file_name, OLD.headers, OLD.row_count, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'import identity is immutable';
  ELSIF OLD.status = 'rolled_back' THEN
    RAISE EXCEPTION 'a rolled-back import is final';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_import_guard BEFORE INSERT OR UPDATE ON public.crm_imports
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_import();
--> statement-breakpoint
-- Import rows: the cells are immutable, except that erasure may empty them.
CREATE FUNCTION public.guard_crm_import_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.tenant_id, NEW.import_id, NEW.row_number) IS DISTINCT FROM (OLD.tenant_id, OLD.import_id, OLD.row_number) THEN
    RAISE EXCEPTION 'import row identity is immutable';
  END IF;
  IF NEW.raw IS DISTINCT FROM OLD.raw AND NOT (NEW.raw = '[]'::jsonb
    AND current_user = pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure))) THEN
    RAISE EXCEPTION 'import cells are immutable except controlled erasure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_import_row_guard BEFORE UPDATE ON public.crm_import_rows
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_import_row();
--> statement-breakpoint
-- Batch rollback. Records an import created are removed only if nobody has touched them
-- since (same version, no children of their own); "Fill empty fields" changes are reverted
-- only on records still at the version the import left. Everything else is kept and counted.
CREATE FUNCTION public.rollback_crm_import(p_tenant uuid, p_import uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); actor_role text; imp record; r record; v integer;
  removed integer := 0; reverted integer := 0; kept integer := 0;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'rollback access denied' USING ERRCODE = '42501';
  END IF;
  SELECT role_id INTO actor_role FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor FOR SHARE;
  SELECT * INTO imp FROM public.crm_imports WHERE tenant_id = p_tenant AND id = p_import FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF actor_role IS NULL OR NOT (actor_role IN ('owner', 'admin') OR (actor_role = 'member' AND imp.created_by = actor)) THEN
    RAISE EXCEPTION 'rollback access denied' USING ERRCODE = '42501';
  END IF;
  IF imp.status NOT IN ('completed', 'failed') THEN RAISE EXCEPTION 'import cannot be rolled back' USING ERRCODE = '55000'; END IF;
  FOR r IN SELECT * FROM public.crm_import_rows WHERE tenant_id = p_tenant AND import_id = p_import AND status = 'done' ORDER BY row_number DESC LOOP
    IF imp.entity = 'person' AND r.contact_id IS NOT NULL THEN
      SELECT version INTO v FROM public.contacts WHERE tenant_id = p_tenant AND id = r.contact_id AND erased_at IS NULL FOR UPDATE;
      IF NOT FOUND OR v IS DISTINCT FROM r.result_version THEN kept := kept + 1; CONTINUE; END IF;
      IF r.created THEN
        IF EXISTS (SELECT 1 FROM public.contact_consents WHERE tenant_id = p_tenant AND contact_id = r.contact_id)
          OR EXISTS (SELECT 1 FROM public.crm_tasks WHERE tenant_id = p_tenant AND contact_id = r.contact_id)
          OR EXISTS (SELECT 1 FROM public.crm_notes WHERE tenant_id = p_tenant AND contact_id = r.contact_id)
          OR EXISTS (SELECT 1 FROM public.opportunities WHERE tenant_id = p_tenant AND contact_id = r.contact_id)
          OR EXISTS (SELECT 1 FROM public.crm_field_values WHERE tenant_id = p_tenant AND (contact_id = r.contact_id OR relation_contact_id = r.contact_id))
          OR EXISTS (SELECT 1 FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = r.contact_id AND company_id::text IS DISTINCT FROM r.applied->>'companyId')
          OR EXISTS (SELECT 1 FROM public.crm_import_rows WHERE tenant_id = p_tenant AND contact_id = r.contact_id AND (import_id <> p_import OR row_number <> r.row_number)) THEN
          kept := kept + 1; CONTINUE;
        END IF;
        UPDATE public.crm_import_rows SET contact_id = NULL, status = 'rolled_back' WHERE tenant_id = p_tenant AND import_id = p_import AND row_number = r.row_number;
        DELETE FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = r.contact_id;
        DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = r.contact_id;
        DELETE FROM public.contacts WHERE tenant_id = p_tenant AND id = r.contact_id;
        removed := removed + 1;
      ELSIF r.applied IS NOT NULL THEN
        IF coalesce((r.applied->>'notes')::boolean, false) THEN
          UPDATE public.contacts SET notes = '' WHERE tenant_id = p_tenant AND id = r.contact_id;
        END IF;
        DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = r.contact_id
          AND kind IN (SELECT jsonb_array_elements_text(coalesce(r.applied->'identifiers', '[]'::jsonb)));
        IF coalesce((r.applied->>'linked')::boolean, false) THEN
          DELETE FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = r.contact_id AND company_id::text = r.applied->>'companyId';
        END IF;
        UPDATE public.contacts SET version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND id = r.contact_id;
        UPDATE public.crm_import_rows SET status = 'rolled_back' WHERE tenant_id = p_tenant AND import_id = p_import AND row_number = r.row_number;
        reverted := reverted + 1;
      END IF;
    ELSIF imp.entity = 'company' AND r.company_id IS NOT NULL THEN
      SELECT version INTO v FROM public.companies WHERE tenant_id = p_tenant AND id = r.company_id FOR UPDATE;
      IF NOT FOUND OR v IS DISTINCT FROM r.result_version THEN kept := kept + 1; CONTINUE; END IF;
      IF r.created THEN
        IF EXISTS (SELECT 1 FROM public.contact_company_links WHERE tenant_id = p_tenant AND company_id = r.company_id)
          OR EXISTS (SELECT 1 FROM public.opportunities WHERE tenant_id = p_tenant AND company_id = r.company_id)
          OR EXISTS (SELECT 1 FROM public.crm_tasks WHERE tenant_id = p_tenant AND company_id = r.company_id)
          OR EXISTS (SELECT 1 FROM public.crm_notes WHERE tenant_id = p_tenant AND company_id = r.company_id)
          OR EXISTS (SELECT 1 FROM public.crm_field_values WHERE tenant_id = p_tenant AND (company_id = r.company_id OR relation_company_id = r.company_id))
          OR EXISTS (SELECT 1 FROM public.crm_import_rows WHERE tenant_id = p_tenant AND company_id = r.company_id AND (import_id <> p_import OR row_number <> r.row_number)) THEN
          kept := kept + 1; CONTINUE;
        END IF;
        UPDATE public.crm_import_rows SET company_id = NULL, status = 'rolled_back' WHERE tenant_id = p_tenant AND import_id = p_import AND row_number = r.row_number;
        DELETE FROM public.companies WHERE tenant_id = p_tenant AND id = r.company_id;
        removed := removed + 1;
      ELSIF coalesce((r.applied->>'description')::boolean, false) THEN
        UPDATE public.companies SET description = '', version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND id = r.company_id;
        UPDATE public.crm_import_rows SET status = 'rolled_back' WHERE tenant_id = p_tenant AND import_id = p_import AND row_number = r.row_number;
        reverted := reverted + 1;
      END IF;
    END IF;
  END LOOP;
  UPDATE public.crm_imports SET status = 'rolled_back', rolled_back_at = now(), updated_at = now(), version = version + 1,
    stats = stats || jsonb_build_object('removed', removed, 'reverted', reverted, 'kept', kept)
    WHERE tenant_id = p_tenant AND id = p_import;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'crm.import.rolled_back', p_import::text,
      jsonb_build_object('removed', removed::text, 'reverted', reverted::text, 'kept', kept::text));
  RETURN jsonb_build_object('removed', removed, 'reverted', reverted, 'kept', kept);
END $$;
REVOKE ALL ON FUNCTION public.rollback_crm_import(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rollback_crm_import(uuid, uuid) TO harvest_app;
--> statement-breakpoint
-- Explicit person merge (owner/admin). The kept person gains the merged person's
-- identifiers it lacks, company links, consent events, tasks, notes, deals, custom
-- values it lacks and the relation values that pointed at the merged person; then
-- the merged person is erased through erase_contact, so no row keeps their old id.
CREATE FUNCTION public.merge_contacts(p_tenant uuid, p_target uuid, p_source uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); n_live integer;
  moved_identifiers integer; dropped_identifiers integer; moved_links integer; moved_consents integer;
  moved_tasks integer; moved_notes integer; moved_deals integer; moved_values integer; repointed_values integer; notes_taken boolean := false;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'merge access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge access denied' USING ERRCODE = '42501'; END IF;
  IF p_target = p_source THEN RAISE EXCEPTION 'a person cannot be merged into themselves' USING ERRCODE = '22023'; END IF;
  -- Lock both people in id order so concurrent merges cannot deadlock.
  PERFORM 1 FROM public.contacts WHERE tenant_id = p_tenant AND id IN (p_target, p_source) AND erased_at IS NULL ORDER BY id FOR UPDATE;
  SELECT count(*) INTO n_live FROM public.contacts WHERE tenant_id = p_tenant AND id IN (p_target, p_source) AND erased_at IS NULL;
  IF n_live <> 2 THEN RETURN NULL; END IF;
  PERFORM set_config('app.merge_source', p_source::text, true);
  WITH moved AS (
    UPDATE public.contact_identifiers s SET contact_id = p_target
    WHERE s.tenant_id = p_tenant AND s.contact_id = p_source
      AND NOT EXISTS (SELECT 1 FROM public.contact_identifiers t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.kind = s.kind)
    RETURNING 1) SELECT count(*) INTO moved_identifiers FROM moved;
  DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS dropped_identifiers = ROW_COUNT;
  INSERT INTO public.contact_company_links (tenant_id, contact_id, company_id, title, is_primary, created_by, created_at)
    SELECT p_tenant, p_target, l.company_id, l.title,
      l.is_primary AND NOT EXISTS (SELECT 1 FROM public.contact_company_links t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.is_primary),
      actor, l.created_at
    FROM public.contact_company_links l
    WHERE l.tenant_id = p_tenant AND l.contact_id = p_source
      AND NOT EXISTS (SELECT 1 FROM public.contact_company_links t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.company_id = l.company_id);
  GET DIAGNOSTICS moved_links = ROW_COUNT;
  DELETE FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = p_source;
  UPDATE public.contact_consents SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_consents = ROW_COUNT;
  UPDATE public.crm_tasks SET contact_id = p_target, version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_tasks = ROW_COUNT;
  UPDATE public.crm_notes SET contact_id = p_target, version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_notes = ROW_COUNT;
  UPDATE public.opportunities SET contact_id = p_target, version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_deals = ROW_COUNT;
  INSERT INTO public.crm_field_values (tenant_id, field_id, object_type, contact_id, value_text, value_number, value_date, value_boolean, value_options, relation_contact_id, relation_company_id, updated_by, updated_at)
    SELECT p_tenant, v.field_id, v.object_type, p_target, v.value_text, v.value_number, v.value_date, v.value_boolean, v.value_options,
      CASE WHEN v.relation_contact_id = p_source THEN p_target ELSE v.relation_contact_id END, v.relation_company_id, actor, now()
    FROM public.crm_field_values v JOIN public.crm_field_definitions d ON d.tenant_id = v.tenant_id AND d.id = v.field_id AND d.archived_at IS NULL
    WHERE v.tenant_id = p_tenant AND v.contact_id = p_source
      AND NOT EXISTS (SELECT 1 FROM public.crm_field_values t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.field_id = v.field_id);
  GET DIAGNOSTICS moved_values = ROW_COUNT;
  UPDATE public.crm_field_values v SET relation_contact_id = p_target, updated_by = actor, updated_at = now()
    FROM public.crm_field_definitions d
    WHERE v.tenant_id = p_tenant AND v.relation_contact_id = p_source AND v.contact_id IS DISTINCT FROM p_source
      AND d.tenant_id = v.tenant_id AND d.id = v.field_id AND d.archived_at IS NULL;
  GET DIAGNOSTICS repointed_values = ROW_COUNT;
  UPDATE public.contacts t SET notes = s.notes FROM public.contacts s
    WHERE t.tenant_id = p_tenant AND t.id = p_target AND s.tenant_id = p_tenant AND s.id = p_source AND t.notes = '' AND s.notes <> '';
  notes_taken := FOUND;
  UPDATE public.contacts SET version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND id = p_target;
  UPDATE public.crm_import_rows SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'contact.merge', p_target::text, jsonb_build_object(
      'identifiers', moved_identifiers::text, 'links', moved_links::text, 'consents', moved_consents::text,
      'tasks', moved_tasks::text, 'notes', moved_notes::text, 'deals', moved_deals::text, 'values', (moved_values + repointed_values)::text));
  PERFORM set_config('app.merge_source', '', true);
  -- The merged person's own record, history and leftovers leave through controlled erasure.
  PERFORM public.erase_contact(p_tenant, p_source);
  RETURN jsonb_build_object('identifiers', moved_identifiers, 'droppedIdentifiers', dropped_identifiers, 'links', moved_links,
    'consents', moved_consents, 'tasks', moved_tasks, 'notes', moved_notes, 'deals', moved_deals,
    'values', moved_values + repointed_values, 'notesCopied', notes_taken);
END $$;
REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid, uuid) TO harvest_app;
--> statement-breakpoint
-- Consent events move with a merge (the ledger stays complete, so any outstanding
-- withdrawal still wins). Only the merge definer may re-parent them; every fact is kept.
-- The erasure branch below is 0008's rule, unchanged.
CREATE OR REPLACE FUNCTION public.guard_consent_redaction() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user = pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.merge_contacts(uuid,uuid,uuid)'::regprocedure))
    AND OLD.contact_id IS NOT NULL AND NEW.contact_id IS NOT NULL AND OLD.contact_id IS DISTINCT FROM NEW.contact_id
    AND OLD.contact_id::text = coalesce(current_setting('app.merge_source', true), '')
    AND OLD.redacted_at IS NULL AND NEW.redacted_at IS NULL
    AND (NEW.tenant_id, NEW.id, NEW.recorded_by, NEW.purpose, NEW.notice_version, NEW.recorded_at, NEW.channel, NEW.status, NEW.source, NEW.evidence, NEW.occurred_at)
      IS NOT DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.recorded_by, OLD.purpose, OLD.notice_version, OLD.recorded_at, OLD.channel, OLD.status, OLD.source, OLD.evidence, OLD.occurred_at)
    AND EXISTS (SELECT 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL) THEN
    RETURN NEW;
  END IF;
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure))
    OR OLD.redacted_at IS NOT NULL OR NEW.redacted_at IS NULL
    OR NEW.contact_id IS NULL OR NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id OR NEW.recorded_by IS NOT NULL OR NEW.channel IS NOT NULL
    OR NEW.source IS NOT NULL OR NEW.evidence IS NOT NULL
    OR (NEW.tenant_id, NEW.status, NEW.purpose, NEW.notice_version)
       IS DISTINCT FROM (OLD.tenant_id, OLD.status, OLD.purpose, OLD.notice_version)
    OR NEW.recorded_at IS DISTINCT FROM date_trunc('day', OLD.recorded_at, 'UTC')
    OR NEW.occurred_at IS DISTINCT FROM least(date_trunc('day', OLD.occurred_at, 'UTC'), date_trunc('day', OLD.recorded_at, 'UTC'))
    OR NEW.redacted_at IS DISTINCT FROM date_trunc('day', now(), 'UTC')
    OR NOT EXISTS (SELECT 1 FROM public.contacts WHERE tenant_id = OLD.tenant_id AND id = OLD.contact_id AND erased_at IS NOT NULL)
  THEN RAISE EXCEPTION 'contact_consents are append-only except controlled erasure'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_crm_note() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid note provenance'; END IF;
    IF NEW.contact_id IS NOT NULL THEN
      PERFORM 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
    END IF;
    -- CRM-05 review (F3): no new note on an archived deal.
    IF NEW.opportunity_id IS NOT NULL THEN
      PERFORM 1 FROM public.opportunities WHERE tenant_id = NEW.tenant_id AND id = NEW.opportunity_id AND archived_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'deal is archived'; END IF;
    END IF;
  ELSIF (NEW.tenant_id, NEW.id, NEW.company_id, NEW.opportunity_id, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.company_id, OLD.opportunity_id, OLD.created_by, OLD.created_at)
    -- CRM-06: only the merge definer may move a person's note to the record it is merged into.
    -- coalesce: an unset merge setting must fail closed, never compare as NULL and slip through.
    OR (NEW.contact_id IS DISTINCT FROM OLD.contact_id AND NOT coalesce(
      current_user = pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.merge_contacts(uuid,uuid,uuid)'::regprocedure))
      AND OLD.contact_id IS NOT NULL AND NEW.contact_id IS NOT NULL
      AND OLD.contact_id::text = coalesce(current_setting('app.merge_source', true), ''), false)) THEN
    RAISE EXCEPTION 'note identity is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- CRM-06 erasure: 0020's version plus scrubbing CSV import rows about the person.
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
  -- CRM-06: CSV import rows about the person (matched or created by an import, or
  -- carrying one of their identifiers) lose their cells, keys and link before the
  -- identifiers below are deleted; the row keeps only its number and outcome codes.
  UPDATE public.crm_import_rows r SET raw = '[]'::jsonb, match_keys = '{}'::text[], contact_id = NULL
    WHERE r.tenant_id = p_tenant AND (r.contact_id = p_contact OR r.match_keys && ARRAY(
      SELECT i.kind || ':' || i.normalized_value FROM public.contact_identifiers i WHERE i.tenant_id = p_tenant AND i.contact_id = p_contact));
  IF erased_time IS NULL THEN
    UPDATE public.contacts SET name = 'Erased contact', notes = '', erased_at = now(), updated_at = now() WHERE tenant_id = p_tenant AND id = p_contact;
    DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = p_contact;
  END IF;
  DELETE FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = p_contact;
  -- CRM-04: deals survive (they are the organisation's business records) but lose
  -- the person link before the re-key; the version bump makes open editors stale.
  UPDATE public.opportunities SET contact_id = NULL, version = version + 1, updated_at = now()
    WHERE tenant_id = p_tenant AND contact_id = p_contact;
  -- CRM-05: tasks are the organisation's work and survive without the person link;
  -- notes about the person are deleted with them (free text may hold personal data);
  -- task and note audit rows lose the person's id so no timeline can reach them.
  UPDATE public.crm_tasks SET contact_id = NULL, version = version + 1, updated_at = now()
    WHERE tenant_id = p_tenant AND contact_id = p_contact;
  DELETE FROM public.crm_notes WHERE tenant_id = p_tenant AND contact_id = p_contact;
  UPDATE public.audit_logs a SET metadata = a.metadata - 'contactId'
    WHERE a.tenant_id = p_tenant AND (a.action LIKE 'task.%' OR a.action LIKE 'note.%') AND a.metadata->>'contactId' = p_contact::text;
  -- CRM-05 review (B1): CRM outbox events, and the jobs dispatched from them, carry the
  -- person's id in their payload. Null it in both, dispatched or not. Fingerprints are
  -- left as written: they guard idempotent producers, and a scrubbed event is never
  -- re-produced with the same key (task and note keys include the bumped version).
  UPDATE public.outbox_events SET payload = jsonb_set(payload, '{contactId}', 'null'::jsonb)
    WHERE tenant_id = p_tenant AND payload->>'contactId' = p_contact::text;
  UPDATE public.jobs SET payload = jsonb_set(payload, '{contactId}', 'null'::jsonb), updated_at = now()
    WHERE tenant_id = p_tenant AND payload->>'contactId' = p_contact::text;
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
