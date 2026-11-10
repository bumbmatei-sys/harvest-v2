-- HC-06B1–B3: restricted persistence and synthetic-only verified claim association.
-- Legacy v1/v2 notices keep their behavior; no production intake or delivery is enabled.
CREATE TABLE public.connect_response_subjects (
 tenant_id uuid NOT NULL, response_id uuid NOT NULL, user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 handle uuid NOT NULL DEFAULT gen_random_uuid(), bound_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,response_id), UNIQUE(handle),
 FOREIGN KEY(tenant_id,response_id) REFERENCES public.campaign_responses(tenant_id,id) ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE TABLE public.connect_consent_origins (
 tenant_id uuid NOT NULL, consent_id uuid NOT NULL, response_id uuid NOT NULL, response_consent_id uuid NOT NULL,
 form_version_id uuid NOT NULL, notice_version_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,consent_id),
 FOREIGN KEY(tenant_id,consent_id) REFERENCES public.contact_consents(tenant_id,id),
 FOREIGN KEY(tenant_id,response_id) REFERENCES public.campaign_responses(tenant_id,id) ON UPDATE CASCADE,
 FOREIGN KEY(tenant_id,response_consent_id) REFERENCES public.campaign_response_consents(tenant_id,id),
 FOREIGN KEY(tenant_id,form_version_id) REFERENCES public.form_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,notice_version_id) REFERENCES public.privacy_notice_versions(tenant_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX connect_consent_origins_response_unique ON public.connect_consent_origins(tenant_id,response_consent_id);
--> statement-breakpoint
-- Completion is bound to the original continuation deadline, independent of invitation cleanup.
CREATE TABLE public.connect_claim_completions (
 flow_hash text PRIMARY KEY CONSTRAINT connect_completion_hash CHECK(flow_hash ~ '^[a-f0-9]{64}$'),
 tenant_id uuid NOT NULL, response_id uuid NOT NULL, user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,response_id) REFERENCES public.campaign_responses(tenant_id,id) ON UPDATE CASCADE
);
CREATE INDEX connect_subject_user ON public.connect_response_subjects(user_id,handle);
CREATE INDEX connect_completion_expiry ON public.connect_claim_completions(expires_at);
--> statement-breakpoint
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['connect_response_subjects','connect_consent_origins','connect_claim_completions'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation_name);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation_name);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,harvest_app',relation_name);
 EXECUTE format($p$CREATE POLICY restricted_owner ON public.%I TO %I
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)$p$,relation_name,current_user);
 END LOOP;
END $$;
--> statement-breakpoint
-- Cross-table constraints verify the actual evidence, not just individually valid foreign keys.
CREATE FUNCTION public.guard_connect_consent_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.campaign_response_consents r
 JOIN public.campaign_responses response ON response.tenant_id=r.tenant_id AND response.id=r.response_id
 JOIN public.contact_consents c ON c.tenant_id=r.tenant_id AND c.id=NEW.consent_id
 WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.response_consent_id AND r.response_id=NEW.response_id
 AND r.form_version_id=NEW.form_version_id AND r.notice_version_id=NEW.notice_version_id
 AND r.redacted_at IS NULL AND c.redacted_at IS NULL AND c.notice_version='connect-immutable' AND c.contact_id=response.contact_id
 AND c.purpose=r.purpose AND c.status=r.status AND c.channel IS NOT DISTINCT FROM r.channel
 AND c.occurred_at=r.occurred_at AND c.recorded_by IS NULL
 AND r.purpose IN ('newsletter','outreach_follow_up')) THEN
 RAISE EXCEPTION 'invalid Connect consent origin' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_connect_consent_origin() FROM PUBLIC;
CREATE TRIGGER connect_origin_guard BEFORE INSERT OR UPDATE ON public.connect_consent_origins
 FOR EACH ROW EXECUTE FUNCTION public.guard_connect_consent_origin();
--> statement-breakpoint
CREATE FUNCTION public.guard_connect_subject() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.tenant_id,NEW.response_id,NEW.user_id,NEW.handle,NEW.bound_at)
 IS DISTINCT FROM (OLD.tenant_id,OLD.response_id,OLD.user_id,OLD.handle,OLD.bound_at) THEN
 RAISE EXCEPTION 'subject binding is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campaign_responses r JOIN public.response_account_claims c
 ON c.tenant_id=r.tenant_id AND c.response_id=r.id
 WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.response_id AND r.status='associated'
 AND c.user_id=NEW.user_id AND c.association_consumed_at IS NOT NULL) THEN
 RAISE EXCEPTION 'subject binding requires completed association' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_connect_subject() FROM PUBLIC;
CREATE TRIGGER connect_subject_guard BEFORE INSERT OR UPDATE ON public.connect_response_subjects
 FOR EACH ROW EXECUTE FUNCTION public.guard_connect_subject();
--> statement-breakpoint
-- Scrub before existing erasers re-key response/consent identities. Invitation expiry cannot
-- delete the durable subject binding; response erasure and account deletion can.
CREATE FUNCTION public.scrub_connect_association_foundation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.status='erased' AND OLD.status<>'erased' THEN
 DELETE FROM public.contact_source_events WHERE tenant_id=OLD.tenant_id AND response_id=OLD.id;
 DELETE FROM public.connect_consent_origins WHERE tenant_id=OLD.tenant_id AND response_id=OLD.id;
 DELETE FROM public.connect_response_subjects WHERE tenant_id=OLD.tenant_id AND response_id=OLD.id;
 DELETE FROM public.connect_claim_completions WHERE tenant_id=OLD.tenant_id AND response_id=OLD.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.scrub_connect_association_foundation() FROM PUBLIC;
CREATE TRIGGER association_foundation_scrub BEFORE UPDATE ON public.campaign_responses
 FOR EACH ROW EXECUTE FUNCTION public.scrub_connect_association_foundation();
--> statement-breakpoint
CREATE FUNCTION public.guard_connect_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.connect_invitation_flows f
 JOIN public.connect_invitations i ON i.tenant_id=f.tenant_id AND i.id=f.invitation_id
 JOIN public.response_account_claims c ON c.tenant_id=i.tenant_id AND c.response_id=i.response_id
 WHERE f.hash=NEW.flow_hash AND f.tenant_id=NEW.tenant_id AND i.response_id=NEW.response_id
 AND c.user_id=NEW.user_id AND c.association_consumed_at IS NOT NULL
 AND NEW.expires_at=f.expires_at AND NEW.expires_at>clock_timestamp()) THEN
 RAISE EXCEPTION 'completion requires original verified continuation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_connect_completion() FROM PUBLIC;
CREATE TRIGGER connect_completion_guard BEFORE INSERT OR UPDATE ON public.connect_claim_completions
 FOR EACH ROW EXECUTE FUNCTION public.guard_connect_completion();
--> statement-breakpoint
-- Consent erasure happens before the response is re-keyed, so unlink provenance first.
CREATE FUNCTION public.scrub_connect_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.redacted_at IS NOT NULL THEN
 PERFORM contact.id FROM public.contacts contact WHERE contact.tenant_id=OLD.tenant_id AND EXISTS(
 SELECT 1 FROM public.contact_consents consent JOIN public.connect_consent_origins origin ON origin.tenant_id=consent.tenant_id AND origin.consent_id=consent.id
 WHERE origin.tenant_id=OLD.tenant_id AND origin.response_consent_id=OLD.id AND consent.contact_id=contact.id)
 ORDER BY contact.id FOR UPDATE NOWAIT;
 -- Keep only unlinked channel/purpose suppression, on the original two clocks. Erasing
 -- response evidence must never let another older response resurrect a withdrawn purpose.
 INSERT INTO public.contact_consents(tenant_id,contact_id,purpose,notice_version,channel,status,source,evidence,occurred_at,recorded_at)
 SELECT c.tenant_id,c.contact_id,c.purpose,'subject-withdrawal',c.channel,'withdrawn','Privacy request','Purpose withdrawn; response evidence erased',c.occurred_at,c.recorded_at
 FROM public.contact_consents c JOIN public.connect_consent_origins origin ON origin.tenant_id=c.tenant_id AND origin.consent_id=c.id
 WHERE origin.tenant_id=OLD.tenant_id AND origin.response_consent_id=OLD.id AND c.status='withdrawn' AND c.redacted_at IS NULL
 AND EXISTS(SELECT 1 FROM public.contacts live WHERE live.tenant_id=c.tenant_id AND live.id=c.contact_id AND live.erased_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.contact_consents suppression WHERE suppression.tenant_id=c.tenant_id AND suppression.contact_id=c.contact_id
 AND suppression.notice_version='subject-withdrawal' AND suppression.purpose=c.purpose AND suppression.channel=c.channel
 AND suppression.occurred_at=c.occurred_at AND suppression.recorded_at=c.recorded_at);
 UPDATE public.contact_consents c SET recorded_by=NULL,channel=NULL,source=NULL,evidence=NULL,
 recorded_at=date_trunc('day',c.recorded_at,'UTC'),occurred_at=least(date_trunc('day',c.occurred_at,'UTC'),date_trunc('day',c.recorded_at,'UTC')),
 redacted_at=date_trunc('day',now(),'UTC')
 WHERE c.tenant_id=OLD.tenant_id AND c.redacted_at IS NULL AND c.id IN
 (SELECT o.consent_id FROM public.connect_consent_origins o WHERE o.tenant_id=OLD.tenant_id AND o.response_consent_id=OLD.id);
 DELETE FROM public.connect_consent_origins WHERE tenant_id=OLD.tenant_id AND response_consent_id=OLD.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.scrub_connect_origin() FROM PUBLIC;
CREATE TRIGGER association_origin_scrub BEFORE UPDATE ON public.campaign_response_consents
 FOR EACH ROW EXECUTE FUNCTION public.scrub_connect_origin();
--> statement-breakpoint
-- Canonical rows expose only a generic notice class; exact notice/response links stay restricted.
ALTER TABLE public.contact_consents DROP CONSTRAINT consent_notice_version;
ALTER TABLE public.contact_consents ADD CONSTRAINT consent_notice_version
 CHECK(notice_version IN ('notice-v1','legacy-unversioned','connect-immutable','subject-withdrawal'));
CREATE OR REPLACE FUNCTION public.guard_contact_child() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM 1 FROM public.contacts WHERE tenant_id=NEW.tenant_id AND id=NEW.contact_id AND erased_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
 IF TG_TABLE_NAME='contact_consents' THEN
 IF NEW.notice_version<>'subject-withdrawal' THEN NEW.recorded_at:=now(); END IF;
 IF NEW.notice_version='subject-withdrawal' THEN
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.erase_contact(uuid,uuid)'::regprocedure))
  OR NEW.status<>'withdrawn' OR NEW.recorded_by IS NOT NULL OR NEW.redacted_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM public.contact_consents prior JOIN public.connect_consent_origins origin ON origin.tenant_id=prior.tenant_id AND origin.consent_id=prior.id
  WHERE prior.tenant_id=NEW.tenant_id AND prior.contact_id=NEW.contact_id AND prior.purpose=NEW.purpose AND prior.channel=NEW.channel AND prior.status='withdrawn'
  AND prior.occurred_at=NEW.occurred_at AND prior.recorded_at=NEW.recorded_at AND prior.redacted_at IS NULL) THEN
   RAISE EXCEPTION 'invalid withdrawal suppression' USING ERRCODE='42501';
  END IF;
 ELSIF NEW.notice_version='connect-immutable' THEN
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.erase_contact(uuid,uuid)'::regprocedure))
   OR NEW.recorded_by IS NOT NULL OR NEW.redacted_at IS NOT NULL
   OR NEW.purpose NOT IN ('newsletter','outreach_follow_up') THEN
   RAISE EXCEPTION 'invalid Connect provenance' USING ERRCODE='42501';
  END IF;
 ELSE
  IF NEW.recorded_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'') OR NEW.recorded_by IS NULL
   OR NEW.redacted_at IS NOT NULL OR NEW.purpose='legacy_unspecified' OR NEW.notice_version='legacy-unversioned' THEN
   RAISE EXCEPTION 'invalid consent provenance';
  END IF;
 END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- A deferred check allows canonical event + private provenance to be inserted atomically,
-- while preventing an ungrounded Connect marker from being committed even by a privileged writer.
CREATE FUNCTION public.check_connect_consent_origin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text:=coalesce(current_setting('app.tenant_id',true),'');
BEGIN
 PERFORM set_config('app.tenant_id',NEW.tenant_id::text,true);
 IF NEW.notice_version='connect-immutable' AND EXISTS(
 SELECT 1 FROM public.contact_consents c WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.id AND c.redacted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.connect_consent_origins o WHERE o.tenant_id=NEW.tenant_id AND o.consent_id=NEW.id) THEN
 RAISE EXCEPTION 'Connect consent requires immutable origin' USING ERRCODE='23514'; END IF;
 PERFORM set_config('app.tenant_id',previous,true);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.check_connect_consent_origin() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER connect_consent_origin_required AFTER INSERT ON public.contact_consents
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.notice_version='connect-immutable') EXECUTE FUNCTION public.check_connect_consent_origin();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_campaign_response() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE link_status text; version_status text; retention integer; campaign_archived timestamptz; link_expires timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'responses are erased, not deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.contact_id IS NOT NULL OR NEW.associated_at IS NOT NULL OR NEW.erased_at IS NOT NULL THEN
      RAISE EXCEPTION 'responses start pending and unassociated';
    END IF;
    SELECT l.status, v.status, v.pending_retention_days, c.archived_at, l.expires_at INTO link_status, version_status, retention, campaign_archived, link_expires
      FROM public.campaign_response_links l
      JOIN public.form_versions v ON v.tenant_id = l.tenant_id AND v.id = l.form_version_id
      JOIN public.campaigns c ON c.tenant_id = l.tenant_id AND c.id = l.campaign_id
      WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.link_id AND l.campaign_id = NEW.campaign_id AND l.form_version_id = NEW.form_version_id
      FOR SHARE OF l, v;
    IF NOT FOUND OR link_status <> 'published' OR version_status <> 'published' OR campaign_archived IS NOT NULL
      OR link_expires <= now() THEN -- HC-03
      RAISE EXCEPTION 'response source is not accepting responses';
    END IF;
    NEW.submitted_at := now();
    NEW.expires_at := now() + make_interval(days => retention);
    RETURN NEW;
  END IF;
  IF NOT public.connect_erasure_writer() THEN
    RAISE EXCEPTION 'pending responses change only through controlled erasure';
  END IF;
  IF (NEW.tenant_id, NEW.campaign_id, NEW.link_id, NEW.form_version_id)
    IS DISTINCT FROM (OLD.tenant_id, OLD.campaign_id, OLD.link_id, OLD.form_version_id) THEN
    RAISE EXCEPTION 'response identity is immutable';
  END IF;
  -- Association is HC-06's verified-claim path; nothing in HC-02 may set or change it.
  IF NEW.contact_id IS NOT NULL AND NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    IF NOT ((OLD.status='pending' AND NEW.status='associated' AND NEW.expires_at=OLD.expires_at
      AND NEW.id=OLD.id AND EXISTS(SELECT 1 FROM public.response_account_claims c
      JOIN public.form_versions v ON v.tenant_id=c.tenant_id AND v.id=NEW.form_version_id
      WHERE c.tenant_id=NEW.tenant_id AND c.response_id=NEW.id AND c.user_id=nullif(current_setting('app.user_id',true),'')
      AND c.expires_at>clock_timestamp() AND c.association_consumed_at IS NOT NULL AND v.definition->>'kind'='connect-intake-v3'))
      OR (OLD.status='associated' AND NEW.status='associated' AND OLD.contact_id::text=current_setting('app.merge_source',true))) THEN
      RAISE EXCEPTION 'response association requires a verified claim';
    END IF;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id AND NEW.status <> 'erased' THEN
    RAISE EXCEPTION 'response identity is immutable';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
ALTER TABLE public.contact_source_events ADD COLUMN response_id uuid;
ALTER TABLE public.contact_source_events ADD COLUMN entry_route text;
ALTER TABLE public.contact_source_events ADD CONSTRAINT contact_sources_response_fk
 FOREIGN KEY(tenant_id,response_id) REFERENCES public.campaign_responses(tenant_id,id) ON UPDATE CASCADE;
ALTER TABLE public.contact_source_events DROP CONSTRAINT contact_sources_contract;
ALTER TABLE public.contact_source_events ADD CONSTRAINT contact_sources_contract CHECK(
 (kind='manual' AND outcome='created' AND import_id IS NULL AND row_number IS NULL AND reverted_at IS NULL AND response_id IS NULL AND entry_route IS NULL)
 OR (kind='csv_import' AND outcome IN ('created','updated') AND import_id IS NOT NULL AND row_number IS NOT NULL AND row_number>0 AND response_id IS NULL AND entry_route IS NULL)
 OR (kind='connect' AND outcome IN ('created','updated') AND import_id IS NULL AND row_number IS NULL AND reverted_at IS NULL AND response_id IS NOT NULL AND entry_route IS NOT NULL AND entry_route IN ('qr','short')));
CREATE UNIQUE INDEX contact_sources_response_unique ON public.contact_source_events(tenant_id,response_id) WHERE kind='connect';
--> statement-breakpoint
-- Private B2 primitive: called only by the future claim orchestrator, never HTTP/app SQL.
-- The orchestrator must create the verified claim in this same transaction and only then call
-- this helper. Any error rolls back both steps. The v3 intake contract is not public yet.
CREATE FUNCTION public.connect_associate_verified(p_tenant uuid,p_response uuid,p_recipient text,p_verified_email text,p_name text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); u record; r record; c record;
 i record; person uuid; created boolean:=false; proof text; binding text; g record; event_id uuid;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' OR actor IS NULL
 OR p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN
 RAISE EXCEPTION 'association unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM public.users WHERE id=actor AND email_verified FOR SHARE;
 IF NOT FOUND OR u.email IS DISTINCT FROM p_verified_email OR u.email !~* '^[^@[:space:]]+@example[.]test$' THEN
 RAISE EXCEPTION 'association unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.response_account_claims WHERE tenant_id=p_tenant AND response_id=p_response AND user_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'association unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=p_tenant AND id=c.invitation_id;
 IF i.recipient_hash IS DISTINCT FROM p_recipient THEN RAISE EXCEPTION 'association identity changed' USING ERRCODE='42501'; END IF;
 IF public.connect_invitation_eligible(p_tenant,p_response,i.source_code) IS NULL THEN
 RAISE EXCEPTION 'association unavailable' USING ERRCODE='40001'; END IF;
 SELECT * INTO r FROM public.campaign_responses WHERE tenant_id=p_tenant AND id=p_response FOR UPDATE;
 SELECT * INTO c FROM public.response_account_claims WHERE tenant_id=p_tenant AND response_id=p_response AND user_id=actor FOR UPDATE;
 IF c.expires_at<=clock_timestamp() OR c.association_consumed_at IS NOT NULL OR r.expires_at<=clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM public.form_versions WHERE tenant_id=p_tenant AND id=r.form_version_id AND definition->>'kind'='connect-intake-v3') THEN
 RAISE EXCEPTION 'association unavailable' USING ERRCODE='42501'; END IF;
 SELECT receipt_hash,sealed_data->>'binding' INTO proof,binding FROM public.connect_intake_receipts WHERE tenant_id=p_tenant AND response_id=p_response;
 -- Receipt/source/response are already locked by eligibility. Never block on the reverse
 -- contact->response order used by merge/erasure; caller retries a bounded whole transaction.
 SELECT ct.id INTO person FROM public.contact_identifiers identifier JOIN public.contacts ct
 ON ct.tenant_id=identifier.tenant_id AND ct.id=identifier.contact_id
 WHERE identifier.tenant_id=p_tenant AND identifier.kind='email' AND identifier.normalized_value=lower(u.email)
 AND ct.erased_at IS NULL FOR UPDATE OF ct NOWAIT;
 IF person IS NULL THEN
  INSERT INTO public.contacts(tenant_id,name) VALUES(p_tenant,left(coalesce(nullif(btrim(p_name),''),nullif(btrim(u.name),''),u.email),100)) RETURNING id INTO person;
  INSERT INTO public.contact_identifiers(tenant_id,contact_id,kind,value,normalized_value) VALUES(p_tenant,person,'email',u.email,lower(u.email));
  created:=true;
 ELSE
  -- Reuse is keyed on the verified email identifier alone. Response rights stay per-response and user-bound,
  -- so a contact that already holds another account's responses (for example after an admin merge) is reusable.
  IF NOT EXISTS(SELECT 1 FROM public.contact_identifiers WHERE tenant_id=p_tenant AND contact_id=person AND kind='email' AND normalized_value=lower(u.email)) THEN
   RAISE EXCEPTION 'association unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF public.connect_invitation_eligible(p_tenant,p_response,i.source_code) IS NULL OR i.expires_at<=clock_timestamp()
 OR c.expires_at<=clock_timestamp() OR r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'association expired' USING ERRCODE='40001'; END IF;
 UPDATE public.response_account_claims SET association_consumed_at=clock_timestamp() WHERE tenant_id=p_tenant AND id=c.id;
 UPDATE public.campaign_responses SET contact_id=person,status='associated',associated_at=clock_timestamp() WHERE tenant_id=p_tenant AND id=p_response;
 INSERT INTO public.connect_response_subjects(tenant_id,response_id,user_id) VALUES(p_tenant,p_response,actor);
 IF created THEN DELETE FROM public.contact_source_events WHERE tenant_id=p_tenant AND contact_id=person AND kind='manual'; END IF;
 INSERT INTO public.contact_source_events(tenant_id,contact_id,kind,outcome,response_id,entry_route)
 VALUES(p_tenant,person,'connect',CASE WHEN created THEN 'created' ELSE 'updated' END,p_response,split_part(binding,':',1));
 FOR g IN SELECT * FROM public.campaign_response_consents grant_event WHERE tenant_id=p_tenant AND response_id=p_response
 AND purpose IN ('newsletter','outreach_follow_up') AND status='granted' AND redacted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.campaign_response_consents w WHERE w.tenant_id=p_tenant AND w.response_id=p_response AND w.purpose=grant_event.purpose AND w.status='withdrawn') LOOP
  INSERT INTO public.contact_consents(tenant_id,contact_id,purpose,notice_version,channel,status,source,evidence,occurred_at)
  VALUES(p_tenant,person,g.purpose,'connect-immutable',g.channel,'granted','Connect','Explicit response choice',g.occurred_at) RETURNING id INTO event_id;
  INSERT INTO public.connect_consent_origins(tenant_id,consent_id,response_id,response_consent_id,form_version_id,notice_version_id)
  VALUES(p_tenant,event_id,p_response,g.id,g.form_version_id,g.notice_version_id);
 END LOOP;
 RETURN person;
END $$;
REVOKE ALL ON FUNCTION public.connect_associate_verified(uuid,uuid,text,text,text) FROM PUBLIC,harvest_app;

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
 IF NOT FOUND OR v.status<>'published' OR coalesce(v.definition->>'kind','') NOT IN ('connect-intake-v1','connect-intake-v2','connect-intake-v3')
 OR v.definition->'syntheticOnly' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(v.definition->'preferredName') IS DISTINCT FROM 'boolean'
 OR coalesce(v.definition->>'followUpChannel','') NOT IN ('email')
 OR v.definition-ARRAY['kind','syntheticOnly','preferredName','followUpChannel']::text[] <> '{}'::jsonb
 OR cardinality(v.offered_purposes)<1 OR NOT (v.offered_purposes <@ CASE WHEN v.definition->>'kind' IN ('connect-intake-v2','connect-intake-v3') THEN ARRAY['outreach_follow_up','newsletter','account_communications']::text[] ELSE ARRAY['outreach_follow_up','newsletter']::text[] END) THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.forms f WHERE f.tenant_id=l.tenant_id AND f.id=v.form_id AND f.archived_at IS NULL) THEN RETURN; END IF;
 SELECT * INTO n FROM public.privacy_notice_versions WHERE tenant_id=l.tenant_id AND id=v.notice_version_id;
 IF NOT FOUND OR n.body NOT LIKE 'Synthetic test notice:%' OR n.locale<>'en' THEN RETURN; END IF;
 tenant:=l.tenant_id;campaign:=l.campaign_id;link:=l.id;version:=v.id;notice_id:=n.id;
 definition:=v.definition;purposes:=v.offered_purposes;notice:=n.body;retention:=v.pending_retention_days;
 IF l.expires_at IS NOT NULL AND l.expires_at<=clock_timestamp() THEN RETURN; END IF;
 stamp:=encode(sha256(convert_to(v.id::text||n.body_sha256,'UTF8')),'hex');RETURN NEXT;
END $$;

--> statement-breakpoint
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
  UPDATE public.contact_source_events SET contact_id=p_target WHERE tenant_id=p_tenant AND contact_id=p_source;
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
  UPDATE public.campaign_responses SET contact_id=p_target WHERE tenant_id=p_tenant AND contact_id=p_source AND status='associated';
  PERFORM set_config('app.merge_source', '', true);
  -- The merged person's own record, history and leftovers leave through controlled erasure.
  PERFORM public.erase_contact(p_tenant, p_source);
  RETURN jsonb_build_object('identifiers', moved_identifiers, 'droppedIdentifiers', dropped_identifiers, 'links', moved_links,
    'consents', moved_consents, 'tasks', moved_tasks, 'notes', moved_notes, 'deals', moved_deals,
    'values', moved_values + repointed_values, 'activities', moved_activities, 'notesCopied', notes_taken);
END $$;


--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_consent_redaction() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user = pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.merge_contacts(uuid,uuid,uuid)'::regprocedure))
    AND OLD.contact_id IS NOT NULL AND NEW.contact_id IS NOT NULL AND OLD.contact_id IS DISTINCT FROM NEW.contact_id
    AND OLD.contact_id::text = coalesce(current_setting('app.merge_source', true), '')
    AND NEW.redacted_at IS NOT DISTINCT FROM OLD.redacted_at
    AND (NEW.tenant_id, NEW.id, NEW.recorded_by, NEW.purpose, NEW.notice_version, NEW.recorded_at, NEW.channel, NEW.status, NEW.source, NEW.evidence, NEW.occurred_at)
      IS NOT DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.recorded_by, OLD.purpose, OLD.notice_version, OLD.recorded_at, OLD.channel, OLD.status, OLD.source, OLD.evidence, OLD.occurred_at)
    AND EXISTS (SELECT 1 FROM public.contacts WHERE tenant_id = NEW.tenant_id AND id = NEW.contact_id AND erased_at IS NULL) THEN
    RETURN NEW;
  END IF;
  IF current_user = pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.erase_contact(uuid,uuid)'::regprocedure))
 AND OLD.notice_version='connect-immutable' AND OLD.redacted_at IS NULL
 AND NEW.redacted_at=date_trunc('day',now(),'UTC')
 AND (NEW.tenant_id,NEW.id,NEW.contact_id,NEW.purpose,NEW.status,NEW.notice_version) IS NOT DISTINCT FROM
 (OLD.tenant_id,OLD.id,OLD.contact_id,OLD.purpose,OLD.status,OLD.notice_version)
 AND NEW.recorded_by IS NULL AND NEW.channel IS NULL AND NEW.source IS NULL AND NEW.evidence IS NULL
 AND NEW.recorded_at=date_trunc('day',OLD.recorded_at,'UTC')
 AND NEW.occurred_at=least(date_trunc('day',OLD.occurred_at,'UTC'),date_trunc('day',OLD.recorded_at,'UTC'))
 AND EXISTS(SELECT 1 FROM public.connect_consent_origins WHERE tenant_id=OLD.tenant_id AND consent_id=OLD.id)
 THEN RETURN NEW; END IF;
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.erase_contact(uuid,uuid)'::regprocedure))
    OR (OLD.redacted_at IS NOT NULL AND OLD.notice_version<>'connect-immutable') OR NEW.redacted_at IS NULL
    OR NEW.contact_id IS NULL OR NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id OR NEW.recorded_by IS NOT NULL OR NEW.channel IS NOT NULL
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
   IF p_purposes IS NULL OR cardinality(p_purposes) NOT BETWEEN 1 AND (CASE WHEN s.definition->>'kind' IN ('connect-intake-v2','connect-intake-v3') THEN 3 ELSE 2 END)
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_campaign_response_consent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE response_status text; response_version uuid; version_notice uuid; offered text[];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'consent evidence is append-only'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT r.status, r.form_version_id, v.notice_version_id, v.offered_purposes INTO response_status, response_version, version_notice, offered
      FROM public.campaign_responses r JOIN public.form_versions v ON v.tenant_id = r.tenant_id AND v.id = r.form_version_id
      WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.response_id FOR UPDATE OF r;
    IF NOT FOUND OR (response_status <> 'pending' AND NOT(response_status='associated' AND NEW.status='withdrawn' AND public.connect_erasure_writer())) THEN RAISE EXCEPTION 'response is not pending'; END IF;
    IF NEW.form_version_id IS DISTINCT FROM response_version OR NEW.notice_version_id IS DISTINCT FROM version_notice THEN
      RAISE EXCEPTION 'evidence must reference the presented form and notice';
    END IF;
    IF NEW.redacted_at IS NOT NULL THEN RAISE EXCEPTION 'evidence starts unredacted'; END IF;
    IF response_status='associated' AND NEW.status='withdrawn' THEN
      SELECT channel INTO NEW.channel FROM public.campaign_response_consents WHERE tenant_id=NEW.tenant_id AND response_id=NEW.response_id AND purpose=NEW.purpose AND status='granted';
    END IF;
    NEW.recorded_at := now();
    IF NEW.status = 'granted' THEN
      IF NOT (NEW.purpose = ANY(offered)) THEN RAISE EXCEPTION 'purpose was not offered by this form'; END IF;
      IF NEW.channel IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.campaign_response_contact_methods m
          WHERE m.tenant_id = NEW.tenant_id AND m.response_id = NEW.response_id AND m.kind = CASE NEW.channel WHEN 'sms' THEN 'phone' ELSE 'email' END) THEN
        RAISE EXCEPTION 'channel has no contact method';
      END IF;
      IF EXISTS (SELECT 1 FROM public.campaign_response_consents w WHERE w.tenant_id = NEW.tenant_id AND w.response_id = NEW.response_id
          AND w.purpose = NEW.purpose AND w.status = 'withdrawn') THEN
        RAISE EXCEPTION 'purpose was withdrawn';
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.campaign_response_consents g WHERE g.tenant_id = NEW.tenant_id AND g.response_id = NEW.response_id
          AND g.purpose = NEW.purpose AND g.status = 'granted') THEN
        RAISE EXCEPTION 'nothing to withdraw';
      END IF;
      IF NEW.actor_kind = 'staff' AND NEW.recorded_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN
        RAISE EXCEPTION 'invalid withdrawal provenance';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT public.connect_erasure_writer() THEN RAISE EXCEPTION 'consent evidence is append-only'; END IF;
  -- Erasure re-keys redacted evidence (as erase_contact re-keys CRM consent events); nothing else may.
  IF NEW.id IS DISTINCT FROM OLD.id AND NEW.redacted_at IS NULL THEN RAISE EXCEPTION 'consent evidence is append-only'; END IF;
  IF (NEW.tenant_id, NEW.purpose, NEW.status, NEW.form_version_id, NEW.notice_version_id, NEW.actor_kind)
    IS DISTINCT FROM (OLD.tenant_id, OLD.purpose, OLD.status, OLD.form_version_id, OLD.notice_version_id, OLD.actor_kind) THEN
    RAISE EXCEPTION 'consent evidence is append-only';
  END IF;
  RETURN NEW;
END $$;
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
  IF r.status IN ('pending','associated') AND EXISTS(SELECT 1 FROM public.connect_intake_receipts WHERE tenant_id=r.tenant_id AND response_id=r.id AND receipt_hash=p_hash) THEN
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
--> statement-breakpoint
CREATE FUNCTION public.connect_project_withdrawal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE person uuid; event_id uuid;
BEGIN
 IF NEW.status<>'withdrawn' OR NEW.purpose NOT IN ('newsletter','outreach_follow_up') THEN RETURN NEW; END IF;
 SELECT contact_id INTO person FROM public.campaign_responses WHERE tenant_id=NEW.tenant_id AND id=NEW.response_id AND status='associated';
 IF person IS NULL THEN RETURN NEW; END IF;
 -- NOWAIT prevents the response->contact boundary from waiting behind a contact eraser.
 PERFORM 1 FROM public.contacts WHERE tenant_id=NEW.tenant_id AND id=person AND erased_at IS NULL FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'response changed' USING ERRCODE='40001'; END IF;
 INSERT INTO public.contact_consents(tenant_id,contact_id,purpose,notice_version,channel,status,source,evidence,occurred_at)
 VALUES(NEW.tenant_id,person,NEW.purpose,'connect-immutable',NEW.channel,'withdrawn','Connect','Response purpose withdrawn',NEW.occurred_at) RETURNING id INTO event_id;
 INSERT INTO public.connect_consent_origins(tenant_id,consent_id,response_id,response_consent_id,form_version_id,notice_version_id)
 VALUES(NEW.tenant_id,event_id,NEW.response_id,NEW.id,NEW.form_version_id,NEW.notice_version_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.connect_project_withdrawal() FROM PUBLIC;
CREATE TRIGGER connect_project_withdrawal AFTER INSERT ON public.campaign_response_consents
 FOR EACH ROW EXECUTE FUNCTION public.connect_project_withdrawal();
--> statement-breakpoint
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY subject_owner_lookup ON public.connect_response_subjects TO %I USING(user_id=nullif(current_setting('app.user_id',true),''))$p$,current_user);
 EXECUTE format($p$CREATE POLICY completion_owner_lookup ON public.connect_claim_completions TO %I USING(flow_hash=nullif(current_setting('app.connect_flow',true),''))$p$,current_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.connect_claim_completed(p_flow text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c record;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN false; END IF;
 PERFORM set_config('app.connect_flow',p_flow,true);
 SELECT * INTO c FROM public.connect_claim_completions WHERE flow_hash=p_flow AND expires_at>clock_timestamp()
 AND user_id=nullif(current_setting('app.user_id',true),'');
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM set_config('app.tenant_id',c.tenant_id::text,true);
 RETURN EXISTS(SELECT 1 FROM public.users WHERE id=c.user_id AND email_verified)
 AND EXISTS(SELECT 1 FROM public.campaign_responses WHERE tenant_id=c.tenant_id AND id=c.response_id AND status='associated' AND expires_at>clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.connect_claim_completed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_claim_completed(text) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.connect_claim_envelope(p_flow text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE f record;i record;
BEGIN
 IF public.connect_invitation_flow(p_flow) IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO f FROM public.connect_invitation_flows WHERE hash=p_flow;
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=f.tenant_id AND id=f.invitation_id;
 RETURN (SELECT sealed_data FROM public.connect_intake_receipts WHERE tenant_id=i.tenant_id AND response_id=i.response_id);
END $$;
REVOKE ALL ON FUNCTION public.connect_claim_envelope(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_claim_envelope(text) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.connect_invitation_consume_verified(p_flow text,p_user text,p_recipient text,p_email text,p_name text,p_decline boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE f record;i record;expiry timestamptz;automatic boolean;person uuid;
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic'
 OR p_user IS DISTINCT FROM nullif(current_setting('app.user_id',true),'') THEN RETURN 'unavailable'; END IF;
 IF NOT p_decline AND public.connect_claim_completed(p_flow) THEN RETURN 'claimed'; END IF;
 PERFORM set_config('app.connect_flow',p_flow,true);
 SELECT * INTO f FROM public.connect_invitation_flows WHERE hash=p_flow AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN 'unavailable'; END IF;
 PERFORM set_config('app.tenant_id',f.tenant_id::text,true);
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=f.tenant_id AND id=f.invitation_id;
 IF NOT FOUND THEN RETURN 'unavailable'; END IF;
 SELECT v.definition->>'kind'='connect-intake-v3' INTO automatic FROM public.campaign_responses r JOIN public.form_versions v
 ON v.tenant_id=r.tenant_id AND v.id=r.form_version_id WHERE r.tenant_id=i.tenant_id AND r.id=i.response_id;
 IF automatic IS DISTINCT FROM true OR p_decline THEN RETURN public.connect_invitation_consume(p_flow,p_user,p_recipient,p_decline); END IF;
 PERFORM 1 FROM public.users WHERE id=p_user AND email_verified AND email=p_email FOR SHARE;
 IF NOT FOUND THEN RETURN 'mismatch'; END IF;
 expiry:=public.connect_invitation_eligible(i.tenant_id,i.response_id,i.source_code);
 SELECT * INTO i FROM public.connect_invitations WHERE tenant_id=f.tenant_id AND id=f.invitation_id FOR UPDATE;
 IF expiry IS NULL OR i.expires_at<=clock_timestamp() OR i.consumed_at IS NOT NULL OR i.generation<>f.generation
 OR NOT EXISTS(SELECT 1 FROM public.connect_invitation_flows WHERE hash=p_flow AND expires_at>clock_timestamp()) THEN RETURN 'unavailable'; END IF;
 IF i.recipient_hash IS DISTINCT FROM p_recipient THEN RETURN 'mismatch'; END IF;
 INSERT INTO public.response_account_claims(tenant_id,response_id,invitation_id,user_id,expires_at)
 VALUES(i.tenant_id,i.response_id,i.id,p_user,least(expiry,clock_timestamp()+interval '10 minutes'));
 person:=public.connect_associate_verified(i.tenant_id,i.response_id,p_recipient,p_email,p_name);
 INSERT INTO public.connect_claim_completions(flow_hash,tenant_id,response_id,user_id,expires_at)
 VALUES(p_flow,i.tenant_id,i.response_id,p_user,f.expires_at);
 UPDATE public.connect_invitations SET consumed_at=clock_timestamp(),envelope=NULL WHERE tenant_id=i.tenant_id AND id=i.id;
 DELETE FROM public.connect_invitation_flows WHERE tenant_id=i.tenant_id AND invitation_id=i.id;
 RETURN 'claimed';
END $$;
REVOKE ALL ON FUNCTION public.connect_invitation_consume_verified(text,text,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_invitation_consume_verified(text,text,text,text,text,boolean) TO harvest_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.connect_invitation_consume(p_flow text,p_user text,p_recipient text,p_decline boolean) RETURNS text
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
 IF NOT p_decline AND EXISTS(SELECT 1 FROM public.campaign_responses r JOIN public.form_versions v ON v.tenant_id=r.tenant_id AND v.id=r.form_version_id WHERE r.tenant_id=i.tenant_id AND r.id=i.response_id AND v.definition->>'kind'='connect-intake-v3') THEN RETURN 'unavailable'; END IF;
 -- p_recipient is a keyed digest of the live verified session email, computed by the trusted server.
 IF i.recipient_hash IS DISTINCT FROM p_recipient THEN RETURN 'mismatch'; END IF;
 INSERT INTO public.response_account_claims(tenant_id,response_id,invitation_id,user_id,expires_at)
 VALUES(i.tenant_id,i.response_id,i.id,p_user,least(expiry,clock_timestamp()+interval '10 minutes'));
 UPDATE public.connect_invitations SET consumed_at=clock_timestamp(),envelope=NULL WHERE tenant_id=i.tenant_id AND id=i.id;
 DELETE FROM public.connect_invitation_flows WHERE tenant_id=i.tenant_id AND invitation_id=i.id;
 RETURN 'claimed';
END $$;
--> statement-breakpoint
CREATE FUNCTION public.connect_subject_responses(p_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE item record;answer jsonb:='[]'::jsonb;entry jsonb;actor text:=nullif(current_setting('app.user_id',true),'');
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN answer; END IF;
 PERFORM 1 FROM public.users WHERE id=actor AND email_verified FOR SHARE;
 IF NOT FOUND THEN RETURN answer; END IF;
 FOR item IN SELECT subject.* FROM public.connect_response_subjects subject JOIN public.campaign_responses r ON r.tenant_id=subject.tenant_id AND r.id=subject.response_id
 WHERE subject.user_id=actor AND r.status='associated' AND r.expires_at>clock_timestamp() AND (p_after IS NULL OR subject.handle>p_after) ORDER BY subject.handle LIMIT 21 LOOP
 PERFORM set_config('app.tenant_id',item.tenant_id::text,true);
 SELECT jsonb_build_object('handle',item.handle,'organizer',w.name,'campaign',c.name,'submittedAt',r.submitted_at,
 'purposes',coalesce((SELECT jsonb_agg(g.purpose ORDER BY g.purpose) FROM public.campaign_response_consents g WHERE g.tenant_id=r.tenant_id AND g.response_id=r.id AND g.status='granted' AND g.purpose IN ('newsletter','outreach_follow_up') AND NOT EXISTS(SELECT 1 FROM public.campaign_response_consents revoke WHERE revoke.tenant_id=r.tenant_id AND revoke.response_id=r.id AND revoke.purpose=g.purpose AND revoke.status='withdrawn')),'[]'::jsonb)) INTO entry
 FROM public.campaign_responses r JOIN public.workspaces w ON w.tenant_id=r.tenant_id JOIN public.campaigns c ON c.tenant_id=r.tenant_id AND c.id=r.campaign_id
 WHERE r.tenant_id=item.tenant_id AND r.id=item.response_id AND r.status='associated' AND r.expires_at>clock_timestamp();
 IF entry IS NOT NULL THEN answer:=answer||jsonb_build_array(entry); END IF;
 END LOOP;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.connect_subject_responses(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_subject_responses(uuid) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.connect_subject_rights(p_handle uuid,p_action text,p_purpose text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE subject record;proof text;actor text:=nullif(current_setting('app.user_id',true),'');
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN false; END IF;
 PERFORM 1 FROM public.users WHERE id=actor AND email_verified FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO subject FROM public.connect_response_subjects WHERE handle=p_handle AND user_id=actor;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM set_config('app.tenant_id',subject.tenant_id::text,true);
 SELECT receipt_hash INTO proof FROM public.connect_intake_receipts WHERE tenant_id=subject.tenant_id AND response_id=subject.response_id;
 IF proof IS NULL THEN RETURN false; END IF;
 RETURN public.connect_intake_rights(proof,p_action,p_purpose);
END $$;
REVOKE ALL ON FUNCTION public.connect_subject_rights(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_subject_rights(uuid,text,text) TO harvest_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.withdraw_connect_response_purpose(p_tenant uuid, p_response uuid, p_purpose text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); response_status text; grant_row record;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'withdrawal access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal access denied' USING ERRCODE = '42501'; END IF;
  SELECT status INTO response_status FROM public.campaign_responses WHERE tenant_id = p_tenant AND id = p_response AND status <> 'erased' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  -- Once associated, the CRM consent ledger owns the person's choices (HC-06 / HC-14).
  IF response_status NOT IN ('pending','associated') THEN RETURN 'not_pending'; END IF;
  IF response_status='associated' AND NOT EXISTS(SELECT 1 FROM public.campaign_responses r JOIN public.form_versions v ON v.tenant_id=r.tenant_id AND v.id=r.form_version_id WHERE r.tenant_id=p_tenant AND r.id=p_response AND v.definition->>'kind'='connect-intake-v3') THEN RETURN 'not_pending'; END IF;
  SELECT form_version_id, notice_version_id INTO grant_row FROM public.campaign_response_consents
    WHERE tenant_id = p_tenant AND response_id = p_response AND purpose = p_purpose AND status = 'granted';
  IF NOT FOUND THEN RETURN 'not_granted'; END IF;
  IF EXISTS (SELECT 1 FROM public.campaign_response_consents WHERE tenant_id = p_tenant AND response_id = p_response
      AND purpose = p_purpose AND status = 'withdrawn') THEN RETURN 'already_withdrawn'; END IF;
  INSERT INTO public.campaign_response_consents (tenant_id, response_id, purpose, status, form_version_id, notice_version_id, actor_kind, recorded_by)
    VALUES (p_tenant, p_response, p_purpose, 'withdrawn', grant_row.form_version_id, grant_row.notice_version_id, 'staff', actor);
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'connect.response.withdraw', p_response::text, jsonb_build_object('purpose', p_purpose));
  RETURN 'withdrawn';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.purge_expired_connect_responses(p_tenant uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); expired record; purged integer := 0;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501'; END IF;
  FOR expired IN SELECT id FROM public.campaign_responses WHERE tenant_id = p_tenant AND status IN ('pending','associated') AND expires_at <= now()
      ORDER BY id FOR UPDATE SKIP LOCKED LOOP
    PERFORM public.connect_scrub_response(p_tenant, expired.id);
    purged := purged + 1;
  END LOOP;
  IF purged > 0 THEN
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
      VALUES (p_tenant, actor, 'connect.response.purge', NULL, jsonb_build_object('count', purged::text));
  END IF;
  RETURN purged;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY completion_expiry_owner ON public.connect_claim_completions TO %I USING(expires_at<=clock_timestamp() AND current_setting('app.connect_purge',true)='synthetic')$p$,current_user);
END $$;
CREATE OR REPLACE FUNCTION public.purge_connect_intake() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record; total integer:=0; previous text:=coalesce(current_setting('app.tenant_id',true),'');
BEGIN
 IF current_setting('app.connect_intake_mode',true) IS DISTINCT FROM 'synthetic' THEN RETURN 0; END IF;
 PERFORM set_config('app.connect_purge','synthetic',true);
 FOR r IN SELECT tenant_id,id FROM public.campaign_responses WHERE status IN ('pending','associated') AND expires_at<=now()
 AND EXISTS(SELECT 1 FROM public.connect_intake_receipts x WHERE x.tenant_id=campaign_responses.tenant_id AND x.response_id=campaign_responses.id)
 ORDER BY expires_at LIMIT 100 LOOP
  PERFORM set_config('app.tenant_id',r.tenant_id::text,true);
  PERFORM 1 FROM public.campaign_responses WHERE tenant_id=r.tenant_id AND id=r.id AND status IN ('pending','associated') AND expires_at<=now() FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
   PERFORM public.connect_scrub_response(r.tenant_id,r.id);total:=total+1;
   INSERT INTO public.connect_intake_events(tenant_id,event,actor,created_at) VALUES(r.tenant_id,'purge','worker',date_trunc('day',now(),'UTC'));
  END IF;
 END LOOP;
 DELETE FROM public.connect_claim_completions WHERE flow_hash IN (SELECT flow_hash FROM public.connect_claim_completions WHERE expires_at<=clock_timestamp() LIMIT 1000);
 DELETE FROM public.connect_intake_limits WHERE key IN (SELECT key FROM public.connect_intake_limits WHERE expires_at<=now() LIMIT 1000);
 PERFORM set_config('app.connect_purge','',true);PERFORM set_config('app.tenant_id',previous,true);RETURN total;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY associated_expiry_owner ON public.campaign_responses TO %I USING(current_setting('app.connect_purge',true)='synthetic' AND status='associated' AND expires_at<=clock_timestamp())$p$,current_user);
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.connect_invitation_flow(p_flow text) RETURNS jsonb
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
 RETURN jsonb_build_object('recipientHash',i.recipient_hash,'recipientBinding',i.token_hash,'sourcePath','/c/'||i.source_code) || coalesce((SELECT CASE WHEN v.definition->>'kind'='connect-intake-v3' THEN jsonb_build_object('automatic',true,'organizer',w.name) ELSE '{}'::jsonb END FROM public.campaign_responses r JOIN public.form_versions v ON v.tenant_id=r.tenant_id AND v.id=r.form_version_id JOIN public.workspaces w ON w.tenant_id=r.tenant_id WHERE r.tenant_id=i.tenant_id AND r.id=i.response_id),'{}'::jsonb);
END $$;
--> statement-breakpoint
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY subject_response_owner_lookup ON public.campaign_responses TO %I USING(EXISTS(SELECT 1 FROM public.connect_response_subjects subject WHERE subject.tenant_id=campaign_responses.tenant_id AND subject.response_id=campaign_responses.id AND subject.user_id=nullif(current_setting('app.user_id',true),'')))$p$,current_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.contact_source_retained(p_tenant uuid,p_response uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_response IS NULL THEN RETURN true; END IF;
 IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
 OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'') AND role_id IN ('owner','admin')) THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.campaign_responses WHERE tenant_id=p_tenant AND id=p_response AND status='associated' AND expires_at>statement_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.contact_source_retained(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_source_retained(uuid,uuid) TO harvest_app;
ALTER POLICY sources_read ON public.contact_source_events USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.tenant_id=contact_source_events.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND m.role_id IN ('owner','admin'))
 AND public.contact_source_retained(tenant_id,response_id));
--> statement-breakpoint
CREATE FUNCTION public.contact_connect_source_label(p_tenant uuid,p_event uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE answer text;
BEGIN
 IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
 OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'') AND role_id IN ('owner','admin')) THEN RETURN NULL; END IF;
 SELECT concat_ws(' · ',campaign.name,link.label,form.name,'v'||version.version) INTO answer
 FROM public.contact_source_events source JOIN public.campaign_responses r ON r.tenant_id=source.tenant_id AND r.id=source.response_id
 JOIN public.campaigns campaign ON campaign.tenant_id=r.tenant_id AND campaign.id=r.campaign_id
 JOIN public.campaign_response_links link ON link.tenant_id=r.tenant_id AND link.id=r.link_id
 JOIN public.form_versions version ON version.tenant_id=r.tenant_id AND version.id=r.form_version_id
 JOIN public.forms form ON form.tenant_id=version.tenant_id AND form.id=version.form_id
 WHERE source.tenant_id=p_tenant AND source.id=p_event AND source.kind='connect' AND r.status='associated' AND r.expires_at>statement_timestamp();
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.contact_connect_source_label(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_connect_source_label(uuid,uuid) TO harvest_app;
--> statement-breakpoint
-- Organizer name is shown only after a trusted flow/subject capability derived tenant context.
-- The runtime role gains no additional workspace policy or table privilege.
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY connect_workspace_owner ON public.workspaces FOR SELECT TO %I USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)$p$,current_user);
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.connect_response_purpose_active(p_tenant uuid, p_response uuid, p_purpose text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'response access denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'response access denied' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.campaign_responses r JOIN public.campaign_response_consents g
      ON g.tenant_id = r.tenant_id AND g.response_id = r.id AND g.purpose = p_purpose AND g.status = 'granted' AND g.redacted_at IS NULL
    WHERE r.tenant_id = p_tenant AND r.id = p_response AND r.status IN ('pending','associated') AND r.expires_at > clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM public.campaign_response_consents w WHERE w.tenant_id = r.tenant_id AND w.response_id = r.id
        AND w.purpose = p_purpose AND w.status = 'withdrawn')
      AND (r.status='pending' OR (r.status='associated' AND EXISTS(SELECT 1 FROM public.form_versions version WHERE version.tenant_id=r.tenant_id AND version.id=r.form_version_id AND version.definition->>'kind'='connect-intake-v3')
      AND (p_purpose='account_communications' OR (
       EXISTS(SELECT 1 FROM public.connect_consent_origins origin JOIN public.contact_consents projected ON projected.tenant_id=origin.tenant_id AND projected.id=origin.consent_id
        WHERE origin.tenant_id=r.tenant_id AND origin.response_id=r.id AND origin.response_consent_id=g.id AND projected.redacted_at IS NULL)
       AND (SELECT latest.status FROM public.contact_consents latest WHERE latest.tenant_id=r.tenant_id AND latest.contact_id=r.contact_id AND latest.purpose=p_purpose AND latest.channel=g.channel AND latest.redacted_at IS NULL ORDER BY latest.recorded_at DESC,latest.occurred_at DESC,latest.id DESC LIMIT 1)='granted'
       AND NOT EXISTS(SELECT 1 FROM public.contact_consents withdrawal WHERE withdrawal.tenant_id=r.tenant_id AND withdrawal.contact_id=r.contact_id AND withdrawal.purpose=p_purpose AND withdrawal.channel=g.channel AND withdrawal.status='withdrawn' AND withdrawal.redacted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.contact_consents later WHERE later.tenant_id=r.tenant_id AND later.contact_id=r.contact_id AND later.purpose=p_purpose AND later.channel=g.channel AND later.status='granted' AND later.redacted_at IS NULL AND later.recorded_at>withdrawal.recorded_at AND later.occurred_at>withdrawal.occurred_at))
      )))));

END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.connect_invitation_prepare(p_token text,p_flow text) RETURNS boolean
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
 IF EXISTS(SELECT 1 FROM public.campaign_responses response JOIN public.form_versions version ON version.tenant_id=response.tenant_id AND version.id=response.form_version_id WHERE response.tenant_id=i.tenant_id AND response.id=i.response_id AND version.definition->>'kind'='connect-intake-v3') THEN expiry:=least(expiry,clock_timestamp()+interval '10 minutes'); END IF;
 INSERT INTO public.connect_invitation_flows(hash,tenant_id,invitation_id,generation,expires_at) VALUES(p_flow,i.tenant_id,i.id,i.generation,least(i.expires_at,expiry));
 RETURN true;
END $$;