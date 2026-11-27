-- Newsletter founder decisions (27 Nov 2026).
-- 1. Consent wording newsletter-consent-v2: the v1 statement plus "This ministry counts link clicks in its emails, as totals only." A hosted sign-up
--    records v2 when the ministry counts link clicks at the moment of sign-up, and v1 otherwise. newsletter_form_signup_start is replaced (it now takes
--    the wording the visitor was shown and records nothing when that is not the wording that applies now). Wordings are immutable: no existing sign-up,
--    grant or evidence row is changed, and nothing is backfilled.
-- 2. Automation emails count link clicks under the campaign rules: links are rewritten only while the ministry counts clicks; totals only per
--    automation, per step, per UTC day and per link; groups under 5 withheld; owners and admins only (newsletter:analytics); click rows kept 90 days,
--    then rolled into anonymous counts; no IP address, user agent or device data. Three new tables, all FORCE RLS, nothing granted to the app role.
-- Every definer pins search_path, schema-qualifies names, restores each app.* setting it changes and checks roles only through public.access_role.
-- The new tables start empty, so the 0091 NO FORCE backfill pattern is not needed. Sending stays off; no worker or schedule is installed.
CREATE TABLE "newsletter_automation_click_counts" (
	"tenant_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"day" date NOT NULL,
	"link_index" integer NOT NULL,
	"count" bigint NOT NULL,
	CONSTRAINT "newsletter_automation_click_counts_tenant_id_automation_id_step_index_day_link_index_pk" PRIMARY KEY("tenant_id","automation_id","step_index","day","link_index"),
	CONSTRAINT "newsletter_automation_click_count_shape" CHECK ("newsletter_automation_click_counts"."count" > 0 and "newsletter_automation_click_counts"."step_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "newsletter_automation_click_links" (
	"tenant_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"link_index" integer NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "newsletter_automation_click_links_tenant_id_automation_id_link_index_pk" PRIMARY KEY("tenant_id","automation_id","link_index"),
	CONSTRAINT "newsletter_automation_click_link_url" UNIQUE("tenant_id","automation_id","url"),
	CONSTRAINT "newsletter_automation_click_link_shape" CHECK ("newsletter_automation_click_links"."link_index" between 0 and 199 and "newsletter_automation_click_links"."url" ~ '^https://' and char_length("newsletter_automation_click_links"."url") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "newsletter_automation_clicks" (
	"tenant_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"link_index" integer NOT NULL,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_automation_clicks_tenant_id_attempt_id_link_index_pk" PRIMARY KEY("tenant_id","attempt_id","link_index"),
	CONSTRAINT "newsletter_automation_click_step" CHECK ("newsletter_automation_clicks"."step_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "newsletter_automation_click_counts" ADD CONSTRAINT "newsletter_automation_click_count_link_fk" FOREIGN KEY ("tenant_id","automation_id","link_index") REFERENCES "public"."newsletter_automation_click_links"("tenant_id","automation_id","link_index") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_automation_click_links" ADD CONSTRAINT "newsletter_automation_click_link_automation_fk" FOREIGN KEY ("tenant_id","automation_id") REFERENCES "public"."newsletter_automations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_automation_clicks" ADD CONSTRAINT "newsletter_automation_click_link_fk" FOREIGN KEY ("tenant_id","automation_id","link_index") REFERENCES "public"."newsletter_automation_click_links"("tenant_id","automation_id","link_index") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_automation_click_retention_idx" ON "newsletter_automation_clicks" USING btree ("clicked_at");--> statement-breakpoint
CREATE INDEX "newsletter_automation_click_automation_idx" ON "newsletter_automation_clicks" USING btree ("tenant_id","automation_id","clicked_at");--> statement-breakpoint
CREATE INDEX "newsletter_automation_log_attempt_idx" ON "newsletter_automation_log" USING btree ("tenant_id","attempt_id") WHERE "newsletter_automation_log"."attempt_id" is not null;

--> statement-breakpoint
-- Row-level security and grants follow the 0126 click tables: forced RLS, nothing for PUBLIC, the app or the worker login, and a definer-owner policy
-- scoped by app.nl_send_tenant (or the worker flag inside a worker definer).
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['newsletter_automation_click_links','newsletter_automation_clicks','newsletter_automation_click_counts'] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
    EXECUTE pg_catalog.format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',rel);
    EXECUTE pg_catalog.format('REVOKE ALL ON public.%I FROM PUBLIC,harvest_app',rel);
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='harvest_worker') THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON public.%I FROM harvest_worker',rel);
    END IF;
    EXECUTE pg_catalog.format($p$CREATE POLICY newsletter_automation_click_owner ON public.%I TO %I
      USING ((session_user='harvest_worker' AND pg_catalog.current_setting('app.nl_send_worker',true)='on')
           OR tenant_id=nullif(pg_catalog.current_setting('app.nl_send_tenant',true),'')::uuid)
      WITH CHECK (tenant_id=nullif(pg_catalog.current_setting('app.nl_send_tenant',true),'')::uuid
           OR (session_user='harvest_worker' AND pg_catalog.current_setting('app.nl_send_worker',true)='on'))$p$,rel,current_user);
  END LOOP;
END $$;
--> statement-breakpoint
-- Hosted sign-up start, replacing the 0088 function. Same checks and limits, plus the wording: v2 when the form's frozen wording is v1 and the ministry
-- counts link clicks now, the frozen wording otherwise. p_wording is what the page showed; when it is not the wording that applies now, nothing is
-- recorded and no message is sent (the server asks the page to reload first, so this only happens when the setting changes mid-request).
DROP FUNCTION public.newsletter_form_signup_start(text, uuid, uuid, text, text, text, text, text);
CREATE FUNCTION public.newsletter_form_signup_start(p_slug text, p_version uuid, p_receipt uuid, p_email text, p_first text, p_last text, p_token text,
  p_address_key text, p_wording text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  address record; snapshot jsonb; wanted uuid[]; live uuid[]; contact uuid; queued boolean; counting boolean; wording text;
  previous_tenant text := pg_catalog.current_setting('app.tenant_id', true);
  previous_nl02 text := pg_catalog.current_setting('app.nl02_tenant', true);
  previous_slug text := pg_catalog.current_setting('app.crm_forms_slug', true);
  previous_forms text := pg_catalog.current_setting('app.crm_forms_tenant', true);
  previous_private text := pg_catalog.current_setting('app.nl02_private', true);
  previous_send text := pg_catalog.current_setting('app.nl_send_tenant', true);
  moment timestamptz := pg_catalog.clock_timestamp(); hour_bucket timestamptz := pg_catalog.date_trunc('hour', pg_catalog.clock_timestamp());
BEGIN
  IF pg_catalog.current_database() !~ '^harvest_test(_|$)' OR NOT public.nl02_email(p_email)
    OR coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{43}$' OR coalesce(p_address_key, '') !~ '^[0-9a-f]{64}$'
    OR pg_catalog.length(coalesce(p_first, '')) > 100 OR pg_catalog.length(coalesce(p_last, '')) > 100 OR public.valid_crm_form_slug(p_slug) IS NOT TRUE
    OR coalesce(p_wording, '') !~ '^newsletter-consent-v[0-9]{1,3}$' THEN RETURN false; END IF;
  PERFORM pg_catalog.set_config('app.nl02_private', 'on', true);
  PERFORM pg_catalog.set_config('app.crm_forms_slug', p_slug, true);
  queued := false;
  SELECT * INTO address FROM public.crm_form_addresses WHERE slug = p_slug AND retired_at IS NULL AND version_id = p_version;
  IF FOUND THEN
    PERFORM pg_catalog.set_config('app.crm_forms_tenant', address.tenant_id::text, true);
    SELECT p.definition->'newsletter' INTO snapshot
      FROM public.crm_form_publications p JOIN public.forms f ON f.tenant_id = p.tenant_id AND f.id = p.form_id AND f.archived_at IS NULL
      WHERE p.tenant_id = address.tenant_id AND p.form_id = address.form_id AND p.version_id = address.version_id;
    PERFORM pg_catalog.set_config('app.nl_send_tenant', address.tenant_id::text, true);
    SELECT s.click_tracking INTO counting FROM public.newsletter_settings s WHERE s.tenant_id = address.tenant_id FOR SHARE;
    PERFORM pg_catalog.set_config('app.nl_send_tenant', coalesce(previous_send, ''), true);
    wording := CASE WHEN coalesce(counting, false) AND snapshot->>'wordingVersion' = 'newsletter-consent-v1' THEN 'newsletter-consent-v2'
      ELSE coalesce(snapshot->>'wordingVersion', '') END;
    IF snapshot IS NOT NULL AND jsonb_typeof(snapshot->'listIds') = 'array' AND wording = p_wording THEN
      SELECT coalesce(pg_catalog.array_agg(value::uuid), ARRAY[]::uuid[]) INTO wanted FROM pg_catalog.jsonb_array_elements_text(snapshot->'listIds');
      PERFORM pg_catalog.set_config('app.nl02_tenant', address.tenant_id::text, true);
      SELECT coalesce(pg_catalog.array_agg(l.id ORDER BY l.id), ARRAY[]::uuid[]) INTO live FROM public.newsletter_lists l
        WHERE l.tenant_id = address.tenant_id AND l.id = ANY(wanted) AND l.archived_at IS NULL;
      IF pg_catalog.cardinality(live) > 0 AND public.nl02_take('hosted-address:' || address.form_id || ':' || p_address_key, hour_bucket, hour_bucket + interval '1 hour', 3) THEN
        PERFORM pg_catalog.set_config('app.tenant_id', address.tenant_id::text, true);
        SELECT c.id INTO contact FROM public.contact_identifiers i JOIN public.contacts c
          ON c.tenant_id = i.tenant_id AND c.id = i.contact_id AND c.erased_at IS NULL
          WHERE i.tenant_id = address.tenant_id AND i.kind = 'email' AND i.normalized_value = p_email FOR SHARE OF c;
        UPDATE public.newsletter_form_signups SET state = 'expired', first_name = NULL, last_name = NULL WHERE (tenant_id, id) IN (
          SELECT tenant_id, id FROM public.newsletter_form_signups WHERE state = 'pending' AND expires_at <= moment
          ORDER BY expires_at, id LIMIT 40 FOR UPDATE SKIP LOCKED);
        INSERT INTO public.newsletter_form_signups(tenant_id, form_id, version_id, receipt, token_hash, email_proof, contact_id, list_ids, wording_version,
            first_name, last_name, created_at, expires_at)
          VALUES (address.tenant_id, address.form_id, address.version_id, p_receipt, public.nl02_hash(p_token), public.nl02_hash(p_token || ':' || p_email), contact,
            live, wording, nullif(pg_catalog.btrim(p_first), ''), nullif(pg_catalog.btrim(p_last), ''), moment, moment + interval '30 minutes')
          ON CONFLICT DO NOTHING;
        queued := FOUND;
      END IF;
    END IF;
  END IF;
  PERFORM pg_catalog.set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
  PERFORM pg_catalog.set_config('app.nl02_tenant', coalesce(previous_nl02, ''), true);
  PERFORM pg_catalog.set_config('app.crm_forms_slug', coalesce(previous_slug, ''), true);
  PERFORM pg_catalog.set_config('app.crm_forms_tenant', coalesce(previous_forms, ''), true);
  PERFORM pg_catalog.set_config('app.nl02_private', coalesce(previous_private, ''), true);
  PERFORM pg_catalog.set_config('app.nl_send_tenant', coalesce(previous_send, ''), true);
  RETURN queued;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_form_signup_start(text, uuid, uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_form_signup_start(text, uuid, uuid, text, text, text, text, text, text) TO harvest_app;
--> statement-breakpoint
-- Worker only: stores the content links of one automation email (new ones get the next position in the automation) and returns the automation and
-- the whole list by position. Returns NULL unless the attempt is this run's current, just-authorised email and the ministry counted clicks at that time.
CREATE FUNCTION public.newsletter_automation_click_links_store(p_tenant uuid,p_run uuid,p_attempt uuid,p_urls text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true);
  prior_private text:=pg_catalog.current_setting('app.nl_auto_private',true);
  automation uuid; link text; stored text[];
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_tenant IS NULL OR p_run IS NULL OR p_attempt IS NULL OR p_urls IS NULL OR pg_catalog.cardinality(p_urls)>200 THEN
    RAISE invalid_parameter_value; END IF;
  FOREACH link IN ARRAY p_urls LOOP
    IF link IS NULL OR link !~ '^https://' OR pg_catalog.char_length(link)>2000 THEN RAISE invalid_parameter_value; END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  PERFORM pg_catalog.set_config('app.nl_auto_private','on',true);
  SELECT ru.automation_id INTO automation FROM public.newsletter_automation_runs ru
    JOIN public.newsletter_automation_log l ON l.tenant_id=ru.tenant_id AND l.run_id=ru.id AND l.attempt_id=p_attempt
      AND l.step_type='email' AND l.outcome='unknown'
    JOIN public.newsletter_settings s ON s.tenant_id=ru.tenant_id AND s.click_tracking AND s.click_tracking_since<=l.at
    WHERE ru.tenant_id=p_tenant AND ru.id=p_run AND ru.attempt_id=p_attempt AND ru.state='active';
  IF automation IS NOT NULL THEN
    -- One worker at a time numbers an automation's links.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('newsletter-automation-links:'||p_tenant::text||':'||automation::text,0));
    FOREACH link IN ARRAY p_urls LOOP
      INSERT INTO public.newsletter_automation_click_links(tenant_id,automation_id,link_index,url)
        SELECT p_tenant,automation,coalesce(max(l.link_index)+1,0),link FROM public.newsletter_automation_click_links l
          WHERE l.tenant_id=p_tenant AND l.automation_id=automation
          HAVING count(*)<200 AND NOT coalesce(pg_catalog.bool_or(l.url=link),false)
        ON CONFLICT (tenant_id,automation_id,url) DO NOTHING;
    END LOOP;
    SELECT coalesce(pg_catalog.array_agg(l.url ORDER BY l.link_index),'{}'::text[]) INTO stored FROM public.newsletter_automation_click_links l
      WHERE l.tenant_id=p_tenant AND l.automation_id=automation;
  END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  PERFORM pg_catalog.set_config('app.nl_auto_private',coalesce(prior_private,''),true);
  RETURN CASE WHEN automation IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('automation',automation,'links',pg_catalog.to_jsonb(stored)) END;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_click_links_store(uuid,uuid,uuid,text[]) FROM PUBLIC,harvest_app;
--> statement-breakpoint
-- The public redirect for automation emails (any caller with a verified token): returns the stored URL for the link, or NULL. Records at most one
-- click per email and link, only while counting applies (it was on when the email was authorised and has stayed on) and the email's log entry still
-- exists. The step comes from that log entry, never from the token. Reads and writes nothing about the person and never changes a subscription.
CREATE FUNCTION public.newsletter_automation_click(p_tenant uuid,p_automation uuid,p_attempt uuid,p_link integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true);
  prior_private text:=pg_catalog.current_setting('app.nl_auto_private',true);
  target text; step integer;
BEGIN
  IF p_tenant IS NULL OR p_automation IS NULL OR p_attempt IS NULL OR p_link IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  PERFORM pg_catalog.set_config('app.nl_auto_private','on',true);
  SELECT l.url INTO target FROM public.newsletter_automation_click_links l
    WHERE l.tenant_id=p_tenant AND l.automation_id=p_automation AND l.link_index=p_link;
  IF target IS NOT NULL THEN
    SELECT l.step_index INTO step FROM public.newsletter_automation_log l
      JOIN public.newsletter_automation_runs ru ON ru.tenant_id=l.tenant_id AND ru.id=l.run_id AND ru.automation_id=p_automation
      JOIN public.newsletter_settings s ON s.tenant_id=l.tenant_id AND s.click_tracking AND s.click_tracking_since<=l.at
      WHERE l.tenant_id=p_tenant AND l.attempt_id=p_attempt AND l.step_type='email' AND l.outcome IN ('sent','unknown')
      LIMIT 1;
    IF step IS NOT NULL THEN
      INSERT INTO public.newsletter_automation_clicks(tenant_id,automation_id,attempt_id,step_index,link_index,clicked_at)
        VALUES (p_tenant,p_automation,p_attempt,step,p_link,pg_catalog.clock_timestamp())
        ON CONFLICT (tenant_id,attempt_id,link_index) DO NOTHING;
    END IF;
  END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  PERFORM pg_catalog.set_config('app.nl_auto_private',coalesce(prior_private,''),true);
  RETURN target;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_click(uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_automation_click(uuid,uuid,uuid,integer) TO harvest_app;
--> statement-breakpoint
-- HEAD requests (often link scanners): the stored URL only, nothing counted.
CREATE FUNCTION public.newsletter_automation_click_target(p_tenant uuid,p_automation uuid,p_link integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true); target text;
BEGIN
  IF p_tenant IS NULL OR p_automation IS NULL OR p_link IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT l.url INTO target FROM public.newsletter_automation_click_links l
    WHERE l.tenant_id=p_tenant AND l.automation_id=p_automation AND l.link_index=p_link;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  RETURN target;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_click_target(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_automation_click_target(uuid,uuid,integer) TO harvest_app;
--> statement-breakpoint
-- Aggregate click report for one automation, owners and admins only (newsletter:analytics). UTC days, at most 90. The campaign rules with the step in
-- the campaign's place: any step-day under 5 hides that day, the period total and the step's row; a step whose emails reached fewer than 5 people
-- never shows clicks; links count only clicks of steps that are shown, so no link total can exceed the shown step totals and a withheld step or day
-- cannot be found by subtracting them; links under 5 are left out, and when that leaves one link or fewer than 5 clicks unaccounted for, the smallest
-- shown link is left out too, so no small figure can be found by subtraction.
CREATE FUNCTION public.newsletter_automation_click_report(p_tenant uuid,p_automation uuid,p_from date,p_until date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_tenant text:=pg_catalog.current_setting('app.nl_send_tenant',true);
  prior_private text:=pg_catalog.current_setting('app.nl_auto_private',true); result jsonb;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(pg_catalog.current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id=p_tenant AND m.user_id=nullif(pg_catalog.current_setting('app.user_id',true),'')
      AND public.newsletter_capability(public.access_role(m.tenant_id,m.user_id,'newsletter',m.role_id),'newsletter:analytics')) THEN
    RAISE insufficient_privilege;
  END IF;
  IF p_automation IS NULL OR p_until IS NULL OR p_from IS NULL OR p_until-p_from NOT BETWEEN 1 AND 90 THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',p_tenant::text,true);
  PERFORM pg_catalog.set_config('app.nl_auto_private','on',true);
  WITH raw AS (
    SELECT k.step_index AS step,(k.clicked_at AT TIME ZONE 'UTC')::date AS day,k.link_index,count(*)::bigint AS n
    FROM public.newsletter_automation_clicks k WHERE k.tenant_id=p_tenant AND k.automation_id=p_automation
      AND k.clicked_at>=p_from::timestamp AT TIME ZONE 'UTC' AND k.clicked_at<p_until::timestamp AT TIME ZONE 'UTC'
    GROUP BY 1,2,3
    UNION ALL
    SELECT a.step_index,a.day,a.link_index,a.count FROM public.newsletter_automation_click_counts a
    WHERE a.tenant_id=p_tenant AND a.automation_id=p_automation AND a.day>=p_from AND a.day<p_until
  ), small_cohorts AS (
    SELECT s.step FROM (SELECT DISTINCT step FROM raw) s WHERE (
      SELECT count(*) FROM public.newsletter_automation_log l JOIN public.newsletter_automation_runs ru ON ru.tenant_id=l.tenant_id AND ru.id=l.run_id
      WHERE l.tenant_id=p_tenant AND ru.automation_id=p_automation AND l.step_type='email' AND l.outcome='sent' AND l.step_index=s.step)<5
  ), step_day AS (
    SELECT step,day,sum(n)::bigint AS n FROM raw GROUP BY 1,2
  ), small_steps AS (
    SELECT DISTINCT step FROM step_day WHERE n<5 UNION SELECT step FROM small_cohorts
  ), small_days AS (
    SELECT DISTINCT day FROM step_day WHERE step IN (SELECT step FROM small_steps)
  ), daily AS (
    SELECT day,sum(n)::bigint AS n FROM step_day GROUP BY 1
  ), per_step AS (
    SELECT step,sum(n)::bigint AS n FROM step_day GROUP BY 1
  ), links AS (
    SELECT r.link_index,sum(r.n)::bigint AS n FROM raw r WHERE r.step NOT IN (SELECT step FROM small_steps) GROUP BY 1
  ), hidden AS (
    SELECT count(*) FILTER (WHERE n<5) AS links,coalesce(sum(n) FILTER (WHERE n<5),0) AS clicks FROM links
  ), ranked AS (
    SELECT l.*,row_number() OVER (ORDER BY l.n,l.link_index DESC) AS smallest FROM links l WHERE l.n>=5
  ), shown AS (
    SELECT r.* FROM ranked r,hidden h WHERE NOT (h.links>0 AND (h.links=1 OR h.clicks<5) AND r.smallest=1)
  )
  SELECT pg_catalog.jsonb_build_object(
    'total',CASE WHEN EXISTS (SELECT FROM small_days) THEN NULL ELSE coalesce((SELECT sum(n) FROM daily),0) END,
    'days',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day',pg_catalog.to_char(d.day,'YYYY-MM-DD'),
      'clicks',CASE WHEN d.day IN (SELECT day FROM small_days) THEN NULL ELSE d.n END) ORDER BY d.day) FROM daily d),'[]'::jsonb),
    'steps',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('step',s.step,
      'clicks',CASE WHEN s.step IN (SELECT step FROM small_steps) THEN NULL ELSE s.n END) ORDER BY s.step) FROM per_step s),'[]'::jsonb),
    'links',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('url',u.url,'clicks',t.n) ORDER BY t.n DESC,u.url)
      FROM (SELECT * FROM shown ORDER BY n DESC,link_index LIMIT 10) t JOIN public.newsletter_automation_click_links u
        ON u.tenant_id=p_tenant AND u.automation_id=p_automation AND u.link_index=t.link_index),'[]'::jsonb)
  ) INTO result;
  PERFORM pg_catalog.set_config('app.nl_send_tenant',coalesce(prior_tenant,''),true);
  PERFORM pg_catalog.set_config('app.nl_auto_private',coalesce(prior_private,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_click_report(uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_automation_click_report(uuid,uuid,date,date) TO harvest_app;
--> statement-breakpoint
-- Worker only (the newsletter:purge:test command): automation click rows older than 90 days become anonymous automation/step/day/link counts in the
-- same statement.
CREATE FUNCTION public.newsletter_purge_automation_clicks(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior_worker text:=pg_catalog.current_setting('app.nl_send_worker',true);
  cutoff timestamptz:=pg_catalog.clock_timestamp()-interval '2160 hours'; purged integer;
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5000 THEN RAISE invalid_parameter_value; END IF;
  PERFORM pg_catalog.set_config('app.nl_send_worker','on',true);
  WITH candidates AS (
    SELECT tenant_id,attempt_id,link_index FROM public.newsletter_automation_clicks WHERE clicked_at<=cutoff
    ORDER BY clicked_at,tenant_id,attempt_id,link_index LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.newsletter_automation_clicks k USING candidates c
    WHERE k.tenant_id=c.tenant_id AND k.attempt_id=c.attempt_id AND k.link_index=c.link_index
    RETURNING k.tenant_id,k.automation_id,k.step_index,k.link_index,k.clicked_at
  ), rolled_up AS (
    INSERT INTO public.newsletter_automation_click_counts AS a(tenant_id,automation_id,step_index,day,link_index,count)
    SELECT tenant_id,automation_id,step_index,(clicked_at AT TIME ZONE 'UTC')::date,link_index,count(*) FROM deleted GROUP BY 1,2,3,4,5
    ON CONFLICT (tenant_id,automation_id,step_index,day,link_index) DO UPDATE SET count=a.count+excluded.count
  )
  SELECT count(*) INTO purged FROM deleted;
  PERFORM pg_catalog.set_config('app.nl_send_worker',coalesce(prior_worker,''),true);
  RETURN purged;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_purge_automation_clicks(integer) FROM PUBLIC,harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.newsletter_automation_click_links_store(uuid,uuid,uuid,text[]),public.newsletter_purge_automation_clicks(integer) TO harvest_worker;
  END IF;
END $$;
