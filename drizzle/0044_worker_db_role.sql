-- Dedicated background-worker role. The six worker functions (community email enqueue/claim/complete, Connect retention sweep/record_failure/health)
-- stop being callable by the web application role: code running as harvest_app could otherwise read recipients' addresses across ministries
-- through the claim function and falsify the retention health signal. Only harvest_worker may execute them, and it has no table privileges.
-- Roles are provisioned outside the migrations (docs/setup/worker-role.md), so this never creates one: the revoke is unconditional and the
-- grant happens only when harvest_worker already exists. On a database without the role, run the grant block again once the role exists
-- (the runbook gives the exact statement); applying this migration earlier is safe and simply leaves the worker functions uncallable.
REVOKE ALL ON FUNCTION public.community_email_enqueue(integer), public.community_email_claim(integer), public.community_email_complete(uuid, text, text),
  public.connect_retention_sweep(integer), public.connect_retention_record_failure(text), public.connect_retention_health() FROM PUBLIC, harvest_app;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit))
      OR EXISTS (SELECT FROM pg_auth_members WHERE member = 'harvest_worker'::regrole)
    THEN RAISE EXCEPTION 'harvest_worker must be an unprivileged SQL-created role without inherited memberships';
    END IF;
    GRANT EXECUTE ON FUNCTION public.community_email_enqueue(integer), public.community_email_claim(integer), public.community_email_complete(uuid, text, text),
      public.connect_retention_sweep(integer), public.connect_retention_record_failure(text), public.connect_retention_health() TO harvest_worker;
  END IF;
END $$;
