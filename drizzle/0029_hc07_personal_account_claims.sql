CREATE TABLE "connect_invitation_flows" (
	"hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connect_invitation_flow_hash" CHECK ("connect_invitation_flows"."hash" ~ '^[a-f0-9]{64}$' and "connect_invitation_flows"."generation">0)
);
--> statement-breakpoint
CREATE TABLE "connect_invitations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"source_code" text NOT NULL,
	"token_hash" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"envelope" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone[] NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lease" uuid,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "connect_invitations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "connect_invitation_fields" CHECK ("connect_invitations"."token_hash" ~ '^[a-f0-9]{64}$' and "connect_invitations"."recipient_hash" ~ '^[a-f0-9]{64}$' and "connect_invitations"."source_code" ~ '^[a-f0-9]{32}$' and "connect_invitations"."generation">0 and "connect_invitations"."attempts">=0 and cardinality("connect_invitations"."issued_at") between 1 and 20),
	CONSTRAINT "connect_invitation_status" CHECK ("connect_invitations"."status" in ('queued','running','sent','failed') and (("connect_invitations"."status"='running' and "connect_invitations"."lease" is not null and "connect_invitations"."locked_at" is not null) or ("connect_invitations"."status"<>'running' and "connect_invitations"."lease" is null and "connect_invitations"."locked_at" is null))),
	CONSTRAINT "connect_invitation_envelope" CHECK ("connect_invitations"."envelope" is null or (jsonb_typeof("connect_invitations"."envelope")='object' and octet_length("connect_invitations"."envelope"::text)<=4096))
);
--> statement-breakpoint
CREATE TABLE "response_account_claims" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"association_consumed_at" timestamp with time zone,
	CONSTRAINT "response_account_claims_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "response_account_claim_expiry" CHECK ("response_account_claims"."expires_at">"response_account_claims"."verified_at")
);
--> statement-breakpoint
ALTER TABLE "connect_invitation_flows" ADD CONSTRAINT "connect_invitation_flows_tenant_id_invitation_id_connect_invitations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."connect_invitations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connect_invitations" ADD CONSTRAINT "connect_invitations_tenant_id_response_id_campaign_responses_tenant_id_id_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."campaign_responses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_account_claims" ADD CONSTRAINT "response_account_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_account_claims" ADD CONSTRAINT "response_account_claims_tenant_id_response_id_campaign_responses_tenant_id_id_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."campaign_responses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_account_claims" ADD CONSTRAINT "response_account_claims_tenant_id_invitation_id_connect_invitations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."connect_invitations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connect_invitation_flow_expiry_idx" ON "connect_invitation_flows" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connect_invitation_response_idx" ON "connect_invitations" USING btree ("tenant_id","response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connect_invitation_token_idx" ON "connect_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "connect_invitation_due_idx" ON "connect_invitations" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "response_account_claim_response_idx" ON "response_account_claims" USING btree ("tenant_id","response_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.connect_intake_source(p_kind text,p_code text) RETURNS TABLE
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
 IF l.status<>'published' OR (l.expires_at IS NOT NULL AND l.expires_at<=clock_timestamp())
 OR (CASE p_kind WHEN 'qr' THEN l.public_code<>p_code ELSE l.short_code<>p_code END) THEN RETURN; END IF;
 PERFORM set_config('app.connect_version',l.form_version_id::text,true);
 SELECT * INTO v FROM public.form_versions WHERE tenant_id=l.tenant_id AND id=l.form_version_id FOR SHARE;
 IF NOT FOUND OR v.status<>'published' OR coalesce(v.definition->>'kind','') NOT IN ('connect-intake-v1','connect-intake-v2')
 OR v.definition->'syntheticOnly' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(v.definition->'preferredName') IS DISTINCT FROM 'boolean'
 OR coalesce(v.definition->>'followUpChannel','') NOT IN ('email')
 OR v.definition-ARRAY['kind','syntheticOnly','preferredName','followUpChannel']::text[] <> '{}'::jsonb
 OR cardinality(v.offered_purposes)<1 OR NOT (v.offered_purposes <@ CASE WHEN v.definition->>'kind'='connect-intake-v2' THEN ARRAY['outreach_follow_up','newsletter','account_communications']::text[] ELSE ARRAY['outreach_follow_up','newsletter']::text[] END) THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.forms f WHERE f.tenant_id=l.tenant_id AND f.id=v.form_id AND f.archived_at IS NULL) THEN RETURN; END IF;
 SELECT * INTO n FROM public.privacy_notice_versions WHERE tenant_id=l.tenant_id AND id=v.notice_version_id;
 IF NOT FOUND OR n.body NOT LIKE 'Synthetic test notice:%' OR n.locale<>'en' THEN RETURN; END IF;
 tenant:=l.tenant_id;campaign:=l.campaign_id;link:=l.id;version:=v.id;notice_id:=n.id;
 definition:=v.definition;purposes:=v.offered_purposes;notice:=n.body;retention:=v.pending_retention_days;
 IF l.expires_at IS NOT NULL AND l.expires_at<=clock_timestamp() THEN RETURN; END IF;
 stamp:=encode(sha256(convert_to(v.id::text||n.body_sha256,'UTF8')),'hex');RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.connect_intake_source(text,text) FROM PUBLIC;


--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.submit_connect_intake(p_kind text,p_code text,p_submission uuid,p_stamp text,p_receipt text,p_fingerprint text,p_purposes text[],p_email boolean,p_phone boolean,p_sealed jsonb,p_until timestamptz) RETURNS text
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
   IF p_purposes IS NULL OR cardinality(p_purposes) NOT BETWEEN 1 AND (CASE WHEN s.definition->>'kind'='connect-intake-v2' THEN 3 ELSE 2 END)
   OR array_position(p_purposes,NULL) IS NOT NULL OR NOT (p_purposes <@ s.purposes)
   OR cardinality(p_purposes)<>(SELECT count(DISTINCT p) FROM unnest(p_purposes) p)
   OR p_email IS DISTINCT FROM ('account_communications'=ANY(p_purposes) OR 'newsletter'=ANY(p_purposes) OR ('outreach_follow_up'=ANY(p_purposes) AND s.definition->>'followUpChannel'='email'))
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


--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.connect_intake_rights(p_hash text,p_action text,p_purpose text) RETURNS boolean
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
   ELSIF p_action='withdraw' AND p_purpose IN ('outreach_follow_up','newsletter','account_communications') THEN
    SELECT * INTO g FROM public.campaign_response_consents WHERE tenant_id=r.tenant_id AND response_id=r.id AND purpose=p_purpose AND status='granted';
    IF FOUND THEN
     IF NOT EXISTS(SELECT 1 FROM public.campaign_response_consents WHERE tenant_id=r.tenant_id AND response_id=r.id AND purpose=p_purpose AND status='withdrawn') THEN
      INSERT INTO public.campaign_response_consents(tenant_id,response_id,purpose,status,form_version_id,notice_version_id,actor_kind)
       VALUES(r.tenant_id,r.id,p_purpose,'withdrawn',g.form_version_id,g.notice_version_id,'subject');
      IF p_purpose<>'account_communications' THEN INSERT INTO public.connect_intake_events(tenant_id,response_id,event,actor,purpose) VALUES(r.tenant_id,r.id,'withdraw','guest',p_purpose); END IF;
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
-- Owner-only policies admit the exact bearer lookup, current tenant, or bounded synthetic worker.
-- No application table grants. SQL contexts are set only inside capability transactions.
ALTER TABLE connect_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE connect_invitation_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_invitation_flows FORCE ROW LEVEL SECURITY;
ALTER TABLE response_account_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_account_claims FORCE ROW LEVEL SECURITY;
REVOKE ALL ON connect_invitations,connect_invitation_flows,response_account_claims FROM PUBLIC,harvest_app;
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY invitation_owner ON public.connect_invitations TO %I
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR id=nullif(current_setting('app.connect_invite_id',true),'')::uuid
 OR token_hash=nullif(current_setting('app.connect_invite_token',true),'') OR current_setting('app.connect_invite_worker',true)='synthetic')
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR current_setting('app.connect_invite_worker',true)='synthetic')$p$,current_user);
 EXECUTE format($p$CREATE POLICY invitation_flow_owner ON public.connect_invitation_flows TO %I
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR hash=nullif(current_setting('app.connect_flow',true),'') OR current_setting('app.connect_invite_worker',true)='synthetic')
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)$p$,current_user);
 EXECUTE format($p$CREATE POLICY account_claim_owner ON public.response_account_claims TO %I
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR current_setting('app.connect_invite_worker',true)='synthetic')
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)$p$,current_user);
END $$;

-- Shared lock order: receipt -> source parents -> response -> invitation. Legacy owner erasers
-- already holding the response use HC-05's try-lock and fail atomically on inverse contention.
CREATE FUNCTION public.connect_invitation_eligible(p_tenant uuid,p_response uuid,p_code text) RETURNS timestamptz
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE proof text;binding text;r record;s record;
BEGIN
 SELECT receipt_hash,sealed_data->>'binding' INTO proof,binding FROM public.connect_intake_receipts WHERE tenant_id=p_tenant AND response_id=p_response;
 IF proof IS NULL THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('connect-intake-receipt:'||proof,0));
 SELECT * INTO s FROM public.connect_intake_source(split_part(binding,':',1),split_part(binding,':',2));
 IF NOT FOUND OR s.tenant<>p_tenant THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.campaign_responses WHERE tenant_id=p_tenant AND id=p_response FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR r.expires_at<=clock_timestamp() OR r.link_id<>s.link OR r.form_version_id<>s.version THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campaign_response_links WHERE tenant_id=p_tenant AND id=r.link_id AND public_code=p_code AND (expires_at IS NULL OR expires_at>clock_timestamp())) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campaign_response_consents WHERE tenant_id=p_tenant AND response_id=p_response AND purpose='account_communications' AND status='granted' AND redacted_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.campaign_response_consents WHERE tenant_id=p_tenant AND response_id=p_response AND purpose='account_communications' AND status='withdrawn') THEN RETURN NULL; END IF;
 RETURN r.expires_at;
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_eligible(uuid,uuid,text) FROM PUBLIC;

-- Receipt-authorized read returns ciphertext to the trusted invitation service, never to HTTP.
CREATE FUNCTION public.connect_invitation_pending(p_receipt text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE x record;prior_invite record;code text;answer jsonb;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN NULL; END IF;
 IF NOT public.connect_intake_quota('invite-request:global',600) OR NOT public.connect_intake_quota('invite-request:'||left(p_receipt,64),12) THEN RETURN jsonb_build_object('limited',true); END IF;
 PERFORM set_config('app.connect_receipt',p_receipt,true);
 SELECT * INTO x FROM public.connect_intake_receipts WHERE receipt_hash=p_receipt;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM set_config('app.tenant_id',x.tenant_id::text,true);
 SELECT l.public_code INTO code FROM public.campaign_responses r JOIN public.campaign_response_links l ON l.tenant_id=r.tenant_id AND l.id=r.link_id WHERE r.tenant_id=x.tenant_id AND r.id=x.response_id;
 -- Existing invitations pin the original source code, including across resends.
 SELECT source_code INTO prior_invite FROM public.connect_invitations WHERE tenant_id=x.tenant_id AND response_id=x.response_id;
 IF FOUND THEN code:=prior_invite.source_code; END IF;
 IF public.connect_invitation_eligible(x.tenant_id,x.response_id,code) IS NULL THEN RETURN NULL; END IF;
 SELECT sealed_data INTO answer FROM public.connect_intake_receipts WHERE tenant_id=x.tenant_id AND response_id=x.response_id AND receipt_hash=p_receipt;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_pending(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_invitation_pending(text) TO harvest_app;

CREATE FUNCTION public.connect_invitation_enqueue(p_receipt text,p_token text,p_recipient text,p_envelope jsonb,p_resend boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE x record;i record;code text;expiry timestamptz;recent timestamptz[];
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN 'unavailable'; END IF;
 IF NOT coalesce(p_token ~ '^[a-f0-9]{64}$' AND p_recipient ~ '^[a-f0-9]{64}$',false)
 OR jsonb_typeof(p_envelope) IS DISTINCT FROM 'object' OR octet_length(p_envelope::text)>4096 THEN RETURN 'unavailable'; END IF;
 PERFORM set_config('app.connect_receipt',p_receipt,true);
 SELECT * INTO x FROM public.connect_intake_receipts WHERE receipt_hash=p_receipt;
 IF NOT FOUND THEN RETURN 'unavailable'; END IF;
 PERFORM set_config('app.tenant_id',x.tenant_id::text,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('connect-intake-receipt:'||p_receipt,0));
 SELECT l.public_code INTO code FROM public.campaign_responses r JOIN public.campaign_response_links l ON l.tenant_id=r.tenant_id AND l.id=r.link_id WHERE r.tenant_id=x.tenant_id AND r.id=x.response_id;
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=x.tenant_id AND response_id=x.response_id;
 IF FOUND THEN code:=i.source_code; END IF;
 expiry:=public.connect_invitation_eligible(x.tenant_id,x.response_id,code);
 IF expiry IS NULL THEN RETURN 'unavailable'; END IF;
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=x.tenant_id AND response_id=x.response_id FOR UPDATE;
 IF FOUND THEN
  IF NOT p_resend OR i.consumed_at IS NOT NULL THEN RETURN 'existing'; END IF;
  -- A lease expiry is not proof of provider failure. Retry uncertain attempts with the same
  -- generation/key; explicit resend waits for confirmed success or the old token to expire.
  IF i.expires_at>clock_timestamp() AND (i.status='running' OR (i.attempts>0 AND i.status IN ('queued','failed'))) THEN RETURN 'limited'; END IF;
  recent:=ARRAY(SELECT t FROM unnest(i.issued_at) t WHERE t>clock_timestamp()-interval '24 hours');
  IF i.issued_at[cardinality(i.issued_at)]>clock_timestamp()-interval '60 seconds'
  OR cardinality(recent)>=20 OR (SELECT count(*) FROM unnest(recent) t WHERE t>clock_timestamp()-interval '1 hour')>=5 THEN RETURN 'limited'; END IF;
  DELETE FROM public.connect_invitation_flows WHERE tenant_id=i.tenant_id AND invitation_id=i.id;
  UPDATE public.connect_invitations SET token_hash=p_token,recipient_hash=p_recipient,envelope=p_envelope,
   expires_at=least(expiry,clock_timestamp()+interval '10 minutes'),issued_at=recent||ARRAY[clock_timestamp()],generation=generation+1,
   status='queued',attempts=0,available_at=clock_timestamp(),locked_at=NULL,lease=NULL WHERE tenant_id=i.tenant_id AND id=i.id;
 ELSE
  INSERT INTO public.connect_invitations(tenant_id,response_id,source_code,token_hash,recipient_hash,envelope,expires_at,issued_at)
   VALUES(x.tenant_id,x.response_id,code,p_token,p_recipient,p_envelope,least(expiry,clock_timestamp()+interval '10 minutes'),ARRAY[clock_timestamp()]);
 END IF;
 RETURN 'queued';
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_enqueue(text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_invitation_enqueue(text,text,text,jsonb,boolean) TO harvest_app;

CREATE FUNCTION public.connect_invitation_prepare(p_token text,p_flow text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i record;expiry timestamptz;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN false; END IF;
 IF NOT public.connect_intake_quota('invite-prepare:global',600) THEN RETURN false; END IF;
 PERFORM set_config('app.connect_invite_token',p_token,true);
 SELECT * INTO i FROM public.connect_invitations WHERE token_hash=p_token;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM set_config('app.tenant_id',i.tenant_id::text,true);
 expiry:=public.connect_invitation_eligible(i.tenant_id,i.response_id,i.source_code);
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=i.tenant_id AND id=i.id FOR UPDATE;
 IF i.token_hash<>p_token OR i.expires_at<=clock_timestamp() OR i.consumed_at IS NOT NULL OR expiry IS NULL THEN RETURN false; END IF;
 -- Bound continuations per invitation; repeated GETs never enter this path.
 IF NOT public.connect_intake_quota('invite-flow:'||i.id::text,12) THEN RETURN false; END IF;
 INSERT INTO public.connect_invitation_flows(hash,tenant_id,invitation_id,generation,expires_at) VALUES(p_flow,i.tenant_id,i.id,i.generation,least(i.expires_at,expiry));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_prepare(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_invitation_prepare(text,text) TO harvest_app;

-- Private helper resolves only the exact flow credential; callers still recheck eligibility under locks.
CREATE FUNCTION public.connect_invitation_flow(p_flow text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE f record;i record;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN NULL; END IF;
 PERFORM set_config('app.connect_flow',p_flow,true);
 SELECT * INTO f FROM public.connect_invitation_flows WHERE hash=p_flow AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM set_config('app.tenant_id',f.tenant_id::text,true);
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=f.tenant_id AND id=f.invitation_id;
 IF NOT FOUND OR i.generation<>f.generation OR i.expires_at<=clock_timestamp() OR i.consumed_at IS NOT NULL THEN RETURN NULL; END IF;
 IF public.connect_invitation_eligible(i.tenant_id,i.response_id,i.source_code) IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('recipientHash',i.recipient_hash,'recipientBinding',i.token_hash,'sourcePath','/c/'||i.source_code);
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_flow(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_invitation_flow(text) TO harvest_app;

CREATE FUNCTION public.connect_invitation_consume(p_flow text,p_user text,p_recipient text,p_decline boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE f record;i record;expiry timestamptz;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic'
 OR p_user IS DISTINCT FROM nullif(current_setting('app.user_id',true),'') THEN RETURN 'unavailable'; END IF;
 PERFORM set_config('app.connect_flow',p_flow,true);
 SELECT * INTO f FROM public.connect_invitation_flows WHERE hash=p_flow AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN 'unavailable'; END IF;
 PERFORM set_config('app.tenant_id',f.tenant_id::text,true);
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=f.tenant_id AND id=f.invitation_id;
 IF NOT FOUND THEN RETURN 'unavailable'; END IF;
 expiry:=public.connect_invitation_eligible(i.tenant_id,i.response_id,i.source_code);
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=f.tenant_id AND id=f.invitation_id FOR UPDATE;
 IF expiry IS NULL OR i.expires_at<=clock_timestamp() OR i.consumed_at IS NOT NULL OR i.generation<>f.generation
 OR NOT EXISTS(SELECT 1 FROM public.connect_invitation_flows WHERE hash=p_flow AND expires_at>clock_timestamp()) THEN RETURN 'unavailable'; END IF;
 IF p_decline THEN DELETE FROM public.connect_invitation_flows WHERE hash=p_flow;RETURN 'declined'; END IF;
 -- p_recipient is a keyed digest of the live verified session email, computed by the trusted server.
 IF i.recipient_hash IS DISTINCT FROM p_recipient THEN RETURN 'mismatch'; END IF;
 INSERT INTO public.response_account_claims(tenant_id,response_id,invitation_id,user_id,expires_at)
 VALUES(i.tenant_id,i.response_id,i.id,p_user,least(expiry,clock_timestamp()+interval '10 minutes'));
 UPDATE public.connect_invitations SET consumed_at=clock_timestamp(),envelope=NULL WHERE tenant_id=i.tenant_id AND id=i.id;
 DELETE FROM public.connect_invitation_flows WHERE tenant_id=i.tenant_id AND invitation_id=i.id;
 RETURN 'claimed';
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_consume(text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_invitation_consume(text,text,text,boolean) TO harvest_app;

CREATE FUNCTION public.connect_invitation_reserve(p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i record;expiry timestamptz;proof text;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN NULL; END IF;
 PERFORM set_config('app.connect_invite_worker','synthetic',true);
 FOR i IN SELECT * FROM public.connect_invitations WHERE consumed_at IS NULL AND envelope IS NOT NULL
 AND ((status='queued' AND available_at<=clock_timestamp()) OR (status='running' AND locked_at<=clock_timestamp()-interval '1 minute'))
 ORDER BY available_at LIMIT 100 LOOP
  PERFORM set_config('app.tenant_id',i.tenant_id::text,true);
  expiry:=public.connect_invitation_eligible(i.tenant_id,i.response_id,i.source_code);
  SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=i.tenant_id AND id=i.id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN CONTINUE; END IF;
  IF expiry IS NULL OR i.expires_at<=clock_timestamp() OR i.attempts>=5 THEN
   UPDATE public.connect_invitations SET status='failed',envelope=NULL,locked_at=NULL,lease=NULL WHERE tenant_id=i.tenant_id AND id=i.id;CONTINUE;
  END IF;
  IF i.consumed_at IS NULL AND i.envelope IS NOT NULL AND ((i.status='queued' AND i.available_at<=clock_timestamp()) OR (i.status='running' AND i.locked_at<=clock_timestamp()-interval '1 minute')) THEN
   UPDATE public.connect_invitations SET status='running',locked_at=clock_timestamp(),lease=p_lease,attempts=attempts+1 WHERE tenant_id=i.tenant_id AND id=i.id;
   SELECT receipt_hash INTO proof FROM public.connect_intake_receipts WHERE tenant_id=i.tenant_id AND response_id=i.response_id;
   RETURN jsonb_build_object('receiptHash',proof,'tokenHash',i.token_hash,'id',i.id,'tenant',i.tenant_id,'generation',i.generation,'envelope',i.envelope,'attempt',i.attempts+1);
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_reserve(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_invitation_reserve(uuid) TO harvest_app;

CREATE FUNCTION public.connect_invitation_dispatch(p_id uuid,p_lease uuid,p_outcome text,p_backoff integer DEFAULT 0) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i record;expiry timestamptz;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN false; END IF;
 PERFORM set_config('app.connect_invite_id',p_id::text,true);
 SELECT * INTO i FROM public.connect_invitations WHERE id=p_id;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM set_config('app.tenant_id',i.tenant_id::text,true);
 expiry:=public.connect_invitation_eligible(i.tenant_id,i.response_id,i.source_code);
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=i.tenant_id AND id=p_id FOR UPDATE;
 IF NOT FOUND OR i.status<>'running' OR i.lease IS DISTINCT FROM p_lease OR i.locked_at<=clock_timestamp()-interval '1 minute' THEN RETURN false; END IF;
 IF expiry IS NULL OR i.expires_at<=clock_timestamp() OR i.consumed_at IS NOT NULL THEN
  UPDATE public.connect_invitations SET status='failed',envelope=NULL,lease=NULL,locked_at=NULL WHERE tenant_id=i.tenant_id AND id=p_id;RETURN false;
 END IF;
 IF p_outcome='check' THEN RETURN true; END IF;
 IF p_outcome='sent' THEN
  UPDATE public.connect_invitations SET status='sent',envelope=NULL,lease=NULL,locked_at=NULL WHERE tenant_id=i.tenant_id AND id=p_id;
 ELSIF p_outcome='retry' AND p_backoff BETWEEN 1000 AND 3600000 THEN
  UPDATE public.connect_invitations SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'queued' END,
   envelope=CASE WHEN attempts>=5 THEN NULL ELSE envelope END,available_at=clock_timestamp()+p_backoff*interval '1 millisecond',lease=NULL,locked_at=NULL WHERE tenant_id=i.tenant_id AND id=p_id;
 ELSE RETURN false; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_dispatch(uuid,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_invitation_dispatch(uuid,uuid,text,integer) TO harvest_app;

-- Erasure and purpose withdrawal invalidate every generation/continuation/grant. This also
-- covers legacy owner erasure/purge, without modifying their callable contracts or impersonating staff.
CREATE FUNCTION public.connect_invitation_cancel() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE proof text;tenant uuid;response uuid;
BEGIN
 IF TG_TABLE_NAME='connect_intake_receipts' THEN tenant:=OLD.tenant_id;response:=OLD.response_id;proof:=OLD.receipt_hash;
 ELSE
  IF NEW.purpose<>'account_communications' OR NEW.status<>'withdrawn' THEN RETURN NEW; END IF;
  tenant:=NEW.tenant_id;response:=NEW.response_id;
  SELECT receipt_hash INTO proof FROM public.connect_intake_receipts WHERE tenant_id=tenant AND response_id=response;
 END IF;
 IF proof IS NOT NULL AND NOT pg_try_advisory_xact_lock(hashtextextended('connect-intake-receipt:'||proof,0)) THEN
  RAISE EXCEPTION 'invitation cancellation must retry' USING ERRCODE='40001';
 END IF;
 DELETE FROM public.connect_invitations WHERE tenant_id=tenant AND response_id=response;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_cancel() FROM PUBLIC;
CREATE TRIGGER connect_invitation_erase BEFORE DELETE ON public.connect_intake_receipts FOR EACH ROW EXECUTE FUNCTION public.connect_invitation_cancel();
CREATE TRIGGER connect_invitation_withdraw AFTER INSERT ON public.campaign_response_consents FOR EACH ROW EXECUTE FUNCTION public.connect_invitation_cancel();

CREATE FUNCTION public.purge_connect_invitations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i record;proof text;total integer:=0;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN 0; END IF;
 PERFORM set_config('app.connect_invite_worker','synthetic',true);
 FOR i IN SELECT * FROM public.connect_invitations x WHERE x.expires_at<=clock_timestamp()
 OR EXISTS(SELECT 1 FROM public.connect_invitation_flows f WHERE f.tenant_id=x.tenant_id AND f.invitation_id=x.id AND f.expires_at<=clock_timestamp())
 OR EXISTS(SELECT 1 FROM public.response_account_claims c WHERE c.tenant_id=x.tenant_id AND c.invitation_id=x.id AND c.expires_at<=clock_timestamp())
 ORDER BY x.expires_at LIMIT 100 LOOP
  PERFORM set_config('app.tenant_id',i.tenant_id::text,true);
  SELECT receipt_hash INTO proof FROM public.connect_intake_receipts WHERE tenant_id=i.tenant_id AND response_id=i.response_id;
  IF proof IS NULL THEN CONTINUE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('connect-intake-receipt:'||proof,0));
  -- Parent lock before child cleanup; re-read expiry/generation after any resend wait.
  SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=i.tenant_id AND id=i.id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN CONTINUE; END IF;
  DELETE FROM public.connect_invitation_flows WHERE hash IN (SELECT hash FROM public.connect_invitation_flows WHERE tenant_id=i.tenant_id AND invitation_id=i.id AND expires_at<=clock_timestamp() LIMIT 1000);
  DELETE FROM public.response_account_claims WHERE tenant_id=i.tenant_id AND invitation_id=i.id AND expires_at<=clock_timestamp();
  IF i.expires_at<=clock_timestamp() AND i.envelope IS NOT NULL THEN
   UPDATE public.connect_invitations SET envelope=NULL,status='failed',lease=NULL,locked_at=NULL WHERE tenant_id=i.tenant_id AND id=i.id;total:=total+1;
  END IF;
  -- Only bounded issuance metadata remains for rolling resend limits, at most24h.
  IF i.issued_at[cardinality(i.issued_at)]<=clock_timestamp()-interval '24 hours'
  AND NOT EXISTS(SELECT 1 FROM public.response_account_claims WHERE tenant_id=i.tenant_id AND invitation_id=i.id) THEN
   DELETE FROM public.connect_invitations WHERE tenant_id=i.tenant_id AND id=i.id;
  END IF;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.purge_connect_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_connect_invitations() TO harvest_app;
