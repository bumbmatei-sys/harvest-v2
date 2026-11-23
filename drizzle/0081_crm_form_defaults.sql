-- Hosted-form defaults: per-visitor and per-ministry rate limits, a capped proof
-- endpoint, a 90-day window for new responses, and a ministry name frozen into
-- each new publication. Visitor keys are salted hashes and live in quota rows for
-- at most two minutes; no raw address is stored.
DROP FUNCTION public.crm_form_public_form(text, boolean);
--> statement-breakpoint
DROP FUNCTION public.crm_form_public_form_scoped(text, boolean);
--> statement-breakpoint
CREATE FUNCTION public.crm_form_public_form_scoped(p_slug text, p_mode text, p_visitor text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE address record; snapshot record; attempts integer; minute_start timestamptz := date_trunc('minute', clock_timestamp());
  bucket record;
BEGIN
  IF current_database() !~ '^harvest_test(_|$)' OR public.valid_crm_form_slug(p_slug) IS NOT TRUE
    OR p_mode NOT IN ('peek', 'proof', 'submit') THEN RETURN NULL; END IF;
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
  IF p_mode <> 'peek' THEN
    IF (p_visitor ~ '^[a-f0-9]{64}$') IS NOT TRUE THEN RETURN '{"limited":true}'::jsonb; END IF;
    DELETE FROM public.crm_form_quotas WHERE minute < minute_start - interval '2 minutes';
    -- Visitor buckets come first so one visitor cannot spend the ministry's bucket.
    FOR bucket IN SELECT * FROM (VALUES
      ('proof', 'proof:' || p_visitor, 30),
      ('submit', 'visitor-form:' || p_visitor || ':' || address.slug, 5),
      ('submit', 'visitor:' || p_visitor, 20),
      ('submit', 'ministry:' || address.tenant_id::text, 300)) AS b(mode, scope, cap) WHERE b.mode = p_mode LOOP
      INSERT INTO public.crm_form_quotas (scope, minute, attempts) VALUES (bucket.scope, minute_start, 1)
        ON CONFLICT (scope, minute) DO UPDATE SET attempts = least(public.crm_form_quotas.attempts + 1, bucket.cap + 1)
        RETURNING crm_form_quotas.attempts INTO attempts;
      IF attempts > bucket.cap THEN RETURN '{"limited":true}'::jsonb; END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('versionId', address.version_id, 'definition', snapshot.definition - 'ministryName',
    'ministryName', snapshot.definition->>'ministryName',
    'notice', jsonb_build_object('version', snapshot.version, 'body', snapshot.body, 'hash', snapshot.body_sha256));
END $$;
REVOKE ALL ON FUNCTION public.crm_form_public_form_scoped(text, text, text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.crm_form_public_form(p_slug text, p_mode text, p_visitor text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
  prior_crm_forms_slug text := current_setting('app.crm_forms_slug', true);
  prior_crm_forms_tenant text := current_setting('app.crm_forms_tenant', true);
BEGIN
  PERFORM set_config('app.crm_forms_slug', '', true);
  PERFORM set_config('app.crm_forms_tenant', '', true);
  result := public.crm_form_public_form_scoped($1, $2, $3);
  PERFORM set_config('app.crm_forms_slug', coalesce(prior_crm_forms_slug, ''), true);
  PERFORM set_config('app.crm_forms_tenant', coalesce(prior_crm_forms_tenant, ''), true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_form_public_form(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_form_public_form(text, text, text) TO harvest_app;
--> statement-breakpoint
-- New responses keep answers for 90 days. Existing rows keep their stored expiry.
DO $$
DECLARE def text; patched text;
BEGIN
  def := pg_get_functiondef('public.crm_form_submit_scoped(text, uuid, uuid, timestamptz, jsonb, text, uuid, text, text)'::regprocedure);
  patched := replace(def, 'at_time + interval ''30 days''', 'at_time + interval ''90 days''');
  IF patched = def THEN RAISE EXCEPTION 'response window not found'; END IF;
  EXECUTE patched;
END $$;
--> statement-breakpoint
-- Freeze the ministry name into each new publication, like the consent text.
DO $$
DECLARE def text; patched text;
BEGIN
  def := pg_get_functiondef('public.crm_form_transition_scoped(uuid, uuid, text, text, integer)'::regprocedure);
  patched := replace(def, 'VALUES (p_tenant, p_form, draft.id, notice, actor, draft.definition);',
    'VALUES (p_tenant, p_form, draft.id, notice, actor, draft.definition || jsonb_build_object(''ministryName'', (SELECT w.name FROM public.workspaces w WHERE w.tenant_id = p_tenant)));');
  IF patched = def THEN RAISE EXCEPTION 'publication insert not found'; END IF;
  EXECUTE patched;
END $$;
