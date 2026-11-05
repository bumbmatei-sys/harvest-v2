-- CRM-01 tenant policies, grants and erasure. Schema is generated in 0011.
-- Context is transaction-local and derived from server-verified membership.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY companies_tenant ON companies TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE contact_company_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_company_links FORCE ROW LEVEL SECURITY;
CREATE POLICY company_links_tenant ON contact_company_links TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- Companies are never hard-deleted by the runtime; link rows are removable relations.
GRANT SELECT, INSERT ON companies TO harvest_app;
GRANT UPDATE (name, domain, description, version, updated_at) ON companies TO harvest_app;
GRANT SELECT, INSERT, DELETE ON contact_company_links TO harvest_app;
GRANT UPDATE (title, is_primary) ON contact_company_links TO harvest_app;
--> statement-breakpoint
-- The erasure definer (migration owner, never harvest_app) must remove links under FORCE RLS.
DO $$ BEGIN
  EXECUTE format($policy$CREATE POLICY erasure_owner_tenant ON public.contact_company_links TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, current_user);
END $$;
--> statement-breakpoint
-- Links may only reference a live contact, serialized against erasure by a share lock.
-- Actor provenance comes from the verified transaction user, not request data.
CREATE FUNCTION public.guard_company_link() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
  IF TG_OP = 'INSERT' AND NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN
    RAISE EXCEPTION 'invalid link provenance';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.contact_id, NEW.company_id, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.contact_id, OLD.company_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'company link identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_link_live_contact BEFORE INSERT OR UPDATE ON public.contact_company_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_link();
--> statement-breakpoint
CREATE FUNCTION public.guard_company_provenance() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN
    RAISE EXCEPTION 'invalid company provenance';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_provenance BEFORE INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_provenance();
--> statement-breakpoint
-- Erasure additionally removes the person's company relationships before re-keying,
-- so no surviving row associates an organization with the erased person. Audit
-- events for those links are contact.* actions targeting the contact and are
-- unlinked by the existing statement below.
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
