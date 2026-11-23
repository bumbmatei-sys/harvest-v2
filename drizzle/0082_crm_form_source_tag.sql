CREATE TABLE "contact_form_sources" (
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"form_title" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contact_form_sources_tenant_id_contact_id_version_id_pk" PRIMARY KEY("tenant_id","contact_id","version_id"),
	CONSTRAINT "contact_form_sources_title" CHECK (length("contact_form_sources"."form_title") <= 300)
);
--> statement-breakpoint
ALTER TABLE "contact_form_sources" ADD CONSTRAINT "contact_form_sources_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_form_sources" ADD CONSTRAINT "contact_form_sources_publication_fk" FOREIGN KEY ("tenant_id","form_id","version_id") REFERENCES "public"."crm_form_publications"("tenant_id","form_id","version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Owners and admins read the tag for as long as the contact exists. It never holds
-- answers, and only the submit definer (and the erase and merge paths) change it.
ALTER TABLE public.contact_form_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_form_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY form_source_read ON public.contact_form_sources FOR SELECT TO harvest_app USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = contact_form_sources.tenant_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
GRANT SELECT ON public.contact_form_sources TO harvest_app;
DO $$
BEGIN
  EXECUTE format('CREATE POLICY form_source_definer ON public.contact_form_sources TO %I
    USING (tenant_id IN (nullif(current_setting(''app.crm_forms_tenant'', true), '''')::uuid, nullif(current_setting(''app.tenant_id'', true), '''')::uuid))
    WITH CHECK (tenant_id IN (nullif(current_setting(''app.crm_forms_tenant'', true), '''')::uuid, nullif(current_setting(''app.tenant_id'', true), '''')::uuid))',
    current_user);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.crm_form_record_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.created_contact THEN
    DELETE FROM public.contact_source_events
      WHERE tenant_id = NEW.tenant_id AND contact_id = NEW.contact_id AND kind = 'manual';
  END IF;
  INSERT INTO public.contact_source_events(tenant_id, contact_id, kind, outcome, occurred_at, crm_form_response_id)
    VALUES (NEW.tenant_id, NEW.contact_id, 'form', CASE WHEN NEW.created_contact THEN 'created' ELSE 'updated' END,
      NEW.submitted_at, NEW.id);
  -- The tag keeps the form as the person's source after the response expires.
  INSERT INTO public.contact_form_sources(tenant_id, contact_id, form_id, version_id, form_title, occurred_at)
    SELECT NEW.tenant_id, NEW.contact_id, NEW.form_id, NEW.version_id, left(coalesce(p.definition->>'title', ''), 300), NEW.submitted_at
      FROM public.crm_form_publications p
      WHERE p.tenant_id = NEW.tenant_id AND p.form_id = NEW.form_id AND p.version_id = NEW.version_id
    ON CONFLICT (tenant_id, contact_id, version_id) DO UPDATE
      SET occurred_at = least(public.contact_form_sources.occurred_at, excluded.occurred_at);
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Erasure removes the tag with the rest of the contact's source evidence.
CREATE FUNCTION public.crm_form_source_before_erase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  DELETE FROM public.contact_form_sources WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_form_source_before_erase() FROM PUBLIC, harvest_app;
CREATE TRIGGER crm_form_source_before_erase BEFORE UPDATE ON public.contacts
  FOR EACH ROW WHEN (OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL)
  EXECUTE FUNCTION public.crm_form_source_before_erase();
--> statement-breakpoint
-- A merge moves the tags to the kept contact (earliest time per form version) before the merged person is erased.
DO $$
DECLARE def text; patched text;
BEGIN
  def := pg_get_functiondef('public.merge_contacts_scoped(uuid, uuid, uuid)'::regprocedure);
  patched := replace(def, '  UPDATE public.crm_form_responses SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;',
    '  INSERT INTO public.contact_form_sources(tenant_id, contact_id, form_id, version_id, form_title, occurred_at)
    SELECT tenant_id, p_target, form_id, version_id, form_title, occurred_at FROM public.contact_form_sources
      WHERE tenant_id = p_tenant AND contact_id = p_source
    ON CONFLICT (tenant_id, contact_id, version_id) DO UPDATE
      SET occurred_at = least(public.contact_form_sources.occurred_at, excluded.occurred_at);
  DELETE FROM public.contact_form_sources WHERE tenant_id = p_tenant AND contact_id = p_source;
  UPDATE public.crm_form_responses SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;');
  IF patched = def THEN RAISE EXCEPTION 'merge hook not found'; END IF;
  EXECUTE patched;
END $$;
