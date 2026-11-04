-- Backfill legacy events without inventing an actor, purpose or notice version.
-- Drizzle applies this migration transactionally; the trigger is replaced before commit.
DROP TRIGGER consent_append_only ON public.contact_consents;
--> statement-breakpoint
ALTER TABLE "contact_consents" ALTER COLUMN "contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_consents" ALTER COLUMN "channel" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_consents" ALTER COLUMN "source" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_consents" ALTER COLUMN "evidence" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD COLUMN "recorded_by" text;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD COLUMN "purpose" text DEFAULT 'legacy_unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD COLUMN "notice_version" text DEFAULT 'legacy-unversioned' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD COLUMN "recorded_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "consent_purpose" CHECK ("contact_consents"."purpose" in ('marketing', 'outreach_follow_up', 'event_administration', 'account_communications', 'legacy_unspecified'));--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "consent_notice_version" CHECK ("contact_consents"."notice_version" in ('notice-v1', 'legacy-unversioned'));--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "consent_redaction" CHECK (("contact_consents"."redacted_at" is null and "contact_consents"."contact_id" is not null and "contact_consents"."channel" is not null and "contact_consents"."source" is not null and "contact_consents"."evidence" is not null) or ("contact_consents"."redacted_at" is not null and "contact_consents"."contact_id" is null and "contact_consents"."channel" is null and "contact_consents"."source" is null and "contact_consents"."evidence" is null and "contact_consents"."recorded_by" is null));
--> statement-breakpoint
-- The definer is the migration owner, never harvest_app. Explicit tenant policies also
-- cover an owner without BYPASSRLS (e.g. Neon); FORCE RLS is never disabled.
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['contacts', 'contact_identifiers', 'contact_consents', 'workspace_members', 'audit_logs'] LOOP
    EXECUTE format($policy$CREATE POLICY erasure_owner_tenant ON public.%I TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, relation_name, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
-- Only the trusted migration owner can see legacy rows during this backfill.
DO $$ BEGIN
  EXECUTE format('CREATE POLICY migration_backfill ON public.contact_consents TO %I USING (true) WITH CHECK (true)', current_user);
  EXECUTE format('CREATE POLICY migration_backfill ON public.audit_logs TO %I USING (true) WITH CHECK (true)', current_user);
END $$;
UPDATE public.contact_consents c SET
  recorded_by = (SELECT a.actor_id FROM public.audit_logs a WHERE a.tenant_id = c.tenant_id AND a.metadata->>'consentId' = c.id::text AND a.action = 'contact.consent_record' ORDER BY a.created_at LIMIT 1),
  recorded_at = coalesce((SELECT a.created_at FROM public.audit_logs a WHERE a.tenant_id = c.tenant_id AND a.metadata->>'consentId' = c.id::text AND a.action = 'contact.consent_record' ORDER BY a.created_at LIMIT 1), c.occurred_at);
DROP POLICY migration_backfill ON public.contact_consents;
DROP POLICY migration_backfill ON public.audit_logs;
ALTER TABLE public.contact_consents ALTER COLUMN purpose DROP DEFAULT;
ALTER TABLE public.contact_consents ALTER COLUMN notice_version DROP DEFAULT;
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
