CREATE FUNCTION public.valid_crm_form_slug(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
  SELECT value ~ '^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])$'
    AND value NOT LIKE '%--%'
    AND value NOT IN ('admin','api','app','assets','auth','edit','f','forms','health','login','new','preview','q','responses','s','settings','sign-in','submit','workspace','workspaces')
$$;
--> statement-breakpoint
CREATE TABLE "crm_form_addresses" (
	"tenant_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"version_id" uuid,
	"retired_at" timestamp with time zone,
	CONSTRAINT "crm_form_addresses_tenant_id_form_id_pk" PRIMARY KEY("tenant_id","form_id"),
	CONSTRAINT "crm_form_address_slug" CHECK (public.valid_crm_form_slug("crm_form_addresses"."slug")),
	CONSTRAINT "crm_form_address_state" CHECK (("crm_form_addresses"."version_id" is null) = ("crm_form_addresses"."retired_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "crm_form_publications" (
	"tenant_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"notice_version_id" uuid NOT NULL,
	"published_by" text NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_form_publications_tenant_id_form_id_version_id_pk" PRIMARY KEY("tenant_id","form_id","version_id"),
	CONSTRAINT "crm_form_publication_definition" CHECK (jsonb_typeof("crm_form_publications"."definition") = 'object' and "crm_form_publications"."definition"->>'kind' = 'crm-form-v1' and octet_length("crm_form_publications"."definition"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "crm_form_quotas" (
	"scope" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "crm_form_quotas_scope_minute_pk" PRIMARY KEY("scope","minute")
);
--> statement-breakpoint
CREATE TABLE "crm_form_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_form_responses" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"company_id" uuid,
	"campaign_id" uuid,
	"qr_link_id" uuid,
	"owner_id" text,
	"labels" text[] NOT NULL,
	"answers" jsonb NOT NULL,
	"consent_block_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_contact" boolean NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "crm_form_responses_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_form_response_answers" CHECK (jsonb_typeof("crm_form_responses"."answers") = 'object' and octet_length("crm_form_responses"."answers"::text) <= 65536 and ("crm_form_responses"."answers"->>"crm_form_responses"."consent_block_id" = 'yes') is true),
	CONSTRAINT "crm_form_response_request_hash" CHECK ("crm_form_responses"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "crm_form_response_expiry" CHECK ("crm_form_responses"."expires_at" > "crm_form_responses"."submitted_at")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_system_actor";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "form_owner_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "form_labels" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_form_addresses" ADD CONSTRAINT "crm_form_address_form_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."forms"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_addresses" ADD CONSTRAINT "crm_form_address_version_fk" FOREIGN KEY ("tenant_id","form_id","version_id") REFERENCES "public"."crm_form_publications"("tenant_id","form_id","version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_publications" ADD CONSTRAINT "crm_form_publications_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_publications" ADD CONSTRAINT "crm_form_publication_form_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."forms"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_publications" ADD CONSTRAINT "crm_form_publication_version_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "public"."form_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_publications" ADD CONSTRAINT "crm_form_publication_notice_fk" FOREIGN KEY ("tenant_id","notice_version_id") REFERENCES "public"."privacy_notice_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_responses" ADD CONSTRAINT "crm_form_responses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_responses" ADD CONSTRAINT "crm_form_response_publication_fk" FOREIGN KEY ("tenant_id","form_id","version_id") REFERENCES "public"."crm_form_publications"("tenant_id","form_id","version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_responses" ADD CONSTRAINT "crm_form_response_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_responses" ADD CONSTRAINT "crm_form_response_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_responses" ADD CONSTRAINT "crm_form_response_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_form_responses" ADD CONSTRAINT "crm_form_response_qr_fk" FOREIGN KEY ("tenant_id","qr_link_id") REFERENCES "public"."campaign_response_links"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_form_address_slug_idx" ON "crm_form_addresses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "crm_form_quota_expiry_idx" ON "crm_form_quotas" USING btree ("minute");--> statement-breakpoint
CREATE INDEX "crm_form_receipt_expiry_idx" ON "crm_form_receipts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "crm_form_responses_listing_idx" ON "crm_form_responses" USING btree ("tenant_id","form_id","submitted_at","id");--> statement-breakpoint
CREATE INDEX "crm_form_responses_contact_idx" ON "crm_form_responses" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "crm_form_responses_expiry_idx" ON "crm_form_responses" USING btree ("tenant_id","expires_at");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_form_owner_id_users_id_fk" FOREIGN KEY ("form_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_system_actor" CHECK ("audit_logs"."actor_id" is not null or "audit_logs"."action" in ('followup.case.withdraw', 'followup.case.revoke', 'community.live.auto_close', 'community.moderation_report_expire', 'newsletter.signup.confirmed', 'newsletter.unsubscribe.list', 'newsletter.unsubscribe.all', 'newsletter.withdrawal.propagated', 'community.profile_save', 'community.profile_withdraw', 'community.profile_erase', 'crm.form.submit'));
--> statement-breakpoint
-- Only the migration owner can use the definer policies. The app can read its own
-- workspace's metadata and unexpired responses as a currently authorized manager.
DO $$
DECLARE rel text;
  tenant_scope text := $scope$tenant_id = nullif(current_setting('app.crm_forms_tenant', true), '')::uuid$scope$;
  resolved_form text := $scope$nullif(current_setting('app.crm_forms_tenant', true), '') IS NOT NULL$scope$;
BEGIN
  FOREACH rel IN ARRAY ARRAY['crm_form_addresses','crm_form_publications','crm_form_responses','crm_form_quotas','crm_form_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['crm_form_addresses','crm_form_publications','crm_form_responses'] LOOP
    EXECUTE format('CREATE POLICY crm_form_manager_read ON public.%I FOR SELECT TO harvest_app USING (
      tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid
      AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = %I.tenant_id
        AND m.user_id = nullif(current_setting(''app.user_id'', true), '''') AND m.role_id IN (''owner'', ''admin'')) %s)',
      rel, rel, CASE WHEN rel = 'crm_form_responses' THEN 'AND expires_at > now()' ELSE '' END);
  END LOOP;
  EXECUTE format('CREATE POLICY crm_form_address_resolve ON public.crm_form_addresses FOR SELECT TO %I USING (
    slug = nullif(current_setting(''app.crm_forms_slug'', true), ''''))', current_user);
  FOREACH rel IN ARRAY ARRAY['crm_form_addresses','crm_form_responses','privacy_notice_versions','workspace_members',
    'companies','crm_pipelines','crm_pipeline_stages','opportunities'] LOOP
    EXECUTE format('CREATE POLICY crm_form_definer_tenant ON public.%I TO %I USING (%s) WITH CHECK (%s)',
      rel, current_user, tenant_scope, tenant_scope);
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['forms','form_versions','crm_form_publications'] LOOP
    EXECUTE format('CREATE POLICY crm_form_definer_read ON public.%I FOR SELECT TO %I USING (%s)', rel, current_user, tenant_scope);
  END LOOP;
  EXECUTE format('CREATE POLICY crm_form_publication_lock ON public.form_versions FOR UPDATE TO %I USING (%s) WITH CHECK (false)', current_user, tenant_scope);
  EXECUTE format('CREATE POLICY crm_form_publication_insert ON public.crm_form_publications FOR INSERT TO %I WITH CHECK (%s)', current_user, tenant_scope);
  EXECUTE format('CREATE POLICY crm_form_quota_access ON public.crm_form_quotas TO %I USING (%s) WITH CHECK (%s)', current_user, resolved_form, resolved_form);
  EXECUTE format('CREATE POLICY crm_form_receipt_access ON public.crm_form_receipts TO %I USING (%s) WITH CHECK (%s)', current_user, resolved_form, resolved_form);
  EXECUTE format('CREATE POLICY crm_form_submit_audit ON public.audit_logs FOR INSERT TO %I WITH CHECK (
    %s AND actor_id IS NULL AND action = ''crm.form.submit'')', current_user, tenant_scope);
END $$;
GRANT SELECT ON public.crm_form_addresses, public.crm_form_publications, public.crm_form_responses TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.crm_form_transition_scoped(p_tenant uuid, p_form uuid, p_action text, p_slug text, p_revision integer)
RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); draft record; address record;
  notice uuid; consent jsonb; notice_number integer; active_version uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE insufficient_privilege;
  END IF;
  PERFORM set_config('app.crm_forms_tenant', p_tenant::text, true);
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-form:' || p_tenant || ':' || p_form, 0));
  SELECT v.id, v.definition INTO draft FROM public.form_versions v
    JOIN public.forms f ON f.tenant_id = v.tenant_id AND f.id = v.form_id
    WHERE v.tenant_id = p_tenant AND v.form_id = p_form AND f.archived_at IS NULL
      AND v.status = 'draft' AND v.definition->>'kind' = 'crm-form-v1'
    ORDER BY v.version DESC LIMIT 1 FOR SHARE OF v;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT * INTO address FROM public.crm_form_addresses WHERE tenant_id = p_tenant AND form_id = p_form FOR UPDATE;
  IF p_action = 'retire' THEN
    IF address.version_id IS NULL THEN RETURN 'unchanged'; END IF;
    UPDATE public.crm_form_addresses SET version_id = NULL, retired_at = now() WHERE tenant_id = p_tenant AND form_id = p_form;
    active_version := address.version_id;
  ELSIF p_action = 'publish' THEN
    IF public.valid_crm_form_slug(p_slug) IS NOT TRUE THEN RETURN 'invalid_slug'; END IF;
    IF address.slug IS NOT NULL AND address.slug <> p_slug THEN RETURN 'immutable_slug'; END IF;
    IF (draft.definition->>'revision')::integer IS DISTINCT FROM p_revision THEN RETURN 'stale'; END IF;
    IF address.version_id = draft.id THEN RETURN 'unchanged'; END IF;
    SELECT block INTO consent FROM jsonb_array_elements(draft.definition->'blocks') block
      WHERE block->>'type' = 'consent' AND block->'required' = 'true'::jsonb;
    IF nullif(btrim(consent->>'text'), '') IS NULL THEN RETURN 'invalid_notice'; END IF;
    IF draft.definition #>> '{settings,ownerId}' IS NOT NULL THEN
      PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant
        AND user_id = draft.definition #>> '{settings,ownerId}' FOR SHARE;
      IF NOT FOUND THEN RETURN 'invalid_owner'; END IF;
    END IF;

    SELECT notice_version_id INTO notice FROM public.crm_form_publications
      WHERE tenant_id = p_tenant AND form_id = p_form AND version_id = draft.id;
    IF NOT FOUND THEN
      -- The new notice key identifies a form-processing acknowledgement only.
      -- Existing Connect and CRM notice keys and purposes keep their original semantics.
      PERFORM pg_advisory_xact_lock(hashtextextended('crm-form-notice:' || p_tenant, 0));
      SELECT coalesce(max(version), 0) + 1 INTO notice_number FROM public.privacy_notice_versions
        WHERE tenant_id = p_tenant AND notice_key = 'crm-hosted-form-v1' AND locale = 'en';
      INSERT INTO public.privacy_notice_versions (tenant_id, notice_key, version, locale, body, created_by)
        VALUES (p_tenant, 'crm-hosted-form-v1', notice_number, 'en', consent->>'text', actor) RETURNING id INTO notice;
      INSERT INTO public.crm_form_publications (tenant_id, form_id, version_id, notice_version_id, published_by, definition)
        VALUES (p_tenant, p_form, draft.id, notice, actor, draft.definition);
    END IF;
    INSERT INTO public.crm_form_addresses (tenant_id, form_id, slug, version_id) VALUES (p_tenant, p_form, p_slug, draft.id)
      ON CONFLICT (tenant_id, form_id) DO UPDATE SET version_id = excluded.version_id, retired_at = NULL;
    active_version := draft.id;
  ELSE
    RETURN 'invalid_action';
  END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'crm.form.' || p_action, p_form::text, jsonb_build_object('versionId', active_version));
  RETURN 'ok';
EXCEPTION WHEN unique_violation THEN
  RETURN 'slug_taken';
END $$;
REVOKE ALL ON FUNCTION public.crm_form_transition_scoped(uuid, uuid, text, text, integer) FROM PUBLIC, harvest_app;

CREATE FUNCTION public.crm_form_transition(p_tenant uuid, p_form uuid, p_action text, p_slug text, p_revision integer)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result text;
  prior_crm_forms_tenant text := current_setting('app.crm_forms_tenant', true);
BEGIN
  PERFORM set_config('app.crm_forms_tenant', '', true);
  result := public.crm_form_transition_scoped($1, $2, $3, $4, $5);
  PERFORM set_config('app.crm_forms_tenant', coalesce(prior_crm_forms_tenant, ''), true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_form_transition(uuid, uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_form_transition(uuid, uuid, text, text, integer) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.crm_form_guard_address() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.tenant_id, NEW.form_id, NEW.slug) IS DISTINCT FROM (OLD.tenant_id, OLD.form_id, OLD.slug) THEN
    RAISE EXCEPTION 'published CRM form addresses are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_form_guard_address BEFORE UPDATE ON public.crm_form_addresses
  FOR EACH ROW EXECUTE FUNCTION public.crm_form_guard_address();
--> statement-breakpoint
-- A published draft becomes read-only. The editor inserts a new draft on the next save.
CREATE FUNCTION public.crm_form_freeze_draft() RETURNS trigger
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
  IF EXISTS (SELECT FROM public.crm_form_publications WHERE tenant_id = OLD.tenant_id AND form_id = OLD.form_id AND version_id = OLD.id) THEN
    RAISE EXCEPTION 'published CRM versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_form_freeze_draft BEFORE UPDATE OR DELETE ON public.form_versions
  FOR EACH ROW EXECUTE FUNCTION public.crm_form_freeze_draft();
--> statement-breakpoint
CREATE FUNCTION public.crm_form_public_form_scoped(p_slug text, p_charge boolean)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE address record; snapshot record; bucket text; attempts integer; minute_start timestamptz := date_trunc('minute', clock_timestamp());
BEGIN
  IF current_database() !~ '^harvest_test(_|$)' OR public.valid_crm_form_slug(p_slug) IS NOT TRUE THEN RETURN NULL; END IF;
  PERFORM set_config('app.crm_forms_slug', p_slug, true);
  SELECT * INTO address FROM public.crm_form_addresses WHERE slug = p_slug AND retired_at IS NULL AND version_id IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM set_config('app.crm_forms_tenant', address.tenant_id::text, true);
  SELECT v.definition, v.notice_version_id, n.body, n.body_sha256, n.version INTO snapshot
    FROM public.crm_form_publications v
    JOIN public.privacy_notice_versions n ON n.tenant_id = v.tenant_id AND n.id = v.notice_version_id AND n.notice_key = 'crm-hosted-form-v1'
    JOIN public.forms f ON f.tenant_id = v.tenant_id AND f.id = v.form_id AND f.archived_at IS NULL
    WHERE v.tenant_id = address.tenant_id AND v.form_id = address.form_id AND v.version_id = address.version_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_charge THEN
    DELETE FROM public.crm_form_quotas WHERE minute < minute_start - interval '2 minutes';
    FOREACH bucket IN ARRAY ARRAY['*', address.slug] LOOP
      INSERT INTO public.crm_form_quotas (scope, minute, attempts) VALUES (bucket, minute_start, 1)
        ON CONFLICT (scope, minute) DO UPDATE SET attempts = least(public.crm_form_quotas.attempts + 1, 601)
        RETURNING crm_form_quotas.attempts INTO attempts;
      IF attempts > (CASE WHEN bucket = '*' THEN 600 ELSE 30 END) THEN RETURN '{"limited":true}'::jsonb; END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('versionId', address.version_id, 'definition', snapshot.definition,
    'notice', jsonb_build_object('version', snapshot.version, 'body', snapshot.body, 'hash', snapshot.body_sha256));
END $$;
REVOKE ALL ON FUNCTION public.crm_form_public_form_scoped(text, boolean) FROM PUBLIC, harvest_app;

CREATE FUNCTION public.crm_form_public_form(p_slug text, p_charge boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
  prior_crm_forms_slug text := current_setting('app.crm_forms_slug', true);
  prior_crm_forms_tenant text := current_setting('app.crm_forms_tenant', true);
BEGIN
  PERFORM set_config('app.crm_forms_slug', '', true);
  PERFORM set_config('app.crm_forms_tenant', '', true);
  result := public.crm_form_public_form_scoped($1, $2);
  PERFORM set_config('app.crm_forms_slug', coalesce(prior_crm_forms_slug, ''), true);
  PERFORM set_config('app.crm_forms_tenant', coalesce(prior_crm_forms_tenant, ''), true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_form_public_form(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_form_public_form(text, boolean) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.crm_form_submit_scoped(p_slug text, p_version uuid, p_receipt uuid, p_proof_expiry timestamptz,
  p_answers jsonb, p_consent text, p_campaign uuid, p_qr text, p_request_hash text)
RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE address record; snapshot record; existing_hash text; tenant uuid; active_campaign uuid; qr_link uuid;
  fields jsonb; person uuid; organization uuid; owner_id text; labels text[]; matching_contacts uuid[];
  address_email text; phone text; social text; company_name text; company_key text; name text;
  was_created boolean := false; identity_key text; pipeline uuid; stage uuid; deal_position double precision; at_time timestamptz := clock_timestamp();
BEGIN
  IF current_database() !~ '^harvest_test(_|$)' OR public.valid_crm_form_slug(p_slug) IS NOT TRUE THEN RETURN 'not_found'; END IF;
  PERFORM set_config('app.crm_forms_slug', p_slug, true);
  -- The address must still be current after admission and JSON validation. The lock
  -- serializes acceptance with retirement and replacement of the published snapshot.
  SELECT a.* INTO address FROM public.crm_form_addresses a
    WHERE a.slug = p_slug AND a.version_id = p_version AND a.retired_at IS NULL;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  tenant := address.tenant_id;
  PERFORM set_config('app.crm_forms_tenant', tenant::text, true);
  PERFORM set_config('app.tenant_id', tenant::text, true);
  PERFORM 1 FROM public.crm_form_addresses a WHERE a.tenant_id = tenant AND a.form_id = address.form_id
    AND a.version_id = p_version AND a.retired_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT v.definition, v.published_by INTO snapshot FROM public.crm_form_publications v
    JOIN public.forms f ON f.tenant_id = v.tenant_id AND f.id = v.form_id AND f.archived_at IS NULL
    WHERE v.tenant_id = tenant AND v.form_id = address.form_id AND v.version_id = p_version;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF p_receipt IS NULL OR p_proof_expiry IS NULL OR p_proof_expiry <= at_time
    OR p_proof_expiry > at_time + interval '10 minutes' OR (p_request_hash ~ '^[a-f0-9]{64}$') IS NOT TRUE OR jsonb_typeof(p_answers) IS DISTINCT FROM 'object'
    OR octet_length(p_answers::text) > 65536 OR (p_answers->>p_consent) IS DISTINCT FROM 'yes'
    OR NOT EXISTS (SELECT FROM jsonb_array_elements(snapshot.definition->'blocks') b
      WHERE b->>'id' = p_consent AND b->>'type' = 'consent' AND b->'required' = 'true'::jsonb)
    OR EXISTS (SELECT FROM jsonb_object_keys(p_answers) AS answer(id) WHERE NOT EXISTS (
      SELECT FROM jsonb_array_elements(snapshot.definition->'blocks') b
      WHERE b->>'id' = answer.id AND b->>'type' NOT IN ('info','upload'))) THEN RETURN 'invalid'; END IF;

  -- A receipt contains only a random nonce. A deleted response cannot be recreated
  -- with its old proof, even while that proof has time remaining.
  DELETE FROM public.crm_form_receipts WHERE expires_at <= at_time;
  INSERT INTO public.crm_form_receipts(id, expires_at) VALUES (p_receipt, p_proof_expiry) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT r.request_hash INTO existing_hash FROM public.crm_form_responses r
      WHERE r.tenant_id = tenant AND r.id = p_receipt AND r.version_id = p_version;
    IF NOT FOUND OR existing_hash = p_request_hash THEN RETURN 'ok'; END IF;
    RETURN 'conflict';
  END IF;

  IF p_qr IS NOT NULL THEN
    IF snapshot.definition #> '{settings,hiddenSource}' IS DISTINCT FROM 'true'::jsonb THEN RAISE invalid_parameter_value; END IF;
    SELECT l.id, l.campaign_id INTO qr_link, active_campaign FROM public.campaign_response_links l
      WHERE l.tenant_id = tenant AND l.public_code = p_qr AND l.status = 'published'
        AND (l.expires_at IS NULL OR l.expires_at > at_time) FOR SHARE;
    IF NOT FOUND THEN RAISE invalid_parameter_value; END IF;
  END IF;
  IF p_campaign IS NOT NULL THEN
    IF snapshot.definition #> '{settings,hiddenCampaign}' IS DISTINCT FROM 'true'::jsonb
      OR (active_campaign IS NOT NULL AND active_campaign <> p_campaign) THEN RAISE invalid_parameter_value; END IF;
    active_campaign := p_campaign;
  END IF;
  IF active_campaign IS NOT NULL THEN
    -- Reuse the exact-campaign row lock that protects Connect submissions.
    PERFORM set_config('app.connect_campaign', active_campaign::text, true);
    PERFORM 1 FROM public.campaigns WHERE tenant_id = tenant AND id = active_campaign
      AND archived_at IS NULL AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RAISE invalid_parameter_value; END IF;
  END IF;

  SELECT jsonb_object_agg(b->>'mapTo', p_answers->(b->>'id')) INTO fields
    FROM jsonb_array_elements(snapshot.definition->'blocks') b
    WHERE b->>'mapTo' IS NOT NULL AND p_answers ? (b->>'id');
  name := nullif(btrim(fields->>'name'), '');
  address_email := nullif(lower(btrim(fields->>'email')), '');
  phone := nullif(regexp_replace(fields->>'phone', '[[:space:]().-]', '', 'g'), '');
  social := nullif(btrim(fields->>'social'), '');
  company_name := nullif(btrim(fields->>'organization'), '');
  owner_id := snapshot.definition #>> '{settings,ownerId}';
  labels := ARRAY(SELECT DISTINCT value FROM jsonb_array_elements_text(snapshot.definition #> '{settings,labels}') ORDER BY value);
  IF name IS NULL OR length(name) > 100 OR (address_email IS NULL AND phone IS NULL)
    OR (address_email IS NOT NULL AND (length(address_email) > 254 OR address_email !~ '^[^@[:space:]]+@example[.]test$'))
    OR (phone IS NOT NULL AND phone !~ '^\+120255501[0-9]{2}$')
    OR length(company_name) > 100 OR length(btrim(fields->>'notes')) > 5000
    OR (social IS NOT NULL AND (length(social) > 100 OR social !~* '^@?[a-z0-9_][a-z0-9_.:-]*$')) THEN RAISE invalid_parameter_value; END IF;
  IF owner_id IS NOT NULL THEN
    PERFORM 1 FROM public.workspace_members WHERE tenant_id = tenant AND user_id = owner_id FOR SHARE;
    IF NOT FOUND THEN RAISE invalid_parameter_value; END IF;
  END IF;

  -- Use the canonical tenant + normalized identifier keys. The index protects
  -- against concurrent manual/import writers and the contact lock against erase/merge.
  FOR identity_key IN SELECT key FROM unnest(ARRAY['email:' || address_email, 'phone:' || phone]) key WHERE key IS NOT NULL ORDER BY key LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(tenant || ':' || identity_key, 0));
  END LOOP;
  SELECT array_agg(id ORDER BY id) INTO matching_contacts FROM (
    SELECT c.id FROM public.contacts c WHERE c.tenant_id = tenant AND c.erased_at IS NULL AND EXISTS (
      SELECT FROM public.contact_identifiers i WHERE i.tenant_id = tenant AND i.contact_id = c.id
        AND ((i.kind = 'email' AND i.normalized_value = address_email) OR (i.kind = 'phone' AND i.normalized_value = phone)))
    ORDER BY c.id FOR UPDATE
  ) matched;
  IF cardinality(matching_contacts) > 1 THEN RAISE integrity_constraint_violation; END IF;
  person := matching_contacts[1];
  IF person IS NULL THEN
    INSERT INTO public.contacts(tenant_id, name, notes, form_owner_id, form_labels)
      VALUES (tenant, name, coalesce(btrim(fields->>'notes'), ''), owner_id, labels) RETURNING id INTO person;
    INSERT INTO public.contact_identifiers(tenant_id, contact_id, kind, value, normalized_value)
      SELECT tenant, person, kind, value, value FROM (VALUES ('email',address_email), ('phone',phone)) i(kind,value) WHERE value IS NOT NULL;
    IF social IS NOT NULL THEN
      INSERT INTO public.contact_identifiers(tenant_id, contact_id, kind, value, normalized_value)
        VALUES (tenant, person, 'social', social, lower(ltrim(social, '@'))) ON CONFLICT DO NOTHING;
    END IF;
    was_created := true;
  ELSE
    -- Recheck after locking: a concurrent merge or identifier edit may have won.
    IF NOT EXISTS (SELECT FROM public.contact_identifiers i WHERE i.tenant_id = tenant AND i.contact_id = person
        AND ((i.kind = 'email' AND i.normalized_value = address_email) OR (i.kind = 'phone' AND i.normalized_value = phone))) THEN
      RAISE serialization_failure;
    END IF;
  END IF;

  IF snapshot.definition #>> '{destination,type}' = 'organizations' AND company_name IS NULL THEN RAISE invalid_parameter_value; END IF;
  -- The publisher is the recorded configuration actor on CRM rows that require
  -- one. Submission audit is separate and system-attributed.
  PERFORM set_config('app.user_id', snapshot.published_by, true);
  IF company_name IS NOT NULL THEN
    company_key := lower(regexp_replace(company_name, '[[:space:]]+', ' ', 'g'));
    PERFORM pg_advisory_xact_lock(hashtextextended(tenant || ':crm-form-company:' || company_key, 0));
    SELECT array_agg(id ORDER BY id) INTO matching_contacts FROM public.companies
      WHERE tenant_id = tenant AND normalized_name = company_key;
    IF cardinality(matching_contacts) > 1 THEN RAISE integrity_constraint_violation; END IF;
    organization := matching_contacts[1];
    IF organization IS NULL THEN
      INSERT INTO public.companies(tenant_id, name, created_by)
        VALUES (tenant, company_name, snapshot.published_by) RETURNING id INTO organization;
    END IF;
    -- An unverified submitter can report an organization on the response, but
    -- only a newly created person gets a durable CRM company link from it.
    IF was_created THEN
      INSERT INTO public.contact_company_links(tenant_id, contact_id, company_id, is_primary, created_by)
        VALUES (tenant, person, organization, true, snapshot.published_by);
    END IF;
  END IF;
  IF snapshot.definition #>> '{destination,type}' = 'pipeline' THEN
    pipeline := (snapshot.definition #>> '{destination,pipelineId}')::uuid;
    PERFORM 1 FROM public.crm_pipelines WHERE tenant_id = tenant AND id = pipeline AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE invalid_parameter_value; END IF;
    SELECT id INTO stage FROM public.crm_pipeline_stages WHERE tenant_id = tenant AND pipeline_id = pipeline
      AND kind = 'open' AND archived_at IS NULL ORDER BY position, id LIMIT 1 FOR SHARE;
    IF NOT FOUND THEN RAISE invalid_parameter_value; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('crm_stage_column:' || tenant || ':' || stage));
    SELECT coalesce(max(position), 0) + 1 INTO deal_position FROM public.opportunities WHERE tenant_id = tenant AND stage_id = stage;
    INSERT INTO public.opportunities(tenant_id, name, pipeline_id, stage_id, contact_id, company_id, owner_user_id, position, created_by)
      VALUES (tenant, snapshot.definition->>'title', pipeline, stage, person, organization, owner_id, deal_position, snapshot.published_by);
  END IF;
  INSERT INTO public.crm_form_responses(tenant_id, id, form_id, version_id, contact_id, company_id, campaign_id,
    qr_link_id, owner_id, labels, answers, consent_block_id, request_hash, created_contact, submitted_at, expires_at)
    VALUES (tenant, p_receipt, address.form_id, p_version, person, organization, active_campaign, qr_link,
      owner_id, labels, p_answers, p_consent, p_request_hash, was_created, at_time, at_time + interval '30 days');
  INSERT INTO public.audit_logs(tenant_id, action, target_id, metadata)
    VALUES (tenant, 'crm.form.submit', address.form_id::text, jsonb_build_object('versionId', p_version));
  RETURN 'ok';
EXCEPTION
  WHEN invalid_parameter_value THEN RETURN 'invalid';
  WHEN integrity_constraint_violation THEN RETURN 'conflict';
END $$;
REVOKE ALL ON FUNCTION public.crm_form_submit_scoped(text, uuid, uuid, timestamptz, jsonb, text, uuid, text, text) FROM PUBLIC, harvest_app;

CREATE FUNCTION public.crm_form_submit(p_slug text, p_version uuid, p_receipt uuid, p_proof_expiry timestamptz,
  p_answers jsonb, p_consent text, p_campaign uuid, p_qr text, p_request_hash text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result text;
  prior_crm_forms_slug text := current_setting('app.crm_forms_slug', true);
  prior_crm_forms_tenant text := current_setting('app.crm_forms_tenant', true);
  prior_campaign text := current_setting('app.connect_campaign', true);
  prior_tenant_id text := current_setting('app.tenant_id', true);
  prior_user_id text := current_setting('app.user_id', true);
BEGIN
  PERFORM set_config('app.crm_forms_slug', '', true);
  PERFORM set_config('app.crm_forms_tenant', '', true);
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.connect_campaign', '', true);
  result := public.crm_form_submit_scoped($1, $2, $3, $4, $5, $6, $7, $8, $9);
  PERFORM set_config('app.crm_forms_slug', coalesce(prior_crm_forms_slug, ''), true);
  PERFORM set_config('app.crm_forms_tenant', coalesce(prior_crm_forms_tenant, ''), true);
  PERFORM set_config('app.tenant_id', coalesce(prior_tenant_id, ''), true);
  PERFORM set_config('app.user_id', coalesce(prior_user_id, ''), true);
  PERFORM set_config('app.connect_campaign', coalesce(prior_campaign, ''), true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_form_submit(text, uuid, uuid, timestamptz, jsonb, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_form_submit(text, uuid, uuid, timestamptz, jsonb, text, uuid, text, text) TO harvest_app;
--> statement-breakpoint
-- Erasure drops the answers, attribution and acknowledgement before the
-- contact's composite key is replaced. The nonce stays until proof expiry.
CREATE FUNCTION public.crm_form_contact_before_rekey() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := current_setting('app.crm_forms_tenant', true);
BEGIN
  PERFORM set_config('app.crm_forms_tenant', OLD.tenant_id::text, true);
  DELETE FROM public.crm_form_responses WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id;
  NEW.form_owner_id := NULL;
  NEW.form_labels := ARRAY[]::text[];
  PERFORM set_config('app.crm_forms_tenant', coalesce(previous, ''), true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_form_contact_before_rekey() FROM PUBLIC, harvest_app;
CREATE TRIGGER crm_form_contact_before_rekey BEFORE UPDATE OF id ON public.contacts
  FOR EACH ROW WHEN (OLD.id IS DISTINCT FROM NEW.id AND NEW.erased_at IS NOT NULL)
  EXECUTE FUNCTION public.crm_form_contact_before_rekey();
--> statement-breakpoint
ALTER FUNCTION public.merge_contacts(uuid, uuid, uuid) RENAME TO merge_contacts_before_crm_forms;
REVOKE ALL ON FUNCTION public.merge_contacts_before_crm_forms(uuid, uuid, uuid) FROM PUBLIC, harvest_app;
CREATE FUNCTION public.merge_contacts_scoped(p_tenant uuid, p_target uuid, p_source uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE merged jsonb;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.crm_forms_tenant', p_tenant::text, true);
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = nullif(current_setting('app.user_id', true), '')
    AND role_id IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  IF p_target = p_source THEN RAISE invalid_parameter_value; END IF;
  PERFORM 1 FROM public.contacts WHERE tenant_id = p_tenant AND id IN (p_target, p_source) AND erased_at IS NULL ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.contacts WHERE tenant_id = p_tenant AND id IN (p_target, p_source) AND erased_at IS NULL) <> 2 THEN RETURN NULL; END IF;
  UPDATE public.crm_form_responses SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  merged := public.merge_contacts_before_crm_forms(p_tenant, p_target, p_source);
  IF merged IS NULL THEN RAISE serialization_failure; END IF;
  RETURN merged;
END $$;
REVOKE ALL ON FUNCTION public.merge_contacts_scoped(uuid, uuid, uuid) FROM PUBLIC, harvest_app;

CREATE FUNCTION public.merge_contacts(p_tenant uuid, p_target uuid, p_source uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
  prior_crm_forms_tenant text := current_setting('app.crm_forms_tenant', true);
BEGIN
  PERFORM set_config('app.crm_forms_tenant', '', true);
  result := public.merge_contacts_scoped($1, $2, $3);
  PERFORM set_config('app.crm_forms_tenant', coalesce(prior_crm_forms_tenant, ''), true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid, uuid) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.crm_form_purge_expired_scoped(p_tenant uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); removed integer;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.crm_forms_tenant', p_tenant::text, true);
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  DELETE FROM public.crm_form_responses r WHERE r.tenant_id = p_tenant AND r.id IN (
    SELECT id FROM public.crm_form_responses WHERE tenant_id = p_tenant AND expires_at <= now()
      ORDER BY expires_at, id LIMIT 100 FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed > 0 THEN
    INSERT INTO public.audit_logs(tenant_id, actor_id, action, metadata)
      VALUES (p_tenant, actor, 'crm.form.responses_purge', jsonb_build_object('count', removed));
  END IF;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.crm_form_purge_expired_scoped(uuid) FROM PUBLIC, harvest_app;

CREATE FUNCTION public.crm_form_purge_expired(p_tenant uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result integer;
  prior_crm_forms_tenant text := current_setting('app.crm_forms_tenant', true);
BEGIN
  PERFORM set_config('app.crm_forms_tenant', '', true);
  result := public.crm_form_purge_expired_scoped($1);
  PERFORM set_config('app.crm_forms_tenant', coalesce(prior_crm_forms_tenant, ''), true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_form_purge_expired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_form_purge_expired(uuid) TO harvest_app;
