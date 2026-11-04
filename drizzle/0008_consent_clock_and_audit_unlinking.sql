ALTER TABLE "audit_logs" ALTER COLUMN "target_id" DROP NOT NULL;
--> statement-breakpoint
-- The recording clock belongs to PostgreSQL, including direct app-role inserts.
CREATE OR REPLACE FUNCTION public.guard_contact_child() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
  IF TG_TABLE_NAME = 'contact_consents' THEN
    NEW.recorded_at := now();
    IF NEW.recorded_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') OR NEW.recorded_by IS NULL
      OR NEW.redacted_at IS NOT NULL OR NEW.purpose = 'legacy_unspecified' OR NEW.notice_version = 'legacy-unversioned'
    THEN RAISE EXCEPTION 'invalid consent provenance'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- The only audit UPDATE is irreversible contact unlinking by the erasure definer.
-- No caller-controlled session flag bypasses the immutable audit facts.
CREATE FUNCTION public.guard_audit_contact_unlinking() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure))
    OR NEW.target_id IS NOT NULL OR NEW.metadata IS DISTINCT FROM '{}'::jsonb
    OR (NEW.id, NEW.tenant_id, NEW.actor_id, NEW.action, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.actor_id, OLD.action, OLD.created_at)
    OR NOT (OLD.action LIKE 'contact.%' OR OLD.action LIKE 'consent.%')
    OR NOT EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.tenant_id = OLD.tenant_id AND c.erased_at IS NOT NULL
        AND c.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND (OLD.target_id = c.id::text OR OLD.metadata->>'contactId' = c.id::text OR EXISTS (
          SELECT 1 FROM public.contact_consents s WHERE s.tenant_id = c.tenant_id AND s.contact_id = c.id
            AND (OLD.target_id = s.id::text OR OLD.metadata->>'consentId' = s.id::text)
        ))
    )
  THEN RAISE EXCEPTION 'audit_logs are append-only except controlled contact unlinking'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER audit_append_only ON public.audit_logs;
CREATE TRIGGER audit_contact_unlinking_only BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_audit_contact_unlinking();
CREATE TRIGGER audit_append_only BEFORE DELETE OR TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
--> statement-breakpoint
-- Defer the composite FK only inside erasure, until the parent is re-keyed.
ALTER TABLE public.contact_consents ALTER CONSTRAINT contact_consents_tenant_id_contact_id_contacts_tenant_id_id_fk DEFERRABLE;
ALTER TABLE public.contact_consents DROP CONSTRAINT consent_redaction;
ALTER TABLE public.contact_consents ADD CONSTRAINT consent_redaction CHECK (
  (redacted_at IS NULL AND contact_id IS NOT NULL AND channel IS NOT NULL AND source IS NOT NULL AND evidence IS NOT NULL)
  OR (redacted_at IS NOT NULL AND channel IS NULL AND source IS NULL AND evidence IS NULL AND recorded_by IS NULL)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_consent_redaction() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
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
CREATE OR REPLACE FUNCTION public.guard_erased_contact() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.erased_at IS NOT NULL THEN
    IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure))
      OR OLD.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid
      OR NEW.id = OLD.id
      OR (NEW.tenant_id, NEW.name, NEW.notes) IS DISTINCT FROM (OLD.tenant_id, OLD.name, OLD.notes)
      OR NEW.created_at IS DISTINCT FROM date_trunc('day', OLD.created_at, 'UTC')
      OR NEW.updated_at IS DISTINCT FROM date_trunc('day', OLD.updated_at, 'UTC')
      OR NEW.erased_at IS DISTINCT FROM date_trunc('day', OLD.erased_at, 'UTC')
      OR EXISTS (SELECT 1 FROM public.contact_consents WHERE tenant_id=OLD.tenant_id AND contact_id=OLD.id)
    THEN RAISE EXCEPTION 'erased contacts cannot be changed'; END IF;
  ELSIF NEW.erased_at IS NOT NULL AND
    (NEW.name <> 'Erased contact' OR NEW.notes <> '' OR current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure)))
  THEN RAISE EXCEPTION 'use controlled erasure'; END IF;
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
  -- Also repair audit links on an already-erased tombstone without another event.
  IF erased_time IS NULL THEN
    UPDATE public.contacts SET name = 'Erased contact', notes = '', erased_at = now(), updated_at = now() WHERE tenant_id = p_tenant AND id = p_contact;
    DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = p_contact;
  END IF;
  -- Remove the complete metadata payload: status/purpose can also identify a
  -- unique anonymous event by day. Capture consent IDs before re-keying them.
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
  -- The retained erasure event carries no contact identifier or metadata.
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id)
    VALUES (p_tenant, actor, 'contact.erase', NULL);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.erase_contact(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_contact(uuid, uuid) TO harvest_app;
--> statement-breakpoint
-- Historical 0006/0007 erasures left contact targets in audit history. Unlink
-- those as well, under the same tenant-scoped guard. Restore migration context.
DO $$ BEGIN
  EXECUTE format('CREATE POLICY migration_backfill ON public.contacts FOR SELECT TO %I USING (true)', current_user);
END $$;
--> statement-breakpoint
DO $$
DECLARE erased record; previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  FOR erased IN SELECT tenant_id, id FROM public.contacts WHERE erased_at IS NOT NULL LOOP
    PERFORM set_config('app.tenant_id', erased.tenant_id::text, true);
    UPDATE public.audit_logs SET target_id = NULL, metadata = '{}'::jsonb
      WHERE tenant_id = erased.tenant_id AND (action LIKE 'contact.%' OR action LIKE 'consent.%')
        AND (target_id = erased.id::text OR metadata->>'contactId' = erased.id::text);
    UPDATE public.contacts SET id=gen_random_uuid(), created_at=date_trunc('day',created_at,'UTC'),
      updated_at=date_trunc('day',updated_at,'UTC'), erased_at=date_trunc('day',erased_at,'UTC')
      WHERE tenant_id=erased.tenant_id AND id=erased.id;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
END $$;

DROP POLICY migration_backfill ON public.contacts;
