-- CF-02 finding (26 Nov): an aborted request closes its connection, but PostgreSQL keeps running the statement until it ends,
-- and behind Hyperdrive the origin connection stays busy. Bound every statement of the runtime logins, per database:
-- harvest_app 20 s (above the 15 s Workers request deadline), harvest_worker 60 s (batched jobs). The owner is unaffected.
-- Changing another role's settings needs CREATEROLE with ADMIN on the role (the trusted Neon owner that created them has it).
-- Where the migrating role lacks it, nothing changes and a notice says so; run this block again as a role that has it.
DO $$
DECLARE
  target text;
  limits constant text[][] := ARRAY[['harvest_app', '20s'], ['harvest_worker', '60s']];
BEGIN
  FOR i IN 1 .. array_length(limits, 1) LOOP
    target := limits[i][1];
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = target) THEN
      RAISE NOTICE 'role % does not exist; statement_timeout not set', target;
    ELSE
      BEGIN
        EXECUTE format('ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L', target, current_database(), limits[i][2]);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'current role cannot alter %; statement_timeout not set', target;
      END;
    END IF;
  END LOOP;
END $$;
