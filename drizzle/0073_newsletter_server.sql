CREATE TABLE "newsletter_campaigns" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"approved_revision" integer,
	"approved_by" text,
	"scheduled_for" timestamp with time zone,
	"time_zone" text,
	"audience_cursor" uuid,
	"audience_resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_campaigns_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_campaign_status" CHECK ("newsletter_campaigns"."status" in ('draft','scheduled','sending','sent','cancelled')),
	CONSTRAINT "newsletter_campaign_review" CHECK (("newsletter_campaigns"."approved_revision" is null AND "newsletter_campaigns"."approved_by" is null AND "newsletter_campaigns"."scheduled_for" is null AND "newsletter_campaigns"."time_zone" is null AND "newsletter_campaigns"."status" IN ('draft','cancelled')) OR
    ("newsletter_campaigns"."approved_revision" IS NOT NULL AND "newsletter_campaigns"."approved_revision" = "newsletter_campaigns"."revision" AND "newsletter_campaigns"."approved_by" IS NOT NULL AND "newsletter_campaigns"."scheduled_for" IS NOT NULL AND "newsletter_campaigns"."time_zone" IS NOT NULL AND "newsletter_campaigns"."status" <> 'draft'))
);
--> statement-breakpoint
CREATE TABLE "newsletter_deliveries" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"contact_id" uuid,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reconciliations" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"provider_id" uuid,
	CONSTRAINT "newsletter_deliveries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_delivery_recipient" UNIQUE("tenant_id","campaign_id","revision","contact_id"),
	CONSTRAINT "newsletter_delivery_provider" UNIQUE("tenant_id","provider_id"),
	CONSTRAINT "newsletter_delivery_state" CHECK ("newsletter_deliveries"."state" in ('queued','leased','dispatching','ambiguous','reconciling','accepted','failed','unconfirmed','cancelled')),
	CONSTRAINT "newsletter_delivery_attempts" CHECK ("newsletter_deliveries"."attempts" BETWEEN 0 AND 3 AND "newsletter_deliveries"."reconciliations" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "newsletter_delivery_events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"link_id" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_delivery_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_event_outcome" CHECK ("newsletter_delivery_events"."outcome" in ('delivered','opened','clicked','bounced','complained','unsubscribed')),
	CONSTRAINT "newsletter_event_link" CHECK (("newsletter_delivery_events"."outcome" = 'clicked') = ("newsletter_delivery_events"."link_id" IS NOT NULL) AND ("newsletter_delivery_events"."link_id" IS NULL OR "newsletter_delivery_events"."link_id" > 0))
);
--> statement-breakpoint
CREATE TABLE "newsletter_revisions" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"subject" text NOT NULL,
	"preview_text" text NOT NULL,
	"content" jsonb NOT NULL,
	"link_count" integer NOT NULL,
	"sender_id" uuid NOT NULL,
	"list_id" uuid,
	"segment_id" uuid,
	"view_id" uuid,
	"view_version" integer,
	CONSTRAINT "newsletter_revisions_tenant_id_campaign_id_version_pk" PRIMARY KEY("tenant_id","campaign_id","version"),
	CONSTRAINT "newsletter_revision_version" CHECK ("newsletter_revisions"."version" > 0 AND "newsletter_revisions"."link_count" BETWEEN 0 AND 5000),
	CONSTRAINT "newsletter_revision_subject" CHECK (length("newsletter_revisions"."subject") between 1 and 150 AND length("newsletter_revisions"."preview_text") <= 200
    AND "newsletter_revisions"."subject" !~ '[[:cntrl:]]' AND "newsletter_revisions"."preview_text" !~ '[[:cntrl:]]'),
	CONSTRAINT "newsletter_revision_audience" CHECK (("newsletter_revisions"."list_id" IS NOT NULL OR "newsletter_revisions"."view_id" IS NOT NULL)
    AND ("newsletter_revisions"."segment_id" IS NULL OR ("newsletter_revisions"."list_id" IS NOT NULL AND "newsletter_revisions"."view_id" IS NOT NULL))
    AND ("newsletter_revisions"."view_id" IS NULL) = ("newsletter_revisions"."view_version" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "newsletter_senders" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"reply_to" text NOT NULL,
	"postal_address" text NOT NULL,
	"verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "newsletter_senders_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "newsletter_templates" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"content" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "newsletter_templates_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_template_version" CHECK ("newsletter_templates"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.newsletter_campaigns ADD CONSTRAINT newsletter_campaign_current_revision_fk
  FOREIGN KEY (tenant_id,id,revision) REFERENCES public.newsletter_revisions(tenant_id,campaign_id,version)
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_delivery_revision_fk" FOREIGN KEY ("tenant_id","campaign_id","revision") REFERENCES "public"."newsletter_revisions"("tenant_id","campaign_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_delivery_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_delivery_events" ADD CONSTRAINT "newsletter_event_delivery_fk" FOREIGN KEY ("tenant_id","delivery_id") REFERENCES "public"."newsletter_deliveries"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_revisions" ADD CONSTRAINT "newsletter_revision_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."newsletter_campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_revisions" ADD CONSTRAINT "newsletter_revision_sender_fk" FOREIGN KEY ("tenant_id","sender_id") REFERENCES "public"."newsletter_senders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_revisions" ADD CONSTRAINT "newsletter_revision_list_fk" FOREIGN KEY ("tenant_id","list_id") REFERENCES "public"."newsletter_lists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_senders" ADD CONSTRAINT "newsletter_senders_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_templates" ADD CONSTRAINT "newsletter_templates_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_campaign_due" ON "newsletter_campaigns" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "newsletter_delivery_due" ON "newsletter_deliveries" USING btree ("state","available_at");--> statement-breakpoint
CREATE INDEX "newsletter_event_delivery_time" ON "newsletter_delivery_events" USING btree ("tenant_id","delivery_id","occurred_at");
--> statement-breakpoint
CREATE TABLE public.newsletter_audience_bindings (
  tenant_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  revision integer NOT NULL,
  view_id uuid NOT NULL,
  segment_id uuid,
  CONSTRAINT newsletter_audience_bindings_tenant_id_campaign_id_revision_pk PRIMARY KEY (tenant_id,campaign_id,revision),
  CONSTRAINT newsletter_binding_revision_fk FOREIGN KEY (tenant_id,campaign_id,revision) REFERENCES public.newsletter_revisions(tenant_id,campaign_id,version),
  CONSTRAINT newsletter_binding_view_fk FOREIGN KEY (tenant_id,view_id) REFERENCES public.crm_saved_views(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT newsletter_binding_segment_fk FOREIGN KEY (tenant_id,segment_id) REFERENCES public.newsletter_segments(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX newsletter_binding_view_index ON public.newsletter_audience_bindings(tenant_id,view_id);
CREATE INDEX newsletter_binding_segment_index ON public.newsletter_audience_bindings(tenant_id,segment_id);

--> statement-breakpoint
-- Role capabilities mirror newsletter:read/manage/review/analytics. Operational tables have no app grants.
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['newsletter_campaigns','newsletter_revisions','newsletter_senders','newsletter_templates','newsletter_deliveries','newsletter_delivery_events','newsletter_audience_bindings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', rel);
    EXECUTE format($p$CREATE POLICY newsletter_delivery_internal ON public.%I TO %I
      USING (current_setting('app.newsletter_internal',true)='on')
      WITH CHECK (current_setting('app.newsletter_internal',true)='on')$p$, rel, current_user);
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['newsletter_audiences','newsletter_lists','newsletter_subscribers','newsletter_subscriptions','newsletter_segments',
      'newsletter_campaigns','newsletter_revisions','newsletter_senders','newsletter_templates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS newsletter_read ON public.%I', rel);
    EXECUTE format($p$CREATE POLICY newsletter_read ON public.%I FOR SELECT TO harvest_app USING (
      tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
        SELECT FROM public.workspace_members m WHERE m.tenant_id=%I.tenant_id
          AND m.user_id=nullif(current_setting('app.user_id',true),'') AND m.role_id IN ('owner','admin')))$p$, rel, rel);
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['newsletter_campaigns','newsletter_revisions','newsletter_senders','newsletter_templates'] LOOP
    EXECUTE format($p$CREATE POLICY newsletter_write ON public.%I TO harvest_app USING (
      tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
        SELECT FROM public.workspace_members m WHERE m.tenant_id=%I.tenant_id
          AND m.user_id=nullif(current_setting('app.user_id',true),'') AND m.role_id IN ('owner','admin')))
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
        SELECT FROM public.workspace_members m WHERE m.tenant_id=%I.tenant_id
          AND m.user_id=nullif(current_setting('app.user_id',true),'') AND m.role_id IN ('owner','admin')))$p$, rel, rel, rel);
  END LOOP;
  -- CRM reads and locks use the existing scoped owner policies. Only list and segment reads need a newsletter policy.
  FOREACH rel IN ARRAY ARRAY['newsletter_lists','newsletter_segments'] LOOP
    EXECUTE format($p$CREATE POLICY newsletter_dispatch_read ON public.%I FOR SELECT TO %I USING (
      current_setting('app.newsletter_internal',true)='on' AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)$p$, rel, current_user);
  END LOOP;
END $$;
GRANT SELECT ON public.newsletter_campaigns,public.newsletter_revisions,public.newsletter_senders,public.newsletter_templates TO harvest_app;
GRANT INSERT (tenant_id,id) ON public.newsletter_campaigns TO harvest_app;
GRANT UPDATE (revision) ON public.newsletter_campaigns TO harvest_app;
GRANT INSERT ON public.newsletter_revisions,public.newsletter_templates TO harvest_app;
GRANT INSERT ON public.newsletter_audience_bindings TO harvest_app;
CREATE POLICY newsletter_bind_reviewed_revision ON public.newsletter_audience_bindings FOR INSERT TO harvest_app WITH CHECK (
  tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT FROM public.newsletter_revisions r
    WHERE (r.tenant_id,r.campaign_id,r.version,r.view_id)=(newsletter_audience_bindings.tenant_id,
      newsletter_audience_bindings.campaign_id,newsletter_audience_bindings.revision,newsletter_audience_bindings.view_id)
    AND r.segment_id IS NOT DISTINCT FROM newsletter_audience_bindings.segment_id
  )
);
GRANT UPDATE (name,content,version) ON public.newsletter_templates TO harvest_app;
GRANT INSERT (tenant_id,id,name,email,reply_to,postal_address) ON public.newsletter_senders TO harvest_app;
--> statement-breakpoint
-- The live segment/view is validated by ministry and pinned version; historical IDs survive CRM view deletion.
CREATE FUNCTION public.newsletter_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_version integer; current_status text;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'newsletter_revision_immutable'; END IF;
  SELECT c.revision,c.status INTO current_version,current_status FROM public.newsletter_campaigns c
    WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.campaign_id FOR UPDATE;
  IF NOT FOUND OR current_status<>'draft' OR current_version<>NEW.version THEN
    RAISE EXCEPTION 'newsletter_revision_not_current';
  END IF;
  IF NEW.view_id IS NOT NULL AND NOT EXISTS (
    SELECT FROM public.crm_saved_views v WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.view_id
      AND v.object_type='person' AND v.owner_user_id IS NULL AND v.version=NEW.view_version
  ) THEN RAISE EXCEPTION 'newsletter_view_unavailable'; END IF;
  IF NEW.segment_id IS NOT NULL AND NOT EXISTS (
    SELECT FROM public.newsletter_segments s JOIN public.newsletter_lists l USING (tenant_id,audience_id)
      WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.segment_id AND l.id=NEW.list_id
        AND s.saved_view_id=NEW.view_id AND s.saved_view_version=NEW.view_version
  ) THEN RAISE EXCEPTION 'newsletter_segment_unavailable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER newsletter_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON public.newsletter_revisions
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_revision_guard();
REVOKE ALL ON FUNCTION public.newsletter_revision_guard() FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_bind_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  INSERT INTO public.newsletter_audience_bindings(tenant_id,campaign_id,revision,view_id,segment_id)
    VALUES(NEW.tenant_id,NEW.campaign_id,NEW.version,NEW.view_id,NEW.segment_id);
  RETURN NEW;
END $$;
CREATE TRIGGER newsletter_bind_revision AFTER INSERT ON public.newsletter_revisions
  FOR EACH ROW WHEN (NEW.view_id IS NOT NULL) EXECUTE FUNCTION public.newsletter_bind_revision();
REVOKE ALL ON FUNCTION public.newsletter_bind_revision() FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_campaign_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF OLD.revision<>NEW.revision AND (OLD.status<>'draft' OR NEW.status<>'draft' OR NEW.revision<>OLD.revision+1)
    THEN RAISE EXCEPTION 'newsletter_revision_sequence'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER newsletter_campaign_revision_guard BEFORE UPDATE OF revision ON public.newsletter_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_campaign_revision_guard();
REVOKE ALL ON FUNCTION public.newsletter_campaign_revision_guard() FROM PUBLIC,harvest_app;
--> statement-breakpoint
-- The migration owner can set custom context locally, but PostgreSQL rejects custom
-- CREATE FUNCTION SET options for restricted roles. Each public entry restores context.
CREATE FUNCTION public.newsletter_enter() RETURNS text[]
LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
  SELECT ARRAY[current_setting('app.newsletter_internal',true),
    current_setting('app.nl02_tenant',true),
    current_setting('app.nl02_private',true),current_setting('app.tenant_id',true),current_setting('app.user_id',true)]
$$;
CREATE FUNCTION public.newsletter_leave(previous text[]) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM set_config('app.newsletter_internal',coalesce(previous[1],''),true);
  PERFORM set_config('app.nl02_tenant',coalesce(previous[2],''),true);
  PERFORM set_config('app.nl02_private',coalesce(previous[3],''),true);
  PERFORM set_config('app.tenant_id',coalesce(previous[4],''),true);
  PERFORM set_config('app.user_id',coalesce(previous[5],''),true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_enter(),public.newsletter_leave(text[]) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_admin(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT p_tenant=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT FROM public.workspace_members WHERE tenant_id=p_tenant
      AND user_id=nullif(current_setting('app.user_id',true),'') AND role_id IN ('owner','admin'))
$$;

CREATE FUNCTION public.newsletter_view_current(r public.newsletter_revisions) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT (r.view_id IS NULL OR EXISTS (SELECT FROM public.newsletter_audience_bindings b
    JOIN public.crm_saved_views v ON (v.tenant_id,v.id)=(b.tenant_id,b.view_id)
    WHERE (b.tenant_id,b.campaign_id,b.revision)=(r.tenant_id,r.campaign_id,r.version)
      AND v.version=r.view_version AND v.owner_user_id IS NULL AND v.object_type='person'))
  AND (r.segment_id IS NULL OR EXISTS (SELECT FROM public.newsletter_segments s
    JOIN public.newsletter_lists l USING (tenant_id,audience_id)
    WHERE s.tenant_id=r.tenant_id AND s.id=r.segment_id AND l.id=r.list_id
      AND s.saved_view_id=r.view_id AND s.saved_view_version=r.view_version))
$$;

CREATE FUNCTION public.newsletter_cancel_pending(p_tenant uuid,p_campaign uuid) RETURNS void
LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
  UPDATE public.newsletter_campaigns SET status='cancelled'
    WHERE tenant_id=p_tenant AND id=p_campaign AND status IN ('draft','scheduled','sending');
  UPDATE public.newsletter_deliveries SET state='cancelled',lease_id=NULL,lease_until=NULL
    WHERE tenant_id=p_tenant AND campaign_id=p_campaign AND state IN ('queued','leased');
$$;

CREATE FUNCTION public.newsletter_review_internal(p_tenant uuid,p_campaign uuid,p_version integer,p_at timestamptz,p_zone text)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.newsletter_revisions; s public.newsletter_senders;
BEGIN
  IF NOT coalesce(public.newsletter_admin(p_tenant),false) THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(731,hashtext(p_tenant::text));
  PERFORM 1 FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=p_campaign
    AND revision=p_version AND status='draft' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO r FROM public.newsletter_revisions WHERE tenant_id=p_tenant AND campaign_id=p_campaign AND version=p_version;
  IF NOT FOUND OR NOT public.newsletter_view_current(r) THEN RETURN false; END IF;
  SELECT * INTO s FROM public.newsletter_senders WHERE tenant_id=p_tenant AND id=r.sender_id FOR SHARE;
  IF s.verified_at IS NULL OR s.disabled_at IS NOT NULL
    OR p_zone IS NULL OR NOT EXISTS (SELECT FROM pg_timezone_names WHERE name=p_zone) THEN RETURN false; END IF;
  UPDATE public.newsletter_campaigns SET status='scheduled',approved_revision=p_version,
    approved_by=current_setting('app.user_id'),scheduled_for=coalesce(p_at,clock_timestamp()),time_zone=p_zone
    WHERE tenant_id=p_tenant AND id=p_campaign;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_review_internal(uuid,uuid,integer,timestamptz,text) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_review(p_tenant uuid,p_campaign uuid,p_version integer,p_at timestamptz,p_zone text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter(); result boolean;
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  result:=public.newsletter_review_internal(p_tenant,p_campaign,p_version,p_at,p_zone);
  PERFORM public.newsletter_leave(previous);
  RETURN result;
END $$;

CREATE FUNCTION public.newsletter_cancel_internal(p_tenant uuid,p_campaign uuid,p_version integer)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NOT coalesce(public.newsletter_admin(p_tenant),false) THEN RETURN false; END IF;
  PERFORM 1 FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=p_campaign
    AND revision=p_version AND status IN ('draft','scheduled','sending','cancelled') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.newsletter_cancel_pending(p_tenant,p_campaign);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_cancel_internal(uuid,uuid,integer) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_cancel(p_tenant uuid,p_campaign uuid,p_version integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter(); result boolean;
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  result:=public.newsletter_cancel_internal(p_tenant,p_campaign,p_version);
  PERFORM public.newsletter_leave(previous);
  RETURN result;
END $$;

CREATE FUNCTION public.newsletter_disable_sender_internal(p_tenant uuid,p_sender uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE campaign uuid;
BEGIN
  IF NOT coalesce(public.newsletter_admin(p_tenant),false) THEN RETURN false; END IF;
  -- Serialize sender disable with the review and final handoff transactions.
  PERFORM pg_advisory_xact_lock(731,hashtext(p_tenant::text));
  UPDATE public.newsletter_senders SET disabled_at=coalesce(disabled_at,clock_timestamp())
    WHERE tenant_id=p_tenant AND id=p_sender;
  IF NOT FOUND THEN RETURN false; END IF;
  FOR campaign IN SELECT c.id FROM public.newsletter_campaigns c JOIN public.newsletter_revisions r
    ON (r.tenant_id,r.campaign_id,r.version)=(c.tenant_id,c.id,c.revision)
    WHERE c.tenant_id=p_tenant AND r.sender_id=p_sender AND c.status IN ('draft','scheduled','sending')
    ORDER BY c.id
  LOOP
    PERFORM public.newsletter_cancel_pending(p_tenant,campaign);
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_disable_sender_internal(uuid,uuid) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_disable_sender(p_tenant uuid,p_sender uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter(); result boolean;
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  result:=public.newsletter_disable_sender_internal(p_tenant,p_sender);
  PERFORM public.newsletter_leave(previous);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.newsletter_admin(uuid),public.newsletter_view_current(public.newsletter_revisions),
  public.newsletter_cancel_pending(uuid,uuid),public.newsletter_review(uuid,uuid,integer,timestamptz,text),
  public.newsletter_cancel(uuid,uuid,integer),public.newsletter_disable_sender(uuid,uuid) FROM PUBLIC,harvest_app;
GRANT EXECUTE ON FUNCTION public.newsletter_review(uuid,uuid,integer,timestamptz,text),
  public.newsletter_cancel(uuid,uuid,integer),public.newsletter_disable_sender(uuid,uuid) TO harvest_app;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_due_internal()
RETURNS TABLE(tenant_id uuid,campaign_id uuid,actor text,cursor uuid) LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
  SELECT c.tenant_id,c.id,c.approved_by,c.audience_cursor FROM public.newsletter_campaigns c
    WHERE c.status IN ('scheduled','sending') AND c.scheduled_for<=clock_timestamp() AND NOT c.audience_resolved
    ORDER BY c.scheduled_for,c.id LIMIT 10
$$;
REVOKE ALL ON FUNCTION public.newsletter_due_internal() FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_due()
RETURNS TABLE(tenant_id uuid,campaign_id uuid,actor text,cursor uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter();
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  RETURN QUERY SELECT * FROM public.newsletter_due_internal();
  PERFORM public.newsletter_leave(previous);
END $$;

CREATE FUNCTION public.newsletter_dispatch_current(c public.newsletter_campaigns, r public.newsletter_revisions) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT c.status IN ('scheduled','sending') AND r.version=c.approved_revision AND public.newsletter_view_current(r)
    AND EXISTS (SELECT FROM public.newsletter_senders s WHERE s.tenant_id=c.tenant_id AND s.id=r.sender_id
      AND s.verified_at IS NOT NULL AND s.disabled_at IS NULL)
    AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=c.tenant_id AND m.user_id=c.approved_by
      AND m.role_id IN ('owner','admin'))
$$;

-- Candidate and final-handoff checks share the existing consent SQL twin.
CREATE FUNCTION public.newsletter_eligible_address(p_tenant uuid,p_contact uuid,p_list uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE sub public.newsletter_subscribers; address text; consent uuid;
BEGIN
  SELECT * INTO sub FROM public.newsletter_subscribers WHERE tenant_id=p_tenant AND contact_id=p_contact;
  IF coalesce(sub.suppressed,false)
    OR EXISTS (SELECT FROM public.newsletter_subscriptions ns WHERE ns.tenant_id=p_tenant AND ns.subscriber_id=sub.id
      AND (ns.state IN ('bounced','suppressed') OR p_list IS NULL AND ns.state='unsubscribed'))
    OR (p_list IS NOT NULL AND NOT EXISTS (SELECT FROM public.newsletter_subscriptions ns
      WHERE ns.tenant_id=p_tenant AND ns.list_id=p_list AND ns.subscriber_id=sub.id AND ns.state='subscribed'))
    THEN RETURN NULL; END IF;
  SELECT cc.id INTO consent FROM public.contact_consents cc
    WHERE cc.tenant_id=p_tenant AND cc.contact_id=p_contact AND cc.purpose='newsletter' AND cc.channel='email'
      AND cc.redacted_at IS NULL ORDER BY cc.recorded_at DESC,cc.occurred_at DESC,cc.id DESC LIMIT 1;
  IF NOT coalesce(public.newsletter_consent_allowed(p_tenant,p_contact,consent),false) THEN RETURN NULL; END IF;
  SELECT i.normalized_value INTO address FROM public.contact_identifiers i
    WHERE i.tenant_id=p_tenant AND i.contact_id=p_contact AND i.kind='email'
      AND public.nl02_email(i.normalized_value) AND i.normalized_value LIKE '%.test';
  RETURN address;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_eligible_address(uuid,uuid,uuid) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_stage_internal(p_tenant uuid,p_campaign uuid,p_after uuid,p_ids uuid[],p_done boolean)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.newsletter_campaigns; r public.newsletter_revisions;
BEGIN
  IF coalesce(cardinality(p_ids),101)>100 OR p_done IS NULL OR
    EXISTS(SELECT FROM unnest(p_ids) AS u(id) WHERE id IS NULL OR id<=p_after)
    OR (cardinality(p_ids)=0 AND NOT p_done) THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.tenant_id',p_tenant::text,true);
  SELECT * INTO c FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=p_campaign
    AND status IN ('scheduled','sending') AND scheduled_for<=clock_timestamp() AND NOT audience_resolved
    AND audience_cursor IS NOT DISTINCT FROM p_after FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO r FROM public.newsletter_revisions WHERE tenant_id=p_tenant AND campaign_id=p_campaign AND version=c.approved_revision;
  IF NOT coalesce(public.newsletter_dispatch_current(c,r),false) THEN
    PERFORM public.newsletter_cancel_pending(p_tenant,p_campaign);
    RETURN;
  END IF;
  PERFORM set_config('app.nl02_tenant',p_tenant::text,true);
  INSERT INTO public.newsletter_deliveries(tenant_id,campaign_id,revision,contact_id)
    SELECT c.tenant_id,c.id,c.approved_revision,p.id FROM public.contacts p
    WHERE p.tenant_id=p_tenant AND p.id=ANY(p_ids) AND p.erased_at IS NULL
      AND public.newsletter_eligible_address(p_tenant,p.id,r.list_id) IS NOT NULL
    ON CONFLICT ON CONSTRAINT newsletter_delivery_recipient DO NOTHING;
  UPDATE public.newsletter_campaigns SET status='sending',audience_resolved=p_done,
    audience_cursor=coalesce((SELECT id FROM unnest(p_ids) u(id) ORDER BY id DESC LIMIT 1),p_after)
    WHERE tenant_id=p_tenant AND id=p_campaign;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_stage_internal(uuid,uuid,uuid,uuid[],boolean) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_stage(p_tenant uuid,p_campaign uuid,p_after uuid,p_ids uuid[],p_done boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter();
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  PERFORM public.newsletter_stage_internal(p_tenant,p_campaign,p_after,p_ids,p_done);
  PERFORM public.newsletter_leave(previous);
END $$;

CREATE FUNCTION public.newsletter_claim_internal(p_limit integer)
RETURNS TABLE(tenant_id uuid,delivery_id uuid,lease_id uuid,reconcile boolean) LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  RETURN QUERY WITH due AS (
    SELECT d.tenant_id,d.id,d.state FROM public.newsletter_deliveries d
    JOIN public.newsletter_campaigns c ON (c.tenant_id,c.id)=(d.tenant_id,d.campaign_id)
    WHERE ((d.state='queued' AND d.available_at<=clock_timestamp() OR d.state='leased' AND d.lease_until<=clock_timestamp())
      AND c.status='sending' AND c.audience_resolved OR
      d.state='ambiguous' AND d.available_at<=clock_timestamp() OR
      d.state IN ('dispatching','reconciling') AND d.lease_until<=clock_timestamp())
    ORDER BY d.available_at,d.id LIMIT least(greatest(coalesce(p_limit,1),1),20) FOR UPDATE OF d SKIP LOCKED
  ), claimed AS (
    UPDATE public.newsletter_deliveries d SET
      state=CASE WHEN due.state IN ('queued','leased') THEN 'leased'
        WHEN d.reconciliations=3 THEN 'unconfirmed' ELSE 'reconciling' END,
      lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',
      reconciliations=d.reconciliations + CASE WHEN due.state IN ('queued','leased') OR d.reconciliations=3 THEN 0 ELSE 1 END
      FROM due WHERE (d.tenant_id,d.id)=(due.tenant_id,due.id)
      RETURNING d.tenant_id,d.id,d.lease_id,d.state
  )
  SELECT claimed.tenant_id,claimed.id,claimed.lease_id,claimed.state='reconciling' FROM claimed WHERE claimed.state<>'unconfirmed';
END $$;
REVOKE ALL ON FUNCTION public.newsletter_claim_internal(integer) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_claim(p_limit integer)
RETURNS TABLE(tenant_id uuid,delivery_id uuid,lease_id uuid,reconcile boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter();
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  RETURN QUERY SELECT * FROM public.newsletter_claim_internal(p_limit);
  PERFORM public.newsletter_leave(previous);
END $$;

CREATE FUNCTION public.newsletter_start_internal(p_tenant uuid,p_delivery uuid,p_lease uuid,p_nonce text)
RETURNS TABLE(recipient text,subject text,preview_text text,content jsonb,sender_name text,sender_email text,
  reply_to text,postal_address text,scope text) LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.newsletter_campaigns; d public.newsletter_deliveries; r public.newsletter_revisions;
  s public.newsletter_senders; sub public.newsletter_subscribers; address text; minute_start timestamptz;
BEGIN
  IF coalesce(p_nonce,'') !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_advisory_xact_lock(731,hashtext(p_tenant::text));
  PERFORM set_config('app.tenant_id',p_tenant::text,true);
  PERFORM set_config('app.nl02_tenant',p_tenant::text,true);
  SELECT * INTO d FROM public.newsletter_deliveries WHERE newsletter_deliveries.tenant_id=p_tenant AND id=p_delivery;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO c FROM public.newsletter_campaigns WHERE newsletter_campaigns.tenant_id=p_tenant AND id=d.campaign_id FOR UPDATE;
  IF c.status<>'sending' OR NOT c.audience_resolved THEN RETURN; END IF;
  SELECT * INTO r FROM public.newsletter_revisions WHERE newsletter_revisions.tenant_id=p_tenant AND campaign_id=c.id AND version=d.revision;
  IF NOT coalesce(public.newsletter_dispatch_current(c,r),false) THEN
    PERFORM public.newsletter_cancel_pending(p_tenant,c.id);
    RETURN;
  END IF;
  PERFORM 1 FROM public.contacts WHERE contacts.tenant_id=p_tenant AND id=d.contact_id AND erased_at IS NULL FOR UPDATE;
  SELECT * INTO d FROM public.newsletter_deliveries WHERE newsletter_deliveries.tenant_id=p_tenant AND id=p_delivery
    AND lease_id=p_lease AND lease_until>clock_timestamp() AND state='leased' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  address:=public.newsletter_eligible_address(p_tenant,d.contact_id,r.list_id);
  IF address IS NULL THEN
    UPDATE public.newsletter_deliveries SET state='cancelled',lease_id=NULL,lease_until=NULL
      WHERE newsletter_deliveries.tenant_id=p_tenant AND id=p_delivery;
    RETURN;
  END IF;
  minute_start:=date_trunc('minute',clock_timestamp());
  IF NOT public.nl02_take('newsletter-dispatch:'||p_tenant,minute_start,minute_start+interval '1 minute',30) THEN
    UPDATE public.newsletter_deliveries SET state='queued',available_at=minute_start+interval '1 minute',lease_id=NULL,lease_until=NULL
      WHERE newsletter_deliveries.tenant_id=p_tenant AND id=p_delivery;
    RETURN;
  END IF;
  SELECT * INTO sub FROM public.newsletter_subscribers WHERE newsletter_subscribers.tenant_id=p_tenant AND contact_id=d.contact_id;
  IF sub.id IS NULL THEN
    PERFORM set_config('app.user_id',c.approved_by,true);
    INSERT INTO public.newsletter_subscribers(tenant_id,contact_id,created_by)
      VALUES(p_tenant,d.contact_id,c.approved_by) RETURNING * INTO sub;
  END IF;
  INSERT INTO public.newsletter_preference_tokens(token_hash,tenant_id,subscriber_id,list_id,scope,email_proof,expires_at)
    VALUES(public.nl02_hash(p_nonce),p_tenant,sub.id,r.list_id,CASE WHEN r.list_id IS NULL THEN 'all' ELSE 'list' END,
      public.nl02_hash(p_nonce||':'||address),clock_timestamp()+interval '30 days');
  UPDATE public.newsletter_deliveries SET state='dispatching',attempts=attempts+1,lease_until=clock_timestamp()+interval '2 minutes'
    WHERE newsletter_deliveries.tenant_id=p_tenant AND id=p_delivery;
  SELECT * INTO s FROM public.newsletter_senders WHERE newsletter_senders.tenant_id=p_tenant AND id=r.sender_id;
  RETURN QUERY SELECT address,r.subject,r.preview_text,r.content,s.name,s.email,s.reply_to,s.postal_address,
    CASE WHEN r.list_id IS NULL THEN 'all' ELSE 'list' END;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_start_internal(uuid,uuid,uuid,text) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_start(p_tenant uuid,p_delivery uuid,p_lease uuid,p_nonce text)
RETURNS TABLE(recipient text,subject text,preview_text text,content jsonb,sender_name text,sender_email text,
  reply_to text,postal_address text,scope text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter();
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  PERFORM set_config('app.nl02_tenant','',true);
  PERFORM set_config('app.nl02_private','on',true);
  PERFORM set_config('app.user_id','',true);
  RETURN QUERY SELECT * FROM public.newsletter_start_internal(p_tenant,p_delivery,p_lease,p_nonce);
  PERFORM public.newsletter_leave(previous);
END $$;

CREATE FUNCTION public.newsletter_finish_internal(p_tenant uuid,p_delivery uuid,p_lease uuid,p_outcome text,p_provider uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.newsletter_deliveries; c public.newsletter_campaigns; next_state text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','retry','unknown','failed','absent')
    OR (p_outcome='accepted')<>(p_provider IS NOT NULL) THEN RAISE invalid_parameter_value; END IF;
  SELECT * INTO d FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND id=p_delivery;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO c FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=d.campaign_id FOR UPDATE;
  SELECT * INTO d FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND id=p_delivery AND lease_id=p_lease
    AND lease_until>clock_timestamp() AND state IN ('dispatching','reconciling') FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF (p_outcome='absent' AND d.state<>'reconciling') OR
    (p_outcome IN ('retry','failed') AND d.state<>'dispatching') THEN RAISE invalid_parameter_value; END IF;
  next_state:=CASE WHEN p_outcome='accepted' THEN 'accepted'
    WHEN p_outcome='unknown' THEN CASE WHEN d.reconciliations=3 THEN 'unconfirmed' ELSE 'ambiguous' END
    WHEN c.status='cancelled' OR d.contact_id IS NULL THEN 'cancelled'
    WHEN p_outcome='failed' OR d.attempts=3 THEN 'failed' ELSE 'queued' END;
  UPDATE public.newsletter_deliveries SET state=next_state,lease_id=NULL,lease_until=NULL,
    available_at=clock_timestamp()+make_interval(secs=>15*greatest(d.attempts,d.reconciliations,1)),
    provider_id=p_provider,accepted_at=CASE WHEN p_outcome='accepted' THEN clock_timestamp() END
    WHERE tenant_id=p_tenant AND id=p_delivery;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_finish_internal(uuid,uuid,uuid,text,uuid) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_finish(p_tenant uuid,p_delivery uuid,p_lease uuid,p_outcome text,p_provider uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter();
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  PERFORM public.newsletter_finish_internal(p_tenant,p_delivery,p_lease,p_outcome,p_provider);
  PERFORM public.newsletter_leave(previous);
END $$;

CREATE FUNCTION public.newsletter_settle_internal()
RETURNS void LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
  WITH done AS (
    SELECT c.tenant_id,c.id FROM public.newsletter_campaigns c
    WHERE c.status='sending' AND c.audience_resolved AND NOT EXISTS (
      SELECT FROM public.newsletter_deliveries d WHERE d.tenant_id=c.tenant_id AND d.campaign_id=c.id
        AND d.state IN ('queued','leased','dispatching','ambiguous','reconciling'))
    ORDER BY c.id LIMIT 100 FOR UPDATE OF c SKIP LOCKED
  )
  UPDATE public.newsletter_campaigns c SET status='sent' FROM done WHERE (c.tenant_id,c.id)=(done.tenant_id,done.id)
$$;
REVOKE ALL ON FUNCTION public.newsletter_settle_internal() FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_settle()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter();
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  PERFORM public.newsletter_settle_internal();
  PERFORM public.newsletter_leave(previous);
END $$;

CREATE FUNCTION public.newsletter_verify_test_sender_internal(p_tenant uuid,p_sender uuid,p_domain text)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  UPDATE public.newsletter_senders SET verified_at=coalesce(verified_at,clock_timestamp())
    WHERE tenant_id=p_tenant AND id=p_sender AND disabled_at IS NULL
      AND split_part(email,'@',2)=p_domain AND split_part(reply_to,'@',2)=p_domain AND p_domain LIKE '%.test';
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_verify_test_sender_internal(uuid,uuid,text) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_verify_test_sender(p_tenant uuid,p_sender uuid,p_domain text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter(); result boolean;
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  result:=public.newsletter_verify_test_sender_internal(p_tenant,p_sender,p_domain);
  PERFORM public.newsletter_leave(previous);
  RETURN result;
END $$;

-- Keep aggregates through CRM redaction and sever the recipient association.
CREATE FUNCTION public.newsletter_detach_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter();
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  UPDATE public.newsletter_deliveries SET contact_id=NULL,
    lease_id=CASE WHEN state IN ('queued','leased') THEN NULL ELSE lease_id END,
    lease_until=CASE WHEN state IN ('queued','leased') THEN NULL ELSE lease_until END,
    state=CASE WHEN state IN ('queued','leased') THEN 'cancelled' ELSE state END
    WHERE tenant_id=NEW.tenant_id AND contact_id=NEW.id;
  PERFORM public.newsletter_leave(previous);
  RETURN NEW;
END $$;
CREATE TRIGGER newsletter_detach_contact AFTER UPDATE OF erased_at ON public.contacts
  FOR EACH ROW WHEN (OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL)
  EXECUTE FUNCTION public.newsletter_detach_contact();

REVOKE ALL ON FUNCTION public.newsletter_due(),public.newsletter_stage(uuid,uuid,uuid,uuid[],boolean),
  public.newsletter_claim(integer),public.newsletter_start(uuid,uuid,uuid,text),
  public.newsletter_finish(uuid,uuid,uuid,text,uuid),public.newsletter_settle(),public.newsletter_verify_test_sender(uuid,uuid,text),
  public.newsletter_detach_contact(),public.newsletter_dispatch_current(public.newsletter_campaigns,public.newsletter_revisions)
  FROM PUBLIC,harvest_app;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_callback_internal(p_tenant uuid,p_event uuid,p_delivery uuid,p_provider uuid,
    p_outcome text,p_link integer,p_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.newsletter_deliveries; r public.newsletter_revisions; sub uuid;
BEGIN
  IF p_tenant IS NULL OR p_delivery IS NULL OR p_event IS NULL OR p_provider IS NULL OR p_at IS NULL
    OR p_at>clock_timestamp()+interval '5 minutes' OR p_outcome IS NULL OR
    p_outcome NOT IN ('delivered','opened','clicked','bounced','complained','unsubscribed')
    OR (p_outcome='clicked')<>(p_link IS NOT NULL) THEN RETURN false; END IF;
  PERFORM set_config('app.nl02_tenant',p_tenant::text,true);
  PERFORM set_config('app.tenant_id',p_tenant::text,true);
  SELECT * INTO d FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND id=p_delivery;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Same lock order as consent withdrawal, preference changes and dispatch.
  PERFORM 1 FROM public.contacts WHERE tenant_id=p_tenant AND id=d.contact_id AND erased_at IS NULL FOR UPDATE;
  SELECT * INTO d FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND id=p_delivery FOR UPDATE;
  IF d.attempts=0 OR d.state NOT IN ('dispatching','ambiguous','reconciling','accepted','unconfirmed')
    OR (d.provider_id IS NOT NULL AND d.provider_id<>p_provider)
    OR EXISTS(SELECT FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND provider_id=p_provider AND id<>p_delivery)
    THEN RETURN false; END IF;
  SELECT * INTO r FROM public.newsletter_revisions WHERE tenant_id=p_tenant AND campaign_id=d.campaign_id AND version=d.revision;
  IF p_link IS NOT NULL AND p_link NOT BETWEEN 1 AND r.link_count THEN RETURN false; END IF;
  INSERT INTO public.newsletter_delivery_events(tenant_id,id,delivery_id,outcome,link_id,occurred_at)
    VALUES(p_tenant,p_event,p_delivery,p_outcome,p_link,p_at)
    ON CONFLICT(tenant_id,id) DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  IF d.state<>'accepted' THEN
    UPDATE public.newsletter_deliveries SET state='accepted',provider_id=p_provider,accepted_at=least(p_at,clock_timestamp()),
      lease_id=NULL,lease_until=NULL WHERE tenant_id=p_tenant AND id=p_delivery;
  END IF;
  IF d.contact_id IS NULL THEN RETURN true; END IF;
  SELECT id INTO sub FROM public.newsletter_subscribers WHERE tenant_id=p_tenant AND contact_id=d.contact_id;
  IF p_outcome IN ('bounced','complained') THEN
    UPDATE public.newsletter_subscribers SET suppressed=true,version=version+1,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant AND id=sub AND NOT suppressed;
  ELSIF p_outcome='unsubscribed' AND r.list_id IS NOT NULL THEN
    UPDATE public.newsletter_subscriptions SET state='unsubscribed',consent_id=NULL,version=version+1,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant AND list_id=r.list_id AND subscriber_id=sub AND state='subscribed';
  ELSIF p_outcome='unsubscribed' AND NOT public.nl02_has_withdrawal(p_tenant,d.contact_id,NULL,false) THEN
    INSERT INTO public.contact_consents(tenant_id,contact_id,purpose,channel,status,source,evidence,notice_version,occurred_at)
      VALUES(p_tenant,d.contact_id,'newsletter','email','withdrawn','newsletter_subject_unsubscribe',
        'Subject requested all newsletter unsubscribe','newsletter-subject-v1',clock_timestamp());
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_callback_internal(uuid,uuid,uuid,uuid,text,integer,timestamptz) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_callback(p_tenant uuid,p_event uuid,p_delivery uuid,p_provider uuid,
    p_outcome text,p_link integer,p_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter(); result boolean;
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  PERFORM set_config('app.tenant_id','',true);
  PERFORM set_config('app.nl02_tenant','',true);
  result:=public.newsletter_callback_internal(p_tenant,p_event,p_delivery,p_provider,p_outcome,p_link,p_at);
  PERFORM public.newsletter_leave(previous);
  RETURN result;
END $$;

CREATE FUNCTION public.newsletter_report_internal(p_tenant uuid,p_campaign uuid,p_list uuid,p_from date,p_until date,p_zone text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb; start_at timestamptz; end_at timestamptz;
BEGIN
  IF NOT coalesce(public.newsletter_admin(p_tenant),false) OR
    (p_campaign IS NULL)=(p_list IS NULL) OR p_from IS NULL OR p_until IS NULL OR p_until-p_from NOT BETWEEN 1 AND 92 OR
    NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=p_zone) THEN RETURN NULL; END IF;
  IF p_campaign IS NOT NULL AND NOT EXISTS(SELECT FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=p_campaign)
    OR p_list IS NOT NULL AND NOT EXISTS(SELECT FROM public.newsletter_lists WHERE tenant_id=p_tenant AND id=p_list)
    THEN RETURN NULL; END IF;
  start_at:=p_from::timestamp AT TIME ZONE p_zone;
  end_at:=p_until::timestamp AT TIME ZONE p_zone;
  WITH deliveries AS MATERIALIZED (
    SELECT d.* FROM public.newsletter_deliveries d
      JOIN public.newsletter_revisions r ON (d.tenant_id,d.campaign_id,d.revision)=(r.tenant_id,r.campaign_id,r.version)
      WHERE d.tenant_id=p_tenant AND (d.campaign_id=p_campaign OR r.list_id=p_list) AND d.accepted_at IS NOT NULL
  ), events AS MATERIALIZED (
    SELECT e.delivery_id AS id,e.outcome,e.link_id,e.occurred_at,e.received_at,d.campaign_id,d.revision
    FROM public.newsletter_delivery_events e JOIN deliveries d ON (d.tenant_id,d.id)=(e.tenant_id,e.delivery_id)
    WHERE e.occurred_at>=start_at AND e.occurred_at<end_at
  ), metrics AS (
    SELECT id,'sent' AS outcome,accepted_at AS occurred_at FROM deliveries WHERE accepted_at>=start_at AND accepted_at<end_at
    UNION ALL
    SELECT id,outcome,min(occurred_at) FROM events GROUP BY id,outcome
  ), totals AS (
    SELECT outcome,count(*) AS amount FROM metrics GROUP BY outcome
  ), cohort AS (
    SELECT e.outcome,count(DISTINCT e.id) AS amount FROM events e JOIN deliveries d ON d.id=e.id
    WHERE d.accepted_at>=start_at AND d.accepted_at<end_at GROUP BY e.outcome
  ), hourly AS (
    SELECT date_trunc('hour',occurred_at,p_zone) AS hour,outcome,count(*) AS amount
    FROM metrics GROUP BY 1,2
  ), links AS (
    SELECT campaign_id,revision,link_id,count(*) AS amount FROM events WHERE link_id IS NOT NULL GROUP BY 1,2,3
  )
  SELECT jsonb_build_object(
    'counts',coalesce((SELECT jsonb_object_agg(outcome,amount) FROM totals),'{}'::jsonb),
    'cohort',coalesce((SELECT jsonb_object_agg(outcome,amount) FROM cohort),'{}'::jsonb),
    'hourly',coalesce((SELECT jsonb_agg(jsonb_build_object('hour',hour,'outcome',outcome,'count',amount) ORDER BY hour,outcome) FROM hourly),'[]'::jsonb),
    'links',coalesce((SELECT jsonb_agg(jsonb_build_object('campaignId',campaign_id,'revision',revision,'linkId',link_id,'count',amount)
      ORDER BY campaign_id,revision,link_id) FROM links),'[]'::jsonb),
    'acceptedThrough',(SELECT max(accepted_at) FROM deliveries WHERE accepted_at>=start_at AND accepted_at<end_at),
    'callbacksThrough',(SELECT max(received_at) FROM events)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_report_internal(uuid,uuid,uuid,date,date,text) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_report(p_tenant uuid,p_campaign uuid,p_list uuid,p_from date,p_until date,p_zone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter(); result jsonb;
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  result:=public.newsletter_report_internal(p_tenant,p_campaign,p_list,p_from,p_until,p_zone);
  PERFORM public.newsletter_leave(previous);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_callback(uuid,uuid,uuid,uuid,text,integer,timestamptz),
  public.newsletter_report(uuid,uuid,uuid,date,date,text) FROM PUBLIC,harvest_app;
GRANT EXECUTE ON FUNCTION public.newsletter_report(uuid,uuid,uuid,date,date,text) TO harvest_app;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker') THEN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit))
      OR EXISTS (SELECT FROM pg_auth_members WHERE member='harvest_worker'::regrole)
    THEN RAISE EXCEPTION 'harvest_worker must be unprivileged and have no role memberships'; END IF;
    GRANT EXECUTE ON FUNCTION public.newsletter_due(),public.newsletter_stage(uuid,uuid,uuid,uuid[],boolean),
      public.newsletter_claim(integer),public.newsletter_start(uuid,uuid,uuid,text),public.newsletter_finish(uuid,uuid,uuid,text,uuid),
      public.newsletter_settle(),public.newsletter_verify_test_sender(uuid,uuid,text),
      public.newsletter_callback(uuid,uuid,uuid,uuid,text,integer,timestamptz) TO harvest_worker;
  END IF;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.newsletter_reject_audience_internal(p_tenant uuid,p_campaign uuid,p_after uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=p_campaign
    AND status IN ('scheduled','sending') AND scheduled_for<=clock_timestamp() AND NOT audience_resolved
    AND audience_cursor IS NOT DISTINCT FROM p_after FOR UPDATE;
  IF FOUND THEN PERFORM public.newsletter_cancel_pending(p_tenant,p_campaign); END IF;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_reject_audience_internal(uuid,uuid,uuid) FROM PUBLIC,harvest_app;

CREATE FUNCTION public.newsletter_reject_audience(p_tenant uuid,p_campaign uuid,p_after uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text[]:=public.newsletter_enter();
BEGIN
  PERFORM set_config('app.newsletter_internal','on',true);
  PERFORM public.newsletter_reject_audience_internal(p_tenant,p_campaign,p_after);
  PERFORM public.newsletter_leave(previous);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_reject_audience(uuid,uuid,uuid) FROM PUBLIC,harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.newsletter_reject_audience(uuid,uuid,uuid) TO harvest_worker;
  END IF;
END $$;
