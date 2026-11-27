-- Staging values remain opaque to SQL. PostgreSQL authorizes and audits the
-- ciphertext release; Web Crypto opens it with a key the database never holds.
CREATE FUNCTION public.connect_staged_envelope_valid(p_envelope jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(
    jsonb_typeof(p_envelope) = 'object' AND octet_length(p_envelope::text) <= 4096
    AND length(p_envelope->>'binding') BETWEEN 1 AND 300
    AND p_envelope->>'iv' ~ '^[A-Za-z0-9+/]{16}$'
    AND p_envelope->>'ciphertext' ~ '^[A-Za-z0-9+/]+={0,2}$'
    AND CASE p_envelope->>'version'
      WHEN '1' THEN p_envelope->>'tag' ~ '^[A-Za-z0-9+/]{22}==$'
        AND p_envelope - ARRAY['version','binding','iv','tag','ciphertext']::text[] = '{}'::jsonb
      WHEN '3' THEN p_envelope->>'keyVersion' IN ('v1','v2')
        AND p_envelope->>'wrapIv' ~ '^[A-Za-z0-9+/]{16}$'
        AND p_envelope->>'wrappedKey' ~ '^[A-Za-z0-9+/]{64}$'
        AND p_envelope - ARRAY['version','keyVersion','binding','iv','ciphertext','wrapIv','wrappedKey']::text[] = '{}'::jsonb
      ELSE false END, false
  )
$$;
REVOKE ALL ON FUNCTION public.connect_staged_envelope_valid(jsonb) FROM PUBLIC, harvest_app;

CREATE TABLE public.connect_contact_decrypt_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('invitation_request', 'invitation_claim', 'invitation_dispatch', 'legacy_rotation')),
  key_version text NOT NULL CHECK (key_version IN ('legacy', 'v1', 'v2')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.connect_contact_decrypt_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_contact_decrypt_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.connect_contact_decrypt_audit FROM PUBLIC, harvest_app;
DO $$
BEGIN
  EXECUTE format($policy$CREATE POLICY connect_contact_decrypt_insert ON public.connect_contact_decrypt_audit FOR INSERT TO %I
    WITH CHECK (current_setting('app.connect_intake_mode', true) = 'synthetic'
      OR (session_user = 'harvest_worker' AND current_setting('app.contact_rotation', true) = 'on'))$policy$, current_user);
END $$;

CREATE FUNCTION public.connect_audit_contact_open(p_envelope jsonb, p_purpose text) RETURNS void
LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO public.connect_contact_decrypt_audit (purpose, key_version)
  SELECT p_purpose, coalesce(p_envelope->>'keyVersion', 'legacy')
  WHERE p_envelope IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.connect_audit_contact_open(jsonb, text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $patch$
DECLARE
  def text;
  patched text;
  old_validation text := $old$jsonb_typeof(p_sealed) IS DISTINCT FROM 'object' OR octet_length(p_sealed::text)>4096
   OR coalesce(length(p_sealed->>'binding'),0) NOT BETWEEN 1 AND 300
   OR p_sealed->>'version' IS DISTINCT FROM '1' OR coalesce(p_sealed->>'iv','') !~ '^[A-Za-z0-9+/]{16}$'
   OR coalesce(p_sealed->>'tag','') !~ '^[A-Za-z0-9+/]{22}==$'
   OR coalesce(p_sealed->>'ciphertext','') !~ '^[A-Za-z0-9+/]+={0,2}$'
   OR p_sealed-ARRAY['version','binding','iv','tag','ciphertext']::text[] <> '{}'::jsonb$old$;
  new_validation text := $new$NOT public.connect_staged_envelope_valid(p_sealed)
   OR (p_sealed->>'version' = '3' AND p_sealed->>'binding' IS DISTINCT FROM
       p_kind || ':' || p_code || ':' || p_submission::text || ':' || p_receipt)$new$;
BEGIN
  def := pg_catalog.pg_get_functiondef('public.submit_connect_intake(text,text,uuid,text,text,text,text[],boolean,boolean,jsonb,timestamptz)'::regprocedure);
  patched := pg_catalog.replace(def, old_validation, new_validation);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(new_validation) - pg_catalog.length(old_validation) THEN
    RAISE EXCEPTION 'submit_connect_intake: expected exactly one envelope validation';
  END IF;
  EXECUTE patched;

END
$patch$;
CREATE FUNCTION public.connect_contact_scope(p_restore jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := '{}'::jsonb; key text;
BEGIN
  FOREACH key IN ARRAY ARRAY['app.tenant_id','app.connect_receipt','app.connect_flow',
    'app.connect_invite_worker','app.connect_campaign','app.connect_version','app.connect_resolve_code'] LOOP
    prior := prior || pg_catalog.jsonb_build_object(key, coalesce(pg_catalog.current_setting(key, true), ''));
    PERFORM pg_catalog.set_config(key, coalesce(p_restore->>key, ''), true);
  END LOOP;
  RETURN prior;
END $$;
REVOKE ALL ON FUNCTION public.connect_contact_scope(jsonb) FROM PUBLIC, harvest_app;

ALTER FUNCTION public.connect_invitation_pending(text) RENAME TO connect_invitation_pending_scoped;
ALTER FUNCTION public.connect_invitation_reserve(uuid) RENAME TO connect_invitation_reserve_scoped;
REVOKE ALL ON FUNCTION public.connect_invitation_pending_scoped(text), public.connect_invitation_reserve_scoped(uuid)
  FROM PUBLIC, harvest_app;

CREATE FUNCTION public.connect_invitation_pending(p_receipt text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.connect_contact_scope(NULL); answer jsonb;
BEGIN
  answer := public.connect_invitation_pending_scoped(p_receipt);
  IF answer->>'limited' IS DISTINCT FROM 'true' THEN
    PERFORM public.connect_audit_contact_open(answer, 'invitation_request');
  END IF;
  PERFORM public.connect_contact_scope(prior);
  RETURN answer;
END $$;

CREATE FUNCTION public.connect_invitation_reserve(p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.connect_contact_scope(NULL); answer jsonb;
BEGIN
  answer := public.connect_invitation_reserve_scoped(p_lease);
  PERFORM public.connect_audit_contact_open(answer->'envelope', 'invitation_dispatch');
  PERFORM public.connect_contact_scope(prior);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_pending(text), public.connect_invitation_reserve(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_invitation_pending(text), public.connect_invitation_reserve(uuid) TO harvest_app;

REVOKE EXECUTE ON FUNCTION public.connect_claim_envelope(text) FROM harvest_app;

CREATE FUNCTION public.connect_claim_contact_open(p_flow text, p_recipient text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE flow jsonb; answer jsonb; prior jsonb;
BEGIN
  IF p_recipient IS NULL OR p_recipient !~ '^[0-9a-f]{64}$' OR NOT EXISTS (SELECT FROM public.users u
    WHERE u.id = nullif(pg_catalog.current_setting('app.user_id', true), '') AND u.email_verified) THEN RETURN NULL; END IF;
  prior := public.connect_contact_scope(NULL);
  flow := public.connect_invitation_flow(p_flow);
  IF flow->>'automatic' = 'true' AND flow->>'recipientHash' = p_recipient THEN
    SELECT r.sealed_data INTO answer FROM public.connect_invitation_flows f
    JOIN public.connect_invitations i ON i.tenant_id = f.tenant_id AND i.id = f.invitation_id
    JOIN public.connect_intake_receipts r ON r.tenant_id = i.tenant_id AND r.response_id = i.response_id
    WHERE f.hash = p_flow;
    PERFORM public.connect_audit_contact_open(answer, 'invitation_claim');
  END IF;
  PERFORM public.connect_contact_scope(prior);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.connect_claim_contact_open(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_claim_contact_open(text, text) TO harvest_app;
--> statement-breakpoint
DO $$
DECLARE fn text; def text; patched text;
  old_entry text := '''app.connect_receipt'',';
  new_entry text := '''app.connect_receipt'',''app.contact_rotation'',';
  worker_scope text := $p$session_user = 'harvest_worker' AND current_setting('app.contact_rotation', true) = 'on'$p$;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.blog_scope_clear()', 'public.account_self_reset()'] LOOP
    def := pg_catalog.pg_get_functiondef(fn::regprocedure);
    patched := pg_catalog.replace(def, old_entry, new_entry);
    IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(new_entry) - pg_catalog.length(old_entry) THEN
      RAISE EXCEPTION '%: expected exactly one connect receipt entry', fn;
    END IF;
    EXECUTE patched;
  END LOOP;
  EXECUTE format('CREATE POLICY contact_rotation_read ON public.connect_intake_receipts FOR SELECT TO %I USING (%s)', current_user, worker_scope);
  EXECUTE format('CREATE POLICY contact_rotation_update ON public.connect_intake_receipts FOR UPDATE TO %I USING (%s) WITH CHECK (%s)', current_user, worker_scope, worker_scope);
END $$;

CREATE FUNCTION public.connect_contact_rotation_page(p_tenant uuid, p_response uuid, p_key text, p_limit integer)
RETURNS TABLE(tenant_id uuid, response_id uuid, envelope jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE item record; prior text := pg_catalog.current_setting('app.contact_rotation', true);
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_key IS NULL OR p_key NOT IN ('v1','v2') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 250
    OR (p_tenant IS NULL) <> (p_response IS NULL) THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.contact_rotation', 'on', true);
  FOR item IN SELECT r.tenant_id, r.response_id, r.sealed_data FROM public.connect_intake_receipts r
    WHERE (p_tenant IS NULL OR (r.tenant_id, r.response_id) > (p_tenant, p_response))
      AND r.sealed_data->>'keyVersion' IS DISTINCT FROM p_key
    ORDER BY r.tenant_id, r.response_id LIMIT p_limit
  LOOP
    IF item.sealed_data->>'version' = '1' THEN
      PERFORM public.connect_audit_contact_open(item.sealed_data, 'legacy_rotation');
    END IF;
    tenant_id := item.tenant_id;
    response_id := item.response_id;
    envelope := item.sealed_data;
    RETURN NEXT;
  END LOOP;
  PERFORM pg_catalog.set_config('app.contact_rotation', coalesce(prior, ''), true);
END $$;

CREATE FUNCTION public.connect_contact_rotation_replace(p_tenant uuid, p_response uuid, p_from jsonb, p_to jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := pg_catalog.current_setting('app.contact_rotation', true); replaced boolean;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF NOT public.connect_staged_envelope_valid(p_to) OR p_to->>'version' IS DISTINCT FROM '3'
    OR p_to->>'binding' IS DISTINCT FROM p_from->>'binding'
    OR (p_from->>'version' = '3' AND (p_from->>'keyVersion' IS DISTINCT FROM 'v1' OR p_to->>'keyVersion' IS DISTINCT FROM 'v2'
      OR p_from->>'iv' IS DISTINCT FROM p_to->>'iv' OR p_from->>'ciphertext' IS DISTINCT FROM p_to->>'ciphertext'))
    THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.contact_rotation', 'on', true);
  UPDATE public.connect_intake_receipts SET sealed_data = p_to
  WHERE tenant_id = p_tenant AND response_id = p_response AND sealed_data = p_from;
  replaced := FOUND;
  PERFORM pg_catalog.set_config('app.contact_rotation', coalesce(prior, ''), true);
  RETURN replaced;
END $$;

CREATE FUNCTION public.connect_contact_rotation_remaining(p_key text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := pg_catalog.current_setting('app.contact_rotation', true); remaining bigint;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_key IS NULL OR p_key NOT IN ('v1','v2') THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.contact_rotation', 'on', true);
  SELECT count(*) INTO remaining FROM public.connect_intake_receipts WHERE sealed_data->>'keyVersion' IS DISTINCT FROM p_key;
  PERFORM pg_catalog.set_config('app.contact_rotation', coalesce(prior, ''), true);
  RETURN remaining;
END $$;
REVOKE ALL ON FUNCTION public.connect_contact_rotation_page(uuid, uuid, text, integer),
  public.connect_contact_rotation_replace(uuid, uuid, jsonb, jsonb), public.connect_contact_rotation_remaining(text) FROM PUBLIC, harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.connect_contact_rotation_page(uuid, uuid, text, integer),
      public.connect_contact_rotation_replace(uuid, uuid, jsonb, jsonb), public.connect_contact_rotation_remaining(text) TO harvest_worker;
  END IF;
END $$;
