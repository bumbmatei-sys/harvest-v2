-- Newsletter link-click counting (founder decisions 26 Nov 2026). Clicks only: no opens, no tracking pixel, no IP address, user agent or device data.
-- Totals only: counts per campaign, per UTC day and per link, with groups under 5 withheld, readable through one definer by owners and admins
-- (newsletter:analytics). Nobody can see who clicked: no app grant reaches the click rows. Off by default per ministry; the owner turns it on.
-- 1. newsletter_settings: one row per ministry. The app reads it (owners and admins) and only an owner may write it (RLS through public.access_role).
--    A trigger sets click_tracking_since from the database clock when counting is turned on and clears it when it is turned off.
-- 2. newsletter_click_links: the content links of a frozen revision by position, written only by the delivery worker. The redirect reads the URL here.
-- 3. newsletter_clicks: at most one row per delivery and link (the redirect is idempotent), for 90 days; then newsletter_purge_clicks (worker only,
--    the newsletter:purge:test command) rolls them into the anonymous newsletter_click_counts and deletes them.
-- 4. newsletter_delivery_authorize (0109) is replaced with the same body plus campaignId, revision and clickTracking in its result. Links are counted
--    only when counting was already on when the campaign was frozen and is still on (turning it off stops new rewriting and new counting at once).
-- 5. Every definer pins search_path, schema-qualifies names, checks roles through public.access_role and restores the app.* settings it changes.
-- Nothing is backfilled (all four tables start empty), so no FORCE RLS backfill handling is needed. Sending stays off; no worker or schedule is installed.
CREATE TABLE "newsletter_click_counts" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"day" date NOT NULL,
	"link_index" integer NOT NULL,
	"count" bigint NOT NULL,
	CONSTRAINT "newsletter_click_counts_tenant_id_campaign_id_revision_day_link_index_pk" PRIMARY KEY("tenant_id","campaign_id","revision","day","link_index"),
	CONSTRAINT "newsletter_click_count_positive" CHECK ("newsletter_click_counts"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "newsletter_click_links" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"link_index" integer NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "newsletter_click_links_tenant_id_campaign_id_revision_link_index_pk" PRIMARY KEY("tenant_id","campaign_id","revision","link_index"),
	CONSTRAINT "newsletter_click_link_url" UNIQUE("tenant_id","campaign_id","revision","url"),
	CONSTRAINT "newsletter_click_link_shape" CHECK ("newsletter_click_links"."link_index" between 0 and 199 and "newsletter_click_links"."url" ~ '^https://' and char_length("newsletter_click_links"."url") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "newsletter_clicks" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"delivery_id" uuid NOT NULL,
	"link_index" integer NOT NULL,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_clicks_tenant_id_delivery_id_link_index_pk" PRIMARY KEY("tenant_id","delivery_id","link_index")
);
--> statement-breakpoint
CREATE TABLE "newsletter_settings" (
	"tenant_id" uuid NOT NULL,
	"click_tracking" boolean DEFAULT false NOT NULL,
	"click_tracking_since" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_settings_tenant_id_pk" PRIMARY KEY("tenant_id"),
	CONSTRAINT "newsletter_settings_click_since" CHECK ("newsletter_settings"."click_tracking" = ("newsletter_settings"."click_tracking_since" is not null))
);
--> statement-breakpoint
ALTER TABLE "newsletter_click_counts" ADD CONSTRAINT "newsletter_click_count_link_fk" FOREIGN KEY ("tenant_id","campaign_id","revision","link_index") REFERENCES "public"."newsletter_click_links"("tenant_id","campaign_id","revision","link_index") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_click_links" ADD CONSTRAINT "newsletter_click_link_revision_fk" FOREIGN KEY ("tenant_id","campaign_id","revision") REFERENCES "public"."newsletter_campaign_revisions"("tenant_id","campaign_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_clicks" ADD CONSTRAINT "newsletter_click_link_fk" FOREIGN KEY ("tenant_id","campaign_id","revision","link_index") REFERENCES "public"."newsletter_click_links"("tenant_id","campaign_id","revision","link_index") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_settings" ADD CONSTRAINT "newsletter_settings_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_click_retention_idx" ON "newsletter_clicks" USING btree ("clicked_at");--> statement-breakpoint
CREATE INDEX "newsletter_click_campaign_idx" ON "newsletter_clicks" USING btree ("tenant_id","campaign_id","clicked_at");--> statement-breakpoint
-- Row-level security and grants follow the existing newsletter tables: forced RLS, nothing for PUBLIC or the worker login, and a definer-owner policy
-- scoped by app.nl_send_tenant (or the worker flag inside a worker definer).
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['newsletter_settings','newsletter_click_links','newsletter_clicks','newsletter_click_counts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,harvest_app',rel);
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='harvest_worker') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM harvest_worker',rel);
    END IF;
    EXECUTE format($p$CREATE POLICY newsletter_click_owner ON public.%I TO %I
      USING ((session_user='harvest_worker' AND pg_catalog.current_setting('app.nl_send_worker',true)='on')
           OR tenant_id=nullif(pg_catalog.current_setting('app.nl_send_tenant',true),'')::uuid)
      WITH CHECK (tenant_id=nullif(pg_catalog.current_setting('app.nl_send_tenant',true),'')::uuid
           OR (session_user='harvest_worker' AND pg_catalog.current_setting('app.nl_send_worker',true)='on'))$p$,rel,current_user);
  END LOOP;
END $$;
--> statement-breakpoint
-- The app reads the setting as an owner or admin and writes it only as the owner. Roles come from public.access_role (0113 guard).
GRANT SELECT ON public.newsletter_settings TO harvest_app;
-- click_tracking_since and updated_at are listed only because an ORM insert names every column; the guard trigger overwrites both.
GRANT INSERT (tenant_id,click_tracking,click_tracking_since,version,updated_at) ON public.newsletter_settings TO harvest_app;
GRANT UPDATE (click_tracking,version) ON public.newsletter_settings TO harvest_app;
CREATE POLICY newsletter_settings_read ON public.newsletter_settings FOR SELECT TO harvest_app
  USING (tenant_id=nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=newsletter_settings.tenant_id
      AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.newsletter_capability(public.access_role(m.tenant_id,m.user_id,'newsletter',m.role_id),'newsletter:campaigns')));
CREATE POLICY newsletter_settings_owner_insert ON public.newsletter_settings FOR INSERT TO harvest_app
  WITH CHECK (tenant_id=nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=newsletter_settings.tenant_id
      AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.access_role(m.tenant_id,m.user_id,'newsletter',m.role_id)='owner'));
CREATE POLICY newsletter_settings_owner_update ON public.newsletter_settings FOR UPDATE TO harvest_app
  USING (tenant_id=nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=newsletter_settings.tenant_id
      AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.access_role(m.tenant_id,m.user_id,'newsletter',m.role_id)='owner'))
  WITH CHECK (tenant_id=nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=newsletter_settings.tenant_id
      AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.access_role(m.tenant_id,m.user_id,'newsletter',m.role_id)='owner'));
--> statement-breakpoint
-- The database clock decides when counting started; the version moves by one on every change.
CREATE FUNCTION public.newsletter_settings_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 THEN RAISE check_violation; END IF;
    NEW.click_tracking_since:=CASE WHEN NEW.click_tracking THEN pg_catalog.clock_timestamp() END;
  ELSE
    IF NEW.tenant_id<>OLD.tenant_id OR NEW.version<>OLD.version+1 THEN RAISE check_violation; END IF;
    NEW.click_tracking_since:=CASE WHEN NOT NEW.click_tracking THEN NULL WHEN OLD.click_tracking THEN OLD.click_tracking_since
      ELSE pg_catalog.clock_timestamp() END;
  END IF;
  NEW.updated_at:=pg_catalog.clock_timestamp();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_settings_guard() FROM PUBLIC,harvest_app;
CREATE TRIGGER newsletter_settings_guard BEFORE INSERT OR UPDATE ON public.newsletter_settings
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_settings_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.newsletter_delivery_authorize(p_tenant uuid,p_key uuid,p_lease uuid,p_nonce text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.newsletter_deliveries; c public.newsletter_campaigns; r public.newsletter_campaign_revisions;
  subscriber public.newsletter_subscribers; contact public.contacts; subscription public.newsletter_subscriptions;
  address record; fingerprint record; assets jsonb; sender text; sender_name text; reply text; ministry text; reason text; consent uuid;
  counting boolean;
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
    SELECT i.address, i.display_name INTO sender, sender_name FROM public.newsletter_identities i JOIN public.newsletter_connections cfg
      ON cfg.tenant_id=i.tenant_id AND cfg.id=i.connection_id
      WHERE i.tenant_id=p_tenant AND i.id=r.sender_id AND i.version=c.sender_version AND cfg.version=c.sender_domain_version
        AND i.ownership_verified AND i.enabled AND i.purpose='sender'
        AND cfg.ownership AND cfg.spf AND cfg.dkim AND cfg.bounce AND cfg.dmarc
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
  -- 0126: links are counted only when counting was on when the campaign was frozen and is still on now.
  SELECT coalesce(s.click_tracking AND s.click_tracking_since<=c.frozen_at,false) INTO counting
    FROM public.newsletter_settings s WHERE s.tenant_id=p_tenant;
  INSERT INTO public.newsletter_preference_tokens(token_hash,tenant_id,subscriber_id,list_id,scope,email_proof,expires_at)
    VALUES(public.nl02_hash(p_nonce),p_tenant,subscriber.id,d.list_id,'list',
      public.nl02_hash(p_nonce||':'||address.normalized_value),clock_timestamp()+interval '30 days');
  UPDATE public.newsletter_campaigns SET state='sending',version=version+1 WHERE tenant_id=p_tenant AND id=c.id AND state='scheduled';
  SELECT * INTO STRICT fingerprint FROM public.newsletter_suppression_digests(p_tenant,address.normalized_value)
    WHERE write_key;
  UPDATE public.newsletter_deliveries SET state='unknown',attempted_at=clock_timestamp(),
    attempted_address_hash=fingerprint.address_hash,attempted_key_version=fingerprint.key_version
    WHERE tenant_id=p_tenant AND id=p_key;
  RETURN jsonb_build_object('email',address.normalized_value,'firstName',split_part(btrim(contact.name),' ',1),'ministryName',ministry,
    'from',sender,'fromName',sender_name,'replyTo',reply,'content',r.content,'subject',r.subject,'preheader',r.preheader,'images',assets,
    'campaignId',c.id,'revision',c.revision,'clickTracking',coalesce(counting,false));
END $$;
--> statement-breakpoint
-- Worker only: stores the content links of the delivery's frozen revision (new ones get the next position) and returns the whole list by position.
-- Returns NULL unless the delivery is this worker's attempted lease and counting applies to its campaign.
CREATE FUNCTION public.newsletter_click_links_store(p_tenant uuid,p_key uuid,p_lease uuid,p_urls text[]) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true);
  d record; link text; stored text[];
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_tenant IS NULL OR p_key IS NULL OR p_lease IS NULL OR p_urls IS NULL OR pg_catalog.cardinality(p_urls)>200 THEN
    RAISE invalid_parameter_value; END IF;
  FOREACH link IN ARRAY p_urls LOOP
    IF link IS NULL OR link !~ '^https://' OR pg_catalog.char_length(link)>2000 THEN RAISE invalid_parameter_value; END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT x.campaign_id,x.revision INTO d FROM public.newsletter_deliveries x
    JOIN public.newsletter_campaigns c ON c.tenant_id=x.tenant_id AND c.id=x.campaign_id AND c.revision=x.revision
    JOIN public.newsletter_settings s ON s.tenant_id=x.tenant_id AND s.click_tracking AND s.click_tracking_since<=c.frozen_at
    WHERE x.tenant_id=p_tenant AND x.id=p_key AND x.lease=p_lease AND x.state='unknown' AND x.attempted_at IS NOT NULL;
  IF NOT FOUND THEN
    PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
    RETURN NULL;
  END IF;
  -- One worker at a time numbers a revision's links.
  PERFORM 1 FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=d.campaign_id FOR UPDATE;
  FOREACH link IN ARRAY p_urls LOOP
    INSERT INTO public.newsletter_click_links(tenant_id,campaign_id,revision,link_index,url)
      SELECT p_tenant,d.campaign_id,d.revision,coalesce(max(l.link_index)+1,0),link FROM public.newsletter_click_links l
        WHERE l.tenant_id=p_tenant AND l.campaign_id=d.campaign_id AND l.revision=d.revision
        HAVING count(*)<200 AND NOT coalesce(pg_catalog.bool_or(l.url=link),false)
      ON CONFLICT (tenant_id,campaign_id,revision,url) DO NOTHING;
  END LOOP;
  SELECT coalesce(pg_catalog.array_agg(l.url ORDER BY l.link_index),'{}'::text[]) INTO stored FROM public.newsletter_click_links l
    WHERE l.tenant_id=p_tenant AND l.campaign_id=d.campaign_id AND l.revision=d.revision;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  RETURN stored;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_click_links_store(uuid,uuid,uuid,text[]) FROM PUBLIC,harvest_app;
--> statement-breakpoint
-- The public redirect (any caller with a verified token): returns the frozen URL for the link, or NULL. Records at most one click per delivery and
-- link, only while counting applies and the delivery record still exists. Reads and writes nothing about the person and never changes a subscription.
CREATE FUNCTION public.newsletter_click(p_tenant uuid,p_campaign uuid,p_revision integer,p_delivery uuid,p_link integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true); target text;
BEGIN
  IF p_tenant IS NULL OR p_campaign IS NULL OR p_revision IS NULL OR p_delivery IS NULL OR p_link IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT l.url INTO target FROM public.newsletter_click_links l
    WHERE l.tenant_id=p_tenant AND l.campaign_id=p_campaign AND l.revision=p_revision AND l.link_index=p_link;
  IF target IS NOT NULL AND EXISTS (
      SELECT FROM public.newsletter_campaigns c JOIN public.newsletter_settings s ON s.tenant_id=c.tenant_id
      WHERE c.tenant_id=p_tenant AND c.id=p_campaign AND c.revision=p_revision AND s.click_tracking AND s.click_tracking_since<=c.frozen_at)
    AND EXISTS (SELECT FROM public.newsletter_deliveries d WHERE d.tenant_id=p_tenant AND d.id=p_delivery
      AND d.campaign_id=p_campaign AND d.revision=p_revision AND d.attempted_at IS NOT NULL) THEN
    INSERT INTO public.newsletter_clicks(tenant_id,campaign_id,revision,delivery_id,link_index,clicked_at)
      VALUES (p_tenant,p_campaign,p_revision,p_delivery,p_link,pg_catalog.clock_timestamp())
      ON CONFLICT (tenant_id,delivery_id,link_index) DO NOTHING;
  END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  RETURN target;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_click(uuid,uuid,integer,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_click(uuid,uuid,integer,uuid,integer) TO harvest_app;
--> statement-breakpoint
-- HEAD requests (often link scanners): the frozen URL only, nothing counted.
CREATE FUNCTION public.newsletter_click_target(p_tenant uuid,p_campaign uuid,p_revision integer,p_link integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true); target text;
BEGIN
  IF p_tenant IS NULL OR p_campaign IS NULL OR p_revision IS NULL OR p_link IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT l.url INTO target FROM public.newsletter_click_links l
    WHERE l.tenant_id=p_tenant AND l.campaign_id=p_campaign AND l.revision=p_revision AND l.link_index=p_link;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  RETURN target;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_click_target(uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_click_target(uuid,uuid,integer,integer) TO harvest_app;
--> statement-breakpoint
-- Aggregate click report for owners and admins (newsletter:analytics). UTC days, at most 90. Withheld (null): any campaign-day under 5 hides that
-- day, the period total and the campaign's row; a campaign whose recipients are a group under 5 never shows clicks; links under 5 are left out, and
-- when that leaves one link or fewer than 5 clicks unaccounted for, the smallest shown link is left out too, so no small figure can be subtracted.
CREATE FUNCTION public.newsletter_click_report(p_tenant uuid,p_campaign uuid,p_from date,p_until date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true); result jsonb;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.newsletter_capability(public.access_role(m.tenant_id,m.user_id,'newsletter',m.role_id),'newsletter:analytics')) THEN
    RAISE insufficient_privilege;
  END IF;
  IF p_until IS NULL OR p_from IS NULL OR p_until-p_from NOT BETWEEN 1 AND 90 THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  WITH raw AS (
    SELECT k.campaign_id,k.revision,(k.clicked_at AT TIME ZONE 'UTC')::date AS day,k.link_index,count(*)::bigint AS n
    FROM public.newsletter_clicks k WHERE k.tenant_id=p_tenant AND (p_campaign IS NULL OR k.campaign_id=p_campaign)
      AND k.clicked_at>=p_from::timestamp AT TIME ZONE 'UTC' AND k.clicked_at<p_until::timestamp AT TIME ZONE 'UTC'
    GROUP BY 1,2,3,4
    UNION ALL
    SELECT a.campaign_id,a.revision,a.day,a.link_index,a.count FROM public.newsletter_click_counts a
    WHERE a.tenant_id=p_tenant AND (p_campaign IS NULL OR a.campaign_id=p_campaign) AND a.day>=p_from AND a.day<p_until
  ), small_cohorts AS (
    SELECT x.campaign_id FROM (
      SELECT d.campaign_id,count(*)::bigint AS n FROM public.newsletter_deliveries d
        WHERE d.tenant_id=p_tenant AND d.campaign_id IN (SELECT campaign_id FROM raw) GROUP BY 1
      UNION ALL
      SELECT a.campaign_id,a.count FROM public.newsletter_archived_counts a
        WHERE a.tenant_id=p_tenant AND a.metric='selected' AND a.campaign_id IN (SELECT campaign_id FROM raw)
    ) x GROUP BY 1 HAVING sum(x.n)<5
  ), campaign_day AS (
    SELECT campaign_id,day,sum(n)::bigint AS n FROM raw GROUP BY 1,2
  ), small_campaigns AS (
    SELECT DISTINCT campaign_id FROM campaign_day WHERE n<5 UNION SELECT campaign_id FROM small_cohorts
  ), small_days AS (
    SELECT DISTINCT day FROM campaign_day WHERE campaign_id IN (SELECT campaign_id FROM small_campaigns)
  ), daily AS (
    SELECT day,sum(n)::bigint AS n FROM campaign_day GROUP BY 1
  ), per_campaign AS (
    SELECT campaign_id,sum(n)::bigint AS n FROM campaign_day GROUP BY 1
  ), links AS (
    SELECT r.campaign_id,r.revision,r.link_index,sum(r.n)::bigint AS n FROM raw r
    WHERE p_campaign IS NOT NULL AND r.campaign_id NOT IN (SELECT campaign_id FROM small_cohorts) GROUP BY 1,2,3
  ), hidden AS (
    SELECT count(*) FILTER (WHERE n<5) AS links,coalesce(sum(n) FILTER (WHERE n<5),0) AS clicks FROM links
  ), ranked AS (
    SELECT l.*,row_number() OVER (ORDER BY l.n,l.revision DESC,l.link_index DESC) AS smallest FROM links l WHERE l.n>=5
  ), shown AS (
    SELECT r.* FROM ranked r,hidden h WHERE NOT (h.links>0 AND (h.links=1 OR h.clicks<5) AND r.smallest=1)
  )
  SELECT jsonb_build_object(
    'total',CASE WHEN EXISTS (SELECT FROM small_days) THEN NULL ELSE coalesce((SELECT sum(n) FROM daily),0) END,
    'days',coalesce((SELECT jsonb_agg(jsonb_build_object('day',pg_catalog.to_char(d.day,'YYYY-MM-DD'),
      'clicks',CASE WHEN d.day IN (SELECT day FROM small_days) THEN NULL ELSE d.n END) ORDER BY d.day) FROM daily d),'[]'::jsonb),
    'campaigns',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.campaign_id,
      'clicks',CASE WHEN c.campaign_id IN (SELECT campaign_id FROM small_campaigns) THEN NULL ELSE c.n END) ORDER BY c.campaign_id) FROM per_campaign c),'[]'::jsonb),
    'links',coalesce((SELECT jsonb_agg(jsonb_build_object('url',u.url,'clicks',t.n) ORDER BY t.n DESC,u.url)
      FROM (SELECT * FROM shown ORDER BY n DESC,link_index LIMIT 10) t JOIN public.newsletter_click_links u
        ON u.tenant_id=p_tenant AND u.campaign_id=t.campaign_id AND u.revision=t.revision AND u.link_index=t.link_index),'[]'::jsonb)
  ) INTO result;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_click_report(uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_click_report(uuid,uuid,date,date) TO harvest_app;
--> statement-breakpoint
-- Worker only (the newsletter:purge:test command): click rows older than 90 days become anonymous campaign/day/link counts in the same statement.
CREATE FUNCTION public.newsletter_purge_clicks(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_worker text:=pg_catalog.current_setting('app.nl_send_worker',true);
  cutoff timestamptz:=pg_catalog.clock_timestamp()-interval '2160 hours'; purged integer;
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5000 THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_worker','on',true);
  WITH candidates AS (
    SELECT tenant_id,delivery_id,link_index FROM public.newsletter_clicks WHERE clicked_at<=cutoff
    ORDER BY clicked_at,tenant_id,delivery_id,link_index LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.newsletter_clicks k USING candidates c
    WHERE k.tenant_id=c.tenant_id AND k.delivery_id=c.delivery_id AND k.link_index=c.link_index
    RETURNING k.tenant_id,k.campaign_id,k.revision,k.link_index,k.clicked_at
  ), rolled_up AS (
    INSERT INTO public.newsletter_click_counts AS a(tenant_id,campaign_id,revision,day,link_index,count)
    SELECT tenant_id,campaign_id,revision,(clicked_at AT TIME ZONE 'UTC')::date,link_index,count(*) FROM deleted GROUP BY 1,2,3,4,5
    ON CONFLICT (tenant_id,campaign_id,revision,day,link_index) DO UPDATE SET count=a.count+excluded.count
  )
  SELECT count(*) INTO purged FROM deleted;
  PERFORM pg_catalog.set_config('app.nl_send_worker',coalesce(prior_worker,''),true);
  RETURN purged;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_purge_clicks(integer) FROM PUBLIC,harvest_app;
--> statement-breakpoint
-- Hosted sign-up forms: whether the form's ministry counts link clicks, so the page can say so. Nothing else about the ministry is returned.
CREATE FUNCTION public.newsletter_form_counts_clicks(p_slug text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_slug text:=pg_catalog.current_setting('app.crm_forms_slug',true);
  prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true); tenant uuid; counting boolean;
BEGIN
  IF public.valid_crm_form_slug(p_slug) IS NOT TRUE THEN RETURN false; END IF;
  PERFORM pg_catalog.set_config('app.crm_forms_slug',p_slug,true);
  SELECT a.tenant_id INTO tenant FROM public.crm_form_addresses a WHERE a.slug=p_slug AND a.retired_at IS NULL;
  PERFORM pg_catalog.set_config('app.crm_forms_slug',coalesce(prior_slug,''),true);
  IF tenant IS NOT NULL THEN
    PERFORM pg_catalog.set_config('app.nl_send_tenant',tenant::text,true);
    SELECT s.click_tracking INTO counting FROM public.newsletter_settings s WHERE s.tenant_id=tenant;
    PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  END IF;
  RETURN coalesce(counting,false);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_form_counts_clicks(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_form_counts_clicks(text) TO harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.newsletter_click_links_store(uuid,uuid,uuid,text[]),public.newsletter_purge_clicks(integer) TO harvest_worker;
  END IF;
END $$;
