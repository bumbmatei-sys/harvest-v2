CREATE TABLE "connect_retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"responses_erased" integer DEFAULT 0 NOT NULL,
	"tombstones_deleted" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	CONSTRAINT "connect_retention_run_status" CHECK ("connect_retention_runs"."status" in ('ok', 'failed') and ("connect_retention_runs"."status" = 'failed') = ("connect_retention_runs"."error_code" is not null)),
	CONSTRAINT "connect_retention_run_error" CHECK ("connect_retention_runs"."error_code" is null or "connect_retention_runs"."error_code" ~ '^[a-z_]{1,40}$'),
	CONSTRAINT "connect_retention_run_counts" CHECK ("connect_retention_runs"."responses_erased" >= 0 and "connect_retention_runs"."tombstones_deleted" >= 0)
);
--> statement-breakpoint
CREATE INDEX "connect_retention_runs_finished_idx" ON "connect_retention_runs" USING btree ("finished_at" DESC NULLS LAST);
--> statement-breakpoint
-- HC-DEC3 and HC-DEC4 engineering (directions selected 13 Nov 2026; every gate stays UNAPPROVED). Spec:
-- docs/superpowers/specs/2026-11-13-hc-retention-erasure-design.md. Nothing here enables collection or delivery.

-- 1) The policy numbers, in one place (src/lib/connect-retention.ts mirrors them; a test compares the two).
CREATE FUNCTION public.connect_retention_policy(OUT max_pending_days integer, OUT tombstone_days integer, OUT small_group_min integer, OUT health_window_hours integer)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT 30, 90, 5, 26 $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.connect_retention_policy() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.connect_retention_policy() TO harvest_app;--> statement-breakpoint

-- 2) Small-group suppression for every future aggregate report over responses or tombstones.
CREATE FUNCTION public.connect_suppress_small(p_count integer) RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_count IS NULL OR p_count < 0 THEN NULL
    WHEN p_count > 0 AND p_count < (SELECT small_group_min FROM public.connect_retention_policy()) THEN NULL ELSE p_count END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.connect_suppress_small(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.connect_suppress_small(integer) TO harvest_app;--> statement-breakpoint

-- 3) Platform maximum for unverified-entry retention. Only a new or changed value is checked, so published versions are untouched.
CREATE FUNCTION public.guard_form_version_retention() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.pending_retention_days IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.pending_retention_days IS DISTINCT FROM OLD.pending_retention_days)
     AND NEW.pending_retention_days > (SELECT max_pending_days FROM public.connect_retention_policy()) THEN
    RAISE EXCEPTION 'retention exceeds the platform maximum' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER form_version_retention_max BEFORE INSERT OR UPDATE ON public.form_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_form_version_retention();--> statement-breakpoint

-- 4) Run log: counts and status only. No application grants; only the retention definers (setting below) read or write it.
ALTER TABLE public.connect_retention_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.connect_retention_runs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.connect_retention_runs FROM PUBLIC, harvest_app;--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY connect_definer_retention_runs ON public.connect_retention_runs TO %I
    USING (current_setting('app.connect_retention', true) = 'on') WITH CHECK (current_setting('app.connect_retention', true) = 'on')$p$, current_user);
  -- The sweep must find expired rows in every ministry. Read-only, and only while it is working; each row is then handled under
  -- that ministry's own tenant policies, as in purge_connect_intake.
  EXECUTE format($p$CREATE POLICY connect_definer_retention_scan ON public.campaign_responses FOR SELECT TO %I
    USING (current_setting('app.connect_retention', true) = 'on' AND (
      (status IN ('pending', 'associated') AND expires_at <= now())
      OR (status = 'erased' AND erased_at <= now() - make_interval(days => (SELECT tombstone_days FROM public.connect_retention_policy())))))$p$, current_user);
END $$;--> statement-breakpoint

-- 5) The two guards. Only their DELETE branch changes (it used to refuse every delete); everything else is as in 0032.
CREATE OR REPLACE FUNCTION public.guard_campaign_response() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE link_status text; version_status text; retention integer; campaign_archived timestamptz; link_expires timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Retention: only an erased tombstone older than the tombstone period, deleted by the retention sweep.
    IF OLD.status = 'erased' AND OLD.erased_at IS NOT NULL
       AND OLD.erased_at <= now() - make_interval(days => (SELECT tombstone_days FROM public.connect_retention_policy()))
       AND current_setting('app.connect_retention', true) = 'on' AND public.connect_erasure_writer() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'responses are erased, not deleted';
  END IF;
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
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_campaign_response_consent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE response_status text; response_version uuid; version_notice uuid; offered text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Retention: only redacted evidence of an erased tombstone past the tombstone period, deleted by the retention sweep.
    IF OLD.redacted_at IS NOT NULL AND current_setting('app.connect_retention', true) = 'on' AND public.connect_erasure_writer()
       AND EXISTS (SELECT 1 FROM public.campaign_responses r WHERE r.tenant_id = OLD.tenant_id AND r.id = OLD.response_id AND r.status = 'erased'
         AND r.erased_at <= now() - make_interval(days => (SELECT tombstone_days FROM public.connect_retention_policy()))) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'consent evidence is append-only';
  END IF;
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
END $$;--> statement-breakpoint

-- 6) The sweep. Erases every expired pending or associated response into a tombstone (the existing scrub), then deletes
-- tombstones past the tombstone period together with their redacted consent rows. All ministries, any mode (it only deletes
-- expired data), bounded batch, SKIP LOCKED. Counts only; never a name, address or response id.
CREATE FUNCTION public.connect_retention_sweep(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r record; v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000); v_started timestamptz := clock_timestamp();
  erased integer := 0; deleted integer := 0; v_tombstone_days integer; previous text := coalesce(current_setting('app.tenant_id', true), '');
BEGIN
  SELECT tombstone_days INTO v_tombstone_days FROM public.connect_retention_policy();
  PERFORM set_config('app.connect_retention', 'on', true);
  FOR r IN SELECT tenant_id, id FROM public.campaign_responses WHERE status IN ('pending', 'associated') AND expires_at <= now()
      ORDER BY expires_at LIMIT v_limit LOOP
    PERFORM set_config('app.tenant_id', r.tenant_id::text, true);
    PERFORM 1 FROM public.campaign_responses WHERE tenant_id = r.tenant_id AND id = r.id AND status IN ('pending', 'associated') AND expires_at <= now() FOR UPDATE SKIP LOCKED;
    IF FOUND THEN PERFORM public.connect_scrub_response(r.tenant_id, r.id); erased := erased + 1; END IF;
  END LOOP;
  FOR r IN SELECT tenant_id, id FROM public.campaign_responses WHERE status = 'erased' AND erased_at <= now() - make_interval(days => v_tombstone_days)
      ORDER BY erased_at LIMIT v_limit LOOP
    PERFORM set_config('app.tenant_id', r.tenant_id::text, true);
    PERFORM 1 FROM public.campaign_responses WHERE tenant_id = r.tenant_id AND id = r.id AND status = 'erased' FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      DELETE FROM public.campaign_response_consents WHERE tenant_id = r.tenant_id AND response_id = r.id;
      DELETE FROM public.campaign_responses WHERE tenant_id = r.tenant_id AND id = r.id;
      deleted := deleted + 1;
    END IF;
  END LOOP;
  INSERT INTO public.connect_retention_runs (started_at, status, responses_erased, tombstones_deleted) VALUES (v_started, 'ok', erased, deleted);
  DELETE FROM public.connect_retention_runs WHERE finished_at < now() - interval '90 days';
  PERFORM set_config('app.tenant_id', previous, true);
  PERFORM set_config('app.connect_retention', '', true);
  RETURN jsonb_build_object('erased', erased, 'deleted', deleted);
END $$;--> statement-breakpoint

-- A sweep that raises rolls back, including its own log row, so the script records the failure here, in a fresh transaction.
CREATE FUNCTION public.connect_retention_record_failure(p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.connect_retention', 'on', true);
  INSERT INTO public.connect_retention_runs (started_at, status, error_code)
    VALUES (now(), 'failed', CASE WHEN p_error ~ '^[a-z_]{1,40}$' THEN p_error ELSE 'sweep_failed' END);
  PERFORM set_config('app.connect_retention', '', true);
END $$;--> statement-breakpoint

-- For a monitor: when the last run succeeded, what the last run was, and whether a run is overdue or failed since the last success.
CREATE FUNCTION public.connect_retention_health() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE last_ok timestamptz; last_status text; v_hours integer;
BEGIN
  SELECT health_window_hours INTO v_hours FROM public.connect_retention_policy();
  PERFORM set_config('app.connect_retention', 'on', true);
  SELECT max(finished_at) INTO last_ok FROM public.connect_retention_runs WHERE status = 'ok';
  SELECT status INTO last_status FROM public.connect_retention_runs ORDER BY finished_at DESC, id LIMIT 1;
  PERFORM set_config('app.connect_retention', '', true);
  RETURN jsonb_build_object('lastSuccessAt', last_ok, 'lastStatus', last_status,
    'overdue', last_ok IS NULL OR last_ok < now() - make_interval(hours => v_hours), 'failedSinceSuccess', coalesce(last_status = 'failed', false));
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.connect_retention_sweep(integer), public.connect_retention_record_failure(text), public.connect_retention_health() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.connect_retention_sweep(integer), public.connect_retention_record_failure(text), public.connect_retention_health() TO harvest_app;
