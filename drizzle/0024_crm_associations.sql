CREATE TABLE "crm_associations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"company_id" uuid,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"consent_id" uuid NOT NULL,
	"external_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"redacted_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_associations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_association_source" CHECK ("crm_associations"."source" in ('zernio', 'form', 'touchpoint')),
	CONSTRAINT "crm_association_kind" CHECK ("crm_associations"."kind" in ('message', 'comment', 'mention', 'form_submission', 'signup', 'call', 'meeting', 'visit', 'other')),
	CONSTRAINT "crm_association_purpose" CHECK ("crm_associations"."purpose" in ('messaging', 'form_follow_up', 'newsletter')),
	CONSTRAINT "crm_association_external_id" CHECK ("crm_associations"."external_id" is null or length("crm_associations"."external_id") between 1 and 200),
	CONSTRAINT "crm_association_summary" CHECK (length("crm_associations"."summary") <= 1000),
	CONSTRAINT "crm_association_payload" CHECK (jsonb_typeof("crm_associations"."payload") = 'object' and octet_length("crm_associations"."payload"::text) <= 16384)
);
--> statement-breakpoint
ALTER TABLE "contact_consents" DROP CONSTRAINT "consent_purpose";--> statement-breakpoint
ALTER TABLE "crm_associations" ADD CONSTRAINT "crm_associations_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_associations" ADD CONSTRAINT "crm_associations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_associations" ADD CONSTRAINT "crm_associations_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_associations" ADD CONSTRAINT "crm_associations_tenant_id_company_id_companies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_associations" ADD CONSTRAINT "crm_associations_tenant_id_consent_id_contact_consents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","consent_id") REFERENCES "public"."contact_consents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_associations_external_idx" ON "crm_associations" USING btree ("tenant_id","source","external_id") WHERE "crm_associations"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "crm_associations_contact_idx" ON "crm_associations" USING btree ("tenant_id","contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "crm_associations_company_idx" ON "crm_associations" USING btree ("tenant_id","company_id","occurred_at");--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "consent_purpose" CHECK ("contact_consents"."purpose" in ('marketing', 'outreach_follow_up', 'event_administration', 'account_communications', 'legacy_unspecified', 'messaging', 'form_follow_up', 'newsletter'));
--> statement-breakpoint
-- CRM-07 (ADR 0013): contact association events with per-purpose consent. The DDL above is
-- generated from src/db/schema.ts; everything below is hand-written and chained onto 0023.
-- 2) Row-level security: harvest_app only, tenant from the verified transaction context.
ALTER TABLE crm_associations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_associations FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_associations_tenant ON crm_associations TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- Append-only for the app: no UPDATE or DELETE grant. Only the erasure and merge definers change rows.
GRANT SELECT, INSERT ON crm_associations TO harvest_app;
DO $$ BEGIN
  EXECUTE format($policy$CREATE POLICY erasure_owner_tenant ON public.crm_associations TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, current_user);
END $$;

--> statement-breakpoint
-- 3) Guard: provenance, a live person, and consent for the purpose enforced in SQL as well as in
-- the service. The consent row must be this person's grant for this purpose, and no withdrawal for
-- the purpose may be outstanding (a later grant on both clocks for the same channel supersedes it,
-- the same rule as the record page). The person row is locked so a concurrent withdrawal serializes.
CREATE FUNCTION public.guard_crm_association() RETURNS trigger
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
CREATE TRIGGER crm_association_guard BEFORE INSERT OR UPDATE ON public.crm_associations
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_association();

--> statement-breakpoint
-- 4) The audit ledger stays append-only. 0019's rule, plus association.* rows may lose the erased
-- person's contactId during erasure, exactly like task.* and note.* rows.
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
  IF (OLD.action LIKE 'task.%' OR OLD.action LIKE 'note.%' OR OLD.action LIKE 'association.%')
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
-- 5) Erasure: 0023's erase_contact plus the CRM-07 delete and text scrub (email, phone, social handle;
-- marked "CRM-07") and
-- association.* rows in the audit strip.
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
  -- CRM-06: CSV import rows about the person (matched or created by an import, or
  -- carrying one of their identifiers) lose their cells, keys and link before the
  -- identifiers below are deleted; the row keeps only its number and outcome codes.
  UPDATE public.crm_import_rows r SET raw = '[]'::jsonb,
    match_keys = CASE WHEN r.contact_id = p_contact THEN '{}'::text[] ELSE ARRAY(
      SELECT key FROM unnest(r.match_keys) AS key WHERE NOT EXISTS (
        SELECT 1 FROM public.contact_identifiers i WHERE i.tenant_id = p_tenant AND i.contact_id = p_contact
          AND i.kind || ':' || i.normalized_value = key)) END,
    contact_id = CASE WHEN r.contact_id = p_contact THEN NULL ELSE r.contact_id END
    WHERE r.tenant_id = p_tenant AND (r.contact_id = p_contact OR EXISTS (
      SELECT 1 FROM public.contact_identifiers i
      WHERE i.tenant_id = p_tenant AND i.contact_id = p_contact AND (
        i.kind || ':' || i.normalized_value = ANY(r.match_keys) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(r.raw) AS cell(value)
          WHERE CASE WHEN i.kind = 'phone' THEN
            length(regexp_replace(i.normalized_value, '[^0-9]', '', 'g')) > 0 AND
            regexp_replace(i.normalized_value, '[^0-9]', '', 'g') = regexp_replace(cell.value, '[^0-9]', '', 'g')
          ELSE length(i.normalized_value) > 0 AND EXISTS (
            SELECT 1 FROM generate_series(1, length(cell.value) - length(i.normalized_value) + 1) AS pos(n)
            WHERE lower(substring(cell.value FROM pos.n FOR length(i.normalized_value))) = lower(i.normalized_value)
              -- A bare one-character handle in prose is indistinguishable from a word.
              AND (i.kind <> 'social' OR length(i.normalized_value) > 1
                OR lower(btrim(cell.value)) = lower(i.normalized_value)
                OR (pos.n > 1 AND substring(cell.value FROM pos.n - 1 FOR 1) = '@'))
              AND (pos.n = 1 OR substring(cell.value FROM pos.n - 1 FOR 1) !~ '[[:alnum:]_@.+:-]'
                OR (i.kind = 'social' AND substring(cell.value FROM pos.n - 1 FOR 1) = '@'
                  AND (pos.n = 2 OR substring(cell.value FROM pos.n - 2 FOR 1) !~ '[[:alnum:]_@.+:-]')))
              AND (pos.n + length(i.normalized_value) > length(cell.value)
                OR substring(cell.value FROM pos.n + length(i.normalized_value) FOR 1) !~ '[[:alnum:]_@.+:-]'
                OR (substring(cell.value FROM pos.n + length(i.normalized_value) FOR 1) = '.'
                  AND (pos.n + length(i.normalized_value) = length(cell.value)
                    OR substring(cell.value FROM pos.n + length(i.normalized_value) + 1 FOR 1) !~ '[[:alnum:]_]')))) END))));
  -- CRM-07: the person's association events go, and any other association whose text or raw
  -- payload contains their email (case-insensitive), phone (digits only) or handle is scrubbed. This runs
  -- before the identifiers below are deleted, because it matches on them.
  DELETE FROM public.crm_associations WHERE tenant_id = p_tenant AND contact_id = p_contact;
  UPDATE public.crm_associations a SET summary = '', payload = '{}'::jsonb, redacted_at = now()
    WHERE a.tenant_id = p_tenant AND EXISTS (
      SELECT 1 FROM public.contact_identifiers i WHERE i.tenant_id = p_tenant AND i.contact_id = p_contact AND (
        (i.kind = 'email' AND (strpos(lower(a.summary), lower(i.normalized_value)) > 0 OR strpos(lower(a.payload::text), lower(i.normalized_value)) > 0))
        OR (i.kind = 'phone' AND length(regexp_replace(i.normalized_value, '[^0-9]', '', 'g')) >= 7 AND (
          strpos(regexp_replace(a.summary, '[^0-9]', '', 'g'), regexp_replace(i.normalized_value, '[^0-9]', '', 'g')) > 0
          OR strpos(regexp_replace(a.payload::text, '[^0-9]', '', 'g'), regexp_replace(i.normalized_value, '[^0-9]', '', 'g')) > 0))
        -- Social handles, case-insensitive, as a whole token (optionally after "@"); a one-character
        -- handle only with its "@", since a bare letter in prose is indistinguishable from a word.
        OR (i.kind = 'social' AND length(i.normalized_value) > 0 AND (
          a.summary ~* ('(^|[^[:alnum:]_@.+:-])' || CASE WHEN length(i.normalized_value) > 1 THEN '@?' ELSE '@' END
            || regexp_replace(i.normalized_value, '([^[:alnum:]_])', '\\\1', 'g') || '($|[^[:alnum:]_@.+:-]|[.]($|[^[:alnum:]_]))')
          OR a.payload::text ~* ('(^|[^[:alnum:]_@.+:-])' || CASE WHEN length(i.normalized_value) > 1 THEN '@?' ELSE '@' END
            || regexp_replace(i.normalized_value, '([^[:alnum:]_])', '\\\1', 'g') || '($|[^[:alnum:]_@.+:-]|[.]($|[^[:alnum:]_]))')))));
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
    WHERE a.tenant_id = p_tenant AND (a.action LIKE 'task.%' OR a.action LIKE 'note.%' OR a.action LIKE 'association.%') AND a.metadata->>'contactId' = p_contact::text;
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
--> statement-breakpoint
-- 6) Merge: 0023's merge_contacts plus moving the merged person's association events (CRM-07)
-- to the kept person before erasure, so they are not deleted with the merged person.
-- Explicit person merge (owner/admin). The kept person gains the merged person's
-- identifiers it lacks, company links, consent events, tasks, notes, deals, custom
-- values it lacks and the relation values that pointed at the merged person; then
-- the merged person is erased through erase_contact, so no row keeps their old id.
CREATE OR REPLACE FUNCTION public.merge_contacts(p_tenant uuid, p_target uuid, p_source uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); n_live integer;
  moved_identifiers integer; dropped_identifiers integer; moved_links integer; moved_consents integer;
  moved_tasks integer; moved_notes integer; moved_activities integer; moved_deals integer; moved_values integer; repointed_values integer; notes_taken boolean := false;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'merge access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge access denied' USING ERRCODE = '42501'; END IF;
  IF p_target = p_source THEN RAISE EXCEPTION 'a person cannot be merged into themselves' USING ERRCODE = '22023'; END IF;
  -- Lock both people in id order so concurrent merges cannot deadlock.
  PERFORM 1 FROM public.contacts WHERE tenant_id = p_tenant AND id IN (p_target, p_source) AND erased_at IS NULL ORDER BY id FOR UPDATE;
  SELECT count(*) INTO n_live FROM public.contacts WHERE tenant_id = p_tenant AND id IN (p_target, p_source) AND erased_at IS NULL;
  IF n_live <> 2 THEN RETURN NULL; END IF;
  PERFORM set_config('app.merge_source', p_source::text, true);
  UPDATE public.crm_import_rows r SET raw = '[]'::jsonb,
    match_keys = CASE WHEN r.contact_id = p_source THEN '{}'::text[] ELSE ARRAY(
      SELECT key FROM unnest(r.match_keys) AS key WHERE NOT EXISTS (
        SELECT 1 FROM public.contact_identifiers i WHERE i.tenant_id = p_tenant AND i.contact_id = p_source
          AND i.kind || ':' || i.normalized_value = key)) END,
    contact_id = CASE WHEN r.contact_id = p_source THEN NULL ELSE r.contact_id END
    WHERE r.tenant_id = p_tenant AND (r.contact_id = p_source OR EXISTS (
      SELECT 1 FROM public.contact_identifiers i
      WHERE i.tenant_id = p_tenant AND i.contact_id = p_source AND (
        i.kind || ':' || i.normalized_value = ANY(r.match_keys) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(r.raw) AS cell(value)
          WHERE CASE WHEN i.kind = 'phone' THEN
            length(regexp_replace(i.normalized_value, '[^0-9]', '', 'g')) > 0 AND
            regexp_replace(i.normalized_value, '[^0-9]', '', 'g') = regexp_replace(cell.value, '[^0-9]', '', 'g')
          ELSE length(i.normalized_value) > 0 AND EXISTS (
            SELECT 1 FROM generate_series(1, length(cell.value) - length(i.normalized_value) + 1) AS pos(n)
            WHERE lower(substring(cell.value FROM pos.n FOR length(i.normalized_value))) = lower(i.normalized_value)
              -- A bare one-character handle in prose is indistinguishable from a word.
              AND (i.kind <> 'social' OR length(i.normalized_value) > 1
                OR lower(btrim(cell.value)) = lower(i.normalized_value)
                OR (pos.n > 1 AND substring(cell.value FROM pos.n - 1 FOR 1) = '@'))
              AND (pos.n = 1 OR substring(cell.value FROM pos.n - 1 FOR 1) !~ '[[:alnum:]_@.+:-]'
                OR (i.kind = 'social' AND substring(cell.value FROM pos.n - 1 FOR 1) = '@'
                  AND (pos.n = 2 OR substring(cell.value FROM pos.n - 2 FOR 1) !~ '[[:alnum:]_@.+:-]')))
              AND (pos.n + length(i.normalized_value) > length(cell.value)
                OR substring(cell.value FROM pos.n + length(i.normalized_value) FOR 1) !~ '[[:alnum:]_@.+:-]'
                OR (substring(cell.value FROM pos.n + length(i.normalized_value) FOR 1) = '.'
                  AND (pos.n + length(i.normalized_value) = length(cell.value)
                    OR substring(cell.value FROM pos.n + length(i.normalized_value) + 1 FOR 1) !~ '[[:alnum:]_]')))) END))));
  WITH moved AS (
    UPDATE public.contact_identifiers s SET contact_id = p_target
    WHERE s.tenant_id = p_tenant AND s.contact_id = p_source
      AND NOT EXISTS (SELECT 1 FROM public.contact_identifiers t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.kind = s.kind)
    RETURNING 1) SELECT count(*) INTO moved_identifiers FROM moved;
  DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS dropped_identifiers = ROW_COUNT;
  INSERT INTO public.contact_company_links (tenant_id, contact_id, company_id, title, is_primary, created_by, created_at)
    SELECT p_tenant, p_target, l.company_id, l.title,
      l.is_primary AND NOT EXISTS (SELECT 1 FROM public.contact_company_links t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.is_primary),
      actor, l.created_at
    FROM public.contact_company_links l
    WHERE l.tenant_id = p_tenant AND l.contact_id = p_source
      AND NOT EXISTS (SELECT 1 FROM public.contact_company_links t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.company_id = l.company_id);
  GET DIAGNOSTICS moved_links = ROW_COUNT;
  DELETE FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = p_source;
  UPDATE public.contact_consents SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_consents = ROW_COUNT;
  UPDATE public.crm_tasks SET contact_id = p_target, version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_tasks = ROW_COUNT;
  UPDATE public.crm_notes SET contact_id = p_target, version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_notes = ROW_COUNT;
  UPDATE public.opportunities SET contact_id = p_target, version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_deals = ROW_COUNT;
  -- CRM-07: association events keep their consent row, which moved above with the same id.
  UPDATE public.crm_associations SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_activities = ROW_COUNT;
  INSERT INTO public.crm_field_values (tenant_id, field_id, object_type, contact_id, value_text, value_number, value_date, value_boolean, value_options, relation_contact_id, relation_company_id, updated_by, updated_at)
    SELECT p_tenant, v.field_id, v.object_type, p_target, v.value_text, v.value_number, v.value_date, v.value_boolean, v.value_options,
      CASE WHEN v.relation_contact_id = p_source THEN p_target ELSE v.relation_contact_id END, v.relation_company_id, actor, now()
    FROM public.crm_field_values v JOIN public.crm_field_definitions d ON d.tenant_id = v.tenant_id AND d.id = v.field_id AND d.archived_at IS NULL
    WHERE v.tenant_id = p_tenant AND v.contact_id = p_source
      AND NOT EXISTS (SELECT 1 FROM public.crm_field_values t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.field_id = v.field_id);
  GET DIAGNOSTICS moved_values = ROW_COUNT;
  UPDATE public.crm_field_values v SET relation_contact_id = p_target, updated_by = actor, updated_at = now()
    FROM public.crm_field_definitions d
    WHERE v.tenant_id = p_tenant AND v.relation_contact_id = p_source AND v.contact_id IS DISTINCT FROM p_source
      AND d.tenant_id = v.tenant_id AND d.id = v.field_id AND d.archived_at IS NULL;
  GET DIAGNOSTICS repointed_values = ROW_COUNT;
  UPDATE public.contacts t SET notes = s.notes FROM public.contacts s
    WHERE t.tenant_id = p_tenant AND t.id = p_target AND s.tenant_id = p_tenant AND s.id = p_source AND t.notes = '' AND s.notes <> '';
  notes_taken := FOUND;
  UPDATE public.contacts SET version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND id = p_target;
  UPDATE public.crm_import_rows SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'contact.merge', p_target::text, jsonb_build_object(
      'identifiers', moved_identifiers::text, 'links', moved_links::text, 'consents', moved_consents::text,
      'tasks', moved_tasks::text, 'notes', moved_notes::text, 'deals', moved_deals::text, 'values', (moved_values + repointed_values)::text, 'activities', moved_activities::text));
  PERFORM set_config('app.merge_source', '', true);
  -- The merged person's own record, history and leftovers leave through controlled erasure.
  PERFORM public.erase_contact(p_tenant, p_source);
  RETURN jsonb_build_object('identifiers', moved_identifiers, 'droppedIdentifiers', dropped_identifiers, 'links', moved_links,
    'consents', moved_consents, 'tasks', moved_tasks, 'notes', moved_notes, 'deals', moved_deals,
    'values', moved_values + repointed_values, 'activities', moved_activities, 'notesCopied', notes_taken);
END $$;
REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid, uuid) TO harvest_app;
--> statement-breakpoint
-- 7) Import rollback: 0023's rollback_crm_import, plus logged activity (CRM-07) counts as a dependant,
-- so an imported person or organization that activity links to is kept rather than failing the
-- whole rollback on the crm_associations foreign keys.
-- Batch rollback. Records an import created are removed only if nobody has touched them
-- since (same version, no children of their own); "Fill empty fields" changes are reverted
-- only on records still at the version the import left. Everything else is kept and counted.
CREATE OR REPLACE FUNCTION public.rollback_crm_import(p_tenant uuid, p_import uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); actor_role text; imp record; r record; v integer;
  removed integer := 0; reverted integer := 0; kept integer := 0;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'rollback access denied' USING ERRCODE = '42501';
  END IF;
  SELECT role_id INTO actor_role FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor FOR SHARE;
  SELECT * INTO imp FROM public.crm_imports WHERE tenant_id = p_tenant AND id = p_import FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF actor_role IS NULL OR NOT (actor_role IN ('owner', 'admin') OR (actor_role = 'member' AND imp.created_by = actor)) THEN
    RAISE EXCEPTION 'rollback access denied' USING ERRCODE = '42501';
  END IF;
  IF imp.status NOT IN ('completed', 'failed') THEN RAISE EXCEPTION 'import cannot be rolled back' USING ERRCODE = '55000'; END IF;
  FOR r IN SELECT * FROM public.crm_import_rows WHERE tenant_id = p_tenant AND import_id = p_import AND status = 'done' ORDER BY row_number DESC LOOP
    IF imp.entity = 'person' AND r.contact_id IS NOT NULL THEN
      SELECT version INTO v FROM public.contacts WHERE tenant_id = p_tenant AND id = r.contact_id AND erased_at IS NULL FOR UPDATE;
      IF NOT FOUND OR v IS DISTINCT FROM r.result_version THEN kept := kept + 1; CONTINUE; END IF;
      IF r.created THEN
        IF EXISTS (SELECT 1 FROM public.contact_consents WHERE tenant_id = p_tenant AND contact_id = r.contact_id)
          OR EXISTS (SELECT 1 FROM public.crm_tasks WHERE tenant_id = p_tenant AND contact_id = r.contact_id)
          OR EXISTS (SELECT 1 FROM public.crm_associations WHERE tenant_id = p_tenant AND contact_id = r.contact_id)
          OR EXISTS (SELECT 1 FROM public.crm_notes WHERE tenant_id = p_tenant AND contact_id = r.contact_id)
          OR EXISTS (SELECT 1 FROM public.opportunities WHERE tenant_id = p_tenant AND contact_id = r.contact_id)
          OR EXISTS (SELECT 1 FROM public.crm_field_values WHERE tenant_id = p_tenant AND (contact_id = r.contact_id OR relation_contact_id = r.contact_id))
          OR EXISTS (SELECT 1 FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = r.contact_id AND company_id::text IS DISTINCT FROM r.applied->>'companyId')
          OR EXISTS (SELECT 1 FROM public.crm_import_rows WHERE tenant_id = p_tenant AND contact_id = r.contact_id AND (import_id <> p_import OR row_number <> r.row_number)) THEN
          kept := kept + 1; CONTINUE;
        END IF;
        UPDATE public.crm_import_rows SET contact_id = NULL, status = 'rolled_back' WHERE tenant_id = p_tenant AND import_id = p_import AND row_number = r.row_number;
        DELETE FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = r.contact_id;
        DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = r.contact_id;
        DELETE FROM public.contacts WHERE tenant_id = p_tenant AND id = r.contact_id;
        removed := removed + 1;
      ELSIF r.applied IS NOT NULL THEN
        IF coalesce((r.applied->>'notes')::boolean, false) THEN
          UPDATE public.contacts SET notes = '' WHERE tenant_id = p_tenant AND id = r.contact_id;
        END IF;
        DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = r.contact_id
          AND kind IN (SELECT jsonb_array_elements_text(coalesce(r.applied->'identifiers', '[]'::jsonb)));
        IF coalesce((r.applied->>'linked')::boolean, false) THEN
          DELETE FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = r.contact_id AND company_id::text = r.applied->>'companyId';
        END IF;
        UPDATE public.contacts SET version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND id = r.contact_id;
        UPDATE public.crm_import_rows SET status = 'rolled_back' WHERE tenant_id = p_tenant AND import_id = p_import AND row_number = r.row_number;
        reverted := reverted + 1;
      END IF;
    ELSIF imp.entity = 'company' AND r.company_id IS NOT NULL THEN
      SELECT version INTO v FROM public.companies WHERE tenant_id = p_tenant AND id = r.company_id FOR UPDATE;
      IF NOT FOUND OR v IS DISTINCT FROM r.result_version THEN kept := kept + 1; CONTINUE; END IF;
      IF r.created THEN
        IF EXISTS (SELECT 1 FROM public.contact_company_links WHERE tenant_id = p_tenant AND company_id = r.company_id)
          OR EXISTS (SELECT 1 FROM public.opportunities WHERE tenant_id = p_tenant AND company_id = r.company_id)
          OR EXISTS (SELECT 1 FROM public.crm_tasks WHERE tenant_id = p_tenant AND company_id = r.company_id)
          OR EXISTS (SELECT 1 FROM public.crm_associations WHERE tenant_id = p_tenant AND company_id = r.company_id)
          OR EXISTS (SELECT 1 FROM public.crm_notes WHERE tenant_id = p_tenant AND company_id = r.company_id)
          OR EXISTS (SELECT 1 FROM public.crm_field_values WHERE tenant_id = p_tenant AND (company_id = r.company_id OR relation_company_id = r.company_id))
          OR EXISTS (SELECT 1 FROM public.crm_import_rows WHERE tenant_id = p_tenant AND company_id = r.company_id AND (import_id <> p_import OR row_number <> r.row_number)) THEN
          kept := kept + 1; CONTINUE;
        END IF;
        UPDATE public.crm_import_rows SET company_id = NULL, status = 'rolled_back' WHERE tenant_id = p_tenant AND import_id = p_import AND row_number = r.row_number;
        DELETE FROM public.companies WHERE tenant_id = p_tenant AND id = r.company_id;
        removed := removed + 1;
      ELSIF coalesce((r.applied->>'description')::boolean, false) THEN
        UPDATE public.companies SET description = '', version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND id = r.company_id;
        UPDATE public.crm_import_rows SET status = 'rolled_back' WHERE tenant_id = p_tenant AND import_id = p_import AND row_number = r.row_number;
        reverted := reverted + 1;
      END IF;
    END IF;
  END LOOP;
  UPDATE public.crm_imports SET status = 'rolled_back', rolled_back_at = now(), updated_at = now(), version = version + 1,
    stats = stats || jsonb_build_object('removed', removed, 'reverted', reverted, 'kept', kept)
    WHERE tenant_id = p_tenant AND id = p_import;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'crm.import.rolled_back', p_import::text,
      jsonb_build_object('removed', removed::text, 'reverted', reverted::text, 'kept', kept::text));
  RETURN jsonb_build_object('removed', removed, 'reverted', reverted, 'kept', kept);
END $$;
REVOKE ALL ON FUNCTION public.rollback_crm_import(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rollback_crm_import(uuid, uuid) TO harvest_app;
