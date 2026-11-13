-- HC-DEC2 engineering (direction selected 13 Nov 2026: owner/admin only until assigned-counselor access exists; the gate stays UNAPPROVED).
-- Pending (unverified) response metadata is read through one audited owner/admin definer. Nothing here collects data or enables delivery.

-- 1) The audited read. Metadata only: no name, locale, submission key, contact method, CRM link or anything the person said.
CREATE OR REPLACE FUNCTION public.read_pending_response_metadata(p_tenant uuid, p_campaign uuid)
RETURNS TABLE (response_id uuid, link_id uuid, form_version_id uuid, notice_version_id uuid, status text, submitted_at timestamptz, expires_at timestamptz, active_purposes text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); read_count integer;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'pending response access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant AND m.user_id = actor AND m.role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pending response access denied' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT r.id, r.link_id, r.form_version_id, v.notice_version_id, r.status, r.submitted_at, r.expires_at,
      -- After expiry nothing is in force, matching connect_response_purpose_active.
      COALESCE((SELECT array_agg(DISTINCT g.purpose ORDER BY g.purpose) FROM public.campaign_response_consents g
        WHERE g.tenant_id = r.tenant_id AND g.response_id = r.id AND g.status = 'granted' AND g.redacted_at IS NULL AND r.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM public.campaign_response_consents w WHERE w.tenant_id = r.tenant_id AND w.response_id = r.id
            AND w.purpose = g.purpose AND w.status = 'withdrawn')), ARRAY[]::text[])
    FROM public.campaign_responses r
    LEFT JOIN public.form_versions v ON v.tenant_id = r.tenant_id AND v.id = r.form_version_id
    WHERE r.tenant_id = p_tenant AND r.campaign_id = p_campaign AND r.status = 'pending'
    ORDER BY r.submitted_at, r.id;
  GET DIAGNOSTICS read_count = ROW_COUNT;
  -- Counts only. The read and its audit row commit or fail together.
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'connect.pending.read', p_campaign::text, jsonb_build_object('count', read_count::text));
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.read_pending_response_metadata(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.read_pending_response_metadata(uuid, uuid) TO harvest_app;--> statement-breakpoint

-- 2) Direct reads can no longer see pending rows, even for an owner/admin. Associated and erased rows keep the 0026 behavior
-- (CRM source filters join them). Evidence rows have no direct application reader any more: the definer above is the reader.
DROP POLICY IF EXISTS campaign_responses_restricted_read ON public.campaign_responses;--> statement-breakpoint
CREATE POLICY campaign_responses_restricted_read ON public.campaign_responses FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND status <> 'pending'
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_responses.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));--> statement-breakpoint
REVOKE SELECT ON public.campaign_response_consents FROM harvest_app;
