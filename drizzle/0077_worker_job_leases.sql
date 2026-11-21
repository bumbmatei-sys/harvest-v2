CREATE TABLE "worker_job_leases" (
	"job" text PRIMARY KEY NOT NULL,
	"token" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_job_receipts" (
	"job" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	CONSTRAINT "worker_job_receipts_job_scheduled_for_pk" PRIMARY KEY("job","scheduled_for")
);
--> statement-breakpoint
ALTER TABLE "worker_job_receipts" ADD CONSTRAINT "worker_job_receipts_job_worker_job_leases_job_fk" FOREIGN KEY ("job") REFERENCES "public"."worker_job_leases"("job") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
REVOKE ALL ON TABLE public.worker_job_leases, public.worker_job_receipts FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- Distinguish a duplicate from a concurrent holder. The lease row is also the
-- mutex for receipt insertion, so the second receipt check closes the race.
CREATE FUNCTION public.worker_job_acquire(p_job text, p_slot timestamptz, p_token uuid, p_seconds integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_job IS NULL OR p_job !~ '^[a-z_]{1,40}$' OR p_slot IS NULL OR NOT isfinite(p_slot)
     OR p_token IS NULL OR p_seconds IS NULL OR p_seconds NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'Invalid worker lease';
  END IF;
  IF EXISTS (SELECT FROM public.worker_job_receipts WHERE job = p_job AND scheduled_for = p_slot) THEN
    RETURN 'done';
  END IF;
  INSERT INTO public.worker_job_leases AS lease (job, token, scheduled_for, expires_at)
    VALUES (p_job, p_token, p_slot, clock_timestamp() + make_interval(secs => p_seconds))
    ON CONFLICT (job) DO UPDATE SET token = excluded.token, scheduled_for = excluded.scheduled_for,
      expires_at = clock_timestamp() + make_interval(secs => p_seconds)
    WHERE lease.expires_at <= clock_timestamp();
  IF NOT FOUND THEN RETURN 'busy'; END IF;
  IF EXISTS (SELECT FROM public.worker_job_receipts WHERE job = p_job AND scheduled_for = p_slot) THEN
    UPDATE public.worker_job_leases SET expires_at = clock_timestamp() WHERE job = p_job;
    RETURN 'done';
  END IF;
  RETURN 'acquired';
END $$;
--> statement-breakpoint
-- This row lock must live in the same transaction as the protected work.
-- Check the clock after any wait for the row lock.
CREATE FUNCTION public.worker_job_fence(p_job text, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE deadline timestamptz;
BEGIN
  SELECT expires_at INTO deadline FROM public.worker_job_leases WHERE job = p_job AND token = p_token FOR UPDATE;
  RETURN coalesce(deadline > clock_timestamp(), false);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.worker_job_renew(p_job text, p_token uuid, p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_seconds IS NULL OR p_seconds NOT BETWEEN 1 AND 300 OR NOT public.worker_job_fence(p_job, p_token) THEN RETURN false; END IF;
  UPDATE public.worker_job_leases SET expires_at = clock_timestamp() + make_interval(secs => p_seconds) WHERE job = p_job;
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.worker_job_finish(p_job text, p_token uuid, p_completed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT public.worker_job_fence(p_job, p_token) THEN RETURN false; END IF;
  IF p_completed THEN
    INSERT INTO public.worker_job_receipts (job, scheduled_for) SELECT job, scheduled_for FROM public.worker_job_leases WHERE job = p_job;
  END IF;
  UPDATE public.worker_job_leases SET expires_at = clock_timestamp() WHERE job = p_job;
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.worker_job_acquire(text,timestamptz,uuid,integer), public.worker_job_fence(text,uuid),
  public.worker_job_renew(text,uuid,integer), public.worker_job_finish(text,uuid,boolean) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- Bounded variants for the Workers path. The zero-argument Node definitions and
-- their grants stay in 0037 and 0042.
CREATE FUNCTION public.community_purge_applications(p_limit integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE removed integer;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 250 THEN RAISE EXCEPTION 'Invalid purge limit'; END IF;
  PERFORM set_config('app.community_purge', 'on', true);
  DELETE FROM public.community_applications WHERE id IN (
    SELECT id FROM public.community_applications
    WHERE status IN ('declined', 'withdrawn') AND decided_at < now() - interval '90 days'
    ORDER BY decided_at, id LIMIT p_limit FOR UPDATE SKIP LOCKED
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM public.community_definer_reset();
  RETURN removed;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.community_purge_notifications(p_limit integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE removed integer; removed_email integer;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 250 THEN RAISE EXCEPTION 'Invalid purge limit'; END IF;
  PERFORM set_config('app.community_purge', 'on', true);
  DELETE FROM public.community_notifications WHERE id IN (
    SELECT id FROM public.community_notifications WHERE read_at < now() - interval '90 days'
    ORDER BY read_at, id LIMIT p_limit FOR UPDATE SKIP LOCKED
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  DELETE FROM public.community_email_deliveries WHERE id IN (
    SELECT id FROM public.community_email_deliveries WHERE created_at < now() - interval '90 days'
    ORDER BY created_at, id LIMIT p_limit FOR UPDATE SKIP LOCKED
  );
  GET DIAGNOSTICS removed_email = ROW_COUNT;
  PERFORM public.community_definer_reset();
  RETURN removed + removed_email;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_purge_applications(integer), public.community_purge_notifications(integer) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- Replay this grant block as the migration owner if the role is provisioned later.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN RETURN; END IF;
  IF EXISTS (SELECT FROM pg_roles r WHERE r.rolname = 'harvest_worker' AND
      (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolinherit OR r.rolreplication
       OR EXISTS (SELECT FROM pg_auth_members WHERE member = r.oid))) THEN
    RAISE EXCEPTION 'harvest_worker must be an unprivileged SQL-created role';
  END IF;
  GRANT EXECUTE ON FUNCTION public.worker_job_acquire(text,timestamptz,uuid,integer), public.worker_job_fence(text,uuid),
    public.worker_job_renew(text,uuid,integer), public.worker_job_finish(text,uuid,boolean),
    public.purge_connect_intake(), public.purge_connect_invitations(),
    public.community_purge_applications(integer), public.community_purge_notifications(integer) TO harvest_worker;
END $$;
