CREATE TABLE "campaign_event_links" (
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_event_links_tenant_id_campaign_id_event_id_pk" PRIMARY KEY("tenant_id","campaign_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_event_links" ADD CONSTRAINT "campaign_event_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_event_links" ADD CONSTRAINT "campaign_event_links_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_event_links" ADD CONSTRAINT "campaign_event_links_tenant_id_event_id_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_event_links_event_idx" ON "campaign_event_links" USING btree ("tenant_id","event_id");--> statement-breakpoint
-- Campaign events (founder approval, 26 Nov). A campaign shows existing ministry events; the event itself stays the one record in Events (0059+).
-- The link table has no grant to the app. Every read and change goes through public.campaign_events_operate, which asks access_role twice:
--   * campaigns area: the caller must be able to write campaigns (owner/admin/member), and the campaign must be in the caller's ministry;
--   * communities area (Events): owners/admins of Events see every linked event and alone may link or unlink; anyone else sees only linked events
--     that are published and that Events already shows them (public.events_sources), so a campaign never reveals an event Events would hide.
-- Nothing here publishes, sends or changes an event.
ALTER TABLE public.campaign_event_links ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.campaign_event_links FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.campaign_event_links FROM PUBLIC, harvest_app;--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY campaign_event_links_definer ON public.campaign_event_links TO %I
    USING (tenant_id = nullif(current_setting('app.events_tenant', true), '')::uuid
      AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.events_tenant', true), '')::uuid
      AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, current_user);
END $$;--> statement-breakpoint
CREATE FUNCTION public.campaign_events_perform(p_tenant uuid, p_campaign uuid, p_action text, p_event uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); stored_role text; is_manager boolean; changed integer;
  moment timestamptz := statement_timestamp(); result jsonb; missing jsonb := '{"outcome":"not_found"}';
BEGIN
  IF actor IS NULL OR p_tenant IS NULL OR p_campaign IS NULL OR p_action IS NULL OR p_action NOT IN ('list', 'candidates', 'link', 'unlink')
    OR p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid THEN RETURN missing; END IF;
  SELECT w.role_id INTO stored_role FROM public.workspace_members w WHERE w.tenant_id = p_tenant AND w.user_id = actor FOR SHARE;
  IF stored_role IS NULL OR public.access_role(p_tenant, actor, 'campaigns', stored_role) NOT IN ('owner', 'admin', 'member') THEN RETURN missing; END IF;
  PERFORM 1 FROM public.campaigns c WHERE c.tenant_id = p_tenant AND c.id = p_campaign;
  IF NOT FOUND THEN RETURN missing; END IF;
  is_manager := public.access_role(p_tenant, actor, 'communities', stored_role) IN ('owner', 'admin');
  IF p_action IN ('candidates', 'link', 'unlink') AND NOT is_manager THEN RETURN missing; END IF;

  IF p_action = 'list' THEN
    SELECT coalesce(jsonb_agg(public.events_project(q.event, actor, moment) ORDER BY (q.event).starts_at, (q.event).id), '[]'::jsonb) INTO result FROM (
      SELECT e AS event FROM public.campaign_event_links l JOIN public.events e ON e.tenant_id = l.tenant_id AND e.id = l.event_id
      WHERE l.tenant_id = p_tenant AND l.campaign_id = p_campaign
        AND (is_manager OR (e.published_at IS NOT NULL AND e.status = 'published' AND public.events_sources(p_tenant, e.id, actor, moment) <> '{}'::jsonb))
      ORDER BY e.starts_at, e.id LIMIT 100) q;
    RETURN jsonb_build_object('outcome', 'ok', 'data', result, 'manage', is_manager);
  END IF;
  IF p_action = 'candidates' THEN
    -- Events that are not cancelled, not yet in this campaign and not long over: what the "Add event" control offers.
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'startsAt', q.starts_at, 'timeZone', q.time_zone, 'status', q.status)
      ORDER BY q.starts_at, q.id), '[]'::jsonb) INTO result FROM (
      SELECT e.id, e.title, e.starts_at, e.time_zone, e.status FROM public.events e
      WHERE e.tenant_id = p_tenant AND e.status <> 'cancelled' AND e.ends_at > moment - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM public.campaign_event_links l WHERE l.tenant_id = p_tenant AND l.campaign_id = p_campaign AND l.event_id = e.id)
      ORDER BY e.starts_at, e.id LIMIT 200) q;
    RETURN jsonb_build_object('outcome', 'ok', 'data', result);
  END IF;
  IF p_event IS NULL THEN RETURN missing; END IF;
  PERFORM 1 FROM public.events e WHERE e.tenant_id = p_tenant AND e.id = p_event;
  IF NOT FOUND THEN RETURN missing; END IF;
  IF p_action = 'link' THEN
    INSERT INTO public.campaign_event_links (tenant_id, campaign_id, event_id, created_by) VALUES (p_tenant, p_campaign, p_event, actor) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.campaign_event_links l WHERE l.tenant_id = p_tenant AND l.campaign_id = p_campaign AND l.event_id = p_event;
  END IF;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN jsonb_build_object('outcome', 'ok', 'data', jsonb_build_object('changed', changed > 0));
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_events_perform(uuid, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
-- The same entry shape as public.events_operate: the Events definer settings are set for the call and put back afterwards.
CREATE FUNCTION public.campaign_events_operate(p_tenant uuid, p_campaign uuid, p_action text, p_event uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous_tenant text := current_setting('app.events_tenant', true); previous_community text := current_setting('app.community_definer_tenant', true); result jsonb;
BEGIN
  PERFORM set_config('app.events_tenant', coalesce(p_tenant::text, ''), true);
  PERFORM set_config('app.community_definer_tenant', coalesce(p_tenant::text, ''), true);
  result := public.campaign_events_perform(p_tenant, p_campaign, p_action, p_event);
  PERFORM set_config('app.events_tenant', coalesce(previous_tenant, ''), true);
  PERFORM set_config('app.community_definer_tenant', coalesce(previous_community, ''), true);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.campaign_events_operate(uuid, uuid, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.campaign_events_operate(uuid, uuid, text, uuid) TO harvest_app;
