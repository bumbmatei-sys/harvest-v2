CREATE TABLE "community_email_feedback" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "community_email_feedback_outcome" CHECK ("community_email_feedback"."outcome" in ('soft_bounce', 'hard_bounce', 'complaint'))
);
--> statement-breakpoint
CREATE TABLE "community_email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"address_hash" text NOT NULL,
	"masked_address" text NOT NULL,
	"reason" text NOT NULL,
	"soft_count" integer DEFAULT 0 NOT NULL,
	"blocked_at" timestamp with time zone,
	CONSTRAINT "community_email_suppression_reason" CHECK ("community_email_suppressions"."reason" in ('soft_bounce', 'hard_bounce', 'complaint'))
);
--> statement-breakpoint
ALTER TABLE "community_email_deliveries" ADD COLUMN "feedback_hash" text;--> statement-breakpoint
ALTER TABLE "community_email_deliveries" ADD COLUMN "feedback_mask" text;--> statement-breakpoint
ALTER TABLE "community_email_suppressions" ADD CONSTRAINT "community_email_suppressions_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_email_feedback_delivery_outcome_idx" ON "community_email_feedback" USING btree ("delivery_id","outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "community_email_suppression_address_idx" ON "community_email_suppressions" USING btree ("tenant_id","address_hash");--> statement-breakpoint
ALTER TABLE public.community_email_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_email_feedback FORCE ROW LEVEL SECURITY;
ALTER TABLE public.community_email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_email_suppressions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_email_feedback, public.community_email_suppressions FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['community_email_feedback', 'community_email_suppressions', 'community_email_deliveries'] LOOP
    EXECUTE format('CREATE POLICY feedback_worker ON public.%I TO %I USING (session_user = %L) WITH CHECK (session_user = %L)',
      relation, current_user, 'harvest_worker', 'harvest_worker');
  END LOOP;
  EXECUTE format($policy$CREATE POLICY feedback_admin_read ON public.community_email_suppressions FOR SELECT TO %I USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
      SELECT FROM public.workspace_members m WHERE m.tenant_id = community_email_suppressions.tenant_id
        AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.access_role(m.tenant_id, m.user_id, 'owner_admin', m.role_id) IN ('owner', 'admin')
    ))$policy$, current_user);
  EXECUTE format($policy$CREATE POLICY feedback_admin_remove ON public.community_email_suppressions FOR DELETE TO %I USING (
    reason = 'soft_bounce' AND blocked_at IS NOT NULL AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
      SELECT FROM public.workspace_members m WHERE m.tenant_id = community_email_suppressions.tenant_id
        AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.access_role(m.tenant_id, m.user_id, 'owner_admin', m.role_id) IN ('owner', 'admin')
    ))$policy$, current_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.community_email_check_suppression(p_id uuid, p_hash text, p_mask text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE delivery public.community_email_deliveries%ROWTYPE;
BEGIN
  PERFORM public.community_definer_reset();
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_mask IS NULL OR p_mask !~ '^[*]{3}@[a-z0-9.-]{1,253}$' THEN
    RAISE invalid_parameter_value;
  END IF;
  SELECT * INTO delivery FROM public.community_email_deliveries WHERE id = p_id AND status = 'sending' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'inactive'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(delivery.tenant_id::text || ':' || p_hash, 0));
  IF EXISTS (SELECT FROM public.community_email_suppressions
    WHERE tenant_id = delivery.tenant_id AND address_hash = p_hash AND blocked_at IS NOT NULL) THEN
    UPDATE public.community_email_deliveries SET status = 'skipped', last_error = 'address_suppressed', locked_until = NULL WHERE id = p_id;
    RETURN 'suppressed';
  END IF;
  IF delivery.feedback_hash IS NOT NULL AND delivery.feedback_hash <> p_hash THEN
    UPDATE public.community_email_deliveries SET status = 'skipped', last_error = 'address_changed', locked_until = NULL WHERE id = p_id;
    RETURN 'inactive';
  END IF;
  UPDATE public.community_email_deliveries SET feedback_hash = p_hash, feedback_mask = p_mask WHERE id = p_id;
  RETURN 'ready';
END $$;
--> statement-breakpoint
CREATE FUNCTION public.community_email_apply_feedback(p_event uuid, p_delivery uuid, p_outcome text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE delivery public.community_email_deliveries%ROWTYPE;
BEGIN
  PERFORM public.community_definer_reset();
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_event IS NULL OR p_outcome IS NULL OR p_outcome NOT IN ('soft_bounce', 'hard_bounce', 'complaint') THEN
    RAISE invalid_parameter_value;
  END IF;
  SELECT * INTO delivery FROM public.community_email_deliveries WHERE id = p_delivery AND feedback_hash IS NOT NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(delivery.tenant_id::text || ':' || delivery.feedback_hash, 0));
  INSERT INTO public.community_email_feedback(event_id, delivery_id, outcome) VALUES (p_event, p_delivery, p_outcome) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.community_email_suppressions AS previous(tenant_id, address_hash, masked_address, reason, soft_count, blocked_at)
    VALUES (delivery.tenant_id, delivery.feedback_hash, delivery.feedback_mask, p_outcome,
      CASE WHEN p_outcome = 'soft_bounce' THEN 1 ELSE 0 END, CASE WHEN p_outcome <> 'soft_bounce' THEN now() END)
    ON CONFLICT (tenant_id, address_hash) DO UPDATE SET
      reason = CASE WHEN previous.reason = 'complaint' OR excluded.reason = 'complaint' THEN 'complaint'
        WHEN previous.reason = 'hard_bounce' OR excluded.reason = 'hard_bounce' THEN 'hard_bounce' ELSE 'soft_bounce' END,
      soft_count = least(previous.soft_count + excluded.soft_count, 3),
      blocked_at = coalesce(previous.blocked_at, excluded.blocked_at,
        CASE WHEN previous.soft_count + excluded.soft_count >= 3 THEN now() END);
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.community_email_suppression_report(p_tenant uuid, p_page integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.community_definer_reset();
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id = p_tenant
    AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.access_role(m.tenant_id, m.user_id, 'owner_admin', m.role_id) IN ('owner', 'admin')
  ) THEN RAISE insufficient_privilege; END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000 THEN RAISE invalid_parameter_value; END IF;
  WITH blocked AS (
    SELECT id, masked_address, reason, blocked_at FROM public.community_email_suppressions WHERE tenant_id = p_tenant AND blocked_at IS NOT NULL
  ), summary AS (
    SELECT count(*) FILTER (WHERE reason = 'soft_bounce') AS soft,
      count(*) FILTER (WHERE reason = 'hard_bounce') AS hard, count(*) FILTER (WHERE reason = 'complaint') AS complaints FROM blocked
  ), items AS (
    SELECT id, masked_address AS "maskedAddress", reason, blocked_at AS "blockedAt"
      FROM blocked ORDER BY blocked_at DESC, id LIMIT 50 OFFSET (p_page-1)*50
  )
  SELECT jsonb_build_object('counts', (SELECT to_jsonb(summary) FROM summary), 'page', p_page,
    'items', coalesce((SELECT jsonb_agg(to_jsonb(items) ORDER BY "blockedAt" DESC, id) FROM items), '[]'::jsonb)) INTO result;
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.community_email_remove_soft_suppression(p_tenant uuid, p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.community_definer_reset();
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id = p_tenant
    AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.access_role(m.tenant_id, m.user_id, 'owner_admin', m.role_id) IN ('owner', 'admin')
  ) THEN RAISE insufficient_privilege; END IF;
  DELETE FROM public.community_email_suppressions WHERE tenant_id = p_tenant AND id = p_id AND reason = 'soft_bounce' AND blocked_at IS NOT NULL;
  RETURN FOUND;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_email_apply_feedback(uuid, uuid, text),
  public.community_email_check_suppression(uuid, text, text) FROM PUBLIC, harvest_app;
REVOKE ALL ON FUNCTION public.community_email_suppression_report(uuid, integer),
  public.community_email_remove_soft_suppression(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_email_suppression_report(uuid, integer),
  public.community_email_remove_soft_suppression(uuid, uuid) TO harvest_app;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.community_email_apply_feedback(uuid, uuid, text),
      public.community_email_check_suppression(uuid, text, text) TO harvest_worker;
  END IF;
END $$;
