CREATE TABLE "campaign_followup_team" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_followup_team_tenant_id_campaign_id_user_id_pk" PRIMARY KEY("tenant_id","campaign_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_followup_team" ADD CONSTRAINT "campaign_followup_team_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_followup_team" ADD CONSTRAINT "campaign_followup_team_tenant_id_user_id_workspace_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followup_cases_campaign_idx" ON "followup_cases" USING btree ("tenant_id","campaign_id","created_at","id");--> statement-breakpoint
-- CW-11. followup_cases keeps campaign_id unreadable to harvest_app (0048), so the per-campaign list, counts and team go only through the
-- definers below. Each re-checks the caller with followup_actor_role (owner/admin, connect area since 0113) and the campaign's tenant,
-- returns no names or contact details, and the team table has no grant to the app at all.
ALTER TABLE public.campaign_followup_team ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.campaign_followup_team FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.campaign_followup_team FROM PUBLIC, harvest_app;--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY campaign_followup_team_definer ON public.campaign_followup_team TO %I
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, current_user);
END $$;--> statement-breakpoint
CREATE FUNCTION public.followup_campaign_manager(p_tenant uuid, p_campaign uuid) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor_role text;
BEGIN
  actor_role := public.followup_actor_role(p_tenant);
  IF actor_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'follow-up access denied' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.campaigns c WHERE c.tenant_id = p_tenant AND c.id = p_campaign;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found' USING ERRCODE = 'P0002'; END IF;
  RETURN nullif(current_setting('app.user_id', true), '');
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_campaign_manager(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
-- Counts only, grouped as the dashboard shows them; never a name or a contact.
CREATE FUNCTION public.followup_campaign_counts(p_tenant uuid, p_campaign uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.followup_campaign_manager(p_tenant, p_campaign);
  RETURN (SELECT jsonb_build_object(
      'waiting', count(*) FILTER (WHERE f.state IN ('requested', 'awaiting_assignment')),
      'assigned', count(*) FILTER (WHERE f.state IN ('assigned', 'attempted')),
      'connected', count(*) FILTER (WHERE f.state = 'connected'),
      'closed', count(*) FILTER (WHERE f.state IN ('no_response', 'closed', 'withdrawn')))
    FROM public.followup_cases f WHERE f.tenant_id = p_tenant AND f.campaign_id = p_campaign);
END $$;--> statement-breakpoint
-- One bounded page of a campaign's cases, oldest first, the same columns the ministry-wide list exposes (no campaign or response id).
CREATE FUNCTION public.followup_campaign_cases(p_tenant uuid, p_campaign uuid, p_limit integer, p_after_created timestamptz, p_after_id uuid,
  p_state text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.followup_campaign_manager(p_tenant, p_campaign);
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 201 THEN RAISE EXCEPTION 'invalid page size' USING ERRCODE = '22023'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'state', f.state, 'contactId', f.contact_id, 'assigneeId', f.assignee_id,
      'version', f.version, 'createdAt', f.created_at, 'updatedAt', f.updated_at, 'stateChangedAt', f.state_changed_at, 'assignedAt', f.assigned_at,
      'cursorKey', f.created_at::text) ORDER BY f.created_at, f.id)
    FROM (SELECT * FROM public.followup_cases f WHERE f.tenant_id = p_tenant AND f.campaign_id = p_campaign
      AND (p_state IS NULL OR f.state = p_state)
      AND (p_after_created IS NULL OR (f.created_at, f.id) > (p_after_created, p_after_id))
      ORDER BY f.created_at, f.id LIMIT p_limit) f), '[]'::jsonb);
END $$;--> statement-breakpoint
-- The team: user ids only (the screens already resolve member names through listAssignableMembers).
CREATE FUNCTION public.followup_campaign_team(p_tenant uuid, p_campaign uuid) RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.followup_campaign_manager(p_tenant, p_campaign);
  RETURN coalesce((SELECT array_agg(t.user_id ORDER BY t.created_at, t.user_id) FROM public.campaign_followup_team t
    WHERE t.tenant_id = p_tenant AND t.campaign_id = p_campaign), '{}');
END $$;--> statement-breakpoint
-- Add or remove one member. Only an active owner, admin or member can be on a team (never a viewer); idempotent; audited.
CREATE FUNCTION public.set_followup_campaign_team_member(p_tenant uuid, p_campaign uuid, p_user text, p_member boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text; changed integer;
BEGIN
  actor := public.followup_campaign_manager(p_tenant, p_campaign);
  IF p_member THEN
    PERFORM 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant AND m.user_id = p_user
      AND public.access_role(m.tenant_id, m.user_id, 'connect', m.role_id) IN ('owner', 'admin', 'member') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'assignee is not an eligible member' USING ERRCODE = '23514'; END IF;
    INSERT INTO public.campaign_followup_team (tenant_id, campaign_id, user_id, added_by) VALUES (p_tenant, p_campaign, p_user, actor) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.campaign_followup_team t WHERE t.tenant_id = p_tenant AND t.campaign_id = p_campaign AND t.user_id = p_user;
  END IF;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed > 0 THEN
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata) VALUES (p_tenant, actor,
      CASE WHEN p_member THEN 'followup.campaign_team.add' ELSE 'followup.campaign_team.remove' END, p_campaign::text, jsonb_build_object('member', p_user));
  END IF;
  RETURN changed > 0;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_campaign_counts(uuid, uuid), public.followup_campaign_cases(uuid, uuid, integer, timestamptz, uuid, text),
  public.followup_campaign_team(uuid, uuid), public.set_followup_campaign_team_member(uuid, uuid, text, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.followup_campaign_counts(uuid, uuid), public.followup_campaign_cases(uuid, uuid, integer, timestamptz, uuid, text),
  public.followup_campaign_team(uuid, uuid), public.set_followup_campaign_team_member(uuid, uuid, text, boolean) TO harvest_app;
