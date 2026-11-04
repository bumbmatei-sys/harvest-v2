ALTER TABLE "contact_consents" ADD CONSTRAINT "consent_occurrence_bound" CHECK ("contact_consents"."occurred_at" <= "contact_consents"."recorded_at" + interval '5 minutes');
--> statement-breakpoint
-- Controlled erasure coarsens timestamps; audit history remains append-only.
CREATE OR REPLACE FUNCTION public.erase_contact(p_tenant uuid, p_contact uuid) RETURNS boolean
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
    channel = NULL, source = NULL, evidence = NULL,
    recorded_at = date_trunc('day', recorded_at, 'UTC'),
    -- Clamp permitted clock skew across midnight to the recording day so the
    -- occurrence CHECK remains true after timestamps lose their precision.
    occurred_at = least(date_trunc('day', occurred_at, 'UTC'), date_trunc('day', recorded_at, 'UTC')),
    redacted_at = date_trunc('day', now(), 'UTC')
    WHERE tenant_id = p_tenant AND contact_id = p_contact;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id)
    VALUES (p_tenant, actor, 'contact.erase', p_contact::text);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.erase_contact(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_contact(uuid, uuid) TO harvest_app;
--> statement-breakpoint
-- No mutable session flag bypasses append-only protection. Only the fixed definer
-- may redact, only after erasure, preserving facts and coarsening times exactly.
CREATE OR REPLACE FUNCTION public.guard_consent_redaction() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure))
    OR OLD.redacted_at IS NOT NULL OR NEW.redacted_at IS NULL
    OR NEW.contact_id IS NOT NULL OR NEW.recorded_by IS NOT NULL OR NEW.channel IS NOT NULL
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
