CREATE TABLE "newsletter_archived_counts" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"count" bigint NOT NULL,
	CONSTRAINT "newsletter_archived_counts_tenant_id_campaign_id_day_metric_pk" PRIMARY KEY("tenant_id","campaign_id","day","metric")
);
--> statement-breakpoint
CREATE TABLE "newsletter_campaign_lists" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"list_id" uuid NOT NULL,
	"list_version" integer NOT NULL,
	CONSTRAINT "newsletter_campaign_lists_tenant_id_campaign_id_revision_list_id_pk" PRIMARY KEY("tenant_id","campaign_id","revision","list_id")
);
--> statement-breakpoint
CREATE TABLE "newsletter_campaign_revisions" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"subject" text NOT NULL,
	"preheader" text,
	"sender_id" uuid,
	"reply_to_id" uuid,
	"content" jsonb NOT NULL,
	"plain_text" text NOT NULL,
	CONSTRAINT "newsletter_campaign_revisions_tenant_id_campaign_id_revision_pk" PRIMARY KEY("tenant_id","campaign_id","revision"),
	CONSTRAINT "newsletter_subject_length" CHECK (length("newsletter_campaign_revisions"."subject") between 1 and 150),
	CONSTRAINT "newsletter_preheader_length" CHECK (length("newsletter_campaign_revisions"."preheader") <= 200)
);
--> statement-breakpoint
CREATE TABLE "newsletter_campaign_segments" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"segment_id" uuid,
	"segment_version" integer NOT NULL,
	CONSTRAINT "newsletter_campaign_segments_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "newsletter_campaigns" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"review_digest" text,
	"review_expires_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"timezone" text,
	"frozen_at" timestamp with time zone,
	"sender_version" integer,
	"reply_version" integer,
	"sender_domain_version" integer,
	CONSTRAINT "newsletter_campaigns_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_campaign_state" CHECK ("newsletter_campaigns"."state" in ('draft','reviewed','scheduled','sending','sent','partial','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "newsletter_connections" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"records" jsonb NOT NULL,
	"ownership" boolean DEFAULT false NOT NULL,
	"spf" boolean DEFAULT false NOT NULL,
	"dkim" boolean DEFAULT false NOT NULL,
	"bounce" boolean DEFAULT false NOT NULL,
	"dmarc" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "newsletter_connections_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_connections_tenant_id_domain_unique" UNIQUE("tenant_id","domain")
);
--> statement-breakpoint
CREATE TABLE "newsletter_deliveries" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"subscriber_id" uuid,
	"suppression_subscriber_id" uuid,
	"list_id" uuid,
	"subscription_version" integer,
	"address_binding" text,
	"state" text NOT NULL,
	"skip_reason" text,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempted_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease" uuid,
	"lease_until" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"complained_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"provider_ref" text,
	"attempted_address_hash" text,
	CONSTRAINT "newsletter_deliveries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_delivery_subscriber_unique" UNIQUE("tenant_id","campaign_id","revision","subscriber_id"),
	CONSTRAINT "newsletter_delivery_reference_unique" UNIQUE("provider_ref"),
	CONSTRAINT "newsletter_delivery_correlation_unique" UNIQUE("id"),
	CONSTRAINT "newsletter_delivery_state" CHECK ("newsletter_deliveries"."state" in ('queued','unknown','accepted','failed','skipped')),
	CONSTRAINT "newsletter_delivery_reason" CHECK (("newsletter_deliveries"."state" = 'skipped') = ("newsletter_deliveries"."skip_reason" is not null) and ("newsletter_deliveries"."skip_reason" is null or "newsletter_deliveries"."skip_reason" in ('global_suppressed','list_suppressed','not_subscribed','consent_missing','consent_withdrawn','person_unavailable','address_unavailable','eligibility_changed','review_invalidated','cancelled')))
);
--> statement-breakpoint
CREATE TABLE "newsletter_identities" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid,
	"address" text NOT NULL,
	"purpose" text DEFAULT 'sender' NOT NULL,
	"ownership_verified" boolean DEFAULT false NOT NULL,
	"confirmation_digest" text,
	"confirmation_expires_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "newsletter_identities_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_identities_tenant_id_address_purpose_unique" UNIQUE("tenant_id","address","purpose"),
	CONSTRAINT "newsletter_identity_purpose" CHECK (("newsletter_identities"."purpose"='sender' and "newsletter_identities"."connection_id" is not null)
    or ("newsletter_identities"."purpose"='reply-to' and "newsletter_identities"."connection_id" is null))
);
--> statement-breakpoint
CREATE TABLE "newsletter_retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_suppressions" (
	"tenant_id" uuid NOT NULL,
	"scope" uuid NOT NULL,
	"address_hash" text NOT NULL,
	"reason" text NOT NULL,
	"blocked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "newsletter_suppressions_tenant_id_scope_address_hash_reason_pk" PRIMARY KEY("tenant_id","scope","address_hash","reason"),
	CONSTRAINT "newsletter_suppression_reason" CHECK ("newsletter_suppressions"."reason" in ('unsubscribe','hard_bounce','complaint'))
);
--> statement-breakpoint
CREATE TABLE "newsletter_template_revisions" (
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "newsletter_template_revisions_tenant_id_template_id_version_pk" PRIMARY KEY("tenant_id","template_id","version")
);
--> statement-breakpoint
CREATE TABLE "newsletter_templates" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "newsletter_templates_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "newsletter_lists" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "newsletter_archived_counts" ADD CONSTRAINT "newsletter_archived_counts_tenant_id_campaign_id_newsletter_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."newsletter_campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaign_lists" ADD CONSTRAINT "newsletter_campaign_list_revision_fk" FOREIGN KEY ("tenant_id","campaign_id","revision") REFERENCES "public"."newsletter_campaign_revisions"("tenant_id","campaign_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaign_lists" ADD CONSTRAINT "newsletter_campaign_lists_tenant_id_list_id_newsletter_lists_tenant_id_id_fk" FOREIGN KEY ("tenant_id","list_id") REFERENCES "public"."newsletter_lists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaign_revisions" ADD CONSTRAINT "newsletter_campaign_revisions_tenant_id_campaign_id_newsletter_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."newsletter_campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaign_revisions" ADD CONSTRAINT "newsletter_revision_sender_fk" FOREIGN KEY ("tenant_id","sender_id") REFERENCES "public"."newsletter_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaign_revisions" ADD CONSTRAINT "newsletter_revision_reply_fk" FOREIGN KEY ("tenant_id","reply_to_id") REFERENCES "public"."newsletter_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaign_segments" ADD CONSTRAINT "newsletter_campaign_segment_revision_fk" FOREIGN KEY ("tenant_id","campaign_id","revision") REFERENCES "public"."newsletter_campaign_revisions"("tenant_id","campaign_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaign_segments" ADD CONSTRAINT "newsletter_campaign_segment_fk" FOREIGN KEY ("tenant_id","segment_id") REFERENCES "public"."newsletter_segments"("tenant_id","id") ON DELETE set null ("segment_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_connections" ADD CONSTRAINT "newsletter_connections_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_delivery_revision_fk" FOREIGN KEY ("tenant_id","campaign_id","revision") REFERENCES "public"."newsletter_campaign_revisions"("tenant_id","campaign_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_delivery_subscriber_fk" FOREIGN KEY ("tenant_id","subscriber_id") REFERENCES "public"."newsletter_subscribers"("tenant_id","id") ON DELETE set null ("subscriber_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_delivery_suppression_fk" FOREIGN KEY ("tenant_id","suppression_subscriber_id") REFERENCES "public"."newsletter_subscribers"("tenant_id","id") ON DELETE set null ("suppression_subscriber_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_delivery_list_fk" FOREIGN KEY ("tenant_id","list_id") REFERENCES "public"."newsletter_lists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_identities" ADD CONSTRAINT "newsletter_identities_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_identities" ADD CONSTRAINT "newsletter_identities_tenant_id_connection_id_newsletter_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."newsletter_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_suppressions" ADD CONSTRAINT "newsletter_suppressions_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_template_revisions" ADD CONSTRAINT "newsletter_template_revisions_tenant_id_template_id_newsletter_templates_tenant_id_id_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."newsletter_templates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_templates" ADD CONSTRAINT "newsletter_templates_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_campaign_due_idx" ON "newsletter_campaigns" USING btree ("state","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_verified_domain" ON "newsletter_connections" USING btree ("domain") WHERE "newsletter_connections"."ownership" and "newsletter_connections"."spf" and "newsletter_connections"."dkim" and "newsletter_connections"."bounce";--> statement-breakpoint
CREATE INDEX "newsletter_delivery_retention_idx" ON "newsletter_deliveries" USING btree ("selected_at","id");--> statement-breakpoint
CREATE INDEX "newsletter_delivery_due_idx" ON "newsletter_deliveries" USING btree ("state","next_check_at","lease_until");
--> statement-breakpoint
CREATE FUNCTION public.newsletter_capability(p_role text,p_capability text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT p_role IN ('owner','admin') AND p_capability IN ('newsletter:campaigns','newsletter:delivery','newsletter:analytics')
$$;
REVOKE ALL ON FUNCTION public.newsletter_capability(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_capability(text,text) TO harvest_app;

DO $$
DECLARE rel text; capability text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['newsletter_campaigns','newsletter_campaign_revisions','newsletter_campaign_lists',
    'newsletter_campaign_segments','newsletter_connections','newsletter_identities','newsletter_templates',
    'newsletter_template_revisions','newsletter_deliveries','newsletter_archived_counts','newsletter_suppressions'] LOOP
    capability:=CASE WHEN rel='newsletter_deliveries' THEN 'newsletter:analytics'
      WHEN rel IN ('newsletter_connections','newsletter_identities') THEN 'newsletter:delivery' ELSE 'newsletter:campaigns' END;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,harvest_app',rel);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM harvest_worker',rel);
    END IF;
    EXECUTE format($p$CREATE POLICY newsletter_admin ON public.%I TO harvest_app
      USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
        SELECT FROM public.workspace_members m WHERE m.tenant_id=%I.tenant_id
          AND m.user_id=nullif(current_setting('app.user_id',true),'') AND public.newsletter_capability(m.role_id,%L)))
      WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
        SELECT FROM public.workspace_members m WHERE m.tenant_id=%I.tenant_id
          AND m.user_id=nullif(current_setting('app.user_id',true),'') AND public.newsletter_capability(m.role_id,%L)))$p$,
      rel,rel,capability,rel,capability);
    EXECUTE format($p$CREATE POLICY newsletter_sending_owner ON public.%I TO %I
      USING ((session_user='harvest_worker' AND current_setting('app.nl_send_worker',true)='on')
           OR tenant_id=nullif(current_setting('app.nl_send_tenant',true),'')::uuid)
      WITH CHECK (tenant_id=nullif(current_setting('app.nl_send_tenant',true),'')::uuid
           OR (session_user='harvest_worker' AND current_setting('app.nl_send_worker',true)='on'))$p$,rel,current_user);
    IF rel NOT IN ('newsletter_deliveries','newsletter_connections','newsletter_identities','newsletter_archived_counts','newsletter_suppressions') THEN
      EXECUTE format('GRANT SELECT,INSERT ON public.%I TO harvest_app',rel);
    END IF;
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['contacts','contact_consents','contact_identifiers','newsletter_lists',
    'newsletter_segments','crm_saved_views','newsletter_subscribers','newsletter_subscriptions','workspaces','files'] LOOP
    EXECUTE format($p$CREATE POLICY newsletter_sender_scope ON public.%I TO %I
      USING (tenant_id=nullif(current_setting('app.nl_send_tenant',true),'')::uuid
        AND session_user='harvest_worker' AND current_setting('app.nl_send_worker',true)='on')
      WITH CHECK (tenant_id=nullif(current_setting('app.nl_send_tenant',true),'')::uuid
        AND session_user='harvest_worker' AND current_setting('app.nl_send_worker',true)='on')$p$,rel,current_user);
  END LOOP;
END $$;
GRANT SELECT ON public.newsletter_connections,public.newsletter_identities TO harvest_app;
GRANT INSERT (tenant_id,domain,records) ON public.newsletter_connections TO harvest_app;
GRANT INSERT (tenant_id,address,purpose,connection_id,confirmation_digest,confirmation_expires_at)
  ON public.newsletter_identities TO harvest_app;
GRANT UPDATE (name,version,revision,state,review_digest,review_expires_at,scheduled_at,timezone,frozen_at,sender_version,reply_version,
  sender_domain_version) ON public.newsletter_campaigns TO harvest_app;
GRANT UPDATE (name,version,archived) ON public.newsletter_templates TO harvest_app;
GRANT UPDATE (enabled,version,confirmation_digest,confirmation_expires_at) ON public.newsletter_identities TO harvest_app;
GRANT INSERT (tenant_id,campaign_id,revision,subscriber_id,list_id,subscription_version,address_binding,state,skip_reason,
  selected_at,next_check_at) ON public.newsletter_deliveries TO harvest_app;

-- Review references are immutable except FK detachment when a canonical shared view is deleted.
CREATE FUNCTION public.newsletter_input_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='newsletter_lists' THEN
    IF (NEW.tenant_id,NEW.id,NEW.audience_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM
       (OLD.tenant_id,OLD.id,OLD.audience_id,OLD.created_by,OLD.created_at) THEN RAISE check_violation; END IF;
    NEW.version:=OLD.version+1;
  ELSIF TG_TABLE_NAME='newsletter_campaigns' THEN
    IF (NEW.state='reviewed') IS DISTINCT FROM (NEW.review_digest IS NOT NULL AND NEW.review_expires_at IS NOT NULL)
      THEN RAISE check_violation; END IF;
    IF TG_OP='INSERT' THEN
      IF NEW.state<>'draft' OR NEW.version<>1 OR NEW.revision<>1 OR NEW.frozen_at IS NOT NULL OR NEW.review_digest IS NOT NULL
        OR NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'') THEN RAISE check_violation; END IF;
    ELSIF NEW.version<>OLD.version+1 OR (OLD.frozen_at IS NOT NULL AND
      (NEW.revision,NEW.frozen_at,NEW.scheduled_at,NEW.timezone,NEW.sender_version,NEW.reply_version,NEW.sender_domain_version)
      IS DISTINCT FROM (OLD.revision,OLD.frozen_at,OLD.scheduled_at,OLD.timezone,OLD.sender_version,OLD.reply_version,OLD.sender_domain_version))
      OR NOT (CASE OLD.state
        WHEN 'draft' THEN NEW.state IN ('draft','reviewed','cancelled')
        WHEN 'reviewed' THEN NEW.state IN ('draft','reviewed','scheduled','failed','cancelled')
        WHEN 'scheduled' THEN NEW.state IN ('sending','failed','cancelled')
        WHEN 'sending' THEN NEW.state IN ('sent','partial','failed','cancelled')
        ELSE false END)
      OR (NEW.state='draft' AND NEW.revision<>OLD.revision+1)
      OR (NEW.state<>'draft' AND NEW.revision<>OLD.revision)
      OR (NEW.state IN ('scheduled','sending','sent','partial','failed') AND
        (NEW.frozen_at IS NULL OR NEW.scheduled_at IS NULL OR NEW.timezone IS NULL))
    THEN RAISE check_violation; END IF;
  ELSIF TG_TABLE_NAME='newsletter_deliveries' THEN
    IF NEW.state NOT IN ('queued','skipped') OR NOT EXISTS (
      SELECT FROM public.newsletter_campaigns c WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.campaign_id
        AND c.revision=NEW.revision AND c.state='reviewed' AND c.review_expires_at>clock_timestamp())
      OR NEW.subscriber_id IS NULL OR NEW.list_id IS NULL
      OR NOT EXISTS (SELECT FROM public.newsletter_campaign_lists l WHERE l.tenant_id=NEW.tenant_id
        AND l.campaign_id=NEW.campaign_id AND l.revision=NEW.revision AND l.list_id=NEW.list_id)
      THEN RAISE check_violation; END IF;
  ELSIF TG_OP='UPDATE' AND NEW.version<>OLD.version+1 THEN
    RAISE check_violation;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_input_guard() FROM PUBLIC,harvest_app;
CREATE TRIGGER newsletter_list_version BEFORE UPDATE ON public.newsletter_lists FOR EACH ROW EXECUTE FUNCTION public.newsletter_input_guard();
CREATE TRIGGER newsletter_campaign_guard BEFORE INSERT OR UPDATE ON public.newsletter_campaigns FOR EACH ROW EXECUTE FUNCTION public.newsletter_input_guard();
CREATE TRIGGER newsletter_delivery_insert_guard BEFORE INSERT ON public.newsletter_deliveries FOR EACH ROW EXECUTE FUNCTION public.newsletter_input_guard();
CREATE TRIGGER newsletter_identity_version BEFORE UPDATE ON public.newsletter_identities FOR EACH ROW EXECUTE FUNCTION public.newsletter_input_guard();
CREATE TRIGGER newsletter_template_version BEFORE UPDATE ON public.newsletter_templates FOR EACH ROW EXECUTE FUNCTION public.newsletter_input_guard();

CREATE FUNCTION public.newsletter_finish_campaign(p_tenant uuid,p_campaign uuid) RETURNS void
LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
  WITH totals AS (
    SELECT count(*) FILTER (WHERE state='accepted') + coalesce((SELECT sum(count) FROM public.newsletter_archived_counts
      WHERE tenant_id=p_tenant AND campaign_id=p_campaign AND metric='accepted'),0) AS accepted,
      count(*) + coalesce((SELECT sum(count) FROM public.newsletter_archived_counts
      WHERE tenant_id=p_tenant AND campaign_id=p_campaign AND metric='selected'),0) AS selected
      FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND campaign_id=p_campaign
      HAVING count(*) FILTER (WHERE state IN ('queued','unknown'))=0
  )
  UPDATE public.newsletter_campaigns SET state=CASE WHEN totals.accepted=0 THEN 'failed'
    WHEN totals.selected=totals.accepted THEN 'sent' ELSE 'partial' END,version=version+1
    FROM totals WHERE tenant_id=p_tenant AND id=p_campaign AND state IN ('scheduled','sending')
$$;
REVOKE ALL ON FUNCTION public.newsletter_finish_campaign(uuid,uuid) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_cancel_queued(p_tenant uuid,p_campaign uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=current_setting('app.nl_send_tenant',true);
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'')
      AND public.newsletter_capability(role_id,'newsletter:delivery')) THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  PERFORM 1 FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=p_campaign AND state='cancelled' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.newsletter_deliveries SET state='skipped',skip_reason='cancelled',lease=NULL,lease_until=NULL
      WHERE tenant_id=p_tenant AND campaign_id=p_campaign AND state='queued';
  END IF;
  PERFORM set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_cancel_queued(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_cancel_queued(uuid,uuid) TO harvest_app;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_delivery_claim(p_limit integer,p_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_worker','on',true);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_seconds IS NULL OR p_seconds NOT BETWEEN 2 AND 300 THEN RAISE invalid_parameter_value; END IF;
  WITH eligible AS (
    SELECT d.tenant_id,d.id FROM public.newsletter_deliveries d JOIN public.newsletter_campaigns c
      ON c.tenant_id=d.tenant_id AND c.id=d.campaign_id AND c.revision=d.revision
    WHERE d.state='queued' AND c.state IN ('scheduled','sending') AND c.frozen_at IS NOT NULL
      AND c.scheduled_at<=clock_timestamp() AND d.selected_at>clock_timestamp()-interval '2160 hours'
      AND d.next_check_at<=clock_timestamp() AND (d.lease_until IS NULL OR d.lease_until<=clock_timestamp())
    ORDER BY d.next_check_at,d.id LIMIT p_limit FOR UPDATE OF d SKIP LOCKED
  ), claimed AS (
    UPDATE public.newsletter_deliveries d SET lease=gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>p_seconds)
      FROM eligible e WHERE d.tenant_id=e.tenant_id AND d.id=e.id
    RETURNING d.tenant_id,d.id,d.lease
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('tenant',tenant_id,'key',id,'lease',lease)),'[]'::jsonb) INTO result FROM claimed;
  RETURN result;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_delivery_authorize(p_tenant uuid,p_key uuid,p_lease uuid,p_nonce text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.newsletter_deliveries; c public.newsletter_campaigns; r public.newsletter_campaign_revisions;
  subscriber public.newsletter_subscribers; contact public.contacts; subscription public.newsletter_subscriptions;
  address record; assets jsonb; sender text; reply text; ministry text; reason text; consent uuid;
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_worker','on',true);
  PERFORM set_config('app.nl02_private','on',true);
  IF coalesce(p_nonce,'') !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT * INTO d FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND id=p_key AND lease=p_lease
    AND lease_until>clock_timestamp() AND state='queued' AND selected_at>clock_timestamp()-interval '2160 hours';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT s.* INTO subscriber FROM public.newsletter_subscribers s WHERE s.tenant_id=p_tenant AND s.id=d.subscriber_id;
  SELECT * INTO contact FROM public.contacts WHERE tenant_id=p_tenant AND id=subscriber.contact_id AND erased_at IS NULL FOR UPDATE;
  SELECT * INTO subscriber FROM public.newsletter_subscribers WHERE tenant_id=p_tenant AND id=d.subscriber_id FOR UPDATE;
  SELECT * INTO c FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=d.campaign_id FOR UPDATE;
  SELECT * INTO d FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND id=p_key AND lease=p_lease
    AND lease_until>clock_timestamp() AND state='queued' AND selected_at>clock_timestamp()-interval '2160 hours' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.newsletter_campaign_revisions WHERE tenant_id=p_tenant AND campaign_id=c.id AND revision=c.revision;

  IF c.state NOT IN ('scheduled','sending') OR c.revision<>d.revision OR c.frozen_at IS NULL THEN reason:='cancelled';
  ELSIF contact.id IS NULL OR subscriber.id IS NULL OR subscriber.contact_id<>contact.id THEN reason:='person_unavailable';
  ELSIF subscriber.suppressed THEN reason:='global_suppressed';
  ELSE
    SELECT * INTO subscription FROM public.newsletter_subscriptions WHERE tenant_id=p_tenant
      AND subscriber_id=subscriber.id AND list_id=d.list_id FOR SHARE;
    IF subscription.state IN ('suppressed','bounced') THEN reason:='list_suppressed';
    ELSIF subscription.state IS DISTINCT FROM 'subscribed' THEN reason:='not_subscribed';
    ELSIF subscription.version IS DISTINCT FROM d.subscription_version THEN reason:='eligibility_changed';
    END IF;
    SELECT id INTO consent FROM public.contact_consents WHERE tenant_id=p_tenant AND contact_id=contact.id
      AND purpose='newsletter' AND channel='email' AND redacted_at IS NULL ORDER BY recorded_at DESC,occurred_at DESC,id DESC LIMIT 1;
    IF reason IS NULL AND NOT coalesce(public.newsletter_consent_allowed(p_tenant,contact.id,consent),false) THEN
      reason:=CASE WHEN public.nl02_has_withdrawal(p_tenant,contact.id,NULL,false) THEN 'consent_withdrawn' ELSE 'consent_missing' END;
    END IF;
  END IF;

  IF reason IS NULL THEN
    IF EXISTS (SELECT FROM public.newsletter_campaign_lists p JOIN public.newsletter_lists l
      ON l.tenant_id=p.tenant_id AND l.id=p.list_id WHERE p.tenant_id=p_tenant AND p.campaign_id=c.id
        AND p.revision=c.revision AND p.list_version<>l.version)
      OR EXISTS (SELECT FROM public.newsletter_campaign_segments p LEFT JOIN public.newsletter_segments s
        ON s.tenant_id=p.tenant_id AND s.id=p.segment_id LEFT JOIN public.crm_saved_views v
        ON v.tenant_id=s.tenant_id AND v.id=s.saved_view_id AND v.version=p.segment_version
          AND v.owner_user_id IS NULL AND v.object_type='person' AND coalesce(v.state->'sources','[]'::jsonb)='[]'::jsonb
        WHERE p.tenant_id=p_tenant AND p.campaign_id=c.id AND p.revision=c.revision
          AND (v.id IS NULL OR s.saved_view_version<>p.segment_version)) THEN
      reason:='review_invalidated';
    END IF;
    SELECT i.address INTO sender FROM public.newsletter_identities i JOIN public.newsletter_connections cfg
      ON cfg.tenant_id=i.tenant_id AND cfg.id=i.connection_id
      WHERE i.tenant_id=p_tenant AND i.id=r.sender_id AND i.version=c.sender_version AND cfg.version=c.sender_domain_version
        AND i.ownership_verified AND i.enabled AND i.purpose='sender'
        AND cfg.ownership AND cfg.spf AND cfg.dkim AND cfg.bounce
        AND cfg.checked_at>clock_timestamp()-interval '48 hours'
        AND split_part(i.address,'@',2)=cfg.domain AND cfg.domain ~ '[.]example[.]test$' AND cfg.domain<>'newsletter.example.test' FOR SHARE OF i,cfg;
    SELECT i.address INTO reply FROM public.newsletter_identities i
      WHERE i.tenant_id=p_tenant AND i.id=r.reply_to_id AND i.version=c.reply_version
        AND i.ownership_verified AND i.enabled AND i.purpose='reply-to' FOR SHARE;
    IF sender IS NULL OR reply IS NULL THEN reason:='review_invalidated'; END IF;
    SELECT i.id,i.normalized_value INTO address FROM public.contact_identifiers i
      WHERE i.tenant_id=p_tenant AND i.contact_id=contact.id AND i.kind='email' FOR SHARE;
    IF NOT FOUND OR NOT public.nl02_email(address.normalized_value) THEN reason:='address_unavailable';
    ELSIF d.address_binding IS DISTINCT FROM (address.id::text||':'||contact.version::text) THEN reason:='eligibility_changed';
    ELSE reason:=coalesce(reason,public.newsletter_address_block(p_tenant,address.normalized_value,d.list_id)); END IF;
    SELECT coalesce(jsonb_agg(f.id),'[]'::jsonb) INTO assets FROM public.files f
      JOIN jsonb_array_elements(r.content) block ON block->>'type'='image' AND f.id::text=block->>'fileId'
      WHERE f.tenant_id=p_tenant AND f.status='ready' AND f.visibility='public' AND f.mime IN ('image/jpeg','image/png','image/webp');
    IF jsonb_array_length(assets)<>(SELECT count(*) FROM jsonb_array_elements(r.content) block WHERE block->>'type'='image')
      THEN reason:='review_invalidated'; END IF;
  END IF;

  IF reason IS NOT NULL THEN
    UPDATE public.newsletter_deliveries SET state='skipped',skip_reason=reason,lease=NULL,lease_until=NULL
      WHERE tenant_id=p_tenant AND id=p_key;
    PERFORM public.newsletter_finish_campaign(p_tenant,c.id);
    RETURN NULL;
  END IF;

  SELECT name INTO ministry FROM public.workspaces WHERE tenant_id=p_tenant;
  INSERT INTO public.newsletter_preference_tokens(token_hash,tenant_id,subscriber_id,list_id,scope,email_proof,expires_at)
    VALUES(public.nl02_hash(p_nonce),p_tenant,subscriber.id,d.list_id,'list',
      public.nl02_hash(p_nonce||':'||address.normalized_value),clock_timestamp()+interval '30 days');
  UPDATE public.newsletter_campaigns SET state='sending',version=version+1 WHERE tenant_id=p_tenant AND id=c.id AND state='scheduled';
  UPDATE public.newsletter_deliveries SET state='unknown',attempted_at=clock_timestamp(),
    attempted_address_hash=public.newsletter_address_hash(p_tenant,address.normalized_value)
    WHERE tenant_id=p_tenant AND id=p_key;
  RETURN jsonb_build_object('email',address.normalized_value,'firstName',split_part(btrim(contact.name),' ',1),'ministryName',ministry,
    'from',sender,'replyTo',reply,'content',r.content,'subject',r.subject,'preheader',r.preheader,'images',assets);
END $$;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_delivery_complete(p_tenant uuid,p_key uuid,p_lease uuid,p_outcome text,p_ref text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE campaign uuid;
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_worker','on',true);
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','failed','unknown')
    OR (p_outcome='accepted' AND coalesce(length(p_ref),0) NOT BETWEEN 1 AND 255) THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT campaign_id INTO campaign FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND id=p_key;
  PERFORM 1 FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=campaign FOR UPDATE;
  UPDATE public.newsletter_deliveries SET state=p_outcome,lease=NULL,lease_until=NULL,
    accepted_at=CASE WHEN p_outcome='accepted' THEN clock_timestamp() END,
    provider_ref=CASE WHEN p_outcome='accepted' THEN p_ref END
    WHERE tenant_id=p_tenant AND id=p_key AND state='unknown' AND lease=p_lease AND lease_until>clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.newsletter_finish_campaign(p_tenant,campaign);
  RETURN true;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_delivery_fail(p_tenant uuid,p_key uuid,p_lease uuid,p_unknown boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  RETURN public.newsletter_delivery_complete(p_tenant,p_key,p_lease,CASE WHEN p_unknown THEN 'unknown' ELSE 'failed' END,NULL);
END $$;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_delivery_health() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_worker','on',true);
  RETURN (SELECT jsonb_build_object('pending',count(*) FILTER (WHERE state='queued' AND next_check_at<=clock_timestamp()),
    'unknown',count(*) FILTER (WHERE state='unknown'),'failed',count(*) FILTER (WHERE state='failed'))
    FROM public.newsletter_deliveries);
END $$;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_delivery_event(p_delivery uuid,p_ref text,p_type text,p_time timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.newsletter_deliveries; s public.newsletter_subscribers; changed boolean; recipient uuid;
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_worker','on',true);
  IF p_type IS NULL OR p_type NOT IN ('accepted','delivered','bounced','complained','unsubscribed')
    OR coalesce(length(p_ref),0) NOT BETWEEN 1 AND 255
    OR p_time IS NULL OR p_time>clock_timestamp()+interval '5 minutes' THEN RETURN; END IF;
  SELECT * INTO d FROM public.newsletter_deliveries WHERE id=p_delivery AND (provider_ref IS NULL OR provider_ref=p_ref)
    AND state IN ('unknown','accepted') AND attempted_at<=p_time+interval '5 seconds';
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.nl_send_tenant',d.tenant_id::text,true);
  recipient:=coalesce(d.suppression_subscriber_id,d.subscriber_id);
  SELECT * INTO s FROM public.newsletter_subscribers WHERE tenant_id=d.tenant_id AND id=recipient;
  PERFORM 1 FROM public.contacts WHERE tenant_id=d.tenant_id AND id=s.contact_id AND erased_at IS NULL FOR UPDATE;
  SELECT * INTO s FROM public.newsletter_subscribers WHERE tenant_id=d.tenant_id AND id=recipient FOR UPDATE;
  PERFORM 1 FROM public.newsletter_campaigns WHERE tenant_id=d.tenant_id AND id=d.campaign_id FOR UPDATE;
  SELECT * INTO d FROM public.newsletter_deliveries WHERE tenant_id=d.tenant_id AND id=d.id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF coalesce(d.suppression_subscriber_id,d.subscriber_id) IS DISTINCT FROM recipient THEN
    RAISE serialization_failure;
  END IF;
  IF d.state NOT IN ('unknown','accepted') OR (d.provider_ref IS NOT NULL AND d.provider_ref<>p_ref) THEN RETURN; END IF;
  changed:=CASE p_type WHEN 'accepted' THEN d.accepted_at IS NULL WHEN 'delivered' THEN d.delivered_at IS NULL
    WHEN 'bounced' THEN d.bounced_at IS NULL WHEN 'complained' THEN d.complained_at IS NULL
    WHEN 'unsubscribed' THEN d.unsubscribed_at IS NULL END;
  IF NOT changed THEN RETURN; END IF;
  UPDATE public.newsletter_deliveries SET state='accepted',provider_ref=p_ref,lease=NULL,lease_until=NULL,
    accepted_at=coalesce(accepted_at,p_time),
    delivered_at=CASE WHEN p_type='delivered' THEN p_time ELSE delivered_at END,
    bounced_at=CASE WHEN p_type='bounced' THEN p_time ELSE bounced_at END,
    complained_at=CASE WHEN p_type='complained' THEN p_time ELSE complained_at END,
    unsubscribed_at=CASE WHEN p_type='unsubscribed' THEN p_time ELSE unsubscribed_at END
    WHERE tenant_id=d.tenant_id AND id=d.id;
  IF d.attempted_address_hash IS NOT NULL AND p_type IN ('bounced','complained','unsubscribed') THEN
    PERFORM public.newsletter_record_suppression(d.tenant_id,CASE WHEN p_type='unsubscribed' THEN d.list_id END,
      d.attempted_address_hash,CASE p_type WHEN 'bounced' THEN 'hard_bounce' WHEN 'complained' THEN 'complaint'
        ELSE 'unsubscribe' END,p_time);
  END IF;
  IF s.id IS NOT NULL AND p_type IN ('bounced','complained') THEN
    UPDATE public.newsletter_subscribers SET suppressed=true,version=version+1,updated_at=clock_timestamp()
      WHERE tenant_id=d.tenant_id AND id=s.id AND NOT suppressed;
  ELSIF s.id IS NOT NULL AND p_type='unsubscribed' THEN
    UPDATE public.newsletter_subscriptions SET state='unsubscribed',consent_id=NULL,version=version+1,updated_at=clock_timestamp()
      WHERE tenant_id=d.tenant_id AND subscriber_id=s.id AND list_id=d.list_id AND state='subscribed'
        AND (d.subscriber_id IS NULL OR version=d.subscription_version)
        AND updated_at<=p_time;
  END IF;
  PERFORM public.newsletter_finish_campaign(d.tenant_id,d.campaign_id);
END $$;

REVOKE ALL ON FUNCTION public.newsletter_delivery_claim(integer,integer),
  public.newsletter_delivery_authorize(uuid,uuid,uuid,text),public.newsletter_delivery_complete(uuid,uuid,uuid,text,text),
  public.newsletter_delivery_fail(uuid,uuid,uuid,boolean),public.newsletter_delivery_health(),
  public.newsletter_delivery_event(uuid,text,text,timestamptz) FROM PUBLIC,harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.newsletter_delivery_claim(integer,integer),
  public.newsletter_delivery_authorize(uuid,uuid,uuid,text),public.newsletter_delivery_complete(uuid,uuid,uuid,text,text),
  public.newsletter_delivery_fail(uuid,uuid,uuid,boolean),public.newsletter_delivery_health(),
  public.newsletter_delivery_event(uuid,text,text,timestamptz) TO harvest_worker;
  END IF;
END $$;

-- Detach identity and address binding before NL-01 forgets the subscriber.
--> statement-breakpoint
CREATE FUNCTION public.newsletter_delivery_forget_subscriber() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=current_setting('app.nl_send_tenant',true);
BEGIN
  PERFORM set_config('app.nl_send_tenant',OLD.tenant_id::text,true);
  UPDATE public.newsletter_deliveries SET subscriber_id=NULL,address_binding=NULL,subscription_version=NULL,
    attempted_address_hash=CASE WHEN suppression_subscriber_id IS NOT NULL THEN attempted_address_hash END
    WHERE tenant_id=OLD.tenant_id AND subscriber_id=OLD.id;
  PERFORM set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_delivery_forget_subscriber() FROM PUBLIC,harvest_app;
CREATE TRIGGER newsletter_delivery_forget BEFORE DELETE ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_delivery_forget_subscriber();

-- Pending source work is never retargeted. An attempted source blocks duplicate target work
-- for that same revision. Future suppression can still follow the canonical target.
ALTER FUNCTION public.merge_contacts(uuid,uuid,uuid) RENAME TO merge_contacts_before_newsletter_sending;
REVOKE ALL ON FUNCTION public.merge_contacts_before_newsletter_sending(uuid,uuid,uuid) FROM PUBLIC,harvest_app;
CREATE FUNCTION public.merge_contacts(p_tenant uuid,p_target uuid,p_source uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE source_id uuid; target_id uuid; merged jsonb;
  prior_tenant text:=current_setting('app.nl_send_tenant',true);
  prior_nl02 text:=current_setting('app.nl02_tenant',true);
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'')
      AND public.newsletter_capability(role_id,'newsletter:delivery')) THEN RAISE insufficient_privilege; END IF;
  IF p_target=p_source THEN RAISE invalid_parameter_value; END IF;
  PERFORM 1 FROM public.contacts WHERE tenant_id=p_tenant AND id IN (p_target,p_source) AND erased_at IS NULL ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.contacts WHERE tenant_id=p_tenant AND id IN (p_target,p_source) AND erased_at IS NULL)<>2 THEN RETURN NULL; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  PERFORM set_config('app.nl02_tenant',p_tenant::text,true);
  SELECT id INTO source_id FROM public.newsletter_subscribers WHERE tenant_id=p_tenant AND contact_id=p_source FOR UPDATE;
  SELECT id INTO target_id FROM public.newsletter_subscribers WHERE tenant_id=p_tenant AND contact_id=p_target FOR UPDATE;
  IF EXISTS (SELECT FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND attempted_at IS NOT NULL
    AND (subscriber_id=source_id OR suppression_subscriber_id=source_id)) THEN
    IF target_id IS NULL THEN
      INSERT INTO public.newsletter_subscribers(tenant_id,contact_id,created_by)
        VALUES(p_tenant,p_target,current_setting('app.user_id',true)) RETURNING id INTO target_id;
    END IF;
    UPDATE public.newsletter_deliveries d SET address_binding=NULL
      WHERE d.tenant_id=p_tenant AND d.subscriber_id=target_id AND d.state='queued' AND EXISTS (
        SELECT FROM public.newsletter_deliveries previous WHERE previous.tenant_id=p_tenant
          AND previous.campaign_id=d.campaign_id AND previous.revision=d.revision AND previous.attempted_at IS NOT NULL
          AND (previous.subscriber_id=source_id OR previous.suppression_subscriber_id=source_id));
    UPDATE public.newsletter_deliveries SET suppression_subscriber_id=target_id WHERE tenant_id=p_tenant
      AND attempted_at IS NOT NULL AND (subscriber_id=source_id OR suppression_subscriber_id=source_id);
  END IF;
  merged:=public.merge_contacts_before_newsletter_sending(p_tenant,p_target,p_source);
  PERFORM set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  PERFORM set_config('app.nl02_tenant',coalesce(prior_nl02,''),true);
  RETURN merged;
END $$;
REVOKE ALL ON FUNCTION public.merge_contacts(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid,uuid,uuid) TO harvest_app;
--> statement-breakpoint
DO $$ DECLARE rel text; BEGIN
  FOREACH rel IN ARRAY ARRAY['contacts','contact_consents','contact_identifiers','newsletter_subscribers','newsletter_subscriptions'] LOOP
    EXECUTE format($p$CREATE POLICY newsletter_reporting_scope ON public.%I TO %I
      USING (tenant_id=nullif(current_setting('app.nl_send_tenant',true),'')::uuid
        AND current_setting('app.nl_send_insight',true)='on') WITH CHECK (false)$p$,rel,current_user);
  END LOOP;
END $$;

CREATE FUNCTION public.newsletter_current_eligibility(p_tenant uuid,p_campaign uuid,p_from date,p_until date)
RETURNS TABLE(cohort date, eligible integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=current_setting('app.nl_send_tenant',true);
  prior_insight text:=current_setting('app.nl_send_insight',true);
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'')
      AND public.newsletter_capability(role_id,'newsletter:analytics')) THEN RAISE insufficient_privilege; END IF;
  IF p_until IS NULL OR p_from IS NULL OR p_until-p_from NOT BETWEEN 1 AND 90 THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  PERFORM set_config('app.nl_send_insight','on',true);
  RETURN QUERY SELECT (d.selected_at AT TIME ZONE 'UTC')::date,
    count(*) FILTER (WHERE c.id IS NOT NULL AND ns.state='subscribed' AND NOT s.suppressed
      AND i.id IS NOT NULL AND public.newsletter_address_block(d.tenant_id,i.normalized_value,d.list_id) IS NULL AND coalesce(public.newsletter_consent_allowed(d.tenant_id,c.id,consent.id),false))::integer
  FROM public.newsletter_deliveries d
  LEFT JOIN public.newsletter_subscribers s ON s.tenant_id=d.tenant_id AND s.id=d.subscriber_id
  LEFT JOIN public.contacts c ON c.tenant_id=s.tenant_id AND c.id=s.contact_id AND c.erased_at IS NULL
  LEFT JOIN public.newsletter_subscriptions ns ON ns.tenant_id=s.tenant_id AND ns.subscriber_id=s.id AND ns.list_id=d.list_id
  LEFT JOIN public.contact_identifiers i ON i.tenant_id=c.tenant_id AND i.contact_id=c.id AND i.kind='email'
  LEFT JOIN LATERAL (SELECT cc.id FROM public.contact_consents cc WHERE cc.tenant_id=c.tenant_id AND cc.contact_id=c.id
    AND cc.purpose='newsletter' AND cc.channel='email' AND cc.redacted_at IS NULL
    ORDER BY cc.recorded_at DESC,cc.occurred_at DESC,cc.id DESC LIMIT 1) consent ON true
  WHERE d.tenant_id=p_tenant AND (p_campaign IS NULL OR d.campaign_id=p_campaign)
    AND d.selected_at>=p_from::timestamp AT TIME ZONE 'UTC' AND d.selected_at<p_until::timestamp AT TIME ZONE 'UTC'
    AND NOT EXISTS (
    SELECT FROM public.newsletter_archived_counts a WHERE a.tenant_id=p_tenant AND a.day=(d.selected_at AT TIME ZONE 'UTC')::date
      AND (p_campaign IS NULL OR a.campaign_id=p_campaign))
  GROUP BY 1 HAVING count(*)>=5;
  PERFORM set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  PERFORM set_config('app.nl_send_insight',coalesce(prior_insight,''),true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_current_eligibility(uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_current_eligibility(uuid,uuid,date,date) TO harvest_app;

--> statement-breakpoint

CREATE FUNCTION public.newsletter_analytics_groups(p_tenant uuid,p_campaign uuid,p_from date,p_until date)
RETURNS TABLE(day text,counts jsonb,reasons jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=current_setting('app.nl_send_tenant',true);
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'')
      AND public.newsletter_capability(role_id,'newsletter:analytics')) THEN RAISE insufficient_privilege; END IF;
  IF p_until IS NULL OR p_from IS NULL OR p_until-p_from NOT BETWEEN 1 AND 90 THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  RETURN QUERY WITH metrics AS (
    SELECT (d.selected_at AT TIME ZONE 'UTC')::date AS selected_day, d.campaign_id, m.metric, count(*) AS total
    FROM public.newsletter_deliveries d CROSS JOIN LATERAL public.newsletter_delivery_metrics(d,false) m
    WHERE d.tenant_id=p_tenant AND (p_campaign IS NULL OR d.campaign_id=p_campaign)
      AND d.selected_at>=p_from::timestamp AT TIME ZONE 'UTC' AND d.selected_at<p_until::timestamp AT TIME ZONE 'UTC'
    GROUP BY 1,2,3
    UNION ALL
    SELECT a.day,a.campaign_id,a.metric,a.count FROM public.newsletter_archived_counts a
    WHERE a.tenant_id=p_tenant AND (p_campaign IS NULL OR a.campaign_id=p_campaign) AND a.day>=p_from AND a.day<p_until
  ), suppressed_days AS (
    SELECT DISTINCT selected_day FROM (
      SELECT selected_day,campaign_id FROM metrics WHERE metric='selected'
      GROUP BY 1,2 HAVING sum(total)<5
    ) small_cohorts
  ), summed AS (
    SELECT selected_day,metric,sum(total) AS total FROM metrics GROUP BY 1,2
  ), daily AS (
    SELECT selected_day, coalesce(sum(total) FILTER (WHERE metric='selected'),0) AS selected,
      jsonb_object_agg(metric,total) FILTER (WHERE metric NOT LIKE 'reason:%') AS totals,
      CASE WHEN min(total) FILTER (WHERE metric LIKE 'reason:%') < 5 THEN NULL
        ELSE coalesce(jsonb_object_agg(substr(metric,8),total) FILTER (WHERE metric LIKE 'reason:%'),'{}'::jsonb) END AS detail
    FROM summed GROUP BY selected_day
  )
  SELECT to_char(daily.selected_day,'YYYY-MM-DD'),
    CASE WHEN suppressed_days.selected_day IS NULL THEN
      '{"selected":0,"skipped":0,"queued":0,"attempted":0,"accepted":0,"failed":0,"delivered":0,"bounced":0,"complained":0,"unsubscribed":0}'::jsonb
      || daily.totals END,
    CASE WHEN suppressed_days.selected_day IS NULL THEN daily.detail END
  FROM daily LEFT JOIN suppressed_days USING (selected_day) ORDER BY daily.selected_day;
  PERFORM set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_analytics_groups(uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_analytics_groups(uuid,uuid,date,date) TO harvest_app;

CREATE FUNCTION public.newsletter_revision_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='newsletter_template_revisions' THEN
    PERFORM 1 FROM public.newsletter_templates WHERE tenant_id=NEW.tenant_id AND id=NEW.template_id
      AND version=NEW.version AND NOT archived FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.newsletter_campaigns WHERE tenant_id=NEW.tenant_id AND id=NEW.campaign_id
      AND state='draft' AND revision=NEW.revision AND frozen_at IS NULL FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE check_violation; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_revision_insert_guard() FROM PUBLIC,harvest_app;
CREATE TRIGGER newsletter_campaign_revision_insert BEFORE INSERT ON public.newsletter_campaign_revisions
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_revision_insert_guard();
CREATE TRIGGER newsletter_campaign_list_insert BEFORE INSERT ON public.newsletter_campaign_lists
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_revision_insert_guard();
CREATE TRIGGER newsletter_campaign_segment_insert BEFORE INSERT ON public.newsletter_campaign_segments
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_revision_insert_guard();
CREATE TRIGGER newsletter_template_revision_insert BEFORE INSERT ON public.newsletter_template_revisions
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_revision_insert_guard();

--> statement-breakpoint
CREATE FUNCTION public.newsletter_confirm_mailbox(p_tenant uuid,p_id uuid,p_digest text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior text:=current_setting('app.nl_send_tenant',true);
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'')
      AND public.newsletter_capability(role_id,'newsletter:delivery')) THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  UPDATE public.newsletter_identities SET ownership_verified=true,confirmation_digest=NULL,confirmation_expires_at=NULL,version=version+1
    WHERE tenant_id=p_tenant AND id=p_id AND confirmation_digest=p_digest AND confirmation_expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE check_violation; END IF;
  PERFORM set_config('app.nl_send_tenant',coalesce(prior,''),true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_confirm_mailbox(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_confirm_mailbox(uuid,uuid,text) TO harvest_app;

CREATE FUNCTION public.newsletter_domains_due(p_limit integer)
RETURNS TABLE(tenant_id uuid,id uuid,domain text,records jsonb,check_revision text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_send_worker','on',true);
  RETURN QUERY SELECT c.tenant_id,c.id,c.domain,c.records,c.xmin::text FROM public.newsletter_connections c
    WHERE c.checked_at IS NULL OR c.checked_at<=clock_timestamp()-interval '24 hours'
    ORDER BY c.checked_at NULLS FIRST,c.id LIMIT p_limit;
END $$;

CREATE FUNCTION public.newsletter_domain_check(p_tenant uuid,p_id uuid,p_check_revision text,
  p_ownership boolean,p_spf boolean,p_dkim boolean,p_bounce boolean,p_dmarc boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_domain text; owns boolean;
  has_spf boolean:=coalesce(p_spf,false); has_dkim boolean:=coalesce(p_dkim,false);
  has_bounce boolean:=coalesce(p_bounce,false); has_dmarc boolean:=coalesce(p_dmarc,false);
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_worker','on',true);
  SELECT domain INTO current_domain FROM public.newsletter_connections WHERE tenant_id=p_tenant AND id=p_id
    AND xmin::text=p_check_revision;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(current_domain,0));
  owns:=coalesce(p_ownership,false) AND current_domain ~ '[.]example[.]test$'
    AND current_domain<>'newsletter.example.test' AND NOT EXISTS (
      SELECT FROM public.newsletter_connections other WHERE other.domain=current_domain AND other.tenant_id<>p_tenant
        AND other.ownership AND other.spf AND other.dkim AND other.bounce);
  UPDATE public.newsletter_connections c SET checked_at=clock_timestamp(),ownership=owns,spf=has_spf,
    dkim=has_dkim,bounce=has_bounce,dmarc=has_dmarc,
    version=c.version+((c.ownership,c.spf,c.dkim,c.bounce,c.dmarc) IS DISTINCT FROM
      (owns,has_spf,has_dkim,has_bounce,has_dmarc))::integer
  WHERE c.tenant_id=p_tenant AND c.id=p_id AND c.xmin::text=p_check_revision;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_domains_due(integer),
  public.newsletter_domain_check(uuid,uuid,text,boolean,boolean,boolean,boolean,boolean) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_address_hash(p_tenant uuid,p_address text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
  SELECT public.nl02_hash('newsletter-suppression:'||p_tenant::text||':'||lower(btrim(p_address)))
$$;

CREATE FUNCTION public.newsletter_record_suppression(p_tenant uuid,p_list uuid,p_hash text,p_reason text,p_blocked timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior text:=current_setting('app.nl_send_tenant',true);
BEGIN
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  INSERT INTO public.newsletter_suppressions AS s(tenant_id,scope,address_hash,reason,blocked_at)
    VALUES(p_tenant,coalesce(p_list,'00000000-0000-0000-0000-000000000000'),p_hash,p_reason,p_blocked)
    ON CONFLICT(tenant_id,scope,address_hash,reason) DO UPDATE SET blocked_at=greatest(s.blocked_at,excluded.blocked_at);
  PERFORM set_config('app.nl_send_tenant',coalesce(prior,''),true);
END $$;

CREATE FUNCTION public.newsletter_address_block(p_tenant uuid,p_address text,p_list uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior text:=current_setting('app.nl_send_tenant',true); result text;
BEGIN
  IF session_user<>'harvest_worker' AND NOT (
    p_tenant IS NOT DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
      SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'')
        AND public.newsletter_capability(role_id,'newsletter:campaigns'))) THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT CASE WHEN bool_or(scope='00000000-0000-0000-0000-000000000000') THEN 'global_suppressed'
    WHEN count(*)>0 THEN 'list_suppressed' END INTO result FROM public.newsletter_suppressions
    WHERE tenant_id=p_tenant AND address_hash=public.newsletter_address_hash(p_tenant,p_address)
      AND scope IN ('00000000-0000-0000-0000-000000000000',p_list);
  PERFORM set_config('app.nl_send_tenant',coalesce(prior,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_address_hash(uuid,text),
  public.newsletter_record_suppression(uuid,uuid,text,text,timestamptz),
  public.newsletter_address_block(uuid,text,uuid) FROM PUBLIC,harvest_app;
GRANT EXECUTE ON FUNCTION public.newsletter_address_block(uuid,text,uuid) TO harvest_app;

CREATE FUNCTION public.newsletter_delivery_metrics(d public.newsletter_deliveries,p_expired boolean)
RETURNS TABLE(metric text) LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT metric FROM (VALUES ('selected',true),('skipped',d.state='skipped' OR (p_expired AND d.state='queued')),
    ('queued',NOT p_expired AND d.state='queued'),('attempted',d.attempted_at IS NOT NULL),('accepted',d.accepted_at IS NOT NULL),
    ('failed',d.state='failed'),('delivered',d.delivered_at IS NOT NULL),('bounced',d.bounced_at IS NOT NULL),
    ('complained',d.complained_at IS NOT NULL),('unsubscribed',d.unsubscribed_at IS NOT NULL),
    ('reason:'||d.skip_reason,d.skip_reason IS NOT NULL),('reason:expired',p_expired AND d.state='queued')
  ) AS m(metric,include) WHERE include
$$;
REVOKE ALL ON FUNCTION public.newsletter_delivery_metrics(public.newsletter_deliveries,boolean) FROM PUBLIC,harvest_app;

ALTER TABLE public.newsletter_retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_retention_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_retention_runs FROM PUBLIC,harvest_app;
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY newsletter_retention_owner ON public.newsletter_retention_runs TO %I
    USING (false) WITH CHECK (session_user='harvest_worker'
      AND current_setting('app.nl_send_worker',true)='on')$p$,current_user);
END $$;

CREATE FUNCTION public.newsletter_purge_deliveries(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE cutoff timestamptz:=clock_timestamp()-interval '2160 hours'; campaign record;
  purged integer:=0; removed integer;
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_send_worker','on',true);
  FOR campaign IN SELECT c.tenant_id,c.id FROM public.newsletter_campaigns c
    WHERE EXISTS (SELECT FROM public.newsletter_deliveries d WHERE d.tenant_id=c.tenant_id AND d.campaign_id=c.id
      AND d.selected_at<=cutoff AND (d.lease_until IS NULL OR d.lease_until<=clock_timestamp()))
    ORDER BY c.tenant_id,c.id LIMIT p_limit FOR UPDATE OF c SKIP LOCKED
  LOOP
    PERFORM set_config('app.nl_send_tenant',campaign.tenant_id::text,true);
    WITH candidates AS (
      SELECT id FROM public.newsletter_deliveries WHERE tenant_id=campaign.tenant_id AND campaign_id=campaign.id
        AND selected_at<=cutoff AND (lease_until IS NULL OR lease_until<=clock_timestamp())
      ORDER BY selected_at,id LIMIT (p_limit-purged) FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM public.newsletter_deliveries d USING candidates k
      WHERE d.tenant_id=campaign.tenant_id AND d.id=k.id RETURNING d
    ), rolled_up AS (
      INSERT INTO public.newsletter_archived_counts AS a(tenant_id,campaign_id,day,metric,count)
      SELECT campaign.tenant_id,campaign.id,((d).selected_at AT TIME ZONE 'UTC')::date,m.metric,count(*)
      FROM deleted CROSS JOIN LATERAL public.newsletter_delivery_metrics(d,true) m GROUP BY 3,4
      ON CONFLICT(tenant_id,campaign_id,day,metric) DO UPDATE SET count=a.count+excluded.count
    )
    SELECT count(*) INTO removed FROM deleted;
    purged:=purged+removed;
    PERFORM public.newsletter_finish_campaign(campaign.tenant_id,campaign.id);
    EXIT WHEN purged>=p_limit;
  END LOOP;
  INSERT INTO public.newsletter_retention_runs(purged) VALUES(purged);
  RETURN purged;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_purge_deliveries(integer) FROM PUBLIC,harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker') THEN
    REVOKE ALL ON public.newsletter_retention_runs FROM harvest_worker;
    GRANT EXECUTE ON FUNCTION public.newsletter_domains_due(integer),
      public.newsletter_domain_check(uuid,uuid,text,boolean,boolean,boolean,boolean,boolean),
      public.newsletter_purge_deliveries(integer) TO harvest_worker;
  END IF;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.nl02_apply_unsubscribe(p_nonce text,p_scope text) RETURNS void
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

  PERFORM public.newsletter_record_suppression(token.tenant_id,token.list_id,
    public.newsletter_address_hash(token.tenant_id,email),'unsubscribe',clock_timestamp());
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.nl02_accept_signup(p_email text,p_token text) RETURNS void
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

  IF NOT public.newsletter_apply_verified_opt_in(form.tenant_id,form.list_id,p_email,pending.created_at) THEN RETURN; END IF;
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

CREATE FUNCTION public.newsletter_apply_verified_opt_in(p_tenant uuid,p_list uuid,p_address text,p_issued_at timestamptz) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior text:=current_setting('app.nl_send_tenant',true); blocked boolean;
  hash text:=public.newsletter_address_hash(p_tenant,p_address);
BEGIN
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT EXISTS (SELECT FROM public.newsletter_suppressions
    WHERE tenant_id=p_tenant AND address_hash=hash AND scope IN ('00000000-0000-0000-0000-000000000000',p_list)
      AND (reason<>'unsubscribe' OR blocked_at>=p_issued_at)) INTO blocked;
  IF NOT blocked THEN
    DELETE FROM public.newsletter_suppressions WHERE tenant_id=p_tenant AND address_hash=hash
      AND scope IN ('00000000-0000-0000-0000-000000000000',p_list) AND reason='unsubscribe' AND blocked_at<p_issued_at;
  END IF;
  PERFORM set_config('app.nl_send_tenant',coalesce(prior,''),true);
  RETURN NOT blocked;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_apply_verified_opt_in(uuid,uuid,text,timestamptz) FROM PUBLIC,harvest_app;
