CREATE TABLE "ads_audience_uploads" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"audience_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"eligible" integer DEFAULT 0 NOT NULL,
	"excluded" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_audience_uploads_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_audience_uploads_shape" CHECK ("ads_audience_uploads"."status" in ('pending','sent','failed','ambiguous') and "ads_audience_uploads"."eligible" >= 0 and "ads_audience_uploads"."sent" >= 0 and pg_column_size("ads_audience_uploads"."excluded") <= 2048)
);
--> statement-breakpoint
CREATE TABLE "ads_conversion_sends" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"event_digest" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_conversion_sends_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ads_conversion_sends_shape" CHECK ("ads_conversion_sends"."status" in ('pending','sent','failed','ambiguous') and length("ads_conversion_sends"."event_name") between 1 and 60 and "ads_conversion_sends"."event_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "contact_consents" DROP CONSTRAINT "consent_notice_version";--> statement-breakpoint
ALTER TABLE "ads_accounts" ADD COLUMN "sync_due_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ads_accounts" ADD COLUMN "sync_lease" uuid;--> statement-breakpoint
ALTER TABLE "ads_accounts" ADD COLUMN "sync_leased_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ads_accounts" ADD COLUMN "sync_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ads_lead_forms" ADD COLUMN "consent_questions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ads_leads" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "ads_leads" ADD COLUMN "converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ads_audience_uploads" ADD CONSTRAINT "ads_audience_uploads_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_audience_uploads" ADD CONSTRAINT "ads_audience_uploads_account_fk" FOREIGN KEY ("tenant_id","ad_account_id") REFERENCES "public"."ads_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_audience_uploads" ADD CONSTRAINT "ads_audience_uploads_audience_fk" FOREIGN KEY ("tenant_id","audience_id") REFERENCES "public"."ads_audiences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_conversion_sends" ADD CONSTRAINT "ads_conversion_sends_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_conversion_sends" ADD CONSTRAINT "ads_conversion_sends_destination_fk" FOREIGN KEY ("tenant_id","destination_id") REFERENCES "public"."ads_conversion_destinations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ads_audience_uploads_key_idx" ON "ads_audience_uploads" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_conversion_sends_event_idx" ON "ads_conversion_sends" USING btree ("tenant_id","destination_id","event_digest");--> statement-breakpoint
ALTER TABLE "ads_leads" ADD CONSTRAINT "ads_leads_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "consent_notice_version" CHECK ("contact_consents"."notice_version" in ('notice-v1', 'legacy-unversioned', 'connect-immutable', 'subject-withdrawal', 'newsletter-subject-v1', 'ad-lead-form-v1'));--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ads_audience_uploads','ads_conversion_sends'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO harvest_app', t);
    EXECUTE format('CREATE POLICY ads_admin ON public.%I TO harvest_app USING (public.ads_can(tenant_id)) WITH CHECK (public.ads_can(tenant_id))', t);
    EXECUTE format('CREATE POLICY ads_definer ON public.%I TO PUBLIC USING (current_user <> ''harvest_app'' AND current_setting(''app.ads_definer'', true) = ''on'') WITH CHECK (current_user <> ''harvest_app'' AND current_setting(''app.ads_definer'', true) = ''on'')', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- A lead becomes a CRM contact only by an explicit owner or admin action, on the hosted-form rules: a person is matched on email or phone (never guessed, never overwritten), created
-- with only the identifiers the lead gave, and given NO consent by the conversion itself. A newsletter or follow-up grant is written only when the lead form explicitly asked for it
-- (a consent question mapped to that purpose) and this lead answered yes; the evidence is the exact consent text of the form. Synthetic data only, like every hosted form, until the
-- HC-02 activation decisions are approved.
CREATE FUNCTION public.ads_lead_convert(p_lead uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); t uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  l record; f record; fields jsonb; nm text; em text; ph text; person uuid; created boolean := false; matching uuid[]; k text; granted text[] := '{}'; purpose text; qkey text; ans text; chan text;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.ads_can(t) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.ads_definer', 'on', true);
  SELECT * INTO l FROM public.ads_leads WHERE tenant_id = t AND id = p_lead FOR UPDATE;
  IF NOT FOUND THEN PERFORM set_config('app.ads_definer', '', true); RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF l.contact_id IS NOT NULL THEN PERFORM set_config('app.ads_definer', '', true); RETURN jsonb_build_object('outcome', 'already', 'contactId', l.contact_id); END IF;
  SELECT * INTO f FROM public.ads_lead_forms WHERE tenant_id = t AND ad_account_id = l.ad_account_id AND external_ref = l.form_ref;
  fields := l.fields;
  nm := nullif(btrim(coalesce(fields->>'full_name', coalesce(fields->>'first_name', '') || ' ' || coalesce(fields->>'last_name', ''))), '');
  em := nullif(lower(btrim(coalesce(fields->>'email', ''))), '');
  ph := nullif(regexp_replace(coalesce(fields->>'phone', ''), '[[:space:]().-]', '', 'g'), '');
  IF nm IS NULL OR length(nm) > 100 OR (em IS NULL AND ph IS NULL)
    OR (em IS NOT NULL AND (length(em) > 254 OR em !~ '^[^@[:space:]]+@example[.]test$'))
    OR (ph IS NOT NULL AND ph !~ '^\+120255501[0-9]{2}$') THEN
    PERFORM set_config('app.ads_definer', '', true); RETURN jsonb_build_object('outcome', 'invalid_lead');
  END IF;
  PERFORM set_config('app.ads_convert_tenant', t::text, true);
  FOR k IN SELECT key FROM unnest(ARRAY['email:' || em, 'phone:' || ph]) key WHERE key IS NOT NULL ORDER BY key LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(t || ':' || k, 0));
  END LOOP;
  SELECT array_agg(id ORDER BY id) INTO matching FROM (
    SELECT c.id FROM public.contacts c WHERE c.tenant_id = t AND c.erased_at IS NULL AND EXISTS (
      SELECT FROM public.contact_identifiers i WHERE i.tenant_id = t AND i.contact_id = c.id AND ((i.kind = 'email' AND i.normalized_value = em) OR (i.kind = 'phone' AND i.normalized_value = ph)))
    ORDER BY c.id FOR UPDATE) m;
  IF cardinality(matching) > 1 THEN PERFORM set_config('app.ads_definer', '', true); RETURN jsonb_build_object('outcome', 'conflict'); END IF;
  person := matching[1];
  IF person IS NULL THEN
    INSERT INTO public.contacts(tenant_id, name) VALUES (t, nm) RETURNING id INTO person;
    INSERT INTO public.contact_identifiers(tenant_id, contact_id, kind, value, normalized_value)
      SELECT t, person, kind, value, value FROM (VALUES ('email', em), ('phone', ph)) i(kind, value) WHERE value IS NOT NULL;
    created := true;
  END IF;
  -- Explicit asks only: the form mapped a question to the purpose and this person answered yes. The text cited as evidence is the one stored on the LEAD when it was received, never read from the form at
  -- conversion time, and a grant is made only while the form still carries exactly that text; a form whose wording changed after the lead was received grants nothing.
  IF f.id IS NOT NULL THEN
    FOREACH purpose IN ARRAY ARRAY['newsletter', 'form_follow_up'] LOOP
      qkey := f.consent_questions ->> purpose;
      ans := lower(btrim(coalesce(fields ->> qkey, '')));
      IF qkey IS NOT NULL AND ans IN ('yes', 'true', '1', 'on', 'checked') AND l.consent_text IS NOT NULL AND btrim(l.consent_text) = btrim(f.consent_text) THEN
        chan := CASE WHEN purpose = 'newsletter' THEN CASE WHEN em IS NOT NULL THEN 'email' END ELSE CASE WHEN em IS NOT NULL THEN 'email' ELSE 'sms' END END;
        IF chan IS NOT NULL THEN
          INSERT INTO public.contact_consents(tenant_id, contact_id, recorded_by, purpose, notice_version, channel, status, source, evidence, occurred_at)
            VALUES (t, person, actor, purpose, 'ad-lead-form-v1', chan, 'granted', 'ad_lead_form', left(btrim(l.consent_text), 1500) || ' [lead answered yes: ' || qkey || ']', least(coalesce(l.submitted_at, now()), now()));
          granted := granted || purpose;
        END IF;
      END IF;
    END LOOP;
  END IF;
  UPDATE public.ads_leads SET contact_id = person, converted_at = now(), updated_at = now(), version = version + 1 WHERE tenant_id = t AND id = p_lead;
  INSERT INTO public.audit_logs(tenant_id, actor_id, action, target_id, metadata) VALUES (t, actor, 'ads.lead_convert', p_lead::text, jsonb_build_object('created', created::text, 'grants', array_to_string(granted, ',')));
  PERFORM set_config('app.ads_definer', '', true); PERFORM set_config('app.ads_convert_tenant', '', true);
  RETURN jsonb_build_object('outcome', 'converted', 'contactId', person, 'created', created, 'granted', to_jsonb(granted));
END $$;
--> statement-breakpoint
-- A lead that became a contact goes with the person: erasing the contact deletes the lead rows that point at it (as the link-in-bio messages do), and a merge moves them to the kept person.
CREATE FUNCTION public.ads_contact_before_erase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := current_setting('app.ads_definer', true);
BEGIN
  PERFORM set_config('app.ads_definer', 'on', true);
  DELETE FROM public.ads_leads WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id;
  IF EXISTS (SELECT FROM public.ads_leads WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id) THEN
    RAISE EXCEPTION 'ad leads of an erased contact must not survive';
  END IF;
  PERFORM set_config('app.ads_definer', coalesce(previous, ''), true);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ads_contact_before_erase BEFORE UPDATE ON public.contacts FOR EACH ROW
  WHEN ((OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL) OR (OLD.id IS DISTINCT FROM NEW.id AND NEW.erased_at IS NOT NULL))
  EXECUTE FUNCTION public.ads_contact_before_erase();
--> statement-breakpoint
-- NOTE: patches the text of merge_contacts_scoped (see migrations 0082 and 0094): it adds the lead repoint after the CRM form response repoint. Port it if that function is redefined.
DO $$
DECLARE def text; patched text;
  hook text := '  UPDATE public.crm_form_responses SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;';
BEGIN
  def := pg_get_functiondef('public.merge_contacts_scoped(uuid, uuid, uuid)'::regprocedure);
  patched := replace(def, hook, hook || '
  PERFORM set_config(''app.ads_merge_prior'', coalesce(current_setting(''app.ads_definer'', true), ''''), true);
  PERFORM set_config(''app.ads_definer'', ''on'', true);
  UPDATE public.ads_leads SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  PERFORM set_config(''app.ads_definer'', current_setting(''app.ads_merge_prior'', true), true);');
  IF patched = def THEN RAISE EXCEPTION 'merge hook not found'; END IF;
  EXECUTE patched;
END $$;
--> statement-breakpoint
-- Scheduled results sync (worker role only; no schedule is installed). Claim leases due, active accounts of fake-provider connections only (like the analytics worker); apply writes numeric
-- results with newest-value-per-day and records the outcome. The provider call happens between the two, outside any transaction.
CREATE FUNCTION public.ads_sync_claim(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid ads sync batch'; END IF;
  PERFORM set_config('app.ads_definer', 'on', true);
  PERFORM set_config('app.social_definer', 'on', true);
  WITH due AS (
    SELECT a.tenant_id, a.id, a.external_ref, c.id AS connection_id, c.external_account_ref, c.credential_envelope
    FROM public.ads_accounts a JOIN public.social_connections c ON (c.tenant_id, c.id) = (a.tenant_id, a.connection_id)
    WHERE a.sync_due_at <= now() AND (a.sync_lease IS NULL OR a.sync_leased_until <= now()) AND a.status = 'active' AND c.status = 'active' AND c.provider = 'fake'
    ORDER BY a.sync_due_at, a.id LIMIT p_limit FOR UPDATE OF a SKIP LOCKED
  ), claimed AS (
    UPDATE public.ads_accounts a SET sync_lease = gen_random_uuid(), sync_leased_until = now() + interval '120 seconds' FROM due WHERE (a.tenant_id, a.id) = (due.tenant_id, due.id)
    RETURNING jsonb_build_object('tenantId', a.tenant_id, 'adAccountId', a.id, 'adAccountRef', due.external_ref, 'connectionId', due.connection_id, 'accountRef', due.external_account_ref,
      'envelope', due.credential_envelope, 'lease', a.sync_lease, 'failures', a.sync_failures) AS payload)
  SELECT coalesce(jsonb_agg(payload), '[]'::jsonb) INTO result FROM claimed;
  PERFORM set_config('app.social_definer', '', true);
  PERFORM set_config('app.ads_definer', '', true);
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.ads_sync_apply(p_tenant uuid, p_account uuid, p_lease uuid, p_state text, p_delay integer, p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE written integer := 0; n integer; instant timestamptz := clock_timestamp(); lvl text;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('ready','failing','delayed') OR p_delay IS NULL OR p_delay NOT BETWEEN 60 AND 86400 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 5000 THEN RAISE EXCEPTION 'invalid ads sync result'; END IF;
  PERFORM set_config('app.ads_definer', 'on', true);
  PERFORM 1 FROM public.ads_accounts WHERE (tenant_id, id, sync_lease) = (p_tenant, p_account, p_lease) AND sync_leased_until > instant FOR UPDATE;
  IF NOT FOUND THEN PERFORM set_config('app.ads_definer', '', true); RETURN -1; END IF;
  IF p_state = 'ready' THEN
    FOREACH lvl IN ARRAY ARRAY['campaign','adset','ad'] LOOP
      WITH rows AS (SELECT r.ref, r.day, r.metrics, coalesce(r.attribution, 'default') AS attribution FROM jsonb_to_recordset(p_rows) AS r(level text, ref text, day date, metrics jsonb, attribution text) WHERE r.level = lvl),
      ent AS (
        SELECT rows.*, CASE lvl WHEN 'campaign' THEN (SELECT x.id FROM public.ads_campaigns x WHERE (x.tenant_id, x.ad_account_id, x.external_ref) = (p_tenant, p_account, rows.ref))
          WHEN 'adset' THEN (SELECT x.id FROM public.ads_ad_sets x WHERE (x.tenant_id, x.ad_account_id, x.external_ref) = (p_tenant, p_account, rows.ref))
          ELSE (SELECT x.id FROM public.ads_ads x WHERE (x.tenant_id, x.ad_account_id, x.external_ref) = (p_tenant, p_account, rows.ref)) END AS entity_id FROM rows)
      INSERT INTO public.ads_results AS prior(tenant_id, ad_account_id, level, entity_id, day, attribution_model, captured_at, metrics)
        SELECT p_tenant, p_account, lvl, ent.entity_id, ent.day, ent.attribution, instant, ent.metrics FROM ent WHERE ent.entity_id IS NOT NULL AND ent.day BETWEEN (now() at time zone 'UTC')::date - 90 AND (now() at time zone 'UTC')::date
        ON CONFLICT (tenant_id, level, entity_id, day, attribution_model) DO UPDATE SET metrics = excluded.metrics, captured_at = excluded.captured_at WHERE prior.captured_at <= excluded.captured_at;
      GET DIAGNOSTICS n = ROW_COUNT; written := written + n;
    END LOOP;
  END IF;
  UPDATE public.ads_accounts SET sync_state = p_state, synced_at = CASE WHEN p_state = 'ready' THEN instant ELSE synced_at END, sync_due_at = instant + make_interval(secs => p_delay),
    sync_failures = CASE WHEN p_state = 'ready' THEN 0 ELSE least(sync_failures + 1, 20) END, sync_lease = NULL, sync_leased_until = NULL, updated_at = now()
    WHERE (tenant_id, id) = (p_tenant, p_account);
  PERFORM set_config('app.ads_definer', '', true);
  RETURN written;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ads_lead_convert(uuid), public.ads_contact_before_erase(), public.ads_sync_claim(integer), public.ads_sync_apply(uuid,uuid,uuid,text,integer,jsonb) FROM PUBLIC, harvest_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ads_lead_convert(uuid) TO harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.ads_sync_claim(integer), public.ads_sync_apply(uuid,uuid,uuid,text,integer,jsonb) TO harvest_worker;
  END IF;
END $$;
