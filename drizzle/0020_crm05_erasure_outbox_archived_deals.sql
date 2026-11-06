-- CRM-05 review fixes (PR #15, round 1).
-- B1: contact erasure also removes the person's id from CRM outbox and job payloads.
-- F3: tasks and notes cannot be added to an archived deal (the service answers 409
-- parent_archived first; these guards are the backstop for any other writer).
-- 0019 is otherwise unchanged; both functions below are its versions plus the marked lines.

-- The erasure definer scrubs outbox and job payloads in the erased person's tenant only.
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['outbox_events', 'jobs'] LOOP
    EXECUTE format($policy$CREATE POLICY erasure_owner_tenant ON public.%I TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, relation_name, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_crm_task() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid task provenance'; END IF;
  ELSIF (NEW.tenant_id, NEW.id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'task identity is immutable';
  END IF;
  IF NEW.assignee_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id) THEN
    PERFORM 1 FROM public.workspace_members WHERE tenant_id = NEW.tenant_id AND user_id = NEW.assignee_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'assignee is not a member'; END IF;
  END IF;
  IF NEW.contact_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.contact_id IS DISTINCT FROM OLD.contact_id) THEN
    PERFORM 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
  END IF;
  -- CRM-05 review (F3): no new task on, or relink onto, an archived deal.
  IF NEW.opportunity_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id) THEN
    PERFORM 1 FROM public.opportunities WHERE tenant_id = NEW.tenant_id AND id = NEW.opportunity_id AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'deal is archived'; END IF;
  END IF;
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
  ELSIF (NEW.tenant_id, NEW.id, NEW.contact_id, NEW.company_id, NEW.opportunity_id, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.contact_id, OLD.company_id, OLD.opportunity_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'note identity is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
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
