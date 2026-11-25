CREATE TABLE "newsletter_automation_log" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"step_type" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"provider_ref" text,
	"attempt_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_automation_log_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_automation_log_shape" CHECK ("newsletter_automation_log"."step_index" >= 0 and length(coalesce("newsletter_automation_log"."reason", '')) <= 80)
);
--> statement-breakpoint
CREATE TABLE "newsletter_automation_runs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"stop_reason" text,
	"step_index" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease" uuid,
	"lease_until" timestamp with time zone,
	"attempt_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "newsletter_automation_runs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_automation_run_contact" UNIQUE("tenant_id","automation_id","contact_id"),
	CONSTRAINT "newsletter_automation_run_state" CHECK (("newsletter_automation_runs"."state" = 'active') = ("newsletter_automation_runs"."finished_at" is null) and ("newsletter_automation_runs"."state" = 'stopped') = ("newsletter_automation_runs"."stop_reason" is not null) and "newsletter_automation_runs"."step_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "newsletter_automations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_form_id" uuid,
	"trigger_list_id" uuid,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_automations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_automation_name" CHECK (length(trim("newsletter_automations"."name")) between 1 and 100),
	CONSTRAINT "newsletter_automation_version" CHECK ("newsletter_automations"."version" >= 1),
	CONSTRAINT "newsletter_automation_trigger" CHECK (("newsletter_automations"."trigger_type" = 'form' and "newsletter_automations"."trigger_form_id" is not null and "newsletter_automations"."trigger_list_id" is null) or ("newsletter_automations"."trigger_type" = 'list' and "newsletter_automations"."trigger_list_id" is not null and "newsletter_automations"."trigger_form_id" is null)),
	CONSTRAINT "newsletter_automation_steps" CHECK (jsonb_typeof("newsletter_automations"."steps") = 'array' and jsonb_array_length("newsletter_automations"."steps") <= 20 and length("newsletter_automations"."steps"::text) <= 600000 and ("newsletter_automations"."state" <> 'active' or jsonb_array_length("newsletter_automations"."steps") > 0))
);
--> statement-breakpoint
ALTER TABLE "newsletter_automation_log" ADD CONSTRAINT "newsletter_automation_log_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."newsletter_automation_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_automation_runs" ADD CONSTRAINT "newsletter_automation_run_automation_fk" FOREIGN KEY ("tenant_id","automation_id") REFERENCES "public"."newsletter_automations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_automation_runs" ADD CONSTRAINT "newsletter_automation_run_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_automation_runs" ADD CONSTRAINT "newsletter_automation_run_list_fk" FOREIGN KEY ("tenant_id","list_id") REFERENCES "public"."newsletter_lists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_automations" ADD CONSTRAINT "newsletter_automations_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_automations" ADD CONSTRAINT "newsletter_automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_automations" ADD CONSTRAINT "newsletter_automation_form_fk" FOREIGN KEY ("tenant_id","trigger_form_id") REFERENCES "public"."forms"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_automations" ADD CONSTRAINT "newsletter_automation_list_fk" FOREIGN KEY ("tenant_id","trigger_list_id") REFERENCES "public"."newsletter_lists"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_automation_log_run_idx" ON "newsletter_automation_log" USING btree ("tenant_id","run_id","at");--> statement-breakpoint
CREATE INDEX "newsletter_automation_run_due_idx" ON "newsletter_automation_runs" USING btree ("next_run_at") WHERE "newsletter_automation_runs"."state" = 'active';--> statement-breakpoint
CREATE INDEX "newsletter_automation_run_contact_idx" ON "newsletter_automation_runs" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "newsletter_automation_state_idx" ON "newsletter_automations" USING btree ("tenant_id","state");--> statement-breakpoint
-- Newsletter automations. Row security is forced on all three tables. Owners and admins manage automations and read runs and the log of their own ministry;
-- runs and log rows are written only by the definer functions below (triggers for entering and stopping, the worker functions for sending).
-- The definer path is allowed by a policy that never matches the application role.
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['newsletter_automations', 'newsletter_automation_runs', 'newsletter_automation_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', rel);
    EXECUTE format($p$CREATE POLICY nl_auto_private ON public.%I TO PUBLIC
      USING (current_user <> 'harvest_app' AND coalesce(current_setting('app.nl_auto_private', true), '') = 'on')
      WITH CHECK (current_user <> 'harvest_app' AND coalesce(current_setting('app.nl_auto_private', true), '') = 'on')$p$, rel);
    EXECUTE format($p$CREATE POLICY nl_auto_read ON public.%I FOR SELECT TO harvest_app
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
        SELECT FROM public.workspace_members m WHERE m.tenant_id = %I.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
          AND public.newsletter_capability(m.role_id, 'newsletter:campaigns')))$p$, rel, rel);
  END LOOP;
END $$;
GRANT SELECT ON public.newsletter_automations, public.newsletter_automation_runs, public.newsletter_automation_log TO harvest_app;
GRANT INSERT (tenant_id, id, name, created_by, version, state, trigger_type, trigger_form_id, trigger_list_id, steps, created_at, updated_at) ON public.newsletter_automations TO harvest_app;
GRANT UPDATE (name, version, state, trigger_type, trigger_form_id, trigger_list_id, steps, updated_at) ON public.newsletter_automations TO harvest_app;
CREATE POLICY nl_auto_write ON public.newsletter_automations FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND created_by = nullif(current_setting('app.user_id', true), '')
    AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = newsletter_automations.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND public.newsletter_capability(m.role_id, 'newsletter:campaigns')));
CREATE POLICY nl_auto_update ON public.newsletter_automations FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT FROM public.workspace_members m
    WHERE m.tenant_id = newsletter_automations.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.newsletter_capability(m.role_id, 'newsletter:campaigns')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT FROM public.workspace_members m
    WHERE m.tenant_id = newsletter_automations.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.newsletter_capability(m.role_id, 'newsletter:campaigns')));
--> statement-breakpoint
-- The trigger and the steps never change identity once runs exist: only a draft or paused automation can be edited, and a change to the steps stops nothing but is
-- picked up by runs at their current position (the editor says so). Guard the edit rules in the database as well.
CREATE FUNCTION public.newsletter_automation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.tenant_id, NEW.id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'newsletter_automation_identity_immutable' USING ERRCODE = '23514'; END IF;
    IF OLD.state = 'active' AND NEW.state = 'active' AND (NEW.steps, NEW.trigger_type, NEW.trigger_form_id, NEW.trigger_list_id) IS DISTINCT FROM (OLD.steps, OLD.trigger_type, OLD.trigger_form_id, OLD.trigger_list_id) THEN
      RAISE EXCEPTION 'newsletter_automation_pause_to_edit' USING ERRCODE = '23514'; END IF;
    IF OLD.state <> 'draft' AND NEW.state = 'draft' THEN RAISE EXCEPTION 'newsletter_automation_state' USING ERRCODE = '23514'; END IF;
    IF NEW.state = 'active' AND OLD.state <> 'active' AND NOT EXISTS (SELECT FROM jsonb_array_elements(NEW.steps) s WHERE s->>'type' = 'email') THEN
      RAISE EXCEPTION 'newsletter_automation_needs_email' USING ERRCODE = '23514'; END IF;
    IF (NEW.trigger_type, NEW.trigger_form_id, NEW.trigger_list_id) IS DISTINCT FROM (OLD.trigger_type, OLD.trigger_form_id, OLD.trigger_list_id)
      AND EXISTS (SELECT FROM public.newsletter_automation_runs r WHERE r.tenant_id = OLD.tenant_id AND r.automation_id = OLD.id) THEN
      RAISE EXCEPTION 'newsletter_automation_trigger_locked' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.state <> 'draft' OR NEW.version <> 1 THEN RAISE EXCEPTION 'newsletter_automation_state' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_guard() FROM PUBLIC, harvest_app;
CREATE TRIGGER newsletter_automation_guard BEFORE INSERT OR UPDATE ON public.newsletter_automations
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_automation_guard();
--> statement-breakpoint
-- The guard reads runs, which only the private policy allows.
CREATE POLICY nl_auto_guard_runs ON public.newsletter_automation_runs FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT FROM public.workspace_members m
    WHERE m.tenant_id = newsletter_automation_runs.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.newsletter_capability(m.role_id, 'newsletter:campaigns')));
--> statement-breakpoint
-- Entering: one run per person per automation (a person who left is not entered again). Called by the triggers below.
CREATE FUNCTION public.newsletter_automation_enroll(p_tenant uuid, p_contact uuid, p_list uuid, p_form uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := current_setting('app.nl_auto_private', true); a record; entered uuid;
BEGIN
  PERFORM set_config('app.nl_auto_private', 'on', true);
  FOR a IN SELECT id FROM public.newsletter_automations WHERE tenant_id = p_tenant AND state = 'active'
    AND ((p_form IS NULL AND trigger_type = 'list' AND trigger_list_id = p_list) OR (p_form IS NOT NULL AND trigger_type = 'form' AND trigger_form_id = p_form)) LOOP
    INSERT INTO public.newsletter_automation_runs(tenant_id, automation_id, contact_id, list_id) VALUES (p_tenant, a.id, p_contact, p_list)
      ON CONFLICT (tenant_id, automation_id, contact_id) DO NOTHING RETURNING id INTO entered;
    IF entered IS NOT NULL THEN
      INSERT INTO public.newsletter_automation_log(tenant_id, run_id, step_index, step_type, outcome) VALUES (p_tenant, entered, 0, 'enter', 'entered');
      entered := NULL;
    END IF;
  END LOOP;
  PERFORM set_config('app.nl_auto_private', coalesce(prior, ''), true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_enroll(uuid, uuid, uuid, uuid) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- Stopping: every active run of the person (on one list, or on all) ends with a reason, and the log says so.
CREATE FUNCTION public.newsletter_automation_stop(p_tenant uuid, p_contact uuid, p_list uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := current_setting('app.nl_auto_private', true);
BEGIN
  PERFORM set_config('app.nl_auto_private', 'on', true);
  WITH stopped AS (
    UPDATE public.newsletter_automation_runs SET state = 'stopped', stop_reason = p_reason, finished_at = clock_timestamp(), lease = NULL, lease_until = NULL
      WHERE tenant_id = p_tenant AND contact_id = p_contact AND state = 'active' AND (p_list IS NULL OR list_id = p_list)
      RETURNING id, step_index)
  INSERT INTO public.newsletter_automation_log(tenant_id, run_id, step_index, step_type, outcome, reason)
    SELECT p_tenant, id, step_index, 'stopped', 'stopped', p_reason FROM stopped;
  PERFORM set_config('app.nl_auto_private', coalesce(prior, ''), true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_stop(uuid, uuid, uuid, text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.newsletter_automation_on_subscription() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := current_setting('app.nl02_tenant', true); person uuid;
BEGIN
  IF NEW.state = 'subscribed' AND (TG_OP = 'INSERT' OR OLD.state <> 'subscribed') THEN
    PERFORM set_config('app.nl02_tenant', NEW.tenant_id::text, true);
    SELECT contact_id INTO person FROM public.newsletter_subscribers WHERE tenant_id = NEW.tenant_id AND id = NEW.subscriber_id;
    PERFORM set_config('app.nl02_tenant', coalesce(prior, ''), true);
    IF person IS NOT NULL THEN PERFORM public.newsletter_automation_enroll(NEW.tenant_id, person, NEW.list_id, NULL); END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.state = 'subscribed' AND NEW.state <> 'subscribed' THEN
    PERFORM set_config('app.nl02_tenant', NEW.tenant_id::text, true);
    SELECT contact_id INTO person FROM public.newsletter_subscribers WHERE tenant_id = NEW.tenant_id AND id = NEW.subscriber_id;
    PERFORM set_config('app.nl02_tenant', coalesce(prior, ''), true);
    IF person IS NOT NULL THEN
      PERFORM public.newsletter_automation_stop(NEW.tenant_id, person, NEW.list_id, CASE WHEN NEW.state = 'unsubscribed' THEN 'unsubscribed' ELSE 'suppressed' END);
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_on_subscription() FROM PUBLIC, harvest_app;
CREATE TRIGGER newsletter_automation_on_subscription AFTER INSERT OR UPDATE ON public.newsletter_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_automation_on_subscription();
--> statement-breakpoint
CREATE FUNCTION public.newsletter_automation_on_suppressed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.newsletter_automation_stop(NEW.tenant_id, NEW.contact_id, NULL, 'suppressed');
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_on_suppressed() FROM PUBLIC, harvest_app;
CREATE TRIGGER newsletter_automation_on_suppressed AFTER UPDATE ON public.newsletter_subscribers
  FOR EACH ROW WHEN (NOT OLD.suppressed AND NEW.suppressed) EXECUTE FUNCTION public.newsletter_automation_on_suppressed();
--> statement-breakpoint
CREATE FUNCTION public.newsletter_automation_on_withdrawal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.newsletter_automation_stop(NEW.tenant_id, NEW.contact_id, NULL, 'consent_withdrawn');
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_on_withdrawal() FROM PUBLIC, harvest_app;
CREATE TRIGGER newsletter_automation_on_withdrawal AFTER INSERT ON public.contact_consents
  FOR EACH ROW WHEN (NEW.purpose = 'newsletter' AND NEW.status = 'withdrawn') EXECUTE FUNCTION public.newsletter_automation_on_withdrawal();
--> statement-breakpoint
-- A confirmed hosted sign-up enters the automations that start from that form. The consent list is the first of the form's lists the person is now
-- subscribed to. (A confirmed sign-up row keeps no link to the person, so the confirmation itself calls this, below.)
CREATE FUNCTION public.newsletter_automation_enroll_form(p_tenant uuid, p_contact uuid, p_form uuid, p_lists uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := current_setting('app.nl02_tenant', true); chosen uuid;
BEGIN
  PERFORM set_config('app.nl02_tenant', p_tenant::text, true);
  SELECT l INTO chosen FROM unnest(p_lists) WITH ORDINALITY AS u(l, n) WHERE EXISTS (SELECT FROM public.newsletter_subscriptions ns
    JOIN public.newsletter_subscribers sb ON sb.tenant_id = ns.tenant_id AND sb.id = ns.subscriber_id
    WHERE ns.tenant_id = p_tenant AND ns.list_id = u.l AND sb.contact_id = p_contact AND ns.state = 'subscribed') ORDER BY n LIMIT 1;
  PERFORM set_config('app.nl02_tenant', coalesce(prior, ''), true);
  IF chosen IS NOT NULL THEN PERFORM public.newsletter_automation_enroll(p_tenant, p_contact, chosen, p_form); END IF;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_enroll_form(uuid, uuid, uuid, uuid[]) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- The hosted sign-up confirmation of 0088, unchanged except for one line: after a granted confirmation it enters the person into the form's automations.
CREATE OR REPLACE FUNCTION public.nl02_accept_form_signup(p_email text, p_token text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pending public.newsletter_form_signups; creator text; contact uuid; list uuid; granted boolean := false; live boolean;
BEGIN
  SELECT * INTO pending FROM public.newsletter_form_signups
    WHERE token_hash = public.nl02_hash(p_token) AND state = 'pending' AND expires_at > clock_timestamp()
      AND email_proof = public.nl02_hash(p_token || ':' || p_email) FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  -- The form must still be published (not unpublished or archived) when the link is used.
  PERFORM set_config('app.crm_forms_tenant', pending.tenant_id::text, true);
  PERFORM set_config('app.nl_forms_tenant', pending.tenant_id::text, true);
  SELECT f.created_by INTO creator FROM public.crm_form_addresses a
    JOIN public.forms f ON f.tenant_id = a.tenant_id AND f.id = a.form_id AND f.archived_at IS NULL
    WHERE a.tenant_id = pending.tenant_id AND a.form_id = pending.form_id AND a.version_id IS NOT NULL AND a.retired_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id', pending.tenant_id::text, true);
  PERFORM set_config('app.nl02_tenant', pending.tenant_id::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended(pending.tenant_id::text || ':newsletter:' || p_email, 0));

  SELECT contact_id INTO contact FROM public.contact_identifiers
    WHERE tenant_id = pending.tenant_id AND kind = 'email' AND normalized_value = p_email;
  IF pending.contact_id IS NOT NULL AND pending.contact_id IS DISTINCT FROM contact THEN RETURN; END IF;
  IF contact IS NULL THEN
    BEGIN
      INSERT INTO public.contacts(tenant_id, name) VALUES (pending.tenant_id,
        coalesce(nullif(btrim(coalesce(pending.first_name, '') || ' ' || coalesce(pending.last_name, '')), ''), 'Newsletter subscriber')) RETURNING id INTO contact;
      INSERT INTO public.contact_identifiers(tenant_id, contact_id, kind, value, normalized_value)
        VALUES (pending.tenant_id, contact, 'email', p_email, p_email);
    EXCEPTION WHEN unique_violation THEN
      SELECT contact_id INTO contact FROM public.contact_identifiers
        WHERE tenant_id = pending.tenant_id AND kind = 'email' AND normalized_value = p_email;
    END;
  END IF;
  PERFORM 1 FROM public.contacts WHERE tenant_id = pending.tenant_id AND id = contact AND erased_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT FROM public.contact_identifiers
    WHERE tenant_id = pending.tenant_id AND contact_id = contact AND kind = 'email' AND normalized_value = p_email) THEN RETURN; END IF;
  -- Single use: the row leaves the pending state whatever the outcome, and the names are dropped with it.
  FOREACH list IN ARRAY pending.list_ids LOOP
    SELECT EXISTS (SELECT FROM public.newsletter_lists WHERE tenant_id = pending.tenant_id AND id = list AND archived_at IS NULL) INTO live;
    IF live AND public.nl02_grant_list(pending.tenant_id, list, contact, p_email, pending.created_at, creator,
        'Newsletter sign-up form, wording ' || pending.wording_version || ', email confirmation') THEN granted := true; END IF;
  END LOOP;
  UPDATE public.newsletter_form_signups SET state = CASE WHEN granted THEN 'confirmed' ELSE 'blocked' END,
    confirmed_at = clock_timestamp(), first_name = NULL, last_name = NULL
    WHERE tenant_id = pending.tenant_id AND id = pending.id;
  IF granted THEN PERFORM public.newsletter_automation_enroll_form(pending.tenant_id, contact, pending.form_id, pending.list_ids); END IF;
END $$;
REVOKE ALL ON FUNCTION public.nl02_accept_form_signup(text, text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- Erasing (and merging away) a person removes their runs and log with them.
CREATE FUNCTION public.newsletter_automation_before_erase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := current_setting('app.nl_auto_private', true);
BEGIN
  PERFORM set_config('app.nl_auto_private', 'on', true);
  DELETE FROM public.newsletter_automation_runs WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id;
  PERFORM set_config('app.nl_auto_private', coalesce(prior, ''), true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_before_erase() FROM PUBLIC, harvest_app;
CREATE TRIGGER newsletter_automation_before_erase BEFORE UPDATE ON public.contacts
  FOR EACH ROW WHEN (OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL) EXECUTE FUNCTION public.newsletter_automation_before_erase();
--> statement-breakpoint
-- Worker step 1: move due runs along. Waits and the end are handled here; a run that reaches an email step is leased and returned for sending.
-- Nothing is sent here, and an unfinished earlier attempt is recorded as unknown and never sent again.
CREATE FUNCTION public.newsletter_automation_tick(p_limit integer, p_lease_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r record; step jsonb; idx integer; jobs jsonb := '[]'::jsonb; new_lease uuid; seconds bigint;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 3600 THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_auto_private', 'on', true);
  FOR r IN SELECT ru.tenant_id, ru.id, ru.step_index, ru.attempt_id, a.steps FROM public.newsletter_automation_runs ru
      JOIN public.newsletter_automations a ON a.tenant_id = ru.tenant_id AND a.id = ru.automation_id
      WHERE ru.state = 'active' AND ru.next_run_at <= clock_timestamp() AND (ru.lease IS NULL OR ru.lease_until <= clock_timestamp()) AND a.state = 'active'
      ORDER BY ru.next_run_at LIMIT p_limit FOR UPDATE OF ru SKIP LOCKED LOOP
    idx := r.step_index;
    IF r.attempt_id IS NOT NULL THEN
      UPDATE public.newsletter_automation_log SET outcome = 'unknown', reason = 'worker_lost' WHERE tenant_id = r.tenant_id AND run_id = r.id AND attempt_id = r.attempt_id AND outcome = 'unknown';
      idx := idx + 1;
    END IF;
    step := r.steps -> idx;
    IF step IS NULL OR step ->> 'type' = 'end' THEN
      UPDATE public.newsletter_automation_runs SET state = 'completed', step_index = idx, attempt_id = NULL, lease = NULL, lease_until = NULL, finished_at = clock_timestamp()
        WHERE tenant_id = r.tenant_id AND id = r.id;
      INSERT INTO public.newsletter_automation_log(tenant_id, run_id, step_index, step_type, outcome) VALUES (r.tenant_id, r.id, idx, 'end', 'completed');
    ELSIF step ->> 'type' = 'wait' THEN
      seconds := (step ->> 'amount')::bigint * CASE step ->> 'unit' WHEN 'hours' THEN 3600 ELSE 86400 END;
      UPDATE public.newsletter_automation_runs SET step_index = idx + 1, attempt_id = NULL, lease = NULL, lease_until = NULL, next_run_at = clock_timestamp() + make_interval(secs => seconds)
        WHERE tenant_id = r.tenant_id AND id = r.id;
      INSERT INTO public.newsletter_automation_log(tenant_id, run_id, step_index, step_type, outcome, reason) VALUES (r.tenant_id, r.id, idx, 'wait', 'waiting', step ->> 'amount' || ' ' || (step ->> 'unit'));
    ELSE
      new_lease := gen_random_uuid();
      UPDATE public.newsletter_automation_runs SET step_index = idx, attempt_id = NULL, lease = new_lease, lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
        WHERE tenant_id = r.tenant_id AND id = r.id;
      jobs := jobs || jsonb_build_array(jsonb_build_object('tenant', r.tenant_id, 'run', r.id, 'lease', new_lease));
    END IF;
  END LOOP;
  RETURN jobs;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_tick(integer, integer) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- Worker step 2: the consent re-check, immediately before every send. A run whose person is no longer a subscriber with a current newsletter grant,
-- or is suppressed, or has no usable address, or whose images are no longer ready, stops here with the reason, and nothing is sent.
CREATE FUNCTION public.newsletter_automation_authorize(p_tenant uuid, p_run uuid, p_lease uuid, p_nonce text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r public.newsletter_automation_runs; a public.newsletter_automations; step jsonb; person public.contacts; subscriber public.newsletter_subscribers;
  subscription public.newsletter_subscriptions; consent uuid; address text; reason text; ministry text; assets jsonb; expected integer; attempt uuid;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF coalesce(p_nonce, '') !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_auto_private', 'on', true);
  PERFORM set_config('app.nl_send_worker', 'on', true);
  PERFORM set_config('app.nl_send_tenant', p_tenant::text, true);
  PERFORM set_config('app.nl02_private', 'on', true);
  PERFORM set_config('app.nl02_tenant', p_tenant::text, true);
  SELECT * INTO r FROM public.newsletter_automation_runs WHERE tenant_id = p_tenant AND id = p_run AND lease = p_lease AND lease_until > clock_timestamp()
    AND state = 'active' AND attempt_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.newsletter_automations WHERE tenant_id = p_tenant AND id = r.automation_id;
  step := a.steps -> r.step_index;
  IF a.state <> 'active' OR step IS NULL OR step ->> 'type' <> 'email' THEN
    UPDATE public.newsletter_automation_runs SET lease = NULL, lease_until = NULL WHERE tenant_id = p_tenant AND id = p_run;
    RETURN NULL;
  END IF;
  SELECT * INTO person FROM public.contacts WHERE tenant_id = p_tenant AND id = r.contact_id AND erased_at IS NULL FOR UPDATE;
  SELECT * INTO subscriber FROM public.newsletter_subscribers WHERE tenant_id = p_tenant AND contact_id = r.contact_id FOR UPDATE;
  IF person.id IS NULL OR subscriber.id IS NULL THEN reason := 'unsubscribed';
  ELSIF subscriber.suppressed THEN reason := 'suppressed';
  ELSE
    SELECT * INTO subscription FROM public.newsletter_subscriptions WHERE tenant_id = p_tenant AND subscriber_id = subscriber.id AND list_id = r.list_id FOR SHARE;
    IF subscription.state IN ('suppressed', 'bounced') THEN reason := 'suppressed';
    ELSIF subscription.state IS DISTINCT FROM 'subscribed' THEN reason := 'unsubscribed';
    ELSE
      SELECT id INTO consent FROM public.contact_consents WHERE tenant_id = p_tenant AND contact_id = person.id AND purpose = 'newsletter' AND channel = 'email' AND redacted_at IS NULL
        ORDER BY recorded_at DESC, occurred_at DESC, id DESC LIMIT 1;
      IF NOT coalesce(public.newsletter_consent_allowed(p_tenant, person.id, consent), false) THEN reason := 'consent_withdrawn'; END IF;
    END IF;
  END IF;
  IF reason IS NULL THEN
    SELECT normalized_value INTO address FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = person.id AND kind = 'email' ORDER BY id LIMIT 1;
    IF address IS NULL OR NOT public.nl02_email(address) THEN reason := 'no_address';
    ELSIF public.newsletter_address_block(p_tenant, address, r.list_id) IS NOT NULL THEN reason := 'suppressed';
    END IF;
  END IF;
  IF reason IS NULL THEN
    SELECT count(DISTINCT v) INTO expected FROM (SELECT jsonb_path_query(step -> 'content', '$.cover.fileId') #>> '{}' AS v
      UNION ALL SELECT jsonb_path_query(step -> 'content', '$.blocks[*].fileId') #>> '{}') ids;
    SELECT coalesce(jsonb_agg(f.id), '[]'::jsonb) INTO assets FROM public.files f WHERE f.tenant_id = p_tenant AND f.status = 'ready' AND f.visibility = 'public'
      AND NOT f.social_upload AND f.mime IN ('image/jpeg', 'image/png', 'image/webp') AND f.id::text IN (
        SELECT jsonb_path_query(step -> 'content', '$.cover.fileId') #>> '{}' UNION SELECT jsonb_path_query(step -> 'content', '$.blocks[*].fileId') #>> '{}');
    IF jsonb_array_length(assets) <> expected THEN reason := 'image_unavailable'; END IF;
  END IF;
  IF reason IS NOT NULL THEN
    UPDATE public.newsletter_automation_runs SET state = 'stopped', stop_reason = reason, finished_at = clock_timestamp(), lease = NULL, lease_until = NULL
      WHERE tenant_id = p_tenant AND id = p_run;
    INSERT INTO public.newsletter_automation_log(tenant_id, run_id, step_index, step_type, outcome, reason) VALUES (p_tenant, p_run, r.step_index, 'stopped', 'stopped', reason);
    RETURN NULL;
  END IF;
  SELECT name INTO ministry FROM public.workspaces WHERE tenant_id = p_tenant;
  INSERT INTO public.newsletter_preference_tokens(token_hash, tenant_id, subscriber_id, list_id, scope, email_proof, expires_at)
    VALUES (public.nl02_hash(p_nonce), p_tenant, subscriber.id, r.list_id, 'list', public.nl02_hash(p_nonce || ':' || address), clock_timestamp() + interval '30 days');
  attempt := gen_random_uuid();
  UPDATE public.newsletter_automation_runs SET attempt_id = attempt WHERE tenant_id = p_tenant AND id = p_run;
  INSERT INTO public.newsletter_automation_log(tenant_id, run_id, step_index, step_type, outcome, attempt_id) VALUES (p_tenant, p_run, r.step_index, 'email', 'unknown', attempt);
  RETURN jsonb_build_object('attempt', attempt, 'email', address, 'firstName', split_part(btrim(person.name), ' ', 1), 'ministryName', ministry,
    'subject', step ->> 'subject', 'preheader', step ->> 'preheader', 'content', step -> 'content', 'images', assets);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_authorize(uuid, uuid, uuid, text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- Worker step 3: record what the provider said and move the run to its next step. A failed send is recorded and the run continues; it is not retried.
CREATE FUNCTION public.newsletter_automation_finish(p_tenant uuid, p_run uuid, p_attempt uuid, p_state text, p_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_state NOT IN ('accepted', 'failed', 'unknown') OR length(coalesce(p_ref, '')) > 255 THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_auto_private', 'on', true);
  UPDATE public.newsletter_automation_log SET outcome = CASE p_state WHEN 'accepted' THEN 'sent' WHEN 'failed' THEN 'failed' ELSE 'unknown' END, provider_ref = p_ref
    WHERE tenant_id = p_tenant AND run_id = p_run AND attempt_id = p_attempt AND outcome = 'unknown';
  UPDATE public.newsletter_automation_runs SET attempt_id = NULL, lease = NULL, lease_until = NULL, step_index = step_index + 1, next_run_at = clock_timestamp()
    WHERE tenant_id = p_tenant AND id = p_run AND attempt_id = p_attempt AND state = 'active';
END $$;
REVOKE ALL ON FUNCTION public.newsletter_automation_finish(uuid, uuid, uuid, text, text) FROM PUBLIC, harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.newsletter_automation_tick(integer, integer), public.newsletter_automation_authorize(uuid, uuid, uuid, text),
      public.newsletter_automation_finish(uuid, uuid, uuid, text, text) TO harvest_worker;
  END IF;
END $$;
