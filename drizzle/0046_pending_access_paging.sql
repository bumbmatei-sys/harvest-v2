-- HC-DEC2 follow-ups (the gate stays UNAPPROVED; nothing here collects data or enables delivery).
-- 1) The audited pending-metadata read becomes one bounded, keyset-paged call. 2) The inert consents read policy is dropped.

-- The old two-argument function is replaced, not overloaded: no second, unbounded entry point may remain.
DROP FUNCTION IF EXISTS public.read_pending_response_metadata(uuid, uuid);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.read_pending_response_metadata(p_tenant uuid, p_campaign uuid, p_limit integer DEFAULT 50, p_after_submitted timestamptz DEFAULT NULL, p_after_id uuid DEFAULT NULL)
RETURNS TABLE (response_id uuid, link_id uuid, form_version_id uuid, notice_version_id uuid, status text, submitted_at timestamptz, expires_at timestamptz, active_purposes text[], cursor_key text, has_more boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); read_count integer; page_size integer := least(greatest(coalesce(p_limit, 50), 1), 200);
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'pending response access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant AND m.user_id = actor AND m.role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pending response access denied' USING ERRCODE = '42501'; END IF;
  IF (p_after_submitted IS NULL) <> (p_after_id IS NULL) THEN RAISE EXCEPTION 'invalid page cursor' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    WITH page AS (
      SELECT r.id AS rid, r.link_id AS rlink, r.form_version_id AS rform, v.notice_version_id AS rnotice, r.status AS rstatus, r.submitted_at AS rsubmitted, r.expires_at AS rexpires,
        -- After expiry nothing is in force, matching connect_response_purpose_active.
        COALESCE((SELECT array_agg(DISTINCT g.purpose ORDER BY g.purpose) FROM public.campaign_response_consents g
          WHERE g.tenant_id = r.tenant_id AND g.response_id = r.id AND g.status = 'granted' AND g.redacted_at IS NULL AND r.expires_at > now()
            AND NOT EXISTS (SELECT 1 FROM public.campaign_response_consents w WHERE w.tenant_id = r.tenant_id AND w.response_id = r.id
              AND w.purpose = g.purpose AND w.status = 'withdrawn')), ARRAY[]::text[]) AS rpurposes
      FROM public.campaign_responses r
      LEFT JOIN public.form_versions v ON v.tenant_id = r.tenant_id AND v.id = r.form_version_id
      WHERE r.tenant_id = p_tenant AND r.campaign_id = p_campaign AND r.status = 'pending'
        AND (p_after_id IS NULL OR (r.submitted_at, r.id) > (p_after_submitted, p_after_id))
      ORDER BY r.submitted_at, r.id
      LIMIT page_size + 1),
    numbered AS (SELECT page.*, row_number() OVER (ORDER BY page.rsubmitted, page.rid) AS rn, count(*) OVER () AS total FROM page)
    SELECT n.rid, n.rlink, n.rform, n.rnotice, n.rstatus, n.rsubmitted, n.rexpires, n.rpurposes,
      -- Exact (microsecond) cursor position: a JS Date would round it.
      n.rsubmitted::text, n.total > page_size
    FROM numbered n WHERE n.rn <= page_size ORDER BY n.rn;
  GET DIAGNOSTICS read_count = ROW_COUNT;
  -- Counts only (rows returned in this page, no ids). The read and its audit row commit or fail together.
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'connect.pending.read', p_campaign::text, jsonb_build_object('count', read_count::text));
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.read_pending_response_metadata(uuid, uuid, integer, timestamptz, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.read_pending_response_metadata(uuid, uuid, integer, timestamptz, uuid) TO harvest_app;--> statement-breakpoint

-- 2) 0045 revoked SELECT on the consents table, which left this policy inert. Dropping it means a future re-grant of SELECT cannot
-- silently reopen access: with FORCE RLS, no policy for the application role and no grant, its access stays denied. The definers
-- read through the owner policy (erasure_owner_tenant, 0026), not this one.
DROP POLICY IF EXISTS campaign_response_consents_restricted_read ON public.campaign_response_consents;--> statement-breakpoint
REVOKE SELECT ON public.campaign_response_consents FROM harvest_app;
