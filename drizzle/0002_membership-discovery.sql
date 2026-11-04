-- Own memberships are discoverable only before selecting a tenant. Once selected,
-- every membership row, including the current user's, must belong to that tenant.
ALTER POLICY memberships_discover ON workspace_members
  USING (
    nullif(current_setting('app.tenant_id', true), '') IS NULL AND
    user_id = nullif(current_setting('app.user_id', true), '')
  );
