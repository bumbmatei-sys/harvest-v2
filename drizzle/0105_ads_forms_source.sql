CREATE TABLE "ads_form_publications" (
	"tenant_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"lead_form_id" uuid NOT NULL,
	"published_by" text NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_form_publications_tenant_id_version_id_pk" PRIMARY KEY("tenant_id","version_id"),
	CONSTRAINT "ads_form_publications_definition" CHECK (jsonb_typeof("ads_form_publications"."definition") = 'object' and "ads_form_publications"."definition"->>'kind' = 'crm-form-v1' and "ads_form_publications"."definition" ? 'ads' and octet_length("ads_form_publications"."definition"::text) <= 65536)
);
--> statement-breakpoint
ALTER TABLE "ads_lead_forms" DROP CONSTRAINT "ads_lead_forms_shape";--> statement-breakpoint
ALTER TABLE "contact_first_sources" DROP CONSTRAINT "contact_first_sources_kind";--> statement-breakpoint
ALTER TABLE "contact_source_events" DROP CONSTRAINT "contact_sources_contract";--> statement-breakpoint
ALTER TABLE "ads_lead_forms" ADD COLUMN "form_id" uuid;--> statement-breakpoint
ALTER TABLE "ads_lead_forms" ADD COLUMN "form_version_id" uuid;--> statement-breakpoint
ALTER TABLE "ads_lead_forms" ADD COLUMN "consent_texts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ads_leads" ADD COLUMN "form_version_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD COLUMN "ad_network" text;--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD COLUMN "ad_form_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD COLUMN "ad_campaign_ref" text;--> statement-breakpoint
ALTER TABLE "ads_form_publications" ADD CONSTRAINT "ads_form_publications_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_form_publications" ADD CONSTRAINT "ads_form_publications_form_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."forms"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_form_publications" ADD CONSTRAINT "ads_form_publications_version_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "public"."form_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_form_publications" ADD CONSTRAINT "ads_form_publications_lead_form_fk" FOREIGN KEY ("tenant_id","lead_form_id") REFERENCES "public"."ads_lead_forms"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ads_form_publications_lead_form_idx" ON "ads_form_publications" USING btree ("tenant_id","lead_form_id");--> statement-breakpoint
ALTER TABLE "ads_lead_forms" ADD CONSTRAINT "ads_lead_forms_version_fk" FOREIGN KEY ("tenant_id","form_version_id") REFERENCES "public"."form_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_leads" ADD CONSTRAINT "ads_leads_form_version_fk" FOREIGN KEY ("tenant_id","form_version_id") REFERENCES "public"."form_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_lead_forms" ADD CONSTRAINT "ads_lead_forms_shape" CHECK (length("ads_lead_forms"."name") between 1 and 120 and length("ads_lead_forms"."consent_text") between 1 and 1000 and "ads_lead_forms"."status" in ('active','archived') and jsonb_typeof("ads_lead_forms"."questions") = 'array' and jsonb_typeof("ads_lead_forms"."consent_texts") = 'object' and pg_column_size("ads_lead_forms"."consent_texts") <= 4096);--> statement-breakpoint
ALTER TABLE "contact_first_sources" ADD CONSTRAINT "contact_first_sources_kind" CHECK ("contact_first_sources"."kind" in ('manual', 'csv_import', 'connect', 'form', 'ad_lead'));--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD CONSTRAINT "contact_sources_ad_detail" CHECK (("contact_source_events"."kind" = 'ad_lead') = ("contact_source_events"."ad_network" is not null) and ("contact_source_events"."kind" = 'ad_lead' or ("contact_source_events"."ad_form_id" is null and "contact_source_events"."ad_campaign_ref" is null)) and ("contact_source_events"."ad_campaign_ref" is null or length("contact_source_events"."ad_campaign_ref") <= 200));--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD CONSTRAINT "contact_sources_contract" CHECK (("contact_source_events"."kind" <> 'ad_lead' and ((("contact_source_events"."kind" = 'manual' and "contact_source_events"."outcome" = 'created' and "contact_source_events"."import_id" is null and "contact_source_events"."row_number" is null and "contact_source_events"."reverted_at" is null and "contact_source_events"."response_id" is null and "contact_source_events"."entry_route" is null) or ("contact_source_events"."kind" = 'csv_import' and "contact_source_events"."outcome" in ('created','updated') and "contact_source_events"."import_id" is not null and "contact_source_events"."row_number" is not null and "contact_source_events"."row_number" > 0 and "contact_source_events"."response_id" is null and "contact_source_events"."entry_route" is null) or ("contact_source_events"."kind" = 'connect' and "contact_source_events"."outcome" in ('created','updated') and "contact_source_events"."import_id" is null and "contact_source_events"."row_number" is null and "contact_source_events"."reverted_at" is null and "contact_source_events"."response_id" is not null and "contact_source_events"."entry_route" is not null and "contact_source_events"."entry_route" in ('qr','short'))) and "contact_source_events"."crm_form_response_id" is null or ("contact_source_events"."kind" = 'form' and "contact_source_events"."outcome" in ('created','updated') and "contact_source_events"."import_id" is null and "contact_source_events"."row_number" is null and "contact_source_events"."reverted_at" is null and "contact_source_events"."response_id" is null and "contact_source_events"."entry_route" is null and "contact_source_events"."crm_form_response_id" is not null))) or ("contact_source_events"."kind" = 'ad_lead' and "contact_source_events"."outcome" in ('created','updated') and "contact_source_events"."import_id" is null and "contact_source_events"."row_number" is null and "contact_source_events"."reverted_at" is null and "contact_source_events"."response_id" is null and "contact_source_events"."entry_route" is null and "contact_source_events"."crm_form_response_id" is null));
--> statement-breakpoint
-- Ad lead forms are built in Harvest on the shared forms model (an `ads` preset of the CRM form definition) and published to a network's instant form. A published version has an
-- ads_form_publications row: the form_versions freeze trigger then refuses every edit, so a lead's form_version_id always names the exact questions and consent wording.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ads_form_publications'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO harvest_app', t);
    EXECUTE format('CREATE POLICY ads_admin ON public.%I TO harvest_app USING (public.ads_can(tenant_id)) WITH CHECK (public.ads_can(tenant_id))', t);
    EXECUTE format('CREATE POLICY ads_definer ON public.%I TO PUBLIC USING (current_user <> ''harvest_app'' AND current_setting(''app.ads_definer'', true) = ''on'') WITH CHECK (current_user <> ''harvest_app'' AND current_setting(''app.ads_definer'', true) = ''on'')', t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.ads_form_publication_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'published ad lead form versions are immutable'; END $$;
REVOKE ALL ON FUNCTION public.ads_form_publication_immutable() FROM PUBLIC;
CREATE TRIGGER ads_form_publication_immutable BEFORE UPDATE OR DELETE ON public.ads_form_publications FOR EACH ROW EXECUTE FUNCTION public.ads_form_publication_immutable();
--> statement-breakpoint
-- Once a lead form was published from a Harvest form version, the consent wording, the question mapping and the version are fixed (a network sync may still rename or archive it).
CREATE FUNCTION public.ads_lead_form_frozen() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.form_version_id IS NOT NULL AND (NEW.form_id, NEW.form_version_id, NEW.consent_text, NEW.consent_questions, NEW.consent_texts, NEW.privacy_url)
    IS DISTINCT FROM (OLD.form_id, OLD.form_version_id, OLD.consent_text, OLD.consent_questions, OLD.consent_texts, OLD.privacy_url) THEN
    RAISE EXCEPTION 'a published ad lead form keeps its consent wording and version';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ads_lead_form_frozen() FROM PUBLIC;
CREATE TRIGGER ads_lead_form_frozen BEFORE UPDATE ON public.ads_lead_forms FOR EACH ROW EXECUTE FUNCTION public.ads_lead_form_frozen();
--> statement-breakpoint
-- A version that has been published to a network is frozen like a hosted-form publication (same trigger, one more publication table).
-- NOTE: this trigger is not a definer, so the ads_form_publications check below runs under the CALLER's row security (owner/admin through ads_admin). Any future definer path that updates
-- crm-form-v1 versions must read ads_form_publications under the ads_definer flag (app.ads_definer = 'on'), or it would see no publication and wrongly allow the edit.
CREATE OR REPLACE FUNCTION public.crm_form_freeze_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.definition->>'kind' = 'crm-form-v1') IS DISTINCT FROM
    (OLD.definition->>'kind' = 'crm-form-v1') AND
    (NEW.definition->>'kind' = 'crm-form-v1' OR OLD.definition->>'kind' = 'crm-form-v1') THEN
    RAISE EXCEPTION 'CRM form kind is immutable';
  END IF;
  IF OLD.definition->>'kind' IS DISTINCT FROM 'crm-form-v1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'CRM forms publish through their own lifecycle'; END IF;
  END IF;
  IF EXISTS (SELECT FROM public.crm_form_publications WHERE tenant_id = OLD.tenant_id AND form_id = OLD.form_id AND version_id = OLD.id)
    OR EXISTS (SELECT FROM public.ads_form_publications WHERE tenant_id = OLD.tenant_id AND form_id = OLD.form_id AND version_id = OLD.id) THEN
    RAISE EXCEPTION 'published CRM versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- An ad lead form never becomes a hosted, publicly addressable form (and a hosted form never becomes an ad lead form): the hosted publication refuses an `ads` definition.
CREATE FUNCTION public.crm_form_publication_no_ads() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.definition ? 'ads' THEN RAISE EXCEPTION 'an ad lead form cannot be published as a hosted form'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_form_publication_no_ads() FROM PUBLIC;
CREATE TRIGGER crm_form_publication_no_ads BEFORE INSERT ON public.crm_form_publications FOR EACH ROW EXECUTE FUNCTION public.crm_form_publication_no_ads();
--> statement-breakpoint
-- A lead keeps a reference to the exact form version it answered, whichever path stored it (poll or webhook): taken from the lead form the network reported.
CREATE FUNCTION public.ads_lead_form_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.ads_definer', true), '');
BEGIN
  IF NEW.form_version_id IS NULL AND NEW.form_ref IS NOT NULL THEN
    PERFORM set_config('app.ads_definer', 'on', true);
    SELECT f.form_version_id INTO NEW.form_version_id FROM public.ads_lead_forms f
      WHERE f.tenant_id = NEW.tenant_id AND f.ad_account_id = NEW.ad_account_id AND f.external_ref = NEW.form_ref;
    PERFORM set_config('app.ads_definer', previous, true);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ads_lead_form_version() FROM PUBLIC, harvest_app;
CREATE TRIGGER ads_lead_form_version BEFORE INSERT ON public.ads_leads FOR EACH ROW EXECUTE FUNCTION public.ads_lead_form_version();
--> statement-breakpoint
-- Lead conversion (replaces 0104): consent is still granted only where the form asked and the person said yes, now also for a separate marketing question, with the exact
-- wording id and text as evidence; and the converted person gets the new first source, ad_lead, with network, form and campaign as detail.
CREATE OR REPLACE FUNCTION public.ads_lead_convert(p_lead uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); t uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  l record; f record; fields jsonb; nm text; em text; ph text; person uuid; created boolean := false; matching uuid[]; k text; granted text[] := '{}'; purpose text; qkey text; ans text; chan text; wording text; shown text;
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
    -- The contact insert credits a provisional manual source; the ad lead replaces it (the hosted-form rule).
    DELETE FROM public.contact_source_events WHERE tenant_id = t AND contact_id = person AND kind = 'manual';
  END IF;
  -- Explicit asks only: the form mapped a question to the purpose and this person answered yes.
  IF f.id IS NOT NULL THEN
    FOREACH purpose IN ARRAY ARRAY['newsletter', 'form_follow_up', 'marketing'] LOOP
      qkey := f.consent_questions ->> purpose;
      ans := lower(btrim(coalesce(fields ->> qkey, '')));
      IF qkey IS NOT NULL AND ans IN ('yes', 'true', '1', 'on', 'checked')
        -- Frozen at receipt: the lead must carry the notice text the form still has, and the version it answered must be the form's version (the per-question wording is frozen with it).
        AND l.consent_text IS NOT NULL AND btrim(l.consent_text) = btrim(f.consent_text) AND (f.form_version_id IS NULL OR l.form_version_id IS NOT DISTINCT FROM f.form_version_id) THEN
        -- The newsletter is email only; follow-up and marketing use the address the person gave, else the phone.
        chan := CASE WHEN purpose = 'newsletter' THEN CASE WHEN em IS NOT NULL THEN 'email' END ELSE CASE WHEN em IS NOT NULL THEN 'email' ELSE 'sms' END END;
        IF chan IS NOT NULL THEN
          -- A form built in Harvest keeps, per question, the wording id and the exact text shown (immutable once published). An older form keeps its single consent text.
          wording := f.consent_texts -> purpose ->> 'wording';
          shown := coalesce(f.consent_texts -> purpose ->> 'text', l.consent_text);
          INSERT INTO public.contact_consents(tenant_id, contact_id, recorded_by, purpose, notice_version, channel, status, source, evidence, occurred_at)
            VALUES (t, person, actor, purpose, 'ad-lead-form-v1', chan, 'granted', 'ad_lead_form',
              left(CASE WHEN wording IS NOT NULL THEN '[' || wording || '] ' ELSE '' END || btrim(shown), 1500) || ' [lead answered yes: ' || qkey || ']', least(coalesce(l.submitted_at, now()), now()));
          granted := granted || purpose;
        END IF;
      END IF;
    END LOOP;
  END IF;
  -- The ad lead is a source of the person: network, the Harvest form and the campaign reference only. The durable first source is credited by the existing trigger.
  INSERT INTO public.contact_source_events(tenant_id, contact_id, kind, outcome, occurred_at, ad_network, ad_form_id, ad_campaign_ref)
    VALUES (t, person, 'ad_lead', CASE WHEN created THEN 'created' ELSE 'updated' END, least(coalesce(l.submitted_at, now()), now()), l.network, f.id, left(l.campaign_ref, 200));
  UPDATE public.ads_leads SET contact_id = person, converted_at = now(), updated_at = now(), version = version + 1 WHERE tenant_id = t AND id = p_lead;
  INSERT INTO public.audit_logs(tenant_id, actor_id, action, target_id, metadata) VALUES (t, actor, 'ads.lead_convert', p_lead::text, jsonb_build_object('created', created::text, 'grants', array_to_string(granted, ',')));
  PERFORM set_config('app.ads_definer', '', true); PERFORM set_config('app.ads_convert_tenant', '', true);
  RETURN jsonb_build_object('outcome', 'converted', 'contactId', person, 'created', created, 'granted', to_jsonb(granted));
END $$;
REVOKE ALL ON FUNCTION public.ads_lead_convert(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ads_lead_convert(uuid) TO harvest_app;
