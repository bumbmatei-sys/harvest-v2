-- CRM-05 tenant policies, grants, guards and erasure. Schema is generated in 0018.
ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_tasks_tenant ON crm_tasks TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_notes_tenant ON crm_notes TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- Notifications: anyone in the tenant may create one (for the assignee), but only the
-- recipient can see or mark their own, even through a raw query in the tenant.
ALTER TABLE crm_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_notifications_insert ON crm_notifications FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY crm_notifications_own ON crm_notifications FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND recipient_user_id = nullif(current_setting('app.user_id', true), ''));
CREATE POLICY crm_notifications_mark ON crm_notifications FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND recipient_user_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND recipient_user_id = nullif(current_setting('app.user_id', true), ''));
-- No DELETE grants: tasks and notes are archived; notifications are marked read.
GRANT SELECT, INSERT ON crm_tasks TO harvest_app;
GRANT UPDATE (title, body, status, priority, due_at, assignee_user_id, contact_id, company_id, opportunity_id, completed_at, archived_at, version, updated_at) ON crm_tasks TO harvest_app;
GRANT SELECT, INSERT ON crm_notes TO harvest_app;
GRANT UPDATE (body, edited_at, archived_at, version, updated_at) ON crm_notes TO harvest_app;
GRANT SELECT, INSERT ON crm_notifications TO harvest_app;
GRANT UPDATE (read_at) ON crm_notifications TO harvest_app;
--> statement-breakpoint
-- The erasure definer unlinks tasks and deletes notes about the erased person.
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['crm_tasks', 'crm_notes'] LOOP
    EXECUTE format($policy$CREATE POLICY erasure_owner_tenant ON public.%I TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, relation_name, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
-- Tasks: provenance; immutable identity; the assignee must be a member of this
-- workspace and a linked person must be live (same posture as the deal owner).
CREATE FUNCTION public.guard_crm_task() RETURNS trigger
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
  RETURN NEW;
END $$;
CREATE TRIGGER crm_task_guard BEFORE INSERT OR UPDATE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_task();
--> statement-breakpoint
-- Notes: provenance; a note never changes author, target or creation time; a new
-- note about a person needs that person to be live.
CREATE FUNCTION public.guard_crm_note() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid note provenance'; END IF;
    IF NEW.contact_id IS NOT NULL THEN
      PERFORM 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
    END IF;
  ELSIF (NEW.tenant_id, NEW.id, NEW.contact_id, NEW.company_id, NEW.opportunity_id, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.contact_id, OLD.company_id, OLD.opportunity_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'note identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_note_guard BEFORE INSERT OR UPDATE ON public.crm_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_note();
--> statement-breakpoint
-- Notifications: identity and recipient are immutable; only read_at changes.
CREATE FUNCTION public.guard_crm_notification() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.actor_user_id IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid notification provenance'; END IF;
    PERFORM 1 FROM public.workspace_members WHERE tenant_id = NEW.tenant_id AND user_id = NEW.recipient_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'recipient is not a member'; END IF;
  ELSIF (NEW.tenant_id, NEW.id, NEW.recipient_user_id, NEW.actor_user_id, NEW.kind, NEW.task_id, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.recipient_user_id, OLD.actor_user_id, OLD.kind, OLD.task_id, OLD.created_at) THEN
    RAISE EXCEPTION 'notification identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_guard BEFORE INSERT OR UPDATE ON public.crm_notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_notification();
--> statement-breakpoint
-- The audit ledger stays append-only. The only change to its guard (0008): besides
-- the existing contact./consent. unlinking, the erasure definer may remove the
-- erased person's id from task./note. rows, leaving everything else untouched.
CREATE OR REPLACE FUNCTION public.guard_audit_contact_unlinking() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure))
    OR (NEW.id, NEW.tenant_id, NEW.actor_id, NEW.action, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.actor_id, OLD.action, OLD.created_at) THEN
    RAISE EXCEPTION 'audit_logs are append-only except controlled contact unlinking';
  END IF;
  IF OLD.action LIKE 'contact.%' OR OLD.action LIKE 'consent.%' THEN
    -- Unchanged from 0008.
    IF NEW.target_id IS NOT NULL OR NEW.metadata IS DISTINCT FROM '{}'::jsonb OR NOT EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.tenant_id = OLD.tenant_id AND c.erased_at IS NOT NULL
        AND c.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND (OLD.target_id = c.id::text OR OLD.metadata->>'contactId' = c.id::text OR EXISTS (
          SELECT 1 FROM public.contact_consents s WHERE s.tenant_id = c.tenant_id AND s.contact_id = c.id
            AND (OLD.target_id = s.id::text OR OLD.metadata->>'consentId' = s.id::text)
        ))
    ) THEN RAISE EXCEPTION 'audit_logs are append-only except controlled contact unlinking'; END IF;
    RETURN NEW;
  END IF;
  IF (OLD.action LIKE 'task.%' OR OLD.action LIKE 'note.%')
    AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
    AND OLD.metadata ? 'contactId' AND NEW.metadata = OLD.metadata - 'contactId'
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.tenant_id = OLD.tenant_id AND c.erased_at IS NOT NULL
        AND c.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND OLD.metadata->>'contactId' = c.id::text
    ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs are append-only except controlled contact unlinking';
END $$;
--> statement-breakpoint
-- CRM-05 erasure: identical to 0016 plus unlinking tasks, deleting notes about the
-- person, and stripping the person's id from task and note audit metadata.
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
