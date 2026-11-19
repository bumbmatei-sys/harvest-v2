CREATE TABLE "newsletter_intake_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "newsletter_intake_limit_count" CHECK ("newsletter_intake_limits"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "newsletter_preference_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"list_id" uuid,
	"scope" text NOT NULL,
	"email_proof" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "newsletter_preference_token_scope" CHECK (("newsletter_preference_tokens"."scope" = 'list' and "newsletter_preference_tokens"."list_id" is not null) or ("newsletter_preference_tokens"."scope" = 'all' and "newsletter_preference_tokens"."list_id" is null)),
	CONSTRAINT "newsletter_preference_token_hashes" CHECK ("newsletter_preference_tokens"."token_hash" ~ '^[0-9a-f]{64}$' and "newsletter_preference_tokens"."email_proof" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "newsletter_signup_challenges" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"contact_id" uuid,
	"form_version" integer NOT NULL,
	"email_proof" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "newsletter_signup_challenge_hashes" CHECK ("newsletter_signup_challenges"."token_hash" ~ '^[0-9a-f]{64}$' and "newsletter_signup_challenges"."email_proof" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "newsletter_signup_forms" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "newsletter_signup_forms_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_signup_form_key" UNIQUE("id"),
	CONSTRAINT "newsletter_signup_form_version" CHECK ("newsletter_signup_forms"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_system_actor";--> statement-breakpoint
ALTER TABLE "contact_consents" DROP CONSTRAINT "consent_notice_version";--> statement-breakpoint
ALTER TABLE "newsletter_preference_tokens" ADD CONSTRAINT "newsletter_preference_tokens_tenant_id_subscriber_id_newsletter_subscribers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","subscriber_id") REFERENCES "public"."newsletter_subscribers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_preference_tokens" ADD CONSTRAINT "newsletter_preference_tokens_tenant_id_list_id_subscriber_id_newsletter_subscriptions_tenant_id_list_id_subscriber_id_fk" FOREIGN KEY ("tenant_id","list_id","subscriber_id") REFERENCES "public"."newsletter_subscriptions"("tenant_id","list_id","subscriber_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_signup_challenges" ADD CONSTRAINT "newsletter_signup_challenges_tenant_id_form_id_newsletter_signup_forms_tenant_id_id_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."newsletter_signup_forms"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_signup_forms" ADD CONSTRAINT "newsletter_signup_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_signup_forms" ADD CONSTRAINT "newsletter_signup_forms_tenant_id_list_id_newsletter_lists_tenant_id_id_fk" FOREIGN KEY ("tenant_id","list_id") REFERENCES "public"."newsletter_lists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_intake_limits_expiry" ON "newsletter_intake_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "newsletter_preference_tokens_expiry" ON "newsletter_preference_tokens" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "newsletter_signup_challenges" ADD CONSTRAINT "newsletter_signup_challenges_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_signup_challenges_contact" ON "newsletter_signup_challenges" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "newsletter_signup_challenges_expiry" ON "newsletter_signup_challenges" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_system_actor" CHECK ("audit_logs"."actor_id" is not null or "audit_logs"."action" in ('followup.case.withdraw', 'followup.case.revoke', 'community.live.auto_close', 'community.moderation_report_expire', 'newsletter.signup.confirmed', 'newsletter.unsubscribe.list', 'newsletter.unsubscribe.all', 'newsletter.withdrawal.propagated'));--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "consent_notice_version" CHECK ("contact_consents"."notice_version" in ('notice-v1', 'legacy-unversioned', 'connect-immutable', 'subject-withdrawal', 'newsletter-subject-v1'));
--> statement-breakpoint
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['newsletter_signup_forms','newsletter_signup_challenges','newsletter_preference_tokens','newsletter_intake_limits'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,harvest_app',rel);
    EXECUTE format($p$CREATE POLICY nl02_private_owner ON public.%I TO %I
      USING (coalesce(current_setting('app.nl02_private',true),'')='on')
      WITH CHECK (coalesce(current_setting('app.nl02_private',true),'')='on')$p$,rel,current_user);
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['newsletter_subscribers','newsletter_subscriptions'] LOOP
    EXECUTE format($p$CREATE POLICY nl02_scoped_owner ON public.%I TO %I
      USING (tenant_id=nullif(current_setting('app.nl02_tenant',true),'')::uuid)
      WITH CHECK (tenant_id=nullif(current_setting('app.nl02_tenant',true),'')::uuid)$p$,rel,current_user);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE (active,version) ON public.newsletter_signup_forms TO harvest_app;
CREATE POLICY nl02_form_managers ON public.newsletter_signup_forms TO harvest_app
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT FROM public.workspace_members w WHERE w.tenant_id=newsletter_signup_forms.tenant_id
      AND w.user_id=nullif(current_setting('app.user_id',true),'') AND w.role_id IN ('owner','admin')))
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT FROM public.workspace_members w WHERE w.tenant_id=newsletter_signup_forms.tenant_id
      AND w.user_id=nullif(current_setting('app.user_id',true),'') AND w.role_id IN ('owner','admin')));
CREATE POLICY nl02_form_actor ON public.newsletter_signup_forms AS RESTRICTIVE FOR INSERT TO harvest_app
  WITH CHECK (created_by=nullif(current_setting('app.user_id',true),''));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_contact_child() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='contact_consents' THEN
   IF NEW.purpose='newsletter' AND NEW.status='withdrawn' THEN
     PERFORM 1 FROM public.contacts WHERE tenant_id=NEW.tenant_id AND id=NEW.contact_id AND erased_at IS NULL FOR UPDATE;
   ELSE
     PERFORM 1 FROM public.contacts WHERE tenant_id=NEW.tenant_id AND id=NEW.contact_id AND erased_at IS NULL FOR SHARE;
   END IF;
 ELSE
   PERFORM 1 FROM public.contacts WHERE tenant_id=NEW.tenant_id AND id=NEW.contact_id AND erased_at IS NULL FOR SHARE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'contact is unavailable'; END IF;
 IF TG_TABLE_NAME='contact_consents' THEN
 IF NEW.notice_version NOT IN ('subject-withdrawal','newsletter-subject-v1') THEN NEW.recorded_at:=now(); END IF;
 IF NEW.notice_version='subject-withdrawal' THEN
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.erase_contact(uuid,uuid)'::regprocedure))
  OR NEW.status<>'withdrawn' OR NEW.recorded_by IS NOT NULL OR NEW.redacted_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM public.contact_consents prior JOIN public.connect_consent_origins origin ON origin.tenant_id=prior.tenant_id AND origin.consent_id=prior.id
  WHERE prior.tenant_id=NEW.tenant_id AND prior.contact_id=NEW.contact_id AND prior.purpose=NEW.purpose AND prior.channel=NEW.channel AND prior.status='withdrawn'
  AND prior.occurred_at=NEW.occurred_at AND prior.recorded_at=NEW.recorded_at AND prior.redacted_at IS NULL) THEN
   RAISE EXCEPTION 'invalid withdrawal suppression' USING ERRCODE='42501';
  END IF;
 ELSIF NEW.notice_version='newsletter-subject-v1' THEN
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.erase_contact(uuid,uuid)'::regprocedure))
    OR NEW.recorded_by IS NOT NULL OR NEW.redacted_at IS NOT NULL
    OR NEW.purpose<>'newsletter' OR NEW.channel IS DISTINCT FROM 'email'
    OR NEW.tenant_id IS DISTINCT FROM nullif(current_setting('app.nl02_tenant',true),'')::uuid
    OR (NEW.status,NEW.source) NOT IN (('granted','newsletter_verified_signup'),('withdrawn','newsletter_subject_unsubscribe'))
  THEN RAISE EXCEPTION 'invalid newsletter provenance' USING ERRCODE='42501'; END IF;
  NEW.recorded_at:=clock_timestamp();
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
REVOKE ALL ON FUNCTION public.guard_contact_child() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.nl02_hash(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
  SELECT encode(sha256(convert_to(p_value,'UTF8')),'hex')
$$;
CREATE FUNCTION public.nl02_take(p_key text,p_start timestamptz,p_expiry timestamptz,p_limit integer) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  INSERT INTO public.newsletter_intake_limits AS quota(key,window_start,expires_at,count)
    VALUES(p_key,p_start,p_expiry,1)
  ON CONFLICT(key) DO UPDATE SET
    window_start=excluded.window_start,expires_at=excluded.expires_at,
    count=CASE WHEN quota.window_start=excluded.window_start THEN quota.count+1 ELSE 1 END
    WHERE quota.window_start<excluded.window_start OR (quota.window_start=excluded.window_start AND quota.count<p_limit);
  RETURN FOUND;
END $$;
CREATE FUNCTION public.nl02_email(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(length(p_value) BETWEEN 3 AND 254 AND p_value=lower(p_value)
   AND p_value ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+[.][^@[:space:][:cntrl:]]+$',false)
$$;
CREATE FUNCTION public.nl02_has_withdrawal(p_tenant uuid,p_contact uuid,p_after timestamptz,p_non_email boolean)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS (SELECT FROM public.contact_consents w WHERE w.tenant_id=p_tenant AND w.contact_id=p_contact
    AND w.purpose='newsletter' AND w.status='withdrawn' AND w.redacted_at IS NULL
    AND (p_after IS NULL OR w.recorded_at>=p_after) AND (NOT p_non_email OR w.channel<>'email')
    AND NOT EXISTS (SELECT FROM public.contact_consents g WHERE g.tenant_id=w.tenant_id
      AND g.contact_id=w.contact_id AND g.purpose=w.purpose AND g.channel=w.channel
      AND g.status='granted' AND g.redacted_at IS NULL AND g.recorded_at>w.recorded_at AND g.occurred_at>w.occurred_at))
$$;
REVOKE ALL ON FUNCTION public.nl02_hash(text),public.nl02_take(text,timestamptz,timestamptz,integer),
  public.nl02_email(text),public.nl02_has_withdrawal(uuid,uuid,timestamptz,boolean) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.nl02_start_signup(p_form uuid,p_email text,p_token text,p_address_key text) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  form public.newsletter_signup_forms;
  contact uuid;
  previous_tenant text:=current_setting('app.tenant_id',true);
  queued boolean;
  moment timestamptz:=clock_timestamp();
  minute_bucket timestamptz:=date_trunc('minute',moment);
  hour_bucket timestamptz:=date_trunc('hour',moment);
BEGIN
  IF NOT public.nl02_email(p_email) OR coalesce(p_token,'') !~ '^[A-Za-z0-9_-]{43}$'
    OR coalesce(p_address_key,'') !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;

  DELETE FROM public.newsletter_intake_limits WHERE key IN (
    SELECT key FROM public.newsletter_intake_limits WHERE expires_at<moment-interval '1 hour'
    ORDER BY expires_at,key LIMIT 40 FOR UPDATE SKIP LOCKED);
  DELETE FROM public.newsletter_signup_challenges WHERE token_hash IN (
    SELECT token_hash FROM public.newsletter_signup_challenges WHERE expires_at<=moment
    ORDER BY expires_at,token_hash LIMIT 40 FOR UPDATE SKIP LOCKED);
  DELETE FROM public.newsletter_preference_tokens WHERE token_hash IN (
    SELECT token_hash FROM public.newsletter_preference_tokens WHERE expires_at<=moment
    ORDER BY expires_at,token_hash LIMIT 40 FOR UPDATE SKIP LOCKED);

  SELECT * INTO form FROM public.newsletter_signup_forms WHERE id=p_form AND active FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT public.nl02_take('form:'||form.id,minute_bucket,minute_bucket+interval '1 minute',20)
     OR NOT public.nl02_take('address:'||form.id||':'||p_address_key,hour_bucket,hour_bucket+interval '1 hour',3)
    THEN RETURN false; END IF;
  PERFORM set_config('app.tenant_id',form.tenant_id::text,true);
  SELECT c.id INTO contact FROM public.contact_identifiers i JOIN public.contacts c
    ON c.tenant_id=i.tenant_id AND c.id=i.contact_id AND c.erased_at IS NULL
    WHERE i.tenant_id=form.tenant_id AND i.kind='email' AND i.normalized_value=p_email FOR SHARE OF c;
  INSERT INTO public.newsletter_signup_challenges(token_hash,tenant_id,form_id,contact_id,form_version,email_proof,created_at,expires_at)
    VALUES(public.nl02_hash(p_token),form.tenant_id,form.id,contact,form.version,
      public.nl02_hash(p_token||':'||p_email),moment,moment+interval '30 minutes')
    ON CONFLICT DO NOTHING;
  queued:=FOUND;
  PERFORM set_config('app.tenant_id',coalesce(previous_tenant,''),true);
  RETURN queued;
END $$;
REVOKE ALL ON FUNCTION public.nl02_start_signup(uuid,text,text,text) FROM PUBLIC;

CREATE FUNCTION public.newsletter_signup_start(p_form uuid,p_email text,p_token text,p_address_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous_private text:=current_setting('app.nl02_private',true); queued boolean;
BEGIN
  PERFORM set_config('app.nl02_private','on',true);
  queued:=public.nl02_start_signup(p_form,p_email,p_token,p_address_key);
  PERFORM set_config('app.nl02_private',coalesce(previous_private,''),true);
  RETURN queued;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_signup_start(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_signup_start(uuid,text,text,text) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.nl02_accept_signup(p_email text,p_token text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  pending public.newsletter_signup_challenges;
  form public.newsletter_signup_forms;
  subscriber public.newsletter_subscribers;
  contact uuid;
  grant_id uuid;
  current_subscription public.newsletter_subscriptions;
BEGIN
  SELECT * INTO pending FROM public.newsletter_signup_challenges
    WHERE token_hash=public.nl02_hash(p_token) AND expires_at>clock_timestamp()
      AND email_proof=public.nl02_hash(p_token||':'||p_email);
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO form FROM public.newsletter_signup_forms
    WHERE tenant_id=pending.tenant_id AND id=pending.form_id AND active AND version=pending.form_version FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id',form.tenant_id::text,true);
  PERFORM set_config('app.nl02_tenant',form.tenant_id::text,true);
  PERFORM pg_advisory_xact_lock(hashtextextended(form.tenant_id::text||':newsletter:'||p_email,0));

  SELECT contact_id INTO contact FROM public.contact_identifiers
    WHERE tenant_id=form.tenant_id AND kind='email' AND normalized_value=p_email;
  IF pending.contact_id IS NOT NULL AND pending.contact_id IS DISTINCT FROM contact THEN RETURN; END IF;
  IF contact IS NULL THEN
    BEGIN
      INSERT INTO public.contacts(tenant_id,name) VALUES(form.tenant_id,'Newsletter subscriber') RETURNING id INTO contact;
      INSERT INTO public.contact_identifiers(tenant_id,contact_id,kind,value,normalized_value)
        VALUES(form.tenant_id,contact,'email',p_email,p_email);
    EXCEPTION WHEN unique_violation THEN
      SELECT contact_id INTO contact FROM public.contact_identifiers
        WHERE tenant_id=form.tenant_id AND kind='email' AND normalized_value=p_email;
    END;
  END IF;
  PERFORM 1 FROM public.contacts WHERE tenant_id=form.tenant_id AND id=contact AND erased_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT FROM public.contact_identifiers
    WHERE tenant_id=form.tenant_id AND contact_id=contact AND kind='email' AND normalized_value=p_email) THEN RETURN; END IF;
  DELETE FROM public.newsletter_signup_challenges WHERE token_hash=pending.token_hash AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  IF public.nl02_has_withdrawal(form.tenant_id,contact,pending.created_at,false)
    OR public.nl02_has_withdrawal(form.tenant_id,contact,NULL,true) THEN RETURN; END IF;
  SELECT * INTO subscriber FROM public.newsletter_subscribers WHERE tenant_id=form.tenant_id AND contact_id=contact FOR UPDATE;
  IF subscriber.suppressed THEN RETURN; END IF;
  SELECT * INTO current_subscription FROM public.newsletter_subscriptions
    WHERE tenant_id=form.tenant_id AND subscriber_id=subscriber.id AND list_id=form.list_id;
  IF current_subscription.state IN ('suppressed','bounced')
    OR (current_subscription.state='unsubscribed' AND current_subscription.updated_at>=pending.created_at)
    OR (current_subscription.state='subscribed' AND public.newsletter_consent_allowed(form.tenant_id,contact,current_subscription.consent_id))
    THEN RETURN; END IF;

  IF subscriber.id IS NULL THEN
    PERFORM set_config('app.user_id',form.created_by,true);
    INSERT INTO public.newsletter_subscribers(tenant_id,contact_id,created_by)
      VALUES(form.tenant_id,contact,form.created_by) RETURNING * INTO subscriber;
  END IF;
  INSERT INTO public.contact_consents(tenant_id,contact_id,purpose,channel,status,source,evidence,notice_version,occurred_at)
    VALUES(form.tenant_id,contact,'newsletter','email','granted','newsletter_verified_signup',
      'Explicit newsletter selection and email confirmation','newsletter-subject-v1',clock_timestamp())
    RETURNING id INTO grant_id;
  IF public.newsletter_consent_allowed(form.tenant_id,contact,grant_id) THEN
    INSERT INTO public.newsletter_subscriptions AS ns(tenant_id,list_id,subscriber_id,state,consent_id)
      VALUES(form.tenant_id,form.list_id,subscriber.id,'subscribed',grant_id)
    ON CONFLICT(tenant_id,list_id,subscriber_id) DO UPDATE SET
      state=excluded.state,consent_id=excluded.consent_id,version=ns.version+1,updated_at=clock_timestamp();
  END IF;
  INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata)
    VALUES(form.tenant_id,NULL,'newsletter.signup.confirmed',subscriber.id::text,jsonb_build_object('listId',form.list_id,'notice','newsletter-subject-v1'));
END $$;
REVOKE ALL ON FUNCTION public.nl02_accept_signup(text,text) FROM PUBLIC;

CREATE FUNCTION public.newsletter_signup_confirm(p_email text,p_token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous_tenant text:=current_setting('app.tenant_id',true);
  previous_public text:=current_setting('app.nl02_tenant',true);
  previous_actor text:=current_setting('app.user_id',true);
  previous_private text:=current_setting('app.nl02_private',true);
BEGIN
  IF NOT public.nl02_email(p_email) OR coalesce(p_token,'') !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN; END IF;
  PERFORM set_config('app.nl02_private','on',true);
  PERFORM public.nl02_accept_signup(p_email,p_token);
  PERFORM set_config('app.nl02_private',coalesce(previous_private,''),true);
  PERFORM set_config('app.tenant_id',coalesce(previous_tenant,''),true);
  PERFORM set_config('app.nl02_tenant',coalesce(previous_public,''),true);
  PERFORM set_config('app.user_id',coalesce(previous_actor,''),true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_signup_confirm(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_signup_confirm(text,text) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.newsletter_preference_issue(p_tenant uuid,p_subscriber uuid,p_list uuid,p_scope text,p_nonce text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text:=current_setting('app.nl02_tenant',true);
  actor text:=nullif(current_setting('app.user_id',true),'');
  email text;
  previous_private text:=current_setting('app.nl02_private',true);
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
    OR actor IS NULL OR coalesce(p_nonce,'') !~ '^[A-Za-z0-9_-]{43}$'
    OR NOT coalesce((p_scope='list' AND p_list IS NOT NULL) OR (p_scope='all' AND p_list IS NULL),false)
    THEN RETURN false; END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=actor AND role_id IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM set_config('app.nl02_tenant',p_tenant::text,true);
  SELECT i.normalized_value INTO email FROM public.newsletter_subscribers s JOIN public.contact_identifiers i
    ON i.tenant_id=s.tenant_id AND i.contact_id=s.contact_id AND i.kind='email'
    WHERE s.tenant_id=p_tenant AND s.id=p_subscriber
      AND (p_list IS NULL OR EXISTS (SELECT FROM public.newsletter_subscriptions ns
        WHERE ns.tenant_id=s.tenant_id AND ns.subscriber_id=s.id AND ns.list_id=p_list));
  PERFORM set_config('app.nl02_tenant',coalesce(previous,''),true);
  IF email IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.nl02_private','on',true);
  INSERT INTO public.newsletter_preference_tokens(token_hash,tenant_id,subscriber_id,list_id,scope,email_proof,expires_at)
    VALUES(public.nl02_hash(p_nonce),p_tenant,p_subscriber,p_list,p_scope,
      public.nl02_hash(p_nonce||':'||email),clock_timestamp()+interval '30 days');
  PERFORM set_config('app.nl02_private',coalesce(previous_private,''),true);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_preference_issue(uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_preference_issue(uuid,uuid,uuid,text,text) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.nl02_apply_unsubscribe(p_nonce text,p_scope text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE token public.newsletter_preference_tokens; contact uuid; email text;
BEGIN
  SELECT * INTO token FROM public.newsletter_preference_tokens
    WHERE token_hash=public.nl02_hash(p_nonce) AND scope=p_scope AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id',token.tenant_id::text,true);
  PERFORM set_config('app.nl02_tenant',token.tenant_id::text,true);
  SELECT contact_id INTO contact FROM public.newsletter_subscribers WHERE tenant_id=token.tenant_id AND id=token.subscriber_id;
  PERFORM 1 FROM public.contacts WHERE tenant_id=token.tenant_id AND id=contact AND erased_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT normalized_value INTO email FROM public.contact_identifiers
    WHERE tenant_id=token.tenant_id AND contact_id=contact AND kind='email';
  IF public.nl02_hash(p_nonce||':'||email) IS DISTINCT FROM token.email_proof THEN RETURN; END IF;
  DELETE FROM public.newsletter_preference_tokens WHERE token_hash=token.token_hash AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;

  IF token.scope='list' THEN
    UPDATE public.newsletter_subscriptions SET state='unsubscribed',consent_id=NULL,version=version+1,updated_at=clock_timestamp()
      WHERE tenant_id=token.tenant_id AND subscriber_id=token.subscriber_id AND list_id=token.list_id AND state='subscribed';
    IF NOT FOUND THEN RETURN; END IF;
  ELSE
    IF NOT EXISTS (SELECT FROM public.contact_consents w WHERE w.tenant_id=token.tenant_id AND w.contact_id=contact
      AND w.purpose='newsletter' AND w.channel='email' AND w.status='withdrawn' AND w.redacted_at IS NULL
      AND NOT EXISTS (SELECT FROM public.contact_consents g WHERE g.tenant_id=w.tenant_id AND g.contact_id=w.contact_id
        AND g.purpose=w.purpose AND g.channel=w.channel AND g.status='granted' AND g.redacted_at IS NULL
        AND g.recorded_at>w.recorded_at AND g.occurred_at>w.occurred_at)) THEN
      INSERT INTO public.contact_consents(tenant_id,contact_id,purpose,channel,status,source,evidence,notice_version,occurred_at)
        VALUES(token.tenant_id,contact,'newsletter','email','withdrawn','newsletter_subject_unsubscribe',
          'Subject requested all newsletter unsubscribe','newsletter-subject-v1',clock_timestamp());
    ELSE
      RETURN;
    END IF;
  END IF;
  INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata)
    VALUES(token.tenant_id,NULL,'newsletter.unsubscribe.'||token.scope,token.subscriber_id::text,
      jsonb_strip_nulls(jsonb_build_object('listId',token.list_id)));
END $$;
REVOKE ALL ON FUNCTION public.nl02_apply_unsubscribe(text,text) FROM PUBLIC;

CREATE FUNCTION public.newsletter_unsubscribe(p_nonce text,p_scope text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text:=current_setting('app.tenant_id',true); previous_public text:=current_setting('app.nl02_tenant',true);
  previous_private text:=current_setting('app.nl02_private',true);
BEGIN
  IF coalesce(p_nonce,'') !~ '^[A-Za-z0-9_-]{43}$' OR coalesce(p_scope,'') NOT IN ('list','all') THEN RETURN; END IF;
  PERFORM set_config('app.nl02_private','on',true);
  PERFORM public.nl02_apply_unsubscribe(p_nonce,p_scope);
  PERFORM set_config('app.nl02_private',coalesce(previous_private,''),true);
  PERFORM set_config('app.tenant_id',coalesce(previous,''),true);
  PERFORM set_config('app.nl02_tenant',coalesce(previous_public,''),true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_unsubscribe(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_unsubscribe(text,text) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.nl02_propagate(p_tenant uuid,p_contact uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text:=current_setting('app.tenant_id',true);
  previous_public text:=current_setting('app.nl02_tenant',true); subscriber uuid; updated integer;
BEGIN
  PERFORM set_config('app.tenant_id',p_tenant::text,true);
  PERFORM set_config('app.nl02_tenant',p_tenant::text,true);
  PERFORM 1 FROM public.contacts WHERE tenant_id=p_tenant AND id=p_contact AND erased_at IS NULL FOR UPDATE;
  IF FOUND AND public.nl02_has_withdrawal(p_tenant,p_contact,NULL,false) THEN
    SELECT id INTO subscriber FROM public.newsletter_subscribers WHERE tenant_id=p_tenant AND contact_id=p_contact FOR UPDATE;
    UPDATE public.newsletter_subscriptions SET state='unsubscribed',consent_id=NULL,version=version+1,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant AND subscriber_id=subscriber AND state='subscribed';
    GET DIAGNOSTICS updated=ROW_COUNT;
    IF updated>0 THEN
      INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata)
        VALUES(p_tenant,NULL,'newsletter.withdrawal.propagated',subscriber::text,jsonb_build_object('listsChanged',updated));
    END IF;
  END IF;
  PERFORM set_config('app.tenant_id',coalesce(previous,''),true);
  PERFORM set_config('app.nl02_tenant',coalesce(previous_public,''),true);
END $$;
REVOKE ALL ON FUNCTION public.nl02_propagate(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.newsletter_withdrawal_propagate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM public.nl02_propagate(NEW.tenant_id,NEW.contact_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_withdrawal_propagate() FROM PUBLIC;
CREATE TRIGGER newsletter_consent_withdraw AFTER INSERT ON public.contact_consents
  FOR EACH ROW WHEN (NEW.purpose='newsletter' AND NEW.status='withdrawn' AND NEW.redacted_at IS NULL)
  EXECUTE FUNCTION public.newsletter_withdrawal_propagate();
CREATE CONSTRAINT TRIGGER newsletter_consent_move AFTER UPDATE ON public.contact_consents DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.purpose='newsletter' AND OLD.contact_id IS DISTINCT FROM NEW.contact_id
    AND NEW.contact_id IS NOT NULL AND NEW.redacted_at IS NULL)
  EXECUTE FUNCTION public.newsletter_withdrawal_propagate();
--> statement-breakpoint
-- Reconcile existing subscribed markers against outstanding withdrawals during upgrade.
DO $$
DECLARE person record;
BEGIN
  EXECUTE format('CREATE POLICY nl02_upgrade ON public.newsletter_subscribers FOR SELECT TO %I USING (true)',current_user);
  FOR person IN SELECT tenant_id,contact_id FROM public.newsletter_subscribers LOOP
    PERFORM public.nl02_propagate(person.tenant_id,person.contact_id);
  END LOOP;
  DROP POLICY nl02_upgrade ON public.newsletter_subscribers;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_forget_pending_signup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous_private text:=current_setting('app.nl02_private',true);
BEGIN
  PERFORM set_config('app.nl02_private','on',true);
  DELETE FROM public.newsletter_signup_challenges WHERE tenant_id=OLD.tenant_id AND contact_id=OLD.id;
  PERFORM set_config('app.nl02_private',coalesce(previous_private,''),true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_forget_pending_signup() FROM PUBLIC;
CREATE TRIGGER newsletter_forget_signup_after_erasure AFTER UPDATE OF erased_at ON public.contacts
  FOR EACH ROW WHEN (OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL)
  EXECUTE FUNCTION public.newsletter_forget_pending_signup();

--> statement-breakpoint
-- Preserve restrictions before the canonical merge erases the source subscriber.
-- Subscription grants and provenance stay tied to the original identity and are not copied.
ALTER FUNCTION public.merge_contacts(uuid,uuid,uuid) RENAME TO merge_contacts_before_nl02;
REVOKE ALL ON FUNCTION public.merge_contacts_before_nl02(uuid,uuid,uuid) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.merge_contacts(p_tenant uuid,p_target uuid,p_source uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),'');
  previous text:=current_setting('app.nl02_tenant',true);
  source_subscriber public.newsletter_subscribers; target_subscriber uuid; merged jsonb;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'merge access denied' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=actor AND role_id IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge access denied' USING ERRCODE='42501'; END IF;
  IF p_target=p_source THEN RAISE EXCEPTION 'a person cannot be merged into themselves' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.contacts WHERE tenant_id=p_tenant AND id IN (p_target,p_source) AND erased_at IS NULL ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.contacts WHERE tenant_id=p_tenant AND id IN (p_target,p_source) AND erased_at IS NULL)<>2 THEN RETURN NULL; END IF;
  PERFORM set_config('app.nl02_tenant',p_tenant::text,true);
  SELECT * INTO source_subscriber FROM public.newsletter_subscribers WHERE tenant_id=p_tenant AND contact_id=p_source;
  IF source_subscriber.suppressed OR EXISTS (
    SELECT FROM public.newsletter_subscriptions WHERE tenant_id=p_tenant AND subscriber_id=source_subscriber.id AND state<>'subscribed'
  ) THEN
    INSERT INTO public.newsletter_subscribers AS target(tenant_id,contact_id,created_by,suppressed)
      VALUES(p_tenant,p_target,actor,source_subscriber.suppressed)
    ON CONFLICT(tenant_id,contact_id) DO UPDATE SET
      suppressed=target.suppressed OR excluded.suppressed,version=target.version+1,updated_at=clock_timestamp()
      RETURNING id INTO target_subscriber;
    INSERT INTO public.newsletter_subscriptions AS target(tenant_id,list_id,subscriber_id,state)
      SELECT p_tenant,list_id,target_subscriber,state FROM public.newsletter_subscriptions
      WHERE tenant_id=p_tenant AND subscriber_id=source_subscriber.id AND state<>'subscribed'
    ON CONFLICT(tenant_id,list_id,subscriber_id) DO UPDATE SET
      state=excluded.state,consent_id=NULL,version=target.version+1,updated_at=clock_timestamp()
      WHERE target.state='subscribed' OR (target.state<>'suppressed' AND excluded.state='suppressed')
        OR (target.state='unsubscribed' AND excluded.state='bounced');
  END IF;
  merged:=public.merge_contacts_before_nl02(p_tenant,p_target,p_source);
  PERFORM set_config('app.nl02_tenant',coalesce(previous,''),true);
  RETURN merged;
END $$;
REVOKE ALL ON FUNCTION public.merge_contacts(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid,uuid,uuid) TO harvest_app;
