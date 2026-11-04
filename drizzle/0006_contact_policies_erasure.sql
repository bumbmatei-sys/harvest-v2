-- Custom tenant policies, grants and controlled consent erasure. Schema is generated separately.
-- Tenant context is transaction-local and derived from server-verified membership.
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY contacts_tenant ON contacts TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE contact_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_identifiers FORCE ROW LEVEL SECURITY;
CREATE POLICY identifiers_tenant ON contact_identifiers TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE contact_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY consents_tenant ON contact_consents TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON contacts TO harvest_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_identifiers TO harvest_app;
GRANT SELECT, INSERT ON contact_consents TO harvest_app;
--> statement-breakpoint
-- Consent is an evidence ledger. Changes append another event, never edit history.
CREATE FUNCTION reject_consent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'contact_consents are append-only'; END $$;
CREATE TRIGGER consent_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON contact_consents
  FOR EACH STATEMENT EXECUTE FUNCTION reject_consent_mutation();

--> statement-breakpoint
-- The definer is the migration owner, never harvest_app. Explicit tenant policies also
-- cover an owner without BYPASSRLS (e.g. Neon); FORCE RLS is never disabled.
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['contacts', 'contact_identifiers', 'contact_consents', 'workspace_members', 'audit_logs'] LOOP
    EXECUTE format($policy$CREATE POLICY erasure_owner_tenant ON public.%I TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, relation_name, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.erase_contact(p_tenant uuid, p_contact uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); erased_time timestamptz;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501'; END IF;
  SELECT erased_at INTO erased_time FROM public.contacts WHERE tenant_id = p_tenant AND id = p_contact FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF erased_time IS NOT NULL THEN RETURN true; END IF;
  UPDATE public.contacts SET name = 'Erased contact', notes = '', erased_at = now(), updated_at = now() WHERE tenant_id = p_tenant AND id = p_contact;
  DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = p_contact;
  -- Re-key and detach proof so old contact/audit identifiers cannot reconnect it.
  UPDATE public.contact_consents SET id = gen_random_uuid(), contact_id = NULL, recorded_by = NULL,
    channel = NULL, source = NULL, evidence = NULL, redacted_at = now()
    WHERE tenant_id = p_tenant AND contact_id = p_contact;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id)
    VALUES (p_tenant, actor, 'contact.erase', p_contact::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.erase_contact(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_contact(uuid, uuid) TO harvest_app;
--> statement-breakpoint
-- No mutable session flag bypasses append-only protection. Only the fixed definer
-- may redact, and only after erasure, without changing any historical consent fact.
CREATE FUNCTION public.guard_consent_redaction() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure))
    OR OLD.redacted_at IS NOT NULL OR NEW.redacted_at IS NULL
    OR NEW.contact_id IS NOT NULL OR NEW.recorded_by IS NOT NULL OR NEW.channel IS NOT NULL
    OR NEW.source IS NOT NULL OR NEW.evidence IS NOT NULL
    OR (NEW.tenant_id, NEW.status, NEW.purpose, NEW.notice_version, NEW.occurred_at, NEW.recorded_at)
       IS DISTINCT FROM (OLD.tenant_id, OLD.status, OLD.purpose, OLD.notice_version, OLD.occurred_at, OLD.recorded_at)
    OR NOT EXISTS (SELECT 1 FROM public.contacts WHERE tenant_id = OLD.tenant_id AND id = OLD.contact_id AND erased_at IS NOT NULL)
  THEN RAISE EXCEPTION 'contact_consents are append-only except controlled erasure'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consent_redaction_only BEFORE UPDATE ON public.contact_consents FOR EACH ROW EXECUTE FUNCTION public.guard_consent_redaction();
DROP TRIGGER consent_append_only ON public.contact_consents;
CREATE TRIGGER consent_append_only BEFORE DELETE OR TRUNCATE ON public.contact_consents FOR EACH STATEMENT EXECUTE FUNCTION public.reject_consent_mutation();
--> statement-breakpoint
-- Lock parent rows to serialize writes against erasure, including direct SQL paths.
CREATE FUNCTION public.guard_contact_child() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
  IF TG_TABLE_NAME = 'contact_consents' THEN
    IF NEW.recorded_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') OR NEW.recorded_by IS NULL
      OR NEW.redacted_at IS NOT NULL OR NEW.purpose = 'legacy_unspecified' OR NEW.notice_version = 'legacy-unversioned'
    THEN RAISE EXCEPTION 'invalid consent provenance'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consent_provenance BEFORE INSERT ON public.contact_consents FOR EACH ROW EXECUTE FUNCTION public.guard_contact_child();
CREATE TRIGGER identifier_live_contact BEFORE INSERT OR UPDATE ON public.contact_identifiers FOR EACH ROW EXECUTE FUNCTION public.guard_contact_child();
--> statement-breakpoint
CREATE FUNCTION public.guard_erased_contact() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.erased_at IS NOT NULL THEN RAISE EXCEPTION 'erased contacts cannot be changed'; END IF;
  IF NEW.erased_at IS NOT NULL AND
    (NEW.name <> 'Erased contact' OR NEW.notes <> '' OR current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure)))
  THEN RAISE EXCEPTION 'use controlled erasure'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contact_erasure_guard BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.guard_erased_contact();
-- Runtime privileges remain SELECT/INSERT only on the ledger; no DELETE on contacts.
REVOKE UPDATE, DELETE, TRUNCATE ON public.contact_consents FROM harvest_app;
