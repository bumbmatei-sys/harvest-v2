CREATE TABLE "social_auto_dm_jobs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"rule_version" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"step" text DEFAULT 'primary' NOT NULL,
	"recipient_key" text,
	"request_hash" text,
	"prefix" text,
	"policy_version" integer,
	"state" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"leased_until" timestamp with time zone,
	"lease" uuid,
	"first_attempt_at" timestamp with time zone,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"delivery_ref" text,
	CONSTRAINT "social_auto_dm_jobs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_auto_dm_job_shape" CHECK ("social_auto_dm_jobs"."state" in ('queued','leased','dispatching','unknown','sent','skipped','handed_off','cancelled') and
    "social_auto_dm_jobs"."step" in ('primary','public','followup') and "social_auto_dm_jobs"."attempts" between 0 and 3 and "social_auto_dm_jobs"."rule_version" > 0 and
    ("social_auto_dm_jobs"."reason" is null or "social_auto_dm_jobs"."reason" in ('cooldown','limit','outside_hours','ineligible','suppressed','provider_error')) and
    ("social_auto_dm_jobs"."recipient_key" is null or "social_auto_dm_jobs"."recipient_key" ~ '^[0-9a-f]{64}$') and
    ("social_auto_dm_jobs"."request_hash" is null or "social_auto_dm_jobs"."request_hash" ~ '^[0-9a-f]{64}$') and
    ("social_auto_dm_jobs"."prefix" is null or "social_auto_dm_jobs"."prefix" in ('rule','away')) and
    ("social_auto_dm_jobs"."delivery_ref" is null or length("social_auto_dm_jobs"."delivery_ref") between 1 and 200) and
    (("social_auto_dm_jobs"."lease" is null) = ("social_auto_dm_jobs"."leased_until" is null)))
);
--> statement-breakpoint
CREATE TABLE "social_auto_dm_rules" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"post_id" uuid,
	"rule" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"enabled_by" text,
	"enabled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_auto_dm_rules_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_auto_dm_rule_connection_key" UNIQUE("tenant_id","connection_id","id"),
	CONSTRAINT "social_auto_dm_rule_shape" CHECK ("social_auto_dm_rules"."version" > 0 and jsonb_typeof("social_auto_dm_rules"."rule") = 'object' and octet_length("social_auto_dm_rules"."rule"::text) <= 24000 and ("social_auto_dm_rules"."enabled" = ("social_auto_dm_rules"."enabled_by" is not null and "social_auto_dm_rules"."enabled_at" is not null)))
);
--> statement-breakpoint
ALTER TABLE "social_auto_dm_jobs" ADD CONSTRAINT "social_auto_dm_job_rule_fk" FOREIGN KEY ("tenant_id","connection_id","rule_id") REFERENCES "public"."social_auto_dm_rules"("tenant_id","connection_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_auto_dm_jobs" ADD CONSTRAINT "social_auto_dm_job_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."social_webhook_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_auto_dm_rules" ADD CONSTRAINT "social_auto_dm_rules_tenant_id_connection_id_social_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_auto_dm_rules" ADD CONSTRAINT "social_auto_dm_rules_tenant_id_post_id_social_posts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","post_id") REFERENCES "public"."social_posts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_auto_dm_job_event_idx" ON "social_auto_dm_jobs" USING btree ("tenant_id","connection_id","rule_id","rule_version","event_id","step");--> statement-breakpoint
CREATE INDEX "social_auto_dm_due_idx" ON "social_auto_dm_jobs" USING btree ("state","next_at");--> statement-breakpoint
CREATE INDEX "social_auto_dm_activity_idx" ON "social_auto_dm_jobs" USING btree ("tenant_id","rule_id","created_at");--> statement-breakpoint
CREATE INDEX "social_auto_dm_active_idx" ON "social_auto_dm_rules" USING btree ("tenant_id","connection_id") WHERE "social_auto_dm_rules"."enabled";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.social_inbox_can(p_tenant uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND p_permission IN ('social:inbox','social:reply','social:assign','social:saved_replies','social:auto_dm')
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner','admin'))
$$;
--> statement-breakpoint
ALTER TABLE public.social_auto_dm_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.social_auto_dm_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.social_auto_dm_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.social_auto_dm_jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY social_auto_dm_rules_admin ON public.social_auto_dm_rules TO harvest_app
  USING (public.social_inbox_can(tenant_id,'social:auto_dm'));
--> statement-breakpoint
CREATE POLICY social_auto_dm_jobs_admin ON public.social_auto_dm_jobs FOR SELECT TO harvest_app
  USING (public.social_inbox_can(tenant_id,'social:auto_dm'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.social_auto_dm_rules TO harvest_app;
--> statement-breakpoint
GRANT SELECT ON public.social_auto_dm_jobs TO harvest_app;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['social_auto_dm_rules','social_auto_dm_jobs','social_inbox_items'] LOOP
    EXECUTE format('CREATE POLICY auto_dm_worker ON public.%I TO %I USING (current_setting(''app.social_auto_dm_worker'', true) = ''on'')', t, current_user);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['social_webhook_events','social_inbox_hours','contact_consents','contacts'] LOOP
    EXECUTE format('CREATE POLICY auto_dm_worker_read ON public.%I FOR SELECT TO %I USING (current_setting(''app.social_auto_dm_worker'', true) = ''on'')', t, current_user);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['social_inbox_hours','contacts'] LOOP
    EXECUTE format('CREATE POLICY auto_dm_worker_lock ON public.%I FOR UPDATE TO %I USING (current_setting(''app.social_auto_dm_worker'', true) = ''on'') WITH CHECK (false)', t, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_auto_dm_guard_rule() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.enabled THEN RAISE EXCEPTION 'invalid initial automation state'; END IF;
  ELSE
    IF (NEW.tenant_id,NEW.id,NEW.connection_id) IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.connection_id)
       OR NEW.version <> OLD.version + 1 OR (NEW.enabled AND (OLD.enabled OR NEW.rule IS DISTINCT FROM OLD.rule))
    THEN RAISE EXCEPTION 'invalid automation revision'; END IF;
    IF NEW.enabled AND NEW.enabled_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'') THEN
      RAISE EXCEPTION 'automation approval actor required';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_auto_dm_rule_guard BEFORE INSERT OR UPDATE ON public.social_auto_dm_rules
  FOR EACH ROW EXECUTE FUNCTION public.social_auto_dm_guard_rule();
--> statement-breakpoint
CREATE FUNCTION public.social_auto_dm_queue_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.subject_ref IS NULL OR NEW.detail->>'activityRef' IS NULL OR NEW.event_type NOT IN ('message.received','comment.received') THEN RETURN NEW; END IF;
  PERFORM set_config('app.social_auto_dm_worker','on',true);
  PERFORM set_config('app.social_definer','on',true);
  INSERT INTO public.social_auto_dm_jobs(tenant_id,connection_id,rule_id,rule_version,event_id)
  SELECT r.tenant_id,r.connection_id,r.id,r.version,NEW.id
  FROM public.social_auto_dm_rules r JOIN public.social_connections c
    ON (c.tenant_id,c.id) = (r.tenant_id,r.connection_id)
  WHERE (r.tenant_id,r.connection_id) = (NEW.tenant_id,NEW.connection_id) AND c.platform IN ('instagram','facebook')
    AND c.status = 'active' AND c.health <> 'failing' AND r.enabled AND r.enabled_at <= NEW.occurred_at
    AND ((r.rule->>'trigger' = 'comment') = (NEW.event_type = 'comment.received'))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_auto_dm_enqueue AFTER UPDATE OF processed_at ON public.social_webhook_events
  FOR EACH ROW WHEN (OLD.processed_at IS NULL AND NEW.processed_at IS NOT NULL) EXECUTE FUNCTION public.social_auto_dm_queue_event();
--> statement-breakpoint
CREATE FUNCTION public.social_auto_dm_cancel_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.social_auto_dm_worker','on',true);
  IF TG_TABLE_NAME = 'social_auto_dm_rules' THEN
    UPDATE public.social_auto_dm_jobs SET state='cancelled',reason='ineligible',lease=NULL,leased_until=NULL,completed_at=now()
    WHERE tenant_id=NEW.tenant_id AND rule_id=NEW.id AND rule_version<>NEW.version AND state IN ('queued','leased');
  ELSIF NEW.status <> 'active' THEN
    UPDATE public.social_auto_dm_jobs SET state='cancelled',reason='ineligible',lease=NULL,leased_until=NULL,completed_at=now()
    WHERE tenant_id=NEW.tenant_id AND connection_id=NEW.id AND state IN ('queued','leased');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_auto_dm_rule_cancel AFTER UPDATE ON public.social_auto_dm_rules
  FOR EACH ROW EXECUTE FUNCTION public.social_auto_dm_cancel_pending();
--> statement-breakpoint
CREATE TRIGGER social_auto_dm_disconnect AFTER UPDATE OF status ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.social_auto_dm_cancel_pending();
--> statement-breakpoint
CREATE FUNCTION public.social_auto_dm_claim(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid automation batch'; END IF;
  PERFORM set_config('app.social_auto_dm_worker','on',true);
  PERFORM set_config('app.social_definer','on',true);
  PERFORM set_config('app.social_inbox_worker','on',true);
  UPDATE public.social_auto_dm_jobs SET state='unknown',reason='provider_error',lease=NULL,leased_until=NULL
    WHERE state='dispatching' AND leased_until<=now();
  UPDATE public.social_auto_dm_jobs SET state='queued',lease=NULL,leased_until=NULL
    WHERE state='leased' AND leased_until<=now();
  WITH due AS (
    SELECT j.tenant_id,j.id,j.state,c.platform,c.external_account_ref,c.credential_envelope,r.rule,
      e.event_type,e.subject_ref,e.detail->>'activityRef' AS activity_ref,e.occurred_at,p.provider_post_ref,
      h.timezone,h.hours,h.away_template,h.version AS policy_revision,
      f.id AS file_id,f.key AS file_key,f.mime AS file_mime,f.size AS file_size
    FROM public.social_auto_dm_jobs j JOIN public.social_auto_dm_rules r ON (r.tenant_id,r.id)=(j.tenant_id,j.rule_id)
    JOIN public.social_connections c ON (c.tenant_id,c.id)=(j.tenant_id,j.connection_id)
    JOIN public.social_webhook_events e ON (e.tenant_id,e.id,e.connection_id)=(j.tenant_id,j.event_id,j.connection_id)
    LEFT JOIN public.social_posts p ON (p.tenant_id,p.id,p.connection_id)=(r.tenant_id,r.post_id,r.connection_id) AND p.status='published'
    LEFT JOIN public.social_inbox_hours h ON (h.tenant_id,h.connection_id)=(j.tenant_id,j.connection_id)
    LEFT JOIN public.files f ON f.tenant_id=j.tenant_id AND f.id::text=r.rule#>>'{response,fileId}'
      AND f.social_upload AND f.status='ready' AND f.social_retired_at IS NULL
    WHERE j.next_at<=now() AND j.state IN ('queued','unknown') AND j.lease IS NULL AND c.provider='fake'
      AND (j.state='queued' OR (j.attempts<3 AND j.created_at > now()-interval '1 day'))
      AND (r.post_id IS NULL OR p.id IS NOT NULL)
    ORDER BY j.next_at,j.id LIMIT p_limit FOR UPDATE OF j SKIP LOCKED
  ), claimed AS (
    UPDATE public.social_auto_dm_jobs j SET state=CASE WHEN due.state='queued' THEN 'leased' ELSE 'unknown' END,
      attempts=j.attempts+CASE WHEN due.state='unknown' THEN 1 ELSE 0 END,
      lease=gen_random_uuid(),leased_until=now()+interval '60 seconds'
    FROM due WHERE (j.tenant_id,j.id)=(due.tenant_id,due.id)
    RETURNING to_jsonb(j) || (to_jsonb(due) - 'id' - 'tenant_id' - 'state') AS payload
  ) SELECT coalesce(jsonb_agg(payload),'[]'::jsonb) INTO result FROM claimed;
  RETURN result;
END $$;
--> statement-breakpoint
-- This is the database twin of the existing send-time consent gate. The same contact
-- lock serializes this check with ledger writers, including withdrawals on other channels.
CREATE FUNCTION public.social_auto_dm_consent(p_tenant uuid,p_contact uuid,p_purpose text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.contact_consents w
    WHERE (w.tenant_id,w.contact_id,w.purpose)=(p_tenant,p_contact,p_purpose) AND w.status='withdrawn' AND w.redacted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.contact_consents g
        WHERE (g.tenant_id,g.contact_id,g.purpose,g.channel)=(w.tenant_id,w.contact_id,w.purpose,w.channel)
          AND g.status='granted' AND g.redacted_at IS NULL AND g.occurred_at>w.occurred_at AND g.recorded_at>w.recorded_at)
  ) AND coalesce((
    SELECT c.status='granted' FROM public.contact_consents c
    WHERE (c.tenant_id,c.contact_id,c.purpose)=(p_tenant,p_contact,p_purpose) AND c.channel='social' AND c.redacted_at IS NULL
    ORDER BY c.recorded_at DESC,c.occurred_at DESC,c.id DESC LIMIT 1
  ),false)
$$;
--> statement-breakpoint
CREATE FUNCTION public.social_auto_dm_begin(p_tenant uuid,p_job uuid,p_lease uuid,p_recipient text,p_conversation text,
  p_deadline timestamptz,p_policy integer,p_variant text,p_request_hash text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE j record; r public.social_auto_dm_rules%ROWTYPE; c record; h record; person uuid; item record; purpose text; cutoff timestamptz;
BEGIN
  PERFORM set_config('app.social_auto_dm_worker','on',true);
  PERFORM set_config('app.social_definer','on',true);
  PERFORM set_config('app.social_inbox_worker','on',true);
  SELECT * INTO j FROM public.social_auto_dm_jobs WHERE (tenant_id,id,lease)=(p_tenant,p_job,p_lease) AND state='leased';
  IF NOT FOUND OR p_recipient !~ '^[a-f0-9]{64}$' OR p_recipient IS NULL OR p_deadline IS NULL OR p_deadline<=clock_timestamp()
    OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_variant IS NULL OR p_variant NOT IN ('rule','away') THEN RETURN 'ineligible'; END IF;
  SELECT status,health INTO c FROM public.social_connections WHERE (tenant_id,id)=(p_tenant,j.connection_id) FOR SHARE;
  IF NOT FOUND OR c.status<>'active' OR c.health='failing' THEN RETURN 'ineligible'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.social_webhook_events e WHERE (e.tenant_id,e.id)=(p_tenant,j.event_id)
    AND p_deadline <= e.occurred_at + CASE WHEN e.event_type='comment.received' THEN interval '7 days' ELSE interval '24 hours' END)
    THEN RETURN 'ineligible'; END IF;
  -- One transaction per connection serializes cap reservations across concurrent rules.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || j.connection_id::text,713));
  SELECT * INTO r FROM public.social_auto_dm_rules WHERE (tenant_id,id)=(p_tenant,j.rule_id) FOR SHARE;
  IF NOT FOUND OR NOT r.enabled OR r.version<>j.rule_version THEN RETURN 'ineligible'; END IF;
  PERFORM 1 FROM public.workspace_members WHERE (tenant_id,user_id)=(p_tenant,r.enabled_by) AND role_id IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RETURN 'ineligible'; END IF;
  SELECT id,contact_id,assignee_id INTO item FROM public.social_inbox_items
    WHERE (tenant_id,connection_id,provider_ref,kind)=(p_tenant,j.connection_id,p_conversation,'dm') FOR SHARE;
  IF item.assignee_id IS NOT NULL THEN RETURN 'ineligible'; END IF;
  purpose := r.rule->>'purpose';
  IF item.contact_id IS NOT NULL THEN
    SELECT id INTO person FROM public.contacts WHERE (tenant_id,id)=(p_tenant,item.contact_id) AND erased_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN 'suppressed'; END IF;
    IF purpose='service' AND EXISTS (
      SELECT 1 FROM public.contact_consents w
      WHERE (w.tenant_id,w.contact_id,w.purpose)=(p_tenant,person,'messaging') AND w.status='withdrawn' AND w.redacted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.contact_consents g
          WHERE (g.tenant_id,g.contact_id,g.purpose,g.channel)=(w.tenant_id,w.contact_id,w.purpose,w.channel)
            AND g.status='granted' AND g.redacted_at IS NULL AND g.occurred_at>w.occurred_at AND g.recorded_at>w.recorded_at)
    ) THEN RETURN 'suppressed'; END IF;
  END IF;
  IF purpose<>'service' AND (person IS NULL OR purpose NOT IN ('marketing','outreach_follow_up','account_communications','messaging')
    OR NOT public.social_auto_dm_consent(p_tenant,person,purpose)) THEN RETURN 'suppressed'; END IF;
  IF purpose='service' AND coalesce((r.rule->>'serviceOnly')::boolean,false)=false THEN RETURN 'suppressed'; END IF;
  SELECT version,timezone INTO h FROM public.social_inbox_hours WHERE (tenant_id,connection_id)=(p_tenant,j.connection_id) FOR SHARE;
  IF coalesce(h.version,0) IS DISTINCT FROM p_policy THEN RETURN 'outside_hours'; END IF;
  IF j.recipient_key IS NOT NULL AND (j.recipient_key,j.prefix,j.policy_version,j.request_hash) IS DISTINCT FROM (p_recipient,p_variant,p_policy,p_request_hash)
    THEN RETURN 'ineligible'; END IF;
  IF j.step='primary' THEN
    IF EXISTS (SELECT 1 FROM public.social_auto_dm_jobs x WHERE (x.tenant_id,x.connection_id,x.event_id)=(p_tenant,j.connection_id,j.event_id)
      AND x.id<>j.id AND x.step='primary' AND x.first_attempt_at IS NOT NULL) THEN RETURN 'cooldown'; END IF;
    IF EXISTS (SELECT 1 FROM public.social_auto_dm_jobs x WHERE (x.tenant_id,x.rule_id,x.recipient_key)=(p_tenant,j.rule_id,p_recipient)
      AND x.id<>j.id AND x.step='primary' AND x.first_attempt_at>now()-make_interval(mins=>(r.rule->>'cooldownMinutes')::integer))
    THEN RETURN 'cooldown'; END IF;
    cutoff := date_trunc('day',now(),coalesce(h.timezone,'UTC'));
    IF (SELECT count(*) FROM public.social_auto_dm_jobs x WHERE (x.tenant_id,x.rule_id)=(p_tenant,j.rule_id)
          AND x.id<>j.id AND x.step='primary' AND x.first_attempt_at>=cutoff) >= (r.rule->>'ruleDaily')::integer
       OR (SELECT count(*) FROM public.social_auto_dm_jobs x WHERE (x.tenant_id,x.rule_id,x.recipient_key)=(p_tenant,j.rule_id,p_recipient)
          AND x.id<>j.id AND x.step='primary' AND x.first_attempt_at>=cutoff) >= (r.rule->>'recipientDaily')::integer
    THEN RETURN 'limit'; END IF;
  END IF;
  UPDATE public.social_auto_dm_jobs SET state='dispatching',recipient_key=p_recipient,prefix=p_variant,policy_version=p_policy,request_hash=p_request_hash,attempts=attempts+1,
    first_attempt_at=coalesce(first_attempt_at,clock_timestamp())
  WHERE (tenant_id,id,lease)=(p_tenant,p_job,p_lease) AND state='leased' AND leased_until>clock_timestamp()
    AND p_deadline>clock_timestamp() AND attempts<3;
  RETURN CASE WHEN FOUND THEN 'dispatch' ELSE 'ineligible' END;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_auto_dm_finish(p_tenant uuid,p_job uuid,p_lease uuid,p_state text,p_reason text,p_result text,p_delay integer,
  p_recipient text,p_conversation text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE j public.social_auto_dm_jobs%ROWTYPE; r public.social_auto_dm_rules%ROWTYPE; can_run boolean;
BEGIN
  PERFORM set_config('app.social_auto_dm_worker','on',true);
  PERFORM set_config('app.social_definer','on',true);
  PERFORM set_config('app.social_inbox_worker','on',true);
  SELECT * INTO j FROM public.social_auto_dm_jobs WHERE (tenant_id,id,lease)=(p_tenant,p_job,p_lease) AND leased_until>clock_timestamp();
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT * INTO r FROM public.social_auto_dm_rules WHERE (tenant_id,id)=(j.tenant_id,j.rule_id) FOR SHARE;
  can_run := r.enabled AND r.version=j.rule_version AND EXISTS (SELECT 1 FROM public.social_connections c
    WHERE (c.tenant_id,c.id)=(j.tenant_id,j.connection_id) AND c.status='active');
  IF NOT coalesce((j.state='leased' AND p_state IN ('queued','skipped','handed_off'))
    OR (j.state='dispatching' AND p_state IN ('queued','sent','unknown','skipped'))
    OR (j.state='unknown' AND p_state IN ('unknown','sent')),false) THEN RAISE EXCEPTION 'invalid automation outcome'; END IF;
  IF p_state='queued' AND (NOT can_run OR j.attempts>=3 OR j.created_at < now()-interval '1 hour') THEN
    p_state := 'skipped'; p_reason := CASE WHEN can_run THEN 'provider_error' ELSE 'ineligible' END;
  END IF;
  IF p_state='handed_off' THEN
    IF NOT can_run OR p_conversation IS NULL OR r.rule->>'handoffUserId' IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.workspace_members WHERE (tenant_id,user_id)=(p_tenant,r.rule->>'handoffUserId') AND role_id IN ('owner','admin')
    ) THEN p_state:='skipped'; p_reason:='ineligible'; END IF;
    IF p_state='handed_off' THEN
      PERFORM set_config('app.tenant_id',p_tenant::text,true);
      PERFORM set_config('app.user_id',r.enabled_by,true);
      INSERT INTO public.social_inbox_items(tenant_id,connection_id,provider_ref,kind,assignee_id,status)
      VALUES (p_tenant,j.connection_id,p_conversation,'dm',r.rule->>'handoffUserId','open')
      ON CONFLICT (tenant_id,connection_id,kind,provider_ref) DO UPDATE
        SET assignee_id=coalesce(social_inbox_items.assignee_id,excluded.assignee_id),status='open',version=social_inbox_items.version+1;
    END IF;
  END IF;
  UPDATE public.social_auto_dm_jobs SET state=p_state,reason=p_reason,delivery_ref=CASE WHEN p_state='sent' THEN p_result END,
    recipient_key=coalesce(recipient_key,p_recipient),lease=NULL,leased_until=NULL,
    next_at=now()+make_interval(secs=>least(86400,greatest(coalesce(p_delay,0),0))),
    completed_at=CASE WHEN p_state NOT IN ('queued','leased','dispatching') THEN now() END
  WHERE (tenant_id,id,lease)=(p_tenant,p_job,p_lease);
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  IF p_state='sent' AND can_run AND j.step='primary' AND j.prefix='rule' THEN
    IF r.rule#>>'{response,publicReply}' IS NOT NULL THEN
      INSERT INTO public.social_auto_dm_jobs(tenant_id,connection_id,rule_id,rule_version,event_id,step)
      VALUES(j.tenant_id,j.connection_id,j.rule_id,j.rule_version,j.event_id,'public') ON CONFLICT DO NOTHING;
    END IF;
    IF r.rule#>>'{response,followup,text}' IS NOT NULL THEN
      INSERT INTO public.social_auto_dm_jobs(tenant_id,connection_id,rule_id,rule_version,event_id,step,next_at)
      VALUES(j.tenant_id,j.connection_id,j.rule_id,j.rule_version,j.event_id,'followup',
        now()+make_interval(mins=>(r.rule#>>'{response,followup,delayMinutes}')::integer)) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN p_state;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.social_auto_dm_claim(integer),public.social_auto_dm_begin(uuid,uuid,uuid,text,text,timestamptz,integer,text,text),
  public.social_auto_dm_finish(uuid,uuid,uuid,text,text,text,integer,text,text),public.social_auto_dm_consent(uuid,uuid,text),
  public.social_auto_dm_queue_event(),public.social_auto_dm_cancel_pending() FROM PUBLIC,harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.social_auto_dm_claim(integer),public.social_auto_dm_begin(uuid,uuid,uuid,text,text,timestamptz,integer,text,text),
      public.social_auto_dm_finish(uuid,uuid,uuid,text,text,text,integer,text,text) TO harvest_worker;
  END IF;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.social_auto_dm_withdraw() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.social_auto_dm_worker','on',true);
  UPDATE public.social_auto_dm_jobs j SET state='cancelled',reason='suppressed',lease=NULL,leased_until=NULL,completed_at=now()
  FROM public.social_auto_dm_rules r,public.social_webhook_events e,public.social_inbox_items i
  WHERE j.tenant_id=NEW.tenant_id AND (j.tenant_id,j.rule_id)=(r.tenant_id,r.id)
    AND (j.tenant_id,j.event_id,j.connection_id)=(e.tenant_id,e.id,e.connection_id) AND e.event_type='message.received'
    AND (j.tenant_id,j.connection_id,e.subject_ref)=(i.tenant_id,i.connection_id,i.provider_ref)
    AND i.kind='dm' AND i.contact_id=NEW.contact_id AND j.state IN ('queued','leased')
    AND (r.rule->>'purpose'=NEW.purpose OR (r.rule->>'purpose'='service' AND NEW.purpose='messaging'));
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.social_auto_dm_withdraw() FROM PUBLIC,harvest_app;
--> statement-breakpoint
CREATE TRIGGER social_auto_dm_consent_withdraw AFTER INSERT ON public.contact_consents
  FOR EACH ROW WHEN (NEW.status='withdrawn' AND NEW.redacted_at IS NULL) EXECUTE FUNCTION public.social_auto_dm_withdraw();
