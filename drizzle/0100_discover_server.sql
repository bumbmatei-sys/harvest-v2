CREATE TABLE "discover_controls" (
	"tenant_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"owner_opt_in" boolean DEFAULT false NOT NULL,
	"category" text,
	"language" text,
	"review_state" text DEFAULT 'not_requested' NOT NULL,
	"review_reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_hash" text,
	"current_hash" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discover_controls_tenant_id_resource_type_resource_id_pk" PRIMARY KEY("tenant_id","resource_type","resource_id"),
	CONSTRAINT "discover_controls_shape" CHECK ("discover_controls"."resource_type" in ('community','course','product') and "discover_controls"."review_state" in ('not_requested','pending','approved','rejected','suspended')
    and ("discover_controls"."language" is null or "discover_controls"."language" ~ '^[a-z]{2,3}$') and ("discover_controls"."category" is null or "discover_controls"."category" in ('discipleship','prayer','worship','bible_study','outreach','missions','youth','family','leadership','service','recovery','other'))
    and ("discover_controls"."review_reason" is null or length("discover_controls"."review_reason") <= 500) and "discover_controls"."version" >= 1 and ("discover_controls"."review_state" not in ('approved','rejected','suspended') or "discover_controls"."reviewed_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "discover_ministry_standing" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"reason" text,
	"set_by" text,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discover_standing_reason" CHECK ("discover_ministry_standing"."reason" is null or length("discover_ministry_standing"."reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "discover_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "discover_reports_shape" CHECK ("discover_reports"."resource_type" in ('community','course','product') and "discover_reports"."reason" in ('spam','inappropriate','misleading','impersonation','other') and "discover_reports"."status" in ('open','reviewed','dismissed') and ("discover_reports"."note" is null or length("discover_reports"."note") <= 500))
);
--> statement-breakpoint
CREATE TABLE "discover_review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"reviewer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discover_review_events_shape" CHECK ("discover_review_events"."decision" in ('approve','reject','suspend','reinstate','standing_suspend','standing_restore') and ("discover_review_events"."reason" is null or length("discover_review_events"."reason") <= 500))
);
--> statement-breakpoint
ALTER TABLE "discover_listings" DROP CONSTRAINT "discover_resource_type";--> statement-breakpoint
ALTER TABLE "discover_listings" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "discover_listings" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "discover_listings" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "discover_listings" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "discover_listings" ADD COLUMN "is_free" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "discover_listings" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "discover_controls" ADD CONSTRAINT "discover_controls_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discover_controls" ADD CONSTRAINT "discover_controls_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discover_ministry_standing" ADD CONSTRAINT "discover_ministry_standing_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discover_reports" ADD CONSTRAINT "discover_reports_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discover_reports" ADD CONSTRAINT "discover_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discover_review_events" ADD CONSTRAINT "discover_review_events_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discover_controls_review_idx" ON "discover_controls" USING btree ("review_state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discover_reports_open_idx" ON "discover_reports" USING btree ("reporter_id","resource_type","resource_id") WHERE "discover_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "discover_reports_queue_idx" ON "discover_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "discover_review_events_resource_idx" ON "discover_review_events" USING btree ("tenant_id","resource_type","resource_id","created_at");--> statement-breakpoint
ALTER TABLE "discover_listings" ADD CONSTRAINT "discover_listing_public_fields" CHECK (("discover_listings"."summary" is null or length("discover_listings"."summary") <= 280) and ("discover_listings"."language" is null or "discover_listings"."language" ~ '^[a-z]{2,3}$'));--> statement-breakpoint
ALTER TABLE "discover_listings" ADD CONSTRAINT "discover_resource_type" CHECK ("discover_listings"."resource_type" in ('community','course','product'));--> statement-breakpoint
CREATE FUNCTION public.discover_can(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner','admin'))
$$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['discover_controls','discover_ministry_standing','discover_reports','discover_review_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', t);
    -- Only the SECURITY DEFINER functions below set these flags; the application role can never satisfy the guard.
    EXECUTE format('CREATE POLICY discover_platform_write ON public.%I TO PUBLIC USING (current_user <> ''harvest_app'' AND current_setting(''app.discover_platform'', true) = ''on'') WITH CHECK (current_user <> ''harvest_app'' AND current_setting(''app.discover_platform'', true) = ''on'')', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['discover_controls','discover_ministry_standing'] LOOP
    EXECUTE format('CREATE POLICY discover_read_flag ON public.%I FOR SELECT TO PUBLIC USING (current_user <> ''harvest_app'' AND current_setting(''app.discover_read'', true) = ''on'')', t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.discover_controls TO harvest_app;
--> statement-breakpoint
CREATE POLICY discover_controls_staff ON public.discover_controls TO harvest_app USING (public.discover_can(tenant_id)) WITH CHECK (public.discover_can(tenant_id));
--> statement-breakpoint
-- Owners may request and withdraw review and edit their own metadata. They can never approve, reject, suspend or edit the reviewer fields: the platform functions below (a different role) do.
CREATE FUNCTION public.discover_controls_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user = 'harvest_app' AND (NEW.review_state NOT IN ('not_requested','pending') OR (NEW.reviewed_by, NEW.reviewed_at, NEW.reviewed_hash, NEW.review_reason) IS DISTINCT FROM (NULL::text, NULL::timestamptz, NULL::text, NULL::text)) THEN
      RAISE EXCEPTION 'a listing starts without a decision' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.resource_type, NEW.resource_id) IS DISTINCT FROM (OLD.tenant_id, OLD.resource_type, OLD.resource_id) THEN RAISE EXCEPTION 'listing identity is immutable'; END IF;
  IF current_user = 'harvest_app' THEN
    IF (NEW.reviewed_by, NEW.reviewed_at, NEW.reviewed_hash, NEW.review_reason) IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at, OLD.reviewed_hash, OLD.review_reason) THEN
      RAISE EXCEPTION 'review decisions are made by the platform' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.review_state IS DISTINCT FROM OLD.review_state AND NOT (
      (OLD.review_state IN ('not_requested','rejected') AND NEW.review_state = 'pending')
      OR (OLD.review_state = 'approved' AND NEW.review_state = 'pending' AND NEW.current_hash IS DISTINCT FROM OLD.reviewed_hash)
      OR (OLD.review_state = 'pending' AND NEW.review_state = 'not_requested')) THEN
      RAISE EXCEPTION 'review state cannot move from % to % here', OLD.review_state, NEW.review_state USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER discover_controls_guard BEFORE INSERT OR UPDATE ON public.discover_controls FOR EACH ROW EXECUTE FUNCTION public.discover_controls_guard();
--> statement-breakpoint
-- Public read. Applies every rule again at read time, so an unlist, suspension or material change takes effect at once even if a projection row is stale:
-- projection row exists (published, listed, opted in) AND approved for exactly the current public fields AND the ministry is not suspended.
CREATE FUNCTION public.discover_search(p_q text, p_type text, p_category text, p_language text, p_audience text, p_free boolean, p_sort text, p_offset integer, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q text := lower(btrim(coalesce(p_q, ''))); pat text; lim integer := least(greatest(coalesce(p_limit, 24), 1), 48); off integer := least(greatest(coalesce(p_offset, 0), 0), 960); result jsonb;
BEGIN
  IF p_sort IS NULL OR p_sort NOT IN ('relevance','newest','name') THEN RAISE EXCEPTION 'invalid sort'; END IF;
  pat := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  PERFORM set_config('app.discover_read', 'on', true);
  WITH visible AS (
    SELECT d.* FROM public.discover_listings d
      JOIN public.discover_controls c ON (c.tenant_id, c.resource_type, c.resource_id) = (d.tenant_id, d.resource_type, d.resource_id)
      LEFT JOIN public.discover_ministry_standing s ON s.tenant_id = d.tenant_id
    WHERE c.review_state = 'approved' AND c.reviewed_hash IS NOT NULL AND c.reviewed_hash = d.content_hash AND coalesce(s.suspended, false) = false
      AND (q = '' OR d.search_text LIKE '%' || pat || '%')
      AND (p_category IS NULL OR d.category = p_category) AND (p_language IS NULL OR d.language = p_language) AND (p_audience IS NULL OR d.audience = p_audience)
      AND (p_free IS NULL OR d.is_free = p_free)
  ), facets AS (SELECT resource_type, count(*)::int AS n FROM visible GROUP BY resource_type),
  ranked AS (
    SELECT v.*, row_number() OVER (ORDER BY
      CASE WHEN p_sort = 'relevance' THEN CASE WHEN q <> '' AND lower(v.name) LIKE pat || '%' THEN 2 WHEN q <> '' AND lower(v.name) LIKE '%' || pat || '%' THEN 1 ELSE 0 END END DESC NULLS LAST,
      CASE WHEN p_sort = 'name' THEN lower(v.name) END ASC NULLS LAST, v.updated_at DESC, v.resource_id DESC) AS rn
    FROM visible v WHERE p_type IS NULL OR v.resource_type = p_type
  ), page AS (SELECT * FROM ranked ORDER BY rn OFFSET off LIMIT lim + 1)
  SELECT jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('type', x.resource_type, 'id', x.resource_id, 'slug', x.slug, 'name', x.name, 'summary', coalesce(x.summary, x.tagline), 'hostName', x.host_name,
      'category', x.category, 'language', x.language, 'audience', x.audience, 'free', x.is_free, 'pricing', x.pricing, 'admission', CASE WHEN x.resource_type = 'community' THEN to_jsonb(x.admission) ELSE NULL END,
      'updatedAt', x.updated_at) ORDER BY x.rn) FROM (SELECT * FROM page ORDER BY rn LIMIT lim) x), '[]'::jsonb),
    'hasMore', (SELECT count(*) FROM page) > lim,
    'facets', coalesce((SELECT jsonb_object_agg(resource_type, n) FROM facets), '{}'::jsonb)) INTO result;
  PERFORM public.community_definer_reset();
  RETURN result;
END $$;
--> statement-breakpoint
-- A signed-in person flags a visible listing. One open report per person and listing; ten per person per day. The ministry never sees who reported.
CREATE FUNCTION public.discover_report(p_type text, p_id uuid, p_reason text, p_note text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); tenant uuid; inserted integer;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'sign in to report' USING ERRCODE = '42501'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('community','course','product') OR p_reason IS NULL OR p_reason NOT IN ('spam','inappropriate','misleading','impersonation','other') OR length(coalesce(p_note, '')) > 500 THEN RAISE EXCEPTION 'invalid report'; END IF;
  PERFORM set_config('app.discover_read', 'on', true);
  PERFORM set_config('app.discover_platform', 'on', true);
  SELECT d.tenant_id INTO tenant FROM public.discover_listings d
    JOIN public.discover_controls c ON (c.tenant_id, c.resource_type, c.resource_id) = (d.tenant_id, d.resource_type, d.resource_id)
    LEFT JOIN public.discover_ministry_standing s ON s.tenant_id = d.tenant_id
    WHERE d.resource_type = p_type AND d.resource_id = p_id AND c.review_state = 'approved' AND c.reviewed_hash = d.content_hash AND coalesce(s.suspended, false) = false;
  IF tenant IS NULL THEN PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true); RETURN 'unknown'; END IF;
  IF (SELECT count(*) FROM public.discover_reports r WHERE r.reporter_id = actor AND r.created_at > now() - interval '1 day') >= 10 THEN
    PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true); RETURN 'rate_limited';
  END IF;
  INSERT INTO public.discover_reports(resource_type, resource_id, tenant_id, reporter_id, reason, note) VALUES (p_type, p_id, tenant, actor, p_reason, nullif(btrim(p_note), '')) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true);
  RETURN CASE WHEN inserted = 1 THEN 'reported' ELSE 'duplicate' END;
END $$;
--> statement-breakpoint
-- Platform review. Granted to the worker role only: there is no platform-admin identity model yet (founder decision pending), so no web route can call these.
CREATE FUNCTION public.discover_platform_queue(p_state text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('pending','approved','rejected','suspended') THEN RAISE EXCEPTION 'invalid state'; END IF;
  PERFORM set_config('app.discover_platform', 'on', true);
  PERFORM set_config('app.discover_read', 'on', true);
  SELECT coalesce(jsonb_agg(row ORDER BY (row->>'requestedAt')), '[]'::jsonb) INTO result FROM (
    SELECT jsonb_build_object('tenantId', c.tenant_id, 'type', c.resource_type, 'id', c.resource_id, 'state', c.review_state, 'reason', c.review_reason, 'version', c.version, 'requestedAt', c.updated_at,
      'name', d.name, 'summary', coalesce(d.summary, d.tagline), 'hostName', d.host_name, 'category', d.category, 'language', d.language, 'audience', d.audience, 'free', d.is_free,
      'materialChange', c.reviewed_hash IS NOT NULL AND c.reviewed_hash IS DISTINCT FROM c.current_hash,
      'openReports', (SELECT count(*) FROM public.discover_reports r WHERE (r.tenant_id, r.resource_type, r.resource_id) = (c.tenant_id, c.resource_type, c.resource_id) AND r.status = 'open')) AS row
    FROM public.discover_controls c LEFT JOIN public.discover_listings d ON (d.tenant_id, d.resource_type, d.resource_id) = (c.tenant_id, c.resource_type, c.resource_id)
    WHERE c.review_state = p_state ORDER BY c.updated_at, c.resource_id LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)) q;
  PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true);
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.discover_platform_decide(p_tenant uuid, p_type text, p_id uuid, p_decision text, p_reason text, p_reviewer text, p_version integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c record; listing_hash text; next_state text; reviewed text;
BEGIN
  IF p_reviewer IS NULL OR length(p_reviewer) NOT BETWEEN 1 AND 200 OR p_decision IS NULL OR p_decision NOT IN ('approve','reject','suspend','reinstate')
    OR (p_decision IN ('reject','suspend') AND length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 1 AND 500) THEN RAISE EXCEPTION 'invalid review decision'; END IF;
  PERFORM set_config('app.discover_platform', 'on', true);
  PERFORM set_config('app.discover_read', 'on', true);
  SELECT * INTO c FROM public.discover_controls WHERE (tenant_id, resource_type, resource_id) = (p_tenant, p_type, p_id) FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true); RETURN 'not_found'; END IF;
  IF c.version <> p_version THEN PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true); RETURN 'stale'; END IF;
  SELECT d.content_hash INTO listing_hash FROM public.discover_listings d WHERE (d.tenant_id, d.resource_type, d.resource_id) = (p_tenant, p_type, p_id);
  IF p_decision = 'approve' THEN
    -- Approval binds the exact public fields the reviewer saw. A listing that is not currently shown (unlisted, unpublished, opted out) cannot be approved.
    IF c.review_state <> 'pending' OR listing_hash IS NULL OR listing_hash IS DISTINCT FROM c.current_hash THEN PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true); RETURN 'not_reviewable'; END IF;
    next_state := 'approved'; reviewed := listing_hash;
  ELSIF p_decision = 'reject' THEN
    IF c.review_state <> 'pending' THEN PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true); RETURN 'not_reviewable'; END IF;
    next_state := 'rejected'; reviewed := c.current_hash;
  ELSIF p_decision = 'suspend' THEN
    IF c.review_state NOT IN ('approved','pending') THEN PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true); RETURN 'not_reviewable'; END IF;
    next_state := 'suspended'; reviewed := c.reviewed_hash;
  ELSE
    IF c.review_state <> 'suspended' THEN PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true); RETURN 'not_reviewable'; END IF;
    -- Reinstating restores an approval only if the public fields are still exactly what was approved; otherwise it goes back to review.
    next_state := CASE WHEN c.reviewed_hash IS NOT NULL AND c.reviewed_hash = c.current_hash THEN 'approved' ELSE 'pending' END; reviewed := c.reviewed_hash;
  END IF;
  UPDATE public.discover_controls SET review_state = next_state, review_reason = CASE WHEN p_decision IN ('reject','suspend') THEN btrim(p_reason) ELSE NULL END, reviewed_by = p_reviewer, reviewed_at = now(),
    reviewed_hash = reviewed, version = version + 1, updated_at = now() WHERE (tenant_id, resource_type, resource_id) = (p_tenant, p_type, p_id);
  INSERT INTO public.discover_review_events(tenant_id, resource_type, resource_id, decision, reason, reviewer) VALUES (p_tenant, p_type, p_id, p_decision, nullif(btrim(p_reason), ''), p_reviewer);
  PERFORM set_config('app.community_definer_tenant', p_tenant::text, true);
  INSERT INTO public.audit_logs(tenant_id, actor_id, action, target_id, metadata) VALUES (p_tenant, p_reviewer, 'discover.review_' || p_decision, p_id::text, jsonb_build_object('type', p_type, 'state', next_state));
  PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true);
  RETURN next_state;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.discover_platform_standing(p_tenant uuid, p_suspended boolean, p_reason text, p_reviewer text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_tenant IS NULL OR p_suspended IS NULL OR p_reviewer IS NULL OR length(p_reviewer) NOT BETWEEN 1 AND 200 OR (p_suspended AND length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 1 AND 500) THEN RAISE EXCEPTION 'invalid standing change'; END IF;
  PERFORM set_config('app.discover_platform', 'on', true);
  INSERT INTO public.discover_ministry_standing(tenant_id, suspended, reason, set_by, set_at) VALUES (p_tenant, p_suspended, CASE WHEN p_suspended THEN btrim(p_reason) END, p_reviewer, now())
    ON CONFLICT (tenant_id) DO UPDATE SET suspended = excluded.suspended, reason = excluded.reason, set_by = excluded.set_by, set_at = excluded.set_at;
  INSERT INTO public.discover_review_events(tenant_id, resource_type, resource_id, decision, reason, reviewer) VALUES (p_tenant, 'community', p_tenant, CASE WHEN p_suspended THEN 'standing_suspend' ELSE 'standing_restore' END, nullif(btrim(p_reason), ''), p_reviewer);
  PERFORM set_config('app.community_definer_tenant', p_tenant::text, true);
  INSERT INTO public.audit_logs(tenant_id, actor_id, action, target_id, metadata) VALUES (p_tenant, p_reviewer, CASE WHEN p_suspended THEN 'discover.ministry_suspend' ELSE 'discover.ministry_restore' END, p_tenant::text, '{}'::jsonb);
  PERFORM public.community_definer_reset(); PERFORM set_config('app.discover_platform', '', true);
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.discover_platform_reports(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM set_config('app.discover_platform', 'on', true);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'tenantId', r.tenant_id, 'type', r.resource_type, 'resourceId', r.resource_id, 'reason', r.reason, 'note', r.note, 'createdAt', r.created_at) ORDER BY r.created_at), '[]'::jsonb)
    INTO result FROM (SELECT * FROM public.discover_reports WHERE status = 'open' ORDER BY created_at LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)) r;
  PERFORM set_config('app.discover_platform', '', true);
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.discover_platform_resolve_report(p_id uuid, p_status text, p_reviewer text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('reviewed','dismissed') OR p_reviewer IS NULL OR length(p_reviewer) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid report resolution'; END IF;
  PERFORM set_config('app.discover_platform', 'on', true);
  UPDATE public.discover_reports SET status = p_status, resolved_by = p_reviewer, resolved_at = now() WHERE id = p_id AND status = 'open';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.discover_platform', '', true);
  RETURN n = 1;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.discover_can(uuid), public.discover_search(text,text,text,text,text,boolean,text,integer,integer), public.discover_report(text,uuid,text,text),
  public.discover_platform_queue(text,integer), public.discover_platform_decide(uuid,text,uuid,text,text,text,integer), public.discover_platform_standing(uuid,boolean,text,text),
  public.discover_platform_reports(integer), public.discover_platform_resolve_report(uuid,text,text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.discover_can(uuid), public.discover_search(text,text,text,text,text,boolean,text,integer,integer), public.discover_report(text,uuid,text,text) TO harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.discover_platform_queue(text,integer), public.discover_platform_decide(uuid,text,uuid,text,text,text,integer), public.discover_platform_standing(uuid,boolean,text,text),
      public.discover_platform_reports(integer), public.discover_platform_resolve_report(uuid,text,text) TO harvest_worker;
  END IF;
END $$;
