-- CRM-03 tenant policies, grants, guards and erasure. Schema is generated in 0013.
ALTER TABLE crm_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_field_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_fields_tenant ON crm_field_definitions TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE crm_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_field_values FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_values_tenant ON crm_field_values TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- Personal views are visible only to their owner, even to a raw query in the tenant.
ALTER TABLE crm_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_saved_views FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_views_visible ON crm_saved_views TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND (owner_user_id IS NULL OR owner_user_id = nullif(current_setting('app.user_id', true), '')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND (owner_user_id IS NULL OR owner_user_id = nullif(current_setting('app.user_id', true), '')));
GRANT SELECT, INSERT ON crm_field_definitions TO harvest_app;
GRANT UPDATE (label, description, required, options, position, archived_at, version, updated_at) ON crm_field_definitions TO harvest_app;
GRANT SELECT, INSERT, DELETE ON crm_field_values TO harvest_app;
GRANT UPDATE (value_text, value_number, value_date, value_boolean, value_options, relation_contact_id, relation_company_id, updated_by, updated_at) ON crm_field_values TO harvest_app;
GRANT SELECT, INSERT, DELETE ON crm_saved_views TO harvest_app;
GRANT UPDATE (name, owner_user_id, state, version, updated_at) ON crm_saved_views TO harvest_app;
--> statement-breakpoint
-- The erasure definer must see and clean every row of these tables in the tenant.
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['crm_field_values', 'crm_saved_views'] LOOP
    EXECUTE format($policy$CREATE POLICY erasure_owner_tenant ON public.%I TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, relation_name, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
-- Definitions: provenance from the verified user; key, type, object and relation target are immutable.
CREATE FUNCTION public.guard_crm_field_definition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid field provenance'; END IF;
  ELSIF (NEW.tenant_id, NEW.id, NEW.object_type, NEW.key, NEW.type, NEW.relation_target, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.object_type, OLD.key, OLD.type, OLD.relation_target, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'field identity is immutable';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.options) o
      WHERE jsonb_typeof(o) <> 'object' OR coalesce(o->>'value', '') !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
        OR length(btrim(coalesce(o->>'label', ''))) NOT BETWEEN 1 AND 60)
    OR (SELECT count(DISTINCT o->>'value') FROM jsonb_array_elements(NEW.options) o) <> jsonb_array_length(NEW.options) THEN
    RAISE EXCEPTION 'invalid field options';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_field_definition_guard BEFORE INSERT OR UPDATE ON public.crm_field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_field_definition();
--> statement-breakpoint
-- Values: the stored column must match the definition's type, options and relation
-- target; archived fields accept no new values; the record must be live (not erased).
CREATE FUNCTION public.guard_crm_field_value() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE def record; matches boolean;
BEGIN
  SELECT type, options, relation_target, archived_at INTO def FROM public.crm_field_definitions
    WHERE tenant_id = NEW.tenant_id AND id = NEW.field_id AND object_type = NEW.object_type FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'field is unavailable'; END IF;
  IF def.archived_at IS NOT NULL THEN RAISE EXCEPTION 'field is archived'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.id, NEW.field_id, NEW.object_type, NEW.contact_id, NEW.company_id)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.field_id, OLD.object_type, OLD.contact_id, OLD.company_id) THEN
    RAISE EXCEPTION 'value identity is immutable';
  END IF;
  IF NEW.updated_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid value provenance'; END IF;
  IF NEW.contact_id IS NOT NULL THEN
    PERFORM 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
  END IF;
  IF NEW.relation_contact_id IS NOT NULL THEN
    PERFORM 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.relation_contact_id AND erased_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'related contact is unavailable'; END IF;
  END IF;
  matches := CASE def.type
      WHEN 'text' THEN NEW.value_text IS NOT NULL
      WHEN 'number' THEN NEW.value_number IS NOT NULL AND NEW.value_number NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
      WHEN 'date' THEN NEW.value_date IS NOT NULL
      WHEN 'boolean' THEN NEW.value_boolean IS NOT NULL
      WHEN 'select' THEN NEW.value_options IS NOT NULL AND cardinality(NEW.value_options) = 1
      WHEN 'multi_select' THEN NEW.value_options IS NOT NULL AND cardinality(NEW.value_options) BETWEEN 1 AND 50
      WHEN 'relation' THEN (def.relation_target = 'person' AND NEW.relation_contact_id IS NOT NULL) OR (def.relation_target = 'company' AND NEW.relation_company_id IS NOT NULL)
      ELSE false END;
  IF NOT coalesce(matches, false) THEN
    RAISE EXCEPTION 'value does not match field type';
  END IF;
  IF NEW.value_options IS NOT NULL AND (
      EXISTS (SELECT 1 FROM unnest(NEW.value_options) v WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(def.options) o WHERE o->>'value' = v))
      OR (SELECT count(DISTINCT v) FROM unnest(NEW.value_options) v) <> cardinality(NEW.value_options)) THEN
    RAISE EXCEPTION 'value is not an allowed option';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_field_value_guard BEFORE INSERT OR UPDATE ON public.crm_field_values
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_field_value();
--> statement-breakpoint
-- Views: provenance from the verified user.
CREATE FUNCTION public.guard_crm_saved_view() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'invalid view provenance'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.id, NEW.object_type, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.object_type, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'view identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_saved_view_guard BEFORE INSERT OR UPDATE ON public.crm_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_saved_view();
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
