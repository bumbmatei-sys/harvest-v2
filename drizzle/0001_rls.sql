-- Migration owner owns tables. Runtime role has no ownership, inheritance, or RLS bypass.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_app') THEN
    CREATE ROLE harvest_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_app'
    AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit))
    OR EXISTS (SELECT FROM pg_auth_members WHERE member = 'harvest_app'::regrole)
  THEN RAISE EXCEPTION 'harvest_app must be an unprivileged SQL-created role without inherited memberships';
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO harvest_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, accounts, verifications, rate_limits, otp_cooldowns TO harvest_app;
GRANT SELECT ON roles TO harvest_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspaces, workspace_members TO harvest_app;
GRANT SELECT, INSERT ON audit_logs TO harvest_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM harvest_app;
INSERT INTO roles (id) VALUES ('owner'), ('admin'), ('member'), ('viewer') ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspaces_tenant ON workspaces TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members FORCE ROW LEVEL SECURITY;
-- A signed-in user can discover only their own memberships before tenant selection.
CREATE POLICY memberships_discover ON workspace_members FOR SELECT TO harvest_app
  USING (user_id = nullif(current_setting('app.user_id', true), ''));
CREATE POLICY memberships_tenant ON workspace_members TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_logs FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY audit_insert ON audit_logs FOR INSERT TO harvest_app
  WITH CHECK (
    actor_id = nullif(current_setting('app.user_id', true), '') AND
    ((tenant_id IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
     OR (tenant_id IS NULL AND action = 'auth.sign_in'))
  );
--> statement-breakpoint
-- Defense in depth: audit events cannot be changed even by accidental owner DML.
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs are append-only'; END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
