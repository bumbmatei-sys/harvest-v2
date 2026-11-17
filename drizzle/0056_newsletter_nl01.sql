CREATE TABLE "newsletter_audiences" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_audiences_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_audience_name" CHECK (length(trim("newsletter_audiences"."name")) between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "newsletter_import_provenance" (
	"tenant_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"source" text NOT NULL,
	"import_id" uuid,
	"row_number" integer,
	"imported_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_import_provenance_tenant_id_subscriber_id_pk" PRIMARY KEY("tenant_id","subscriber_id"),
	CONSTRAINT "newsletter_import_provenance" CHECK (("newsletter_import_provenance"."source"='manual' and "newsletter_import_provenance"."import_id" is null and "newsletter_import_provenance"."row_number" is null and "newsletter_import_provenance"."imported_at" is null) or ("newsletter_import_provenance"."source"='csv_import' and "newsletter_import_provenance"."import_id" is not null and "newsletter_import_provenance"."row_number" is not null and "newsletter_import_provenance"."row_number">0 and "newsletter_import_provenance"."imported_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "newsletter_lists" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"audience_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_lists_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_list_name" CHECK (length(trim("newsletter_lists"."name")) between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "newsletter_segments" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"audience_id" uuid NOT NULL,
	"saved_view_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_segments_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_segment_name" CHECK (length(trim("newsletter_segments"."name")) between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_subscribers_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_subscriber_version" CHECK ("newsletter_subscribers"."version">=1),
	CONSTRAINT "newsletter_tags_count" CHECK (cardinality("newsletter_subscribers"."tags")<=50)
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscriptions" (
	"tenant_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"state" text NOT NULL,
	"consent_id" uuid,
	"purpose" text DEFAULT 'newsletter' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_subscriptions_tenant_id_list_id_subscriber_id_pk" PRIMARY KEY("tenant_id","list_id","subscriber_id"),
	CONSTRAINT "newsletter_subscription_state" CHECK ("newsletter_subscriptions"."state" in ('subscribed','unsubscribed','bounced','suppressed')),
	CONSTRAINT "newsletter_subscription_purpose" CHECK ("newsletter_subscriptions"."purpose"='newsletter'),
	CONSTRAINT "newsletter_subscription_consent" CHECK ("newsletter_subscriptions"."state"<>'subscribed' or "newsletter_subscriptions"."consent_id" is not null),
	CONSTRAINT "newsletter_subscription_version" CHECK ("newsletter_subscriptions"."version">=1)
);
--> statement-breakpoint
ALTER TABLE "newsletter_audiences" ADD CONSTRAINT "newsletter_audiences_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_audiences" ADD CONSTRAINT "newsletter_audiences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_import_provenance" ADD CONSTRAINT "newsletter_import_provenance_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_import_provenance" ADD CONSTRAINT "newsletter_import_provenance_tenant_id_subscriber_id_newsletter_subscribers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","subscriber_id") REFERENCES "public"."newsletter_subscribers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_import_provenance" ADD CONSTRAINT "newsletter_import_provenance_tenant_id_import_id_crm_imports_tenant_id_id_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."crm_imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_lists" ADD CONSTRAINT "newsletter_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_lists" ADD CONSTRAINT "newsletter_lists_tenant_id_audience_id_newsletter_audiences_tenant_id_id_fk" FOREIGN KEY ("tenant_id","audience_id") REFERENCES "public"."newsletter_audiences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_segments" ADD CONSTRAINT "newsletter_segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_segments" ADD CONSTRAINT "newsletter_segments_tenant_id_audience_id_newsletter_audiences_tenant_id_id_fk" FOREIGN KEY ("tenant_id","audience_id") REFERENCES "public"."newsletter_audiences"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_segments" ADD CONSTRAINT "newsletter_segments_tenant_id_saved_view_id_crm_saved_views_tenant_id_id_fk" FOREIGN KEY ("tenant_id","saved_view_id") REFERENCES "public"."crm_saved_views"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_tenant_id_list_id_newsletter_lists_tenant_id_id_fk" FOREIGN KEY ("tenant_id","list_id") REFERENCES "public"."newsletter_lists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_tenant_id_subscriber_id_newsletter_subscribers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","subscriber_id") REFERENCES "public"."newsletter_subscribers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_tenant_id_consent_id_contact_consents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","consent_id") REFERENCES "public"."contact_consents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_contact_unique" ON "newsletter_subscribers" USING btree ("tenant_id","contact_id");--> statement-breakpoint
-- NL-01: canonical contacts and consent ledger only. No sender or provider capability.
DO $$ DECLARE rel text; BEGIN
 FOREACH rel IN ARRAY ARRAY['newsletter_audiences','newsletter_lists','newsletter_subscribers','newsletter_subscriptions','newsletter_segments'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',rel);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app',rel);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO harvest_app',rel);
 EXECUTE format($p$CREATE POLICY newsletter_read ON public.%I FOR SELECT TO harvest_app USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.workspace_members w WHERE w.tenant_id=%I.tenant_id AND w.user_id=nullif(current_setting('app.user_id',true),'') AND w.role_id IN ('owner','admin','member')))$p$,rel,rel);
 EXECUTE format($p$CREATE POLICY newsletter_insert ON public.%I FOR INSERT TO harvest_app WITH CHECK (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.workspace_members w WHERE w.tenant_id=%I.tenant_id AND w.user_id=nullif(current_setting('app.user_id',true),'') AND w.role_id IN ('owner','admin')))$p$,rel,rel);
 EXECUTE format($p$CREATE POLICY newsletter_update ON public.%I FOR UPDATE TO harvest_app USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.workspace_members w WHERE w.tenant_id=%I.tenant_id AND w.user_id=nullif(current_setting('app.user_id',true),'') AND w.role_id IN ('owner','admin')))
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.workspace_members w WHERE w.tenant_id=%I.tenant_id AND w.user_id=nullif(current_setting('app.user_id',true),'') AND w.role_id IN ('owner','admin')))$p$,rel,rel,rel);
 END LOOP;
END $$;
--> statement-breakpoint
-- Defense-in-depth SQL twin of the existing gate, not a new consent source. Parity-tested against mayContact.
CREATE FUNCTION public.newsletter_consent_allowed(p_tenant uuid,p_contact uuid,p_consent uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.contacts WHERE tenant_id=p_tenant AND id=p_contact AND erased_at IS NULL)
 AND p_consent=(SELECT c.id FROM public.contact_consents c WHERE c.tenant_id=p_tenant AND c.contact_id=p_contact AND c.purpose='newsletter' AND c.channel='email' AND c.redacted_at IS NULL ORDER BY c.recorded_at DESC,c.occurred_at DESC,c.id DESC LIMIT 1)
 AND EXISTS(SELECT 1 FROM public.contact_consents c WHERE c.tenant_id=p_tenant AND c.id=p_consent AND c.contact_id=p_contact AND c.purpose='newsletter' AND c.channel='email' AND c.status='granted' AND c.redacted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.contact_consents w WHERE w.tenant_id=p_tenant AND w.contact_id=p_contact AND w.purpose='newsletter' AND w.status='withdrawn' AND w.redacted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.contact_consents g WHERE g.tenant_id=w.tenant_id AND g.contact_id=w.contact_id AND g.purpose=w.purpose AND g.channel=w.channel AND g.status='granted' AND g.redacted_at IS NULL AND g.recorded_at>w.recorded_at AND g.occurred_at>w.occurred_at))
$$;
--> statement-breakpoint
CREATE FUNCTION public.newsletter_subscriber_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.tenant_id,NEW.id,NEW.contact_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.contact_id,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'newsletter_identity_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.suppressed AND NOT NEW.suppressed THEN RAISE EXCEPTION 'newsletter_suppression_final' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id',true),'') THEN RAISE EXCEPTION 'newsletter_actor' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public.contacts WHERE tenant_id=NEW.tenant_id AND id=NEW.contact_id AND erased_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'newsletter_contact_unavailable' USING ERRCODE='23514'; END IF;
 IF cardinality(NEW.tags)>50 OR EXISTS(SELECT 1 FROM unnest(NEW.tags) t WHERE t IS NULL OR t !~ '^[a-z0-9][a-z0-9_-]{0,39}$') THEN RAISE EXCEPTION 'newsletter_tags_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER newsletter_subscriber_guard BEFORE INSERT OR UPDATE ON public.newsletter_subscribers FOR EACH ROW EXECUTE FUNCTION public.newsletter_subscriber_guard();
--> statement-breakpoint
CREATE FUNCTION public.newsletter_subscription_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record; cid uuid;
BEGIN
 SELECT contact_id INTO cid FROM public.newsletter_subscribers WHERE tenant_id=NEW.tenant_id AND id=NEW.subscriber_id;
 PERFORM 1 FROM public.contacts WHERE tenant_id=NEW.tenant_id AND id=cid AND erased_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'newsletter_contact_unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM public.newsletter_subscribers WHERE tenant_id=NEW.tenant_id AND id=NEW.subscriber_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'newsletter_subscriber_unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.tenant_id,NEW.list_id,NEW.subscriber_id,NEW.created_at) IS DISTINCT FROM (OLD.tenant_id,OLD.list_id,OLD.subscriber_id,OLD.created_at) THEN RAISE EXCEPTION 'newsletter_identity_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.state='suppressed' AND NEW.state<>'suppressed' THEN RAISE EXCEPTION 'newsletter_suppression_final' USING ERRCODE='23514'; END IF;
 IF NEW.state='subscribed' AND (s.suppressed OR NOT coalesce(public.newsletter_consent_allowed(NEW.tenant_id,s.contact_id,NEW.consent_id),false)) THEN RAISE EXCEPTION 'newsletter_consent_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER newsletter_subscription_guard BEFORE INSERT OR UPDATE ON public.newsletter_subscriptions FOR EACH ROW EXECUTE FUNCTION public.newsletter_subscription_guard();
--> statement-breakpoint
-- Segment references must remain canonical CRM shared person views; no new predicate grammar.
CREATE FUNCTION public.newsletter_segment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.crm_saved_views v WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.saved_view_id AND v.object_type='person' AND v.owner_user_id IS NULL AND coalesce(v.state->'sources','[]'::jsonb)='[]'::jsonb) THEN RAISE EXCEPTION 'newsletter_view_unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER newsletter_segment_guard BEFORE INSERT OR UPDATE ON public.newsletter_segments FOR EACH ROW EXECUTE FUNCTION public.newsletter_segment_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.newsletter_consent_allowed(uuid,uuid,uuid),public.newsletter_subscriber_guard(),public.newsletter_subscription_guard(),public.newsletter_segment_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_consent_allowed(uuid,uuid,uuid) TO harvest_app;

--> statement-breakpoint
ALTER TABLE public.newsletter_import_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_import_provenance FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_import_provenance FROM PUBLIC,harvest_app;
GRANT SELECT,INSERT ON public.newsletter_import_provenance TO harvest_app;
CREATE POLICY newsletter_provenance ON public.newsletter_import_provenance TO harvest_app
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.workspace_members w WHERE w.tenant_id=newsletter_import_provenance.tenant_id AND w.user_id=nullif(current_setting('app.user_id',true),'') AND w.role_id IN ('owner','admin')))
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by=nullif(current_setting('app.user_id',true),'') AND EXISTS(SELECT 1 FROM public.workspace_members w WHERE w.tenant_id=newsletter_import_provenance.tenant_id AND w.user_id=nullif(current_setting('app.user_id',true),'') AND w.role_id IN ('owner','admin')));
CREATE FUNCTION public.newsletter_provenance_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.source='csv_import' AND NOT EXISTS(SELECT 1 FROM public.newsletter_subscribers s JOIN public.contact_source_events e ON e.tenant_id=s.tenant_id AND e.contact_id=s.contact_id JOIN public.crm_imports i ON i.tenant_id=e.tenant_id AND i.id=e.import_id
 WHERE s.tenant_id=NEW.tenant_id AND s.id=NEW.subscriber_id AND e.kind='csv_import' AND e.import_id=NEW.import_id AND e.row_number=NEW.row_number AND e.reverted_at IS NULL AND i.entity='person') THEN RAISE EXCEPTION 'newsletter_import_unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER newsletter_provenance_guard BEFORE INSERT ON public.newsletter_import_provenance FOR EACH ROW EXECUTE FUNCTION public.newsletter_provenance_guard();
REVOKE ALL ON FUNCTION public.newsletter_provenance_guard() FROM PUBLIC;
