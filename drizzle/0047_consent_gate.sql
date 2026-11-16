-- HC-DEC1b: the association insert guard mirrors the service gate. A newsletter permission counts toward an association only
-- when it was recorded for the email channel; a withdrawal on any channel still blocks (unchanged). Engineering default,
-- UNAPPROVED pending legal review; nothing here collects data, sends anything or enables delivery.
-- Re-runnable: CREATE OR REPLACE keeps the owner, grants and the existing trigger; FORCE RLS is untouched.
CREATE OR REPLACE FUNCTION public.guard_crm_association() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid association provenance'; END IF;
    PERFORM 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
    -- The grant must still be in force on its channel: a later "unknown" or withdrawal there replaces it,
    -- exactly as on the record page (latest event per channel, ordered by both clocks, then id).
    PERFORM 1 FROM public.contact_consents c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.consent_id
      AND c.contact_id = NEW.contact_id AND c.purpose = NEW.purpose AND c.status = 'granted' AND c.redacted_at IS NULL
      -- HC-DEC1b (engineering default, UNAPPROVED): a newsletter grant counts only on the email channel, as in the service gate.
      AND (c.purpose <> 'newsletter' OR c.channel = 'email')
      AND NOT EXISTS (SELECT 1 FROM public.contact_consents l WHERE l.tenant_id = c.tenant_id AND l.contact_id = c.contact_id
        AND l.channel = c.channel AND l.purpose = c.purpose AND l.status <> 'granted' AND l.redacted_at IS NULL
        AND (l.recorded_at, l.occurred_at, l.id) > (c.recorded_at, c.occurred_at, c.id));
    IF NOT FOUND THEN RAISE EXCEPTION 'consent required for this purpose'; END IF;
    IF EXISTS (SELECT 1 FROM public.contact_consents w WHERE w.tenant_id = NEW.tenant_id AND w.contact_id = NEW.contact_id
        AND w.purpose = NEW.purpose AND w.status = 'withdrawn' AND NOT EXISTS (
          SELECT 1 FROM public.contact_consents g WHERE g.tenant_id = w.tenant_id AND g.contact_id = w.contact_id AND g.channel = w.channel
            AND g.purpose = w.purpose AND g.status = 'granted' AND g.recorded_at > w.recorded_at AND g.occurred_at > w.occurred_at)) THEN
      RAISE EXCEPTION 'consent required for this purpose';
    END IF;
    RETURN NEW;
  END IF;
  -- Updates come only from definers: erasure scrubs text, a merge moves the person.
  IF (NEW.tenant_id, NEW.id, NEW.company_id, NEW.source, NEW.kind, NEW.purpose, NEW.consent_id, NEW.external_id, NEW.occurred_at, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.company_id, OLD.source, OLD.kind, OLD.purpose, OLD.consent_id, OLD.external_id, OLD.occurred_at, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'association identity is immutable';
  END IF;
  -- coalesce: an unset merge setting must fail closed, never compare as NULL and slip through.
  IF NEW.contact_id IS DISTINCT FROM OLD.contact_id AND NOT coalesce(
      current_user = pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.merge_contacts(uuid,uuid,uuid)'::regprocedure))
      AND OLD.contact_id::text = coalesce(current_setting('app.merge_source', true), ''), false) THEN
    RAISE EXCEPTION 'association identity is immutable';
  END IF;
  IF (NEW.summary, NEW.payload, NEW.redacted_at) IS DISTINCT FROM (OLD.summary, OLD.payload, OLD.redacted_at) AND NOT (
      NEW.summary = '' AND NEW.payload = '{}'::jsonb AND NEW.redacted_at IS NOT NULL
      AND current_user = pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure))) THEN
    RAISE EXCEPTION 'association content changes only through erasure';
  END IF;
  RETURN NEW;
END $$;
