CREATE TABLE "connect_intake_events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid,
	"event" text NOT NULL,
	"actor" text NOT NULL,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connect_intake_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "connect_intake_event_kind" CHECK ("connect_intake_events"."event" in ('submit','withdraw','erase','purge') and "connect_intake_events"."actor" in ('guest','worker')),
	CONSTRAINT "connect_intake_event_purpose" CHECK (("connect_intake_events"."event"='withdraw' and "connect_intake_events"."purpose" in ('outreach_follow_up','newsletter')) or ("connect_intake_events"."event"<>'withdraw' and "connect_intake_events"."purpose" is null))
);
--> statement-breakpoint
CREATE TABLE "connect_intake_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connect_intake_limit_count" CHECK ("connect_intake_limits"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "connect_intake_receipts" (
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"receipt_hash" text NOT NULL,
	"fingerprint" text NOT NULL,
	"sealed_data" jsonb NOT NULL,
	"replay_until" timestamp with time zone NOT NULL,
	CONSTRAINT "connect_intake_receipts_tenant_id_response_id_pk" PRIMARY KEY("tenant_id","response_id"),
	CONSTRAINT "connect_intake_receipt_hash" CHECK ("connect_intake_receipts"."receipt_hash" ~ '^[a-f0-9]{64}$' and "connect_intake_receipts"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "connect_intake_sealed" CHECK (jsonb_typeof("connect_intake_receipts"."sealed_data") = 'object' and octet_length("connect_intake_receipts"."sealed_data"::text) <= 4096)
);
--> statement-breakpoint
ALTER TABLE "connect_intake_events" ADD CONSTRAINT "connect_intake_events_tenant_id_response_id_campaign_responses_tenant_id_id_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."campaign_responses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connect_intake_receipts" ADD CONSTRAINT "connect_intake_receipts_tenant_id_response_id_campaign_responses_tenant_id_id_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."campaign_responses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connect_intake_limits_expiry_idx" ON "connect_intake_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connect_intake_receipt_hash_idx" ON "connect_intake_receipts" USING btree ("receipt_hash");
--> statement-breakpoint
-- HC-05: test-only public capability, restricted receipts and source quotas. Application-side
-- gating permits only explicit synthetic mode against a disposable local database, never production.
-- No DB role/table grants are broadened on existing pending tables.
ALTER TABLE connect_intake_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_intake_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON connect_intake_events FROM PUBLIC,harvest_app;
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY intake_events_owner ON public.connect_intake_events TO %I
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)$p$,current_user);
END $$;
CREATE FUNCTION public.guard_intake_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND public.connect_erasure_writer()
 AND (NEW.tenant_id,NEW.event,NEW.actor,NEW.purpose) IS NOT DISTINCT FROM (OLD.tenant_id,OLD.event,OLD.actor,OLD.purpose)
 AND NEW.response_id IS NULL AND OLD.response_id IS NOT NULL AND NEW.id<>OLD.id
 AND NEW.created_at=date_trunc('day',OLD.created_at,'UTC') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'intake audit is append-only';
END $$;
REVOKE ALL ON FUNCTION public.guard_intake_event() FROM PUBLIC;
CREATE TRIGGER intake_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.connect_intake_events FOR EACH ROW EXECUTE FUNCTION public.guard_intake_event();
CREATE TRIGGER intake_event_truncate BEFORE TRUNCATE ON public.connect_intake_events FOR EACH STATEMENT EXECUTE FUNCTION public.guard_intake_event();
ALTER TABLE connect_intake_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_intake_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE connect_intake_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_intake_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON connect_intake_receipts, connect_intake_limits FROM PUBLIC, harvest_app;
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY intake_receipt_owner ON public.connect_intake_receipts TO %I
 USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid
 OR receipt_hash = nullif(current_setting('app.connect_receipt',true),'')
 OR current_setting('app.connect_purge',true) = 'synthetic')
 WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)$p$,current_user);
 EXECUTE format($p$CREATE POLICY intake_limit_owner ON public.connect_intake_limits TO %I
 USING (current_setting('app.connect_intake_mode',true) = 'synthetic' OR public.connect_erasure_writer())
 WITH CHECK (current_setting('app.connect_intake_mode',true) = 'synthetic' OR public.connect_erasure_writer())$p$,current_user);
 EXECUTE format($p$CREATE POLICY intake_notice_owner ON public.privacy_notice_versions FOR SELECT TO %I
 USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)$p$,current_user);
 EXECUTE format($p$CREATE POLICY intake_form_owner ON public.forms FOR SELECT TO %I
 USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)$p$,current_user);
 -- PostgreSQL row locks also require an UPDATE policy; these owner-only policies are scoped
 -- to the exact public-source parents selected inside the capability, not harvest_app.
 EXECUTE format($p$CREATE POLICY intake_campaign_lock ON public.campaigns FOR UPDATE TO %I
 USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid
 AND id = nullif(current_setting('app.connect_campaign',true),'')::uuid)$p$,current_user);
 EXECUTE format($p$CREATE POLICY intake_version_lock ON public.form_versions FOR UPDATE TO %I
 USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid
 AND id = nullif(current_setting('app.connect_version',true),'')::uuid)$p$,current_user);
 EXECUTE format($p$CREATE POLICY intake_expired_owner ON public.campaign_responses FOR SELECT TO %I
 USING (current_setting('app.connect_purge',true) = 'synthetic' AND status='pending' AND expires_at <= now()
 AND EXISTS (SELECT 1 FROM public.connect_intake_receipts x WHERE x.tenant_id=campaign_responses.tenant_id AND x.response_id=campaign_responses.id))$p$,current_user);
END $$;

CREATE FUNCTION public.connect_intake_quota(p_key text, p_max integer) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE accepted boolean;
BEGIN
 INSERT INTO public.connect_intake_limits (key,count,expires_at) VALUES (p_key,1,now()+interval '1 minute')
 ON CONFLICT (key) DO UPDATE SET count=CASE WHEN connect_intake_limits.expires_at<=now() THEN 1 ELSE connect_intake_limits.count+1 END,
 expires_at=CASE WHEN connect_intake_limits.expires_at<=now() THEN now()+interval '1 minute' ELSE connect_intake_limits.expires_at END
 WHERE connect_intake_limits.expires_at<=now() OR connect_intake_limits.count<p_max RETURNING true INTO accepted;
 RETURN coalesce(accepted,false);
END $$;
REVOKE ALL ON FUNCTION public.connect_intake_quota(text,integer) FROM PUBLIC;

-- Private helper. The returned ownership IDs are never exposed by a public manifest/HTTP API.
-- Shared locks serialize submit with pause, rotation, campaign archive and form retirement.
CREATE FUNCTION public.connect_intake_source(p_kind text,p_code text) RETURNS TABLE
 (tenant uuid,campaign uuid,link uuid,version uuid,notice_id uuid,definition jsonb,purposes text[],notice text,retention integer,stamp text)
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE l record; v record; n record; live boolean;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN; END IF;
 IF NOT coalesce((p_kind='qr' AND p_code ~ '^[a-f0-9]{32}$') OR (p_kind='short' AND p_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),false) THEN RETURN; END IF;
 PERFORM set_config('app.connect_resolve_code',p_code,true);
 SELECT * INTO l FROM public.campaign_response_links WHERE CASE p_kind WHEN 'qr' THEN public_code=p_code ELSE short_code=p_code END;
 PERFORM set_config('app.connect_resolve_code','',true);
 IF NOT FOUND OR l.id IS NULL OR l.form_version_id IS NULL THEN RETURN; END IF;
 PERFORM set_config('app.tenant_id',l.tenant_id::text,true);
 PERFORM set_config('app.connect_campaign',l.campaign_id::text,true);
 SELECT archived_at IS NULL INTO live FROM public.campaigns WHERE tenant_id=l.tenant_id AND id=l.campaign_id FOR SHARE;
 IF live IS DISTINCT FROM true THEN RETURN; END IF;
 SELECT * INTO l FROM public.campaign_response_links WHERE tenant_id=l.tenant_id AND id=l.id FOR SHARE;
 IF l.status<>'published' OR (l.expires_at IS NOT NULL AND l.expires_at<=now())
 OR (CASE p_kind WHEN 'qr' THEN l.public_code<>p_code ELSE l.short_code<>p_code END) THEN RETURN; END IF;
 PERFORM set_config('app.connect_version',l.form_version_id::text,true);
 SELECT * INTO v FROM public.form_versions WHERE tenant_id=l.tenant_id AND id=l.form_version_id FOR SHARE;
 IF NOT FOUND OR v.status<>'published' OR coalesce(v.definition->>'kind','')<>'connect-intake-v1'
 OR v.definition->'syntheticOnly' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(v.definition->'preferredName') IS DISTINCT FROM 'boolean'
 OR coalesce(v.definition->>'followUpChannel','') NOT IN ('email')
 OR v.definition-ARRAY['kind','syntheticOnly','preferredName','followUpChannel']::text[] <> '{}'::jsonb
 OR cardinality(v.offered_purposes)<1 OR NOT (v.offered_purposes <@ ARRAY['outreach_follow_up','newsletter']::text[]) THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.forms f WHERE f.tenant_id=l.tenant_id AND f.id=v.form_id AND f.archived_at IS NULL) THEN RETURN; END IF;
 SELECT * INTO n FROM public.privacy_notice_versions WHERE tenant_id=l.tenant_id AND id=v.notice_version_id;
 IF NOT FOUND OR n.body NOT LIKE 'Synthetic test notice:%' OR n.locale<>'en' THEN RETURN; END IF;
 tenant:=l.tenant_id;campaign:=l.campaign_id;link:=l.id;version:=v.id;notice_id:=n.id;
 definition:=v.definition;purposes:=v.offered_purposes;notice:=n.body;retention:=v.pending_retention_days;
 stamp:=encode(sha256(convert_to(v.id::text||n.body_sha256,'UTF8')),'hex');RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.connect_intake_source(text,text) FROM PUBLIC;

CREATE FUNCTION public.connect_intake_manifest(p_kind text,p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record; result jsonb; previous text:=coalesce(current_setting('app.tenant_id',true),'');
BEGIN
 SELECT * INTO s FROM public.connect_intake_source(p_kind,p_code);
 IF FOUND THEN result:=jsonb_build_object('stamp',s.stamp,'definition',s.definition,'purposes',s.purposes,'notice',s.notice,'retentionDays',s.retention); END IF;
 PERFORM set_config('app.tenant_id',previous,true);PERFORM set_config('app.connect_campaign','',true);PERFORM set_config('app.connect_version','',true);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.connect_intake_manifest(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_intake_manifest(text,text) TO harvest_app;

CREATE FUNCTION public.submit_connect_intake(p_kind text,p_code text,p_submission uuid,p_stamp text,p_receipt text,p_fingerprint text,p_purposes text[],p_email boolean,p_phone boolean,p_sealed jsonb,p_until timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record; existing record; response uuid; purpose text; result text:='unavailable'; previous text:=coalesce(current_setting('app.tenant_id',true),'');
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('connect-intake-receipt:'||p_receipt,0));
 IF EXISTS(SELECT 1 FROM public.connect_intake_limits WHERE key='revoked:'||p_receipt AND expires_at>now()) THEN RETURN 'unavailable'; END IF;
 -- Source quota is shared by code, not by an entire venue IP. Receipt quota bounds retries.
 IF NOT coalesce(p_receipt ~ '^[a-f0-9]{64}$' AND p_fingerprint ~ '^[a-f0-9]{64}$',false) THEN RETURN 'invalid'; END IF;
 IF NOT public.connect_intake_quota('source:'||coalesce(p_kind,'')||':'||left(coalesce(p_code,''),40),600)
 OR NOT public.connect_intake_quota('receipt:'||p_receipt,12) THEN RETURN 'limited'; END IF;
 SELECT * INTO s FROM public.connect_intake_source(p_kind,p_code);
 IF FOUND THEN
  result:='changed';
  IF p_stamp=s.stamp AND p_submission IS NOT NULL AND p_until>clock_timestamp() AND p_until<=clock_timestamp()+interval '11 minutes' THEN
   IF p_purposes IS NULL OR cardinality(p_purposes) NOT BETWEEN 1 AND 2
   OR array_position(p_purposes,NULL) IS NOT NULL OR NOT (p_purposes <@ s.purposes)
   OR cardinality(p_purposes)<>(SELECT count(DISTINCT p) FROM unnest(p_purposes) p)
   OR p_email IS DISTINCT FROM ('newsletter'=ANY(p_purposes) OR ('outreach_follow_up'=ANY(p_purposes) AND s.definition->>'followUpChannel'='email'))
   OR p_phone IS DISTINCT FROM ('outreach_follow_up'=ANY(p_purposes) AND s.definition->>'followUpChannel'='phone')
   OR jsonb_typeof(p_sealed) IS DISTINCT FROM 'object' OR octet_length(p_sealed::text)>4096
   OR coalesce(length(p_sealed->>'binding'),0) NOT BETWEEN 1 AND 300
   OR p_sealed->>'version' IS DISTINCT FROM '1' OR coalesce(p_sealed->>'iv','') !~ '^[A-Za-z0-9+/]{16}$'
   OR coalesce(p_sealed->>'tag','') !~ '^[A-Za-z0-9+/]{22}==$'
   OR coalesce(p_sealed->>'ciphertext','') !~ '^[A-Za-z0-9+/]+={0,2}$'
   OR p_sealed-ARRAY['version','binding','iv','tag','ciphertext']::text[] <> '{}'::jsonb THEN result:='invalid';
   ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(s.tenant::text||s.campaign::text||p_submission::text,0));
    SELECT r.id,x.receipt_hash,x.fingerprint INTO existing FROM public.campaign_responses r
     LEFT JOIN public.connect_intake_receipts x ON x.tenant_id=r.tenant_id AND x.response_id=r.id
     WHERE r.tenant_id=s.tenant AND r.campaign_id=s.campaign AND r.public_submission_id=p_submission FOR UPDATE OF r;
    IF EXISTS(SELECT 1 FROM public.connect_intake_limits WHERE key='revoked:'||p_receipt AND expires_at>now()) THEN result:='unavailable';
    ELSIF p_until<=clock_timestamp() THEN result:='changed';
    ELSIF FOUND THEN
     result:=CASE WHEN existing.receipt_hash=p_receipt AND existing.fingerprint=p_fingerprint AND EXISTS(SELECT 1 FROM public.campaign_responses WHERE tenant_id=s.tenant AND id=existing.id AND status='pending' AND expires_at>now()) THEN 'replayed' ELSE 'conflict' END;
    ELSE
     INSERT INTO public.campaign_responses (tenant_id,campaign_id,link_id,form_version_id,public_submission_id,locale)
      VALUES (s.tenant,s.campaign,s.link,s.version,p_submission,'en') RETURNING id INTO response;
     -- Canonical contact-method rows contain opaque envelope references, never plaintext or an
     -- email-derived searchable fingerprint. HC-07 must verify/decrypt before any association.
     IF p_email THEN INSERT INTO public.campaign_response_contact_methods (tenant_id,response_id,kind,value,normalized_value)
      VALUES(s.tenant,response,'email','sealed:'||response::text,'pending-verification'); END IF;
     IF p_phone THEN INSERT INTO public.campaign_response_contact_methods (tenant_id,response_id,kind,value,normalized_value)
      VALUES(s.tenant,response,'phone','sealed:'||response::text,'pending-verification'); END IF;
     INSERT INTO public.connect_intake_receipts(tenant_id,response_id,receipt_hash,fingerprint,sealed_data,replay_until) VALUES (s.tenant,response,p_receipt,p_fingerprint,p_sealed,p_until);
     FOREACH purpose IN ARRAY p_purposes LOOP
      INSERT INTO public.campaign_response_consents (tenant_id,response_id,purpose,status,channel,form_version_id,notice_version_id,actor_kind)
       VALUES(s.tenant,response,purpose,'granted',CASE WHEN purpose='outreach_follow_up' AND p_phone THEN 'sms' ELSE 'email' END,s.version,s.notice_id,'subject');
     END LOOP;
     INSERT INTO public.connect_intake_events(tenant_id,response_id,event,actor) VALUES(s.tenant,response,'submit','guest');
     result:='created';
    END IF;
   END IF;
  END IF;
 END IF;
 PERFORM set_config('app.tenant_id',previous,true);PERFORM set_config('app.connect_campaign','',true);PERFORM set_config('app.connect_version','',true);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.submit_connect_intake(text,text,uuid,text,text,text,text[],boolean,boolean,jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_connect_intake(text,text,uuid,text,text,text,text[],boolean,boolean,jsonb,timestamptz) TO harvest_app;

CREATE FUNCTION public.connect_intake_rights(p_hash text,p_action text,p_purpose text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE receipt record; r record; g record; previous text:=coalesce(current_setting('app.tenant_id',true),''); result boolean:=false;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic'
 OR NOT coalesce(p_hash ~ '^[a-f0-9]{64}$',false) THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('connect-intake-receipt:'||p_hash,0));
 IF NOT public.connect_intake_quota('rights:global',600) OR NOT public.connect_intake_quota('receipt:'||p_hash,12) THEN RETURN NULL; END IF;
 PERFORM set_config('app.connect_receipt',p_hash,true);
 SELECT * INTO receipt FROM public.connect_intake_receipts WHERE receipt_hash=p_hash;
 PERFORM set_config('app.connect_receipt','',true);
 IF FOUND AND receipt.response_id IS NOT NULL THEN
  PERFORM set_config('app.tenant_id',receipt.tenant_id::text,true);
  SELECT * INTO r FROM public.campaign_responses WHERE tenant_id=receipt.tenant_id AND id=receipt.response_id FOR UPDATE;
  IF r.status='pending' AND EXISTS(SELECT 1 FROM public.connect_intake_receipts WHERE tenant_id=r.tenant_id AND response_id=r.id AND receipt_hash=p_hash) THEN
   IF p_action='erase' THEN
    PERFORM public.connect_scrub_response(r.tenant_id,r.id);
    INSERT INTO public.connect_intake_events(tenant_id,event,actor,created_at) VALUES(r.tenant_id,'erase','guest',date_trunc('day',now(),'UTC'));result:=true;
   ELSIF p_action='withdraw' AND p_purpose IN ('outreach_follow_up','newsletter') THEN
    SELECT * INTO g FROM public.campaign_response_consents WHERE tenant_id=r.tenant_id AND response_id=r.id AND purpose=p_purpose AND status='granted';
    IF FOUND THEN
     IF NOT EXISTS(SELECT 1 FROM public.campaign_response_consents WHERE tenant_id=r.tenant_id AND response_id=r.id AND purpose=p_purpose AND status='withdrawn') THEN
      INSERT INTO public.campaign_response_consents(tenant_id,response_id,purpose,status,form_version_id,notice_version_id,actor_kind)
       VALUES(r.tenant_id,r.id,p_purpose,'withdrawn',g.form_version_id,g.notice_version_id,'subject');
      INSERT INTO public.connect_intake_events(tenant_id,response_id,event,actor,purpose) VALUES(r.tenant_id,r.id,'withdraw','guest',p_purpose);
     END IF;
     result:=true;
    END IF;
   END IF;
  END IF;
 END IF;
 PERFORM set_config('app.tenant_id',previous,true);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.connect_intake_rights(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_intake_rights(text,text,text) TO harvest_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.connect_scrub_response(p_tenant uuid, p_response uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE proof text;
BEGIN
  SELECT receipt_hash INTO proof FROM public.connect_intake_receipts WHERE tenant_id=p_tenant AND response_id=p_response;
  -- Existing owner/contact erasers may already hold the response row. Never wait in the inverse
  -- order: fail atomically with a retryable serialization conflict instead of deadlocking.
  IF proof IS NOT NULL AND NOT pg_try_advisory_xact_lock(hashtextextended('connect-intake-receipt:'||proof,0)) THEN
    RAISE EXCEPTION 'intake erasure must retry' USING ERRCODE='40001';
  END IF;
  -- Revocation-only suppression: no tenant/response/contact IDs; expires with the enforceable submission-proof lifetime.
  INSERT INTO public.connect_intake_limits(key,count,expires_at)
    SELECT 'revoked:'||x.receipt_hash,1,x.replay_until FROM public.connect_intake_receipts x JOIN public.campaign_responses r ON r.tenant_id=x.tenant_id AND r.id=x.response_id
    WHERE x.tenant_id=p_tenant AND x.response_id=p_response AND x.replay_until>now()
    ON CONFLICT(key) DO NOTHING;
  DELETE FROM public.connect_intake_limits WHERE key IN (SELECT 'receipt:'||receipt_hash FROM public.connect_intake_receipts WHERE tenant_id=p_tenant AND response_id=p_response);
  UPDATE public.connect_intake_events SET id=gen_random_uuid(),response_id=NULL,created_at=date_trunc('day',created_at,'UTC') WHERE tenant_id=p_tenant AND response_id=p_response;
  DELETE FROM public.connect_intake_receipts WHERE tenant_id=p_tenant AND response_id=p_response;
  DELETE FROM public.campaign_response_contact_methods WHERE tenant_id = p_tenant AND response_id = p_response;
  UPDATE public.campaign_response_consents SET id = gen_random_uuid(), channel = NULL, recorded_by = NULL,
    recorded_at = date_trunc('day', recorded_at, 'UTC'),
    occurred_at = least(date_trunc('day', occurred_at, 'UTC'), date_trunc('day', recorded_at, 'UTC')),
    redacted_at = date_trunc('day', now(), 'UTC')
    WHERE tenant_id = p_tenant AND response_id = p_response;
  -- Connect producers (HC-05+) keep responseId top level, as CRM events keep contactId (CRM-08).
  UPDATE public.outbox_events SET payload = jsonb_set(payload, '{responseId}', 'null'::jsonb)
    WHERE tenant_id = p_tenant AND payload->>'responseId' = p_response::text;
  UPDATE public.jobs SET payload = jsonb_set(payload, '{responseId}', 'null'::jsonb), updated_at = now()
    WHERE tenant_id = p_tenant AND payload->>'responseId' = p_response::text;
  UPDATE public.campaign_responses SET status = 'erased', preferred_name = NULL, locale = NULL, contact_id = NULL,
    associated_at = NULL, expires_at = NULL, erased_at = date_trunc('day', now(), 'UTC'),
    submitted_at = date_trunc('day', submitted_at, 'UTC'), public_submission_id = gen_random_uuid()
    WHERE tenant_id = p_tenant AND id = p_response;
  UPDATE public.audit_logs SET target_id = NULL
    WHERE tenant_id = p_tenant AND action LIKE 'connect.response.%' AND target_id = p_response::text;
  UPDATE public.campaign_responses SET id = gen_random_uuid() WHERE tenant_id = p_tenant AND id = p_response;
END $$;
REVOKE ALL ON FUNCTION public.connect_scrub_response(uuid, uuid) FROM PUBLIC;

--> statement-breakpoint
-- Expiry-only worker capability: test intake rows, bounded batches, no actor impersonation and
-- no address reads. The operator script is itself local-synthetic gated. No scheduler deployed.
CREATE FUNCTION public.purge_connect_intake() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record; total integer:=0; previous text:=coalesce(current_setting('app.tenant_id',true),'');
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN 0; END IF;
 PERFORM set_config('app.connect_purge','synthetic',true);
 FOR r IN SELECT tenant_id,id FROM public.campaign_responses WHERE status='pending' AND expires_at<=now()
 AND EXISTS(SELECT 1 FROM public.connect_intake_receipts x WHERE x.tenant_id=campaign_responses.tenant_id AND x.response_id=campaign_responses.id)
 ORDER BY expires_at LIMIT 100 LOOP
  PERFORM set_config('app.tenant_id',r.tenant_id::text,true);
  PERFORM 1 FROM public.campaign_responses WHERE tenant_id=r.tenant_id AND id=r.id AND status='pending' AND expires_at<=now() FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
   PERFORM public.connect_scrub_response(r.tenant_id,r.id);total:=total+1;
   INSERT INTO public.connect_intake_events(tenant_id,event,actor,created_at) VALUES(r.tenant_id,'purge','worker',date_trunc('day',now(),'UTC'));
  END IF;
 END LOOP;
 DELETE FROM public.connect_intake_limits WHERE key IN (SELECT key FROM public.connect_intake_limits WHERE expires_at<=now() LIMIT 1000);
 PERFORM set_config('app.connect_purge','',true);PERFORM set_config('app.tenant_id',previous,true);RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.purge_connect_intake() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_connect_intake() TO harvest_app;
