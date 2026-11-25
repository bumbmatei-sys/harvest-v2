CREATE TABLE "platform_staff" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "platform_staff_shape" CHECK ("platform_staff"."role" in ('reviewer','admin') and length("platform_staff"."granted_by") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "platform_staff_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_staff_audit_shape" CHECK (length("platform_staff_audit"."action") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_staff_audit_actor_idx" ON "platform_staff_audit" USING btree ("actor_id","created_at");--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['platform_staff','platform_staff_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', t);
    -- Only the SECURITY DEFINER functions below set this flag. No application policy and no application grant exists on these tables.
    EXECUTE format('CREATE POLICY platform_staff_definer ON public.%I TO PUBLIC USING (current_user <> ''harvest_app'' AND current_setting(''app.platform_staff'', true) = ''on'') WITH CHECK (current_user <> ''harvest_app'' AND current_setting(''app.platform_staff'', true) = ''on'')', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Ops only: granted by the migration owner from scripts/platform-staff.ts. Nobody else holds EXECUTE (not the application role, not the worker role).
CREATE FUNCTION public.platform_staff_grant(p_user text, p_role text, p_by text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_user IS NULL OR p_role IS NULL OR p_role NOT IN ('reviewer','admin') OR p_by IS NULL OR length(btrim(p_by)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid staff grant'; END IF;
  PERFORM set_config('app.platform_staff', 'on', true);
  INSERT INTO public.platform_staff(user_id, role, granted_by) VALUES (p_user, p_role, btrim(p_by))
    ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, created_at = now(), revoked_at = NULL;
  INSERT INTO public.platform_staff_audit(actor_id, action, target_type, target_id) VALUES (btrim(p_by), 'staff.grant', 'user', p_user);
  PERFORM set_config('app.platform_staff', '', true);
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.platform_staff_revoke(p_user text, p_by text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_user IS NULL OR p_by IS NULL OR length(btrim(p_by)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid staff revoke'; END IF;
  PERFORM set_config('app.platform_staff', 'on', true);
  UPDATE public.platform_staff SET revoked_at = now() WHERE user_id = p_user AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN INSERT INTO public.platform_staff_audit(actor_id, action, target_type, target_id) VALUES (btrim(p_by), 'staff.revoke', 'user', p_user); END IF;
  PERFORM set_config('app.platform_staff', '', true);
  RETURN n = 1;
END $$;
--> statement-breakpoint
-- The role of an ACTIVE staff member, or NULL. Internal helper: no one but the other definers calls it.
CREATE FUNCTION public.platform_staff_role(p_user text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r text; prior text := current_setting('app.platform_staff', true);
BEGIN
  IF p_user IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.platform_staff', 'on', true);
  SELECT s.role INTO r FROM public.platform_staff s WHERE s.user_id = p_user AND s.revoked_at IS NULL;
  PERFORM set_config('app.platform_staff', coalesce(prior, ''), true);
  RETURN r;
END $$;
--> statement-breakpoint
-- Records one staff action. Internal helper.
CREATE FUNCTION public.platform_staff_log(p_actor text, p_action text, p_type text, p_id text, p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := current_setting('app.platform_staff', true);
BEGIN
  PERFORM set_config('app.platform_staff', 'on', true);
  INSERT INTO public.platform_staff_audit(actor_id, action, target_type, target_id, tenant_id) VALUES (p_actor, left(p_action, 80), left(p_type, 40), left(p_id, 200), p_tenant);
  PERFORM set_config('app.platform_staff', coalesce(prior, ''), true);
END $$;
--> statement-breakpoint
-- The caller's own staff role (null for everyone else). The one fact the web layer may ask.
CREATE FUNCTION public.platform_staff_me() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.platform_staff_role(nullif(current_setting('app.user_id', true), ''))
$$;
--> statement-breakpoint
-- Staff Discover review. Every function checks the active role of the signed-in user, writes a staff audit row and returns Discover review data only (no member, application, payment
-- or private ministry data). Reviewers approve and reject, resolve reports and read the queue; admins also suspend, reinstate and change a ministry's Discover standing.
CREATE FUNCTION public.platform_discover_queue(p_state text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); result jsonb;
BEGIN
  IF public.platform_staff_role(actor) IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  result := public.discover_platform_queue(p_state, p_limit);
  PERFORM public.platform_staff_log(actor, 'discover.queue', 'queue', p_state, NULL);
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.platform_discover_decide(p_type text, p_id uuid, p_decision text, p_reason text, p_version integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); role text; tenant uuid; n integer; outcome text;
BEGIN
  role := public.platform_staff_role(actor);
  IF role IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve','reject','suspend','reinstate') THEN RAISE EXCEPTION 'invalid review decision'; END IF;
  IF p_decision IN ('suspend','reinstate') AND role <> 'admin' THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('app.discover_platform', 'on', true);
  SELECT count(*), min(tenant_id::text)::uuid INTO n, tenant FROM public.discover_controls WHERE resource_type = p_type AND resource_id = p_id;
  PERFORM set_config('app.discover_platform', '', true);
  IF n <> 1 THEN RETURN 'not_found'; END IF;
  outcome := public.discover_platform_decide(tenant, p_type, p_id, p_decision, p_reason, actor, p_version);
  PERFORM public.platform_staff_log(actor, 'discover.decision.' || p_decision, p_type, p_id::text, tenant);
  RETURN outcome;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.platform_discover_reports(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); result jsonb;
BEGIN
  IF public.platform_staff_role(actor) IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  result := public.discover_platform_reports(p_limit);
  PERFORM public.platform_staff_log(actor, 'discover.reports', 'queue', 'open', NULL);
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.platform_discover_resolve_report(p_id uuid, p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); done boolean;
BEGIN
  IF public.platform_staff_role(actor) IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  done := public.discover_platform_resolve_report(p_id, p_status, actor);
  IF done THEN PERFORM public.platform_staff_log(actor, 'discover.report.' || p_status, 'report', p_id::text, NULL); END IF;
  RETURN done;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.platform_discover_standing(p_tenant uuid, p_suspended boolean, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF public.platform_staff_role(actor) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.discover_platform_standing(p_tenant, p_suspended, p_reason, actor);
  PERFORM public.platform_staff_log(actor, CASE WHEN p_suspended THEN 'discover.standing.suspend' ELSE 'discover.standing.restore' END, 'ministry', p_tenant::text, p_tenant);
  RETURN true;
END $$;
--> statement-breakpoint
-- The legacy communities-only Discover list under the same approval rule as the unified search (listing approved for exactly its current public fields, ministry not suspended).
CREATE FUNCTION public.discover_communities_approved(p_query text, p_open_only boolean, p_after timestamptz, p_after_id uuid, p_limit integer) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.discover_read', 'on', true);
  RETURN QUERY SELECT jsonb_build_object('id', d.resource_id, 'slug', d.slug, 'name', d.name, 'tagline', d.tagline, 'hostName', d.host_name,
      'pricing', d.pricing, 'admission', to_jsonb(d.admission), 'updatedAt', d.updated_at)
    FROM public.discover_listings d
      JOIN public.discover_controls c ON (c.tenant_id, c.resource_type, c.resource_id) = (d.tenant_id, d.resource_type, d.resource_id)
      LEFT JOIN public.discover_ministry_standing s ON s.tenant_id = d.tenant_id
    WHERE d.resource_type = 'community' AND c.review_state = 'approved' AND c.reviewed_hash IS NOT NULL AND c.reviewed_hash = d.content_hash AND coalesce(s.suspended, false) = false
      AND (coalesce(p_query, '') = '' OR d.search_text LIKE '%' || replace(replace(replace(lower(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
      AND (NOT coalesce(p_open_only, false) OR 'open' = ANY (d.admission))
      AND (p_after IS NULL OR (d.updated_at, d.resource_id) < (p_after, p_after_id))
    ORDER BY d.updated_at DESC, d.resource_id DESC
    LIMIT least(greatest(coalesce(p_limit, 24), 1), 48);
  PERFORM public.community_definer_reset();
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.platform_staff_grant(text,text,text), public.platform_staff_revoke(text,text), public.platform_staff_role(text), public.platform_staff_log(text,text,text,text,uuid),
  public.platform_staff_me(), public.platform_discover_queue(text,integer), public.platform_discover_decide(text,uuid,text,text,integer), public.platform_discover_reports(integer),
  public.platform_discover_resolve_report(uuid,text), public.platform_discover_standing(uuid,boolean,text), public.discover_communities_approved(text,boolean,timestamptz,uuid,integer) FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- The web application may call only the staff-checked Discover functions and ask for its own role; grant, revoke, role and log stay unreachable from request code.
GRANT EXECUTE ON FUNCTION public.platform_staff_me(), public.platform_discover_queue(text,integer), public.platform_discover_decide(text,uuid,text,text,integer), public.platform_discover_reports(integer),
  public.platform_discover_resolve_report(uuid,text), public.platform_discover_standing(uuid,boolean,text), public.discover_communities_approved(text,boolean,timestamptz,uuid,integer) TO harvest_app;
