-- Keep historical approvals and their audit references. The new limit is enforced on every new or updated row.
ALTER TABLE "ai_tool_approvals" DROP CONSTRAINT "ai_tool_approval_expiry";--> statement-breakpoint
ALTER TABLE "ai_tool_approvals" ADD CONSTRAINT "ai_tool_approval_expiry" CHECK ("ai_tool_approvals"."expires_at" > "ai_tool_approvals"."created_at" and "ai_tool_approvals"."expires_at" <= "ai_tool_approvals"."created_at" + interval '10 minutes') NOT VALID;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_ai_tool_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF actor IS NULL OR NEW.requested_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'approval belongs to another person'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.decided_at IS NOT NULL OR NEW.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'approval must start pending'; END IF;
    IF NEW.created_at > clock_timestamp() THEN RAISE EXCEPTION 'approval cannot start in the future'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.tool, NEW.args_hash, NEW.requested_by, NEW.expires_at, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.tool, OLD.args_hash, OLD.requested_by, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'approval identity is immutable';
  END IF;
  -- Check after acquiring the row lock. A transaction may have begun well before the approval expired.
  IF clock_timestamp() >= OLD.expires_at OR OLD.expires_at > OLD.created_at + interval '10 minutes' THEN
    RAISE EXCEPTION 'approval has expired' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') AND NEW.decided_at IS NOT NULL AND NEW.consumed_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'approved' AND NEW.status = 'consumed' AND NEW.consumed_at IS NOT NULL AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'approval cannot change from % to %', OLD.status, NEW.status;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_ai_tool_approval() FROM PUBLIC;--> statement-breakpoint

-- Keep the existing import workflows intact. The support projection uses the caller's current RLS context.
CREATE FUNCTION public.crm_import_diagnostics(p_tenant uuid)
RETURNS TABLE (
  id uuid, entity text, status text, created_at timestamptz, updated_at timestamptz,
  completed_at timestamptz, rolled_back_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_tenant IS NULL
    OR p_tenant::text IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')
    OR NOT EXISTS (
      SELECT 1 FROM public.workspace_members AS member
      WHERE member.tenant_id = p_tenant AND member.user_id = nullif(current_setting('app.user_id', true), '')
        AND member.role_id IN ('owner', 'admin')
    ) THEN
    RAISE EXCEPTION 'import diagnostics access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT i.id, i.entity, i.status, i.created_at, i.updated_at, i.completed_at, i.rolled_back_at
    FROM public.crm_imports AS i
    WHERE i.tenant_id = p_tenant
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT 50;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.crm_import_diagnostics(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.crm_import_diagnostics(uuid) TO harvest_app;
