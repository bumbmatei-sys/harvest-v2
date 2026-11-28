ALTER TABLE public.campaign_response_consents ADD COLUMN assisted_evidence jsonb;
ALTER TABLE public.campaign_response_consents ADD CONSTRAINT campaign_response_consent_assisted CHECK (
  assisted_evidence IS NULL OR (status = 'granted' AND actor_kind = 'subject' AND redacted_at IS NULL
    AND jsonb_typeof(assisted_evidence) = 'object'
    AND coalesce(assisted_evidence->>'method' IN ('in_person','phone'), false)
    AND coalesce(assisted_evidence->>'wordingVersion' ~ '^[a-f0-9]{64}$', false)
    AND coalesce(length(assisted_evidence->>'recordedBy') BETWEEN 1 AND 200, false)
    AND assisted_evidence - ARRAY['method','wordingVersion','recordedBy'] = '{}'::jsonb)
);--> statement-breakpoint

-- The public signature stays stable. Both callers use the same intake and the
-- same ledger; staff records the subject's affirmative choices as evidence.
DO $$
DECLARE def text; patched text; edit text[];
BEGIN
  def := pg_catalog.pg_get_functiondef('public.submit_connect_intake(text,text,uuid,text,text,text,text[],boolean,boolean,jsonb,timestamptz)'::regprocedure);
  FOREACH edit SLICE 1 IN ARRAY ARRAY[
    ARRAY['FUNCTION public.submit_connect_intake(', 'FUNCTION public.submit_connect_intake_scoped('],
    ARRAY['p_until timestamp with time zone)', 'p_until timestamp with time zone, p_tenant uuid, p_campaign uuid, p_method text, p_wording text)'],
    ARRAY['DECLARE s record;', $new$DECLARE actor text := nullif(current_setting('app.user_id',true), ''); evidence jsonb; s record;$new$]
  ] LOOP
    patched := pg_catalog.replace(def, edit[1], edit[2]);
    IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(edit[2]) - pg_catalog.length(edit[1]) THEN
      RAISE EXCEPTION 'Expected one submit intake anchor';
    END IF;
    def := patched;
  END LOOP;
  FOREACH edit SLICE 1 IN ARRAY ARRAY[
    ARRAY[$old$ PERFORM pg_advisory_xact_lock(hashtextextended('connect-intake-receipt:'||p_receipt,0));$old$,
    $new$ IF p_tenant IS NOT NULL THEN
  IF previous <> p_tenant::text OR actor IS NULL OR p_campaign IS NULL
    OR NOT coalesce(p_method IN ('in_person','phone') AND p_wording ~ '^[a-f0-9]{64}$', false) THEN RETURN result; END IF;
  PERFORM 1 FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=actor
    AND public.access_role(m.tenant_id,m.user_id,'connect',m.role_id) IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RETURN result; END IF;
  evidence := jsonb_build_object('method',p_method,'wordingVersion',p_wording,'recordedBy',actor);
 ELSIF p_campaign IS NOT NULL OR p_method IS NOT NULL OR p_wording IS NOT NULL THEN RETURN result;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('connect-intake-receipt:'||p_receipt,0));$new$],
    ARRAY[$old$ SELECT * INTO s FROM public.connect_intake_source(p_kind,p_code);
 IF FOUND THEN$old$,
    $new$ SELECT * INTO s FROM public.connect_intake_source(p_kind,p_code);
 IF FOUND AND (p_tenant IS NULL OR (s.tenant=p_tenant AND s.campaign=p_campaign)) THEN
  IF evidence IS NOT NULL AND p_wording IS DISTINCT FROM s.stamp THEN
   PERFORM set_config('app.tenant_id',previous,true);PERFORM set_config('app.connect_campaign','',true);PERFORM set_config('app.connect_version','',true);
   RETURN 'changed';
  END IF;$new$],
    ARRAY[$old$notice_version_id,actor_kind)$old$, $new$notice_version_id,actor_kind,assisted_evidence)$new$],
    ARRAY[$old$s.version,s.notice_id,'subject');$old$, $new$s.version,s.notice_id,'subject',evidence);$new$]
  ] LOOP
    patched := pg_catalog.replace(def, edit[1], edit[2]);
    IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(edit[2]) - pg_catalog.length(edit[1]) THEN
      RAISE EXCEPTION 'Expected one scoped intake anchor';
    END IF;
    def := patched;
  END LOOP;
  EXECUTE def;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.submit_connect_intake_scoped(text,text,uuid,text,text,text,text[],boolean,boolean,jsonb,timestamptz,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_connect_intake_scoped(text,text,uuid,text,text,text,text[],boolean,boolean,jsonb,timestamptz,uuid,uuid,text,text) TO harvest_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.submit_connect_intake(p_kind text,p_code text,p_submission uuid,p_stamp text,p_receipt text,p_fingerprint text,
  p_purposes text[],p_email boolean,p_phone boolean,p_sealed jsonb,p_until timestamptz) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.submit_connect_intake_scoped(p_kind,p_code,p_submission,p_stamp,p_receipt,p_fingerprint,p_purposes,p_email,p_phone,p_sealed,p_until,
    NULL,NULL,NULL,NULL)
$$;--> statement-breakpoint
DO $$
DECLARE def text; patched text;
  anchor constant text := '  IF NOT public.connect_erasure_writer() THEN RAISE EXCEPTION ''consent evidence is append-only''; END IF;';
  replacement constant text := anchor || E'\n  IF NEW.redacted_at IS NOT NULL THEN NEW.assisted_evidence := NULL;\n  ELSIF NEW.assisted_evidence IS DISTINCT FROM OLD.assisted_evidence THEN RAISE EXCEPTION ''consent evidence is append-only''; END IF;';
BEGIN
  def := pg_catalog.pg_get_functiondef('public.guard_campaign_response_consent()'::regprocedure);
  patched := pg_catalog.replace(def, anchor, replacement);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'Expected one consent erasure guard';
  END IF;
  EXECUTE patched;
END $$;
