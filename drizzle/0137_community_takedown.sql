CREATE TABLE "community_harvest_report_quotas" (
	"scope" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "community_harvest_report_quotas_scope_minute_pk" PRIMARY KEY("scope","minute")
);
--> statement-breakpoint
CREATE TABLE "community_harvest_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_harvest_reports_target" CHECK ("community_harvest_reports"."target_type" in ('community', 'post', 'comment') and ("community_harvest_reports"."target_type" <> 'community' or "community_harvest_reports"."target_id" = "community_harvest_reports"."community_id")),
	CONSTRAINT "community_harvest_reports_reason" CHECK ("community_harvest_reports"."reason" in ('spam','harassment','inappropriate','impersonation','scam','other')),
	CONSTRAINT "community_harvest_reports_note" CHECK ("community_harvest_reports"."note" is null or length("community_harvest_reports"."note") between 1 and 500),
	CONSTRAINT "community_harvest_reports_status" CHECK ("community_harvest_reports"."status" in ('open','reviewed','dismissed') and (("community_harvest_reports"."status" = 'open') = ("community_harvest_reports"."resolved_at" is null)))
);
--> statement-breakpoint
CREATE TABLE "community_takedowns" (
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"hidden" boolean NOT NULL,
	"reason" text,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_takedowns_target_type_target_id_pk" PRIMARY KEY("target_type","target_id"),
	CONSTRAINT "community_takedowns_target" CHECK ("community_takedowns"."target_type" in ('community', 'post', 'comment') and ("community_takedowns"."target_type" <> 'community' or "community_takedowns"."target_id" = "community_takedowns"."community_id")),
	CONSTRAINT "community_takedowns_reason" CHECK ("community_takedowns"."reason" is null or length("community_takedowns"."reason") between 1 and 500),
	CONSTRAINT "community_takedowns_hidden_reason" CHECK (not "community_takedowns"."hidden" or "community_takedowns"."reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "community_harvest_reports" ADD CONSTRAINT "community_harvest_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_harvest_reports" ADD CONSTRAINT "community_harvest_reports_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_takedowns" ADD CONSTRAINT "community_takedowns_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_takedowns" ADD CONSTRAINT "community_takedowns_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_harvest_report_quota_expiry_idx" ON "community_harvest_report_quotas" USING btree ("minute");--> statement-breakpoint
CREATE INDEX "community_harvest_reports_open_idx" ON "community_harvest_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "community_harvest_reports_target_idx" ON "community_harvest_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "community_takedowns_target_idx" ON "community_takedowns" USING btree ("target_id");--> statement-breakpoint
CREATE TABLE "community_takedown_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "community_takedown_appeals_message" CHECK (length("community_takedown_appeals"."message") between 1 and 1000),
	CONSTRAINT "community_takedown_appeals_status" CHECK ("community_takedown_appeals"."status" in ('open','declined','restored') and (("community_takedown_appeals"."status" = 'open') = ("community_takedown_appeals"."decided_at" is null)))
);
--> statement-breakpoint
ALTER TABLE "community_takedown_appeals" ADD CONSTRAINT "community_takedown_appeals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "community_takedown_appeals" ADD CONSTRAINT "community_takedown_appeals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "community_takedown_appeals" ADD CONSTRAINT "community_takedown_appeals_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "community_takedown_appeals_open_idx" ON "community_takedown_appeals" USING btree ("community_id") WHERE "community_takedown_appeals"."status" = 'open';
--> statement-breakpoint
CREATE INDEX "community_takedown_appeals_recent_idx" ON "community_takedown_appeals" USING btree ("community_id","created_at");--> statement-breakpoint
-- Harvest staff takedown for communities, forum posts and replies (founder, 27 Nov 2026: "like the giving takedown"). The four tables are reached only
-- through the definers below (FORCE RLS, no app grant), except that a community's owners and admins read whether Harvest paused their community and
-- the review requests they sent.
DO $$
DECLARE rel text;
  manager text := $s$target_type = 'community' AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id = community_takedowns.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND public.access_role(m.tenant_id, m.user_id, 'communities', m.role_id) IN ('owner', 'admin'))$s$;
BEGIN
  FOREACH rel IN ARRAY ARRAY['community_takedowns','community_harvest_reports','community_harvest_report_quotas','community_takedown_appeals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', rel);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN EXECUTE format('REVOKE ALL ON public.%I FROM harvest_worker', rel); END IF;
    EXECUTE format($p$CREATE POLICY community_takedown_definer ON public.%I TO %I USING (current_setting('app.community_takedown', true) = 'on') WITH CHECK (current_setting('app.community_takedown', true) = 'on')$p$, rel, current_user);
  END LOOP;
  EXECUTE 'CREATE POLICY community_takedowns_manage_read ON public.community_takedowns FOR SELECT TO harvest_app USING (' || manager || ')';
  EXECUTE 'CREATE POLICY community_takedown_appeals_manage_read ON public.community_takedown_appeals FOR SELECT TO harvest_app USING ('
    || replace(replace(manager, 'target_type = ''community'' AND ', ''), 'community_takedowns.tenant_id', 'community_takedown_appeals.tenant_id') || ')';
END $$;--> statement-breakpoint
GRANT SELECT ON public.community_takedowns, public.community_takedown_appeals TO harvest_app;--> statement-breakpoint
-- Whether Harvest staff hid this community, post or reply (ids are unique across the three kinds). A yes or no only, for the row policies and the
-- member read predicate below; sets and restores one flag, so it is safe inside any other definer.
CREATE FUNCTION public.community_harvest_hidden(p_target uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result boolean; previous text := current_setting('app.community_takedown', true);
BEGIN
  IF p_target IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.community_takedown', 'on', true);
  SELECT EXISTS (SELECT FROM public.community_takedowns t WHERE t.target_id = p_target AND t.hidden) INTO result;
  PERFORM set_config('app.community_takedown', coalesce(previous, ''), true);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_harvest_hidden(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_harvest_hidden(uuid) TO harvest_app;--> statement-breakpoint
-- A community Harvest paused reads nothing in the member area (every member-readable table goes through this predicate), and stops notifications.
CREATE OR REPLACE FUNCTION public.community_can_read(p_tenant uuid, p_community uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_memberships m
    WHERE m.tenant_id = p_tenant AND m.community_id = p_community AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.status = 'active'
      AND (m.role IN ('owner', 'admin', 'moderator', 'contributor') OR EXISTS (SELECT 1 FROM public.entitlements e
        WHERE e.tenant_id = p_tenant AND e.user_id = m.user_id AND e.resource_type = 'community' AND e.resource_id = p_community
          AND e.revoked_at IS NULL AND e.valid_from <= now() AND (e.valid_until IS NULL OR e.valid_until > now()))))
    AND NOT public.community_harvest_hidden(p_community)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_user_can_read(p_tenant uuid, p_community uuid, p_user text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.community_memberships m
    WHERE m.tenant_id = p_tenant AND m.community_id = p_community AND m.user_id = p_user AND m.status = 'active'
      AND (m.role IN ('owner', 'admin', 'moderator', 'contributor') OR EXISTS (SELECT 1 FROM public.entitlements e
        WHERE e.tenant_id = p_tenant AND e.user_id = m.user_id AND e.resource_type = 'community' AND e.resource_id = p_community
          AND e.revoked_at IS NULL AND e.valid_from <= now() AND (e.valid_until IS NULL OR e.valid_until > now()))))
    AND NOT public.community_harvest_hidden(p_community)
$$;--> statement-breakpoint
-- Public page, Discover: a paused community answers as a missing one.
CREATE OR REPLACE FUNCTION public.community_public(p_slug text, p_invite_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c record; host text; invited boolean := false;
BEGIN
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT * INTO c FROM public.communities WHERE communities.slug = p_slug AND communities.status = 'published';
  -- Harvest staff paused it: the same neutral answer as a missing community (0137).
  IF NOT FOUND OR public.community_harvest_hidden(c.id) THEN PERFORM public.community_definer_reset(); RETURN NULL; END IF;
  IF p_invite_hash IS NOT NULL THEN
    PERFORM set_config('app.community_resolve_invite', p_invite_hash, true);
    invited := EXISTS (SELECT 1 FROM public.community_invites i WHERE i.token_hash = p_invite_hash AND i.community_id = c.id AND i.tenant_id = c.tenant_id
      AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now());
  END IF;
  IF c.visibility = 'hidden' AND NOT invited THEN PERFORM public.community_definer_reset(); RETURN NULL; END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  SELECT w.name INTO host FROM public.workspaces w WHERE w.tenant_id = c.tenant_id;
  PERFORM public.community_definer_reset();
  RETURN jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'tagline', c.tagline, 'description', c.description, 'hostName', host,
    'pricing', c.pricing, 'visibility', c.visibility, 'allowOpen', c.allow_open, 'allowApply', c.allow_apply, 'allowInvite', c.allow_invite,
    'rulesList', to_jsonb(c.rules_list), 'rulesVersion', c.rules_version, 'joinQuestions', c.join_questions, 'questionsVersion', c.questions_version,
    'invited', invited);
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.discover_communities(p_query text, p_open_only boolean, p_after timestamptz, p_after_id uuid, p_limit integer) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.discover_read', 'on', true);
  RETURN QUERY SELECT jsonb_build_object('id', d.resource_id, 'slug', d.slug, 'name', d.name, 'tagline', d.tagline, 'hostName', d.host_name,
      'pricing', d.pricing, 'admission', to_jsonb(d.admission), 'updatedAt', d.updated_at)
    FROM public.discover_listings d
    WHERE d.resource_type = 'community' AND NOT public.community_harvest_hidden(d.resource_id)
      AND (coalesce(p_query, '') = '' OR d.search_text LIKE '%' || replace(replace(replace(lower(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
      AND (NOT coalesce(p_open_only, false) OR 'open' = ANY (d.admission))
      AND (p_after IS NULL OR (d.updated_at, d.resource_id) < (p_after, p_after_id))
    ORDER BY d.updated_at DESC, d.resource_id DESC
    LIMIT least(greatest(coalesce(p_limit, 24), 1), 48);
  PERFORM public.community_definer_reset();
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.discover_communities_approved(p_query text, p_open_only boolean, p_after timestamptz, p_after_id uuid, p_limit integer) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.discover_read', 'on', true);
  RETURN QUERY SELECT jsonb_build_object('id', d.resource_id, 'slug', d.slug, 'name', d.name, 'tagline', d.tagline, 'hostName', d.host_name,
      'pricing', d.pricing, 'admission', to_jsonb(d.admission), 'updatedAt', d.updated_at)
    FROM public.discover_listings d
      JOIN public.discover_controls c ON (c.tenant_id, c.resource_type, c.resource_id) = (d.tenant_id, d.resource_type, d.resource_id)
      LEFT JOIN public.discover_ministry_standing s ON s.tenant_id = d.tenant_id
    WHERE d.resource_type = 'community' AND NOT public.community_harvest_hidden(d.resource_id) AND c.review_state = 'approved' AND c.reviewed_hash IS NOT NULL AND c.reviewed_hash = d.content_hash AND coalesce(s.suspended, false) = false
      AND (coalesce(p_query, '') = '' OR d.search_text LIKE '%' || replace(replace(replace(lower(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
      AND (NOT coalesce(p_open_only, false) OR 'open' = ANY (d.admission))
      AND (p_after IS NULL OR (d.updated_at, d.resource_id) < (p_after, p_after_id))
    ORDER BY d.updated_at DESC, d.resource_id DESC
    LIMIT least(greatest(coalesce(p_limit, 24), 1), 48);
  PERFORM public.community_definer_reset();
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.discover_search(p_q text, p_type text, p_category text, p_language text, p_audience text, p_free boolean, p_sort text, p_offset integer, p_limit integer) RETURNS jsonb
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
      AND (d.resource_type <> 'community' OR NOT public.community_harvest_hidden(d.resource_id))
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
END $$;--> statement-breakpoint
-- Entry reset: the 0134 list plus this migration's flag.
CREATE OR REPLACE FUNCTION public.community_definer_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT set_config(name, '', true) FROM unnest(ARRAY['app.community_resolve_slug','app.community_definer_tenant','app.community_resolve_ids',
    'app.community_resolve_invite','app.community_resolve_email','app.discover_read','app.community_resolve_user','app.community_purge',
    'app.community_email_worker','app.giving_definer','app.giving_definer_tenant','app.giving_public_tenant',
    'app.give_public_slug','app.give_public_tenant','app.give_public_fundraising',
    'app.catalog_tenant','app.chat_purge','app.chat_settings','app.community_stats_write','app.discover_platform',
    'app.dm_evidence_report','app.dm_purge','app.events_tenant','app.live_community',
    'app.account_export','app.account_erase','app.community_takedown']) AS name;
$$;--> statement-breakpoint
-- The account export and erasure definers' reset (0134) blanks this migration's flag too.
CREATE OR REPLACE FUNCTION public.account_self_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT pg_catalog.set_config(name, '', true) FROM pg_catalog.unnest(ARRAY['app.account_export','app.account_erase',
    'app.access_tenant','app.access_token','app.ads_definer','app.blog_public_file','app.blog_public_handle','app.blog_public_tenant','app.blog_publish','app.bio_handle','app.bio_tenant','app.campaign_budget_tenant','app.campaign_invite_tenant',
    'app.campaign_invite_token','app.catalog_learner_tenant','app.catalog_my_notes','app.catalog_progress_tenant','app.catalog_slug','app.catalog_tenant',
    'app.chat_purge','app.chat_settings','app.community_definer_tenant','app.community_email_worker','app.community_takedown','app.community_purge','app.community_resolve_email',
    'app.community_resolve_ids','app.community_resolve_invite','app.community_resolve_slug','app.community_resolve_user','app.community_stats_write',
    'app.connect_campaign','app.connect_flow','app.connect_intake_mode','app.connect_invite_id','app.connect_invite_token','app.connect_invite_worker',
    'app.connect_landing_link','app.connect_metrics','app.connect_purge','app.connect_receipt','app.connect_resolve_code','app.connect_resolve_tenant',
    'app.connect_retention','app.connect_version','app.crm_forms_slug','app.crm_forms_tenant','app.discover_platform','app.discover_read',
    'app.dm_evidence_report','app.dm_purge','app.docs_purge','app.event_cover_cleanup','app.events_tenant','app.give_public_fundraising',
    'app.give_public_slug','app.give_public_tenant','app.giving_definer','app.giving_definer_tenant','app.giving_public_tenant','app.live_community',
    'app.newsletter_erasure_contact','app.newsletter_erasure_tenant','app.nl02_private','app.nl02_tenant','app.nl_auto_private','app.nl_forms_tenant','app.nl_growth_scan',
    'app.nl_send_insight','app.nl_send_tenant','app.nl_send_worker','app.office_erasure_contact','app.platform_staff','app.social_analytics_worker',
    'app.social_approval_definer','app.social_auto_dm_worker','app.social_definer','app.social_inbox_worker','app.social_media_tenant',
    'app.social_upload_cleanup','app.tenant_id']) AS name;
$$;--> statement-breakpoint
-- A post or reply Harvest hid is invisible to everyone through the application role except its author and the community's staff (hosts and
-- moderators in the member area, ministry staff through the tenant path), who see a "Hidden by Harvest" marker. Restrictive: it narrows every
-- existing read policy and adds nothing.
DO $$ DECLARE rel text; BEGIN
  FOREACH rel IN ARRAY ARRAY['community_posts','community_comments'] LOOP
    EXECUTE format($p$CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO harvest_app USING (
      author_id = nullif(current_setting('app.user_id', true), '')
      OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      OR NOT public.community_harvest_hidden(id)
      OR EXISTS (SELECT 1 FROM public.community_memberships m WHERE m.tenant_id = %I.tenant_id AND m.community_id = %I.community_id
        AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.status = 'active' AND m.role IN ('owner', 'admin', 'moderator')))$p$,
      rel || '_harvest_hidden', rel, rel, rel);
  END LOOP;
END $$;--> statement-breakpoint
-- Internal (not granted): count a report against the minute buckets and store it. Three a minute per visitor and community, thirty a minute per community.
CREATE FUNCTION public.community_harvest_report_record(p_tenant uuid, p_community uuid, p_type text, p_target uuid, p_reason text, p_note text, p_visitor text) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE minute_start timestamptz := date_trunc('minute', clock_timestamp()); used integer; exceeded boolean := false; bucket text; cap integer;
BEGIN
  IF p_visitor IS NULL OR p_visitor !~ '^[a-f0-9]{64}$' OR p_reason IS NULL OR p_reason NOT IN ('spam','harassment','inappropriate','impersonation','scam','other') THEN RETURN 'invalid'; END IF;
  PERFORM set_config('app.community_takedown', 'on', true);
  DELETE FROM public.community_harvest_report_quotas WHERE minute < minute_start - interval '2 minutes';
  FOR bucket, cap IN SELECT * FROM (VALUES ('report:' || p_visitor || ':' || p_community, 3), ('report:' || p_community, 30)) v LOOP
    INSERT INTO public.community_harvest_report_quotas AS q (scope, minute, attempts) VALUES (bucket, minute_start, 1)
      ON CONFLICT (scope, minute) DO UPDATE SET attempts = least(q.attempts + 1, 1000) RETURNING q.attempts INTO used;
    IF used > cap THEN exceeded := true; END IF;
  END LOOP;
  IF NOT exceeded THEN
    INSERT INTO public.community_harvest_reports (tenant_id, community_id, target_type, target_id, reason, note)
      VALUES (p_tenant, p_community, p_type, p_target, p_reason, nullif(btrim(coalesce(p_note, '')), ''));
  END IF;
  PERFORM set_config('app.community_takedown', '', true);
  RETURN CASE WHEN exceeded THEN 'limited' ELSE 'ok' END;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_harvest_report_record(uuid, uuid, text, uuid, text, text, text) FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Any visitor, no account: report a community from its public page. The same answer for a missing, draft, hidden or already paused community.
CREATE FUNCTION public.community_harvest_report_community(p_slug text, p_reason text, p_note text, p_visitor text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c record; result text := 'not_found';
BEGIN
  PERFORM public.community_definer_reset();
  IF length(coalesce(p_note, '')) <= 500 THEN
    PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
    SELECT communities.tenant_id, communities.id, communities.visibility INTO c FROM public.communities WHERE communities.slug = p_slug AND communities.status = 'published';
    IF FOUND AND c.visibility <> 'hidden' AND NOT public.community_harvest_hidden(c.id) THEN
      result := public.community_harvest_report_record(c.tenant_id, c.id, 'community', c.id, p_reason, p_note, p_visitor);
    END IF;
  END IF;
  PERFORM public.community_definer_reset();
  RETURN result;
END $$;--> statement-breakpoint
-- A member reports a post or reply they can read to Harvest (not to the hosts). Never their own; the same answer for anything they cannot read.
CREATE FUNCTION public.community_harvest_report_content(p_slug text, p_type text, p_target uuid, p_reason text, p_note text, p_visitor text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; ok boolean := false; result text := 'not_found';
BEGIN
  PERFORM public.community_definer_reset();
  IF actor IS NULL OR p_type IS NULL OR p_type NOT IN ('post', 'comment') OR p_target IS NULL OR length(coalesce(p_note, '')) > 500 THEN
    PERFORM public.community_definer_reset(); RETURN 'not_found';
  END IF;
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NOT NULL AND NOT public.community_harvest_hidden(p_target) THEN
    IF p_type = 'post' THEN
      ok := EXISTS (SELECT 1 FROM public.community_posts p WHERE p.tenant_id = ctx.o_tenant AND p.community_id = ctx.o_community AND p.id = p_target
        AND p.removed_at IS NULL AND p.held_at IS NULL AND p.author_id IS DISTINCT FROM actor);
    ELSE
      ok := EXISTS (SELECT 1 FROM public.community_comments c JOIN public.community_posts p ON p.id = c.post_id
        WHERE c.tenant_id = ctx.o_tenant AND c.community_id = ctx.o_community AND c.id = p_target AND c.removed_at IS NULL AND c.held_at IS NULL
          AND p.removed_at IS NULL AND p.held_at IS NULL AND NOT public.community_harvest_hidden(p.id) AND c.author_id IS DISTINCT FROM actor);
    END IF;
    IF ok THEN result := public.community_harvest_report_record(ctx.o_tenant, ctx.o_community, p_type, p_target, p_reason, p_note, p_visitor); END IF;
  END IF;
  PERFORM public.community_definer_reset();
  RETURN result;
END $$;--> statement-breakpoint
-- A member of a community Harvest paused: its name, and for the community's owners and admins also the reason. NULL for everyone else and every
-- community that is not paused, so it reveals nothing to a non-member.
CREATE FUNCTION public.community_harvest_paused(p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); c record; member_role text; why text;
BEGIN
  PERFORM public.community_definer_reset();
  IF actor IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT communities.tenant_id, communities.id, communities.slug, communities.name INTO c FROM public.communities WHERE communities.slug = p_slug AND communities.status = 'published';
  IF NOT FOUND OR NOT public.community_harvest_hidden(c.id) THEN PERFORM public.community_definer_reset(); RETURN NULL; END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  SELECT m.role INTO member_role FROM public.community_memberships m WHERE m.tenant_id = c.tenant_id AND m.community_id = c.id AND m.user_id = actor AND m.status = 'active';
  IF member_role IS NULL THEN PERFORM public.community_definer_reset(); RETURN NULL; END IF;
  IF member_role IN ('owner', 'admin') THEN
    PERFORM set_config('app.community_takedown', 'on', true);
    SELECT t.reason INTO why FROM public.community_takedowns t WHERE t.target_type = 'community' AND t.target_id = c.id AND t.hidden;
  END IF;
  PERFORM public.community_definer_reset();
  RETURN jsonb_build_object('slug', c.slug, 'name', c.name, 'manager', member_role IN ('owner', 'admin'), 'reason', why);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_harvest_report_community(text, text, text, text), public.community_harvest_report_content(text, text, uuid, text, text, text),
  public.community_harvest_paused(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_harvest_report_community(text, text, text, text), public.community_harvest_report_content(text, text, uuid, text, text, text),
  public.community_harvest_paused(text) TO harvest_app;--> statement-breakpoint
-- Harvest staff (platform_staff, the Discover review role): reviewers and admins list and resolve reports; admins only hide and restore. Each function
-- re-checks the active staff role of the signed-in user and writes a platform_staff_audit row. Reports carry no reporter identity.
CREATE FUNCTION public.platform_community_reports(p_status text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); raw jsonb; r jsonb; result jsonb := '[]'::jsonb;
  ministry text; community record; excerpt text; found_target boolean;
BEGIN
  PERFORM public.community_definer_reset();
  IF public.platform_staff_role(actor) IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('open','reviewed','dismissed') THEN RAISE EXCEPTION 'invalid report status' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.community_takedown', 'on', true);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'tenantId', x.tenant_id, 'communityId', x.community_id, 'targetType', x.target_type, 'targetId', x.target_id,
      'reason', x.reason, 'note', x.note, 'status', x.status, 'createdAt', x.created_at,
      'hidden', EXISTS (SELECT FROM public.community_takedowns t WHERE t.target_type = x.target_type AND t.target_id = x.target_id AND t.hidden),
      -- The ministry's latest review request, shown next to the community's report and pause.
      'appeal', CASE WHEN x.target_type = 'community' THEN (SELECT jsonb_build_object('id', a.id, 'message', a.message, 'status', a.status, 'createdAt', a.created_at)
        FROM public.community_takedown_appeals a WHERE a.community_id = x.community_id ORDER BY a.created_at DESC LIMIT 1) END) ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb)
    INTO raw FROM (SELECT * FROM public.community_harvest_reports h WHERE h.status = p_status ORDER BY h.created_at DESC, h.id DESC LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)) x;
  PERFORM set_config('app.community_takedown', '', true);
  -- Names and a short excerpt of what was reported, read one ministry at a time through the existing tenant-keyed definer policies.
  FOR r IN SELECT * FROM jsonb_array_elements(raw) LOOP
    PERFORM set_config('app.community_definer_tenant', r->>'tenantId', true);
    SELECT w.name INTO ministry FROM public.workspaces w WHERE w.tenant_id = (r->>'tenantId')::uuid;
    SELECT c.name, c.slug INTO community FROM public.communities c WHERE c.tenant_id = (r->>'tenantId')::uuid AND c.id = (r->>'communityId')::uuid;
    excerpt := NULL; found_target := true;
    IF r->>'targetType' = 'post' THEN
      SELECT left(p.title || ' · ' || p.body_text, 280) INTO excerpt FROM public.community_posts p WHERE p.tenant_id = (r->>'tenantId')::uuid AND p.id = (r->>'targetId')::uuid AND p.removed_at IS NULL;
      found_target := FOUND;
    ELSIF r->>'targetType' = 'comment' THEN
      SELECT left(c.body, 280) INTO excerpt FROM public.community_comments c WHERE c.tenant_id = (r->>'tenantId')::uuid AND c.id = (r->>'targetId')::uuid AND c.removed_at IS NULL;
      found_target := FOUND;
    END IF;
    result := result || jsonb_build_array(r || jsonb_build_object('ministry', ministry, 'community', community.name, 'slug', community.slug, 'excerpt', excerpt, 'removed', NOT found_target));
  END LOOP;
  PERFORM public.community_definer_reset();
  PERFORM public.platform_staff_log(actor, 'community.reports', 'queue', p_status, NULL);
  RETURN result;
END $$;--> statement-breakpoint
CREATE FUNCTION public.platform_community_resolve_report(p_id uuid, p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); tenant uuid;
BEGIN
  PERFORM public.community_definer_reset();
  IF public.platform_staff_role(actor) IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('reviewed','dismissed') THEN RAISE EXCEPTION 'invalid report status' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.community_takedown', 'on', true);
  UPDATE public.community_harvest_reports SET status = p_status, resolved_by = actor, resolved_at = now() WHERE id = p_id AND status = 'open' RETURNING tenant_id INTO tenant;
  PERFORM set_config('app.community_takedown', '', true);
  IF tenant IS NULL THEN RETURN false; END IF;
  PERFORM public.platform_staff_log(actor, 'community.report.' || p_status, 'community_harvest_report', p_id::text, tenant);
  RETURN true;
END $$;--> statement-breakpoint
-- Staff admins only (as for giving and Discover standing): hide (a reason is required) or restore a reported community, post or reply.
-- The target's ministry and community come from its reports, so staff act only on what someone reported.
CREATE FUNCTION public.platform_community_takedown(p_type text, p_target uuid, p_hidden boolean, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); scope record;
BEGIN
  PERFORM public.community_definer_reset();
  IF public.platform_staff_role(actor) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('community','post','comment') OR p_target IS NULL OR p_hidden IS NULL
    OR (p_hidden AND nullif(btrim(coalesce(p_reason, '')), '') IS NULL) THEN RAISE EXCEPTION 'a reason is required to hide' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.community_takedown', 'on', true);
  SELECT h.tenant_id, h.community_id INTO scope FROM public.community_harvest_reports h WHERE h.target_type = p_type AND h.target_id = p_target ORDER BY h.created_at LIMIT 1;
  IF NOT FOUND THEN PERFORM set_config('app.community_takedown', '', true); RETURN false; END IF;
  INSERT INTO public.community_takedowns (target_type, target_id, tenant_id, community_id, hidden, reason, changed_by, changed_at)
    VALUES (p_type, p_target, scope.tenant_id, scope.community_id, p_hidden, CASE WHEN p_hidden THEN left(btrim(p_reason), 500) END, actor, now())
    ON CONFLICT (target_type, target_id) DO UPDATE SET hidden = EXCLUDED.hidden, reason = EXCLUDED.reason, changed_by = EXCLUDED.changed_by, changed_at = EXCLUDED.changed_at;
  -- Restoring a community answers its open review request.
  IF p_type = 'community' AND NOT p_hidden THEN
    UPDATE public.community_takedown_appeals SET status = 'restored', decided_by = actor, decided_at = now() WHERE community_id = p_target AND status = 'open';
  END IF;
  PERFORM set_config('app.community_takedown', '', true);
  PERFORM public.platform_staff_log(actor, CASE WHEN p_hidden THEN 'community.takedown.hide' ELSE 'community.takedown.restore' END, p_type, p_target::text, scope.tenant_id);
  RETURN true;
END $$;--> statement-breakpoint
-- The in-app badge: how many Harvest reports are open (a number only; no email or other alert).
CREATE FUNCTION public.platform_community_open_count() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); n integer;
BEGIN
  PERFORM public.community_definer_reset();
  IF public.platform_staff_role(actor) IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('app.community_takedown', 'on', true);
  SELECT count(*)::integer INTO n FROM public.community_harvest_reports WHERE status = 'open';
  PERFORM set_config('app.community_takedown', '', true);
  RETURN n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.platform_community_reports(text, integer), public.platform_community_resolve_report(uuid, text), public.platform_community_takedown(text, uuid, boolean, text),
  public.platform_community_open_count() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.platform_community_reports(text, integer), public.platform_community_resolve_report(uuid, text), public.platform_community_takedown(text, uuid, boolean, text),
  public.platform_community_open_count() TO harvest_app;--> statement-breakpoint
-- Founder answers (27 Nov), part 1: a ministry's owners and admins ask Harvest to review a paused community. A short message, one open request at a
-- time, three a day per community; the request goes to the staff queue next to the report and the pause, and is written to the ministry's audit log.
CREATE FUNCTION public.community_harvest_appeal(p_tenant uuid, p_community uuid, p_message text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); body text := btrim(coalesce(p_message, '')); result text;
BEGIN
  PERFORM public.community_definer_reset();
  IF actor IS NULL OR p_tenant IS NULL OR p_community IS NULL THEN RETURN 'not_found'; END IF;
  PERFORM set_config('app.community_definer_tenant', p_tenant::text, true);
  IF NOT EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = p_tenant AND m.user_id = actor
      AND public.access_role(m.tenant_id, m.user_id, 'communities', m.role_id) IN ('owner', 'admin'))
    OR NOT EXISTS (SELECT FROM public.communities c WHERE c.tenant_id = p_tenant AND c.id = p_community)
    OR NOT public.community_harvest_hidden(p_community) THEN
    PERFORM public.community_definer_reset(); RETURN 'not_found';
  END IF;
  IF length(body) NOT BETWEEN 1 AND 1000 OR body ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' THEN PERFORM public.community_definer_reset(); RETURN 'invalid'; END IF;
  PERFORM set_config('app.community_takedown', 'on', true);
  IF EXISTS (SELECT FROM public.community_takedown_appeals a WHERE a.community_id = p_community AND a.status = 'open') THEN result := 'open';
  ELSIF (SELECT count(*) FROM public.community_takedown_appeals a WHERE a.community_id = p_community AND a.created_at > now() - interval '24 hours') >= 3 THEN result := 'limited';
  ELSE
    INSERT INTO public.community_takedown_appeals (tenant_id, community_id, message, created_by) VALUES (p_tenant, p_community, body, actor);
    result := 'ok';
  END IF;
  PERFORM set_config('app.community_takedown', '', true);
  IF result = 'ok' THEN
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (p_tenant, actor, 'community.takedown.appeal', p_community::text);
  END IF;
  PERFORM public.community_definer_reset();
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_harvest_appeal(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_harvest_appeal(uuid, uuid, text) TO harvest_app;--> statement-breakpoint
-- Staff admins keep the pause and close the open request (restoring the community closes it too). Audited.
CREATE FUNCTION public.platform_community_appeal_decline(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); tenant uuid;
BEGIN
  PERFORM public.community_definer_reset();
  IF public.platform_staff_role(actor) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('app.community_takedown', 'on', true);
  UPDATE public.community_takedown_appeals SET status = 'declined', decided_by = actor, decided_at = now() WHERE id = p_id AND status = 'open' RETURNING tenant_id INTO tenant;
  PERFORM set_config('app.community_takedown', '', true);
  IF tenant IS NULL THEN RETURN false; END IF;
  PERFORM public.platform_staff_log(actor, 'community.appeal.declined', 'community_takedown_appeal', p_id::text, tenant);
  RETURN true;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.platform_community_appeal_decline(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.platform_community_appeal_decline(uuid) TO harvest_app;--> statement-breakpoint
-- Founder answers, part 2: while Harvest pauses a community its forum and chat are read-only for everyone, owners and admins included, whatever path
-- the write takes (member definers, chat definers, the ministry's staff path). New rows are refused; an update may change only the columns an account
-- deletion clears or a purge recounts (reply counts, revision numbers). Deletions (retention, account erasure) still run. The same neutral answer as a missing community (SQLSTATE P0404).
CREATE FUNCTION public.community_harvest_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.community_harvest_hidden(NEW.community_id) AND (TG_OP = 'INSERT'
      OR (to_jsonb(NEW) - ARRAY['author_id', 'user_id', 'sender_id', 'updated_at', 'reply_count', 'rev']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['author_id', 'user_id', 'sender_id', 'updated_at', 'reply_count', 'rev'])) THEN
    RAISE EXCEPTION 'community unavailable' USING ERRCODE = 'P0404';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_harvest_write_guard() FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Part 3: a paused community takes no new members and no new or resubmitted applications, through any path (join, invitation, approval).
CREATE FUNCTION public.community_harvest_join_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.community_harvest_hidden(NEW.community_id) AND (TG_OP = 'INSERT'
      OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('active', 'pending', 'info_requested', 'approved'))) THEN
    RAISE EXCEPTION 'community unavailable' USING ERRCODE = 'P0404';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_harvest_join_guard() FROM PUBLIC, harvest_app;--> statement-breakpoint
DO $$ DECLARE rel text; BEGIN
  FOREACH rel IN ARRAY ARRAY['community_posts','community_comments','community_likes','community_messages','community_message_reactions','community_dm_messages'] LOOP
    EXECUTE format('CREATE TRIGGER community_harvest_write_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.community_harvest_write_guard()', rel);
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['community_memberships','community_applications'] LOOP
    EXECUTE format('CREATE TRIGGER community_harvest_join_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.community_harvest_join_guard()', rel);
  END LOOP;
END $$;--> statement-breakpoint
-- Chat and private messages: no chat role in a paused community, so owners and admins cannot open chat either (settings stay open to them). Patched
-- on the live definition (0057, rewritten by 0113) so earlier rewrites are kept; the migration fails if the body no longer has the expected shape.
DO $$ DECLARE def text; patched text; BEGIN
  def := pg_get_functiondef('public.community_chat_role(uuid,uuid,text)'::regprocedure);
  patched := regexp_replace(def, '\mBEGIN\M', E'BEGIN\n IF public.community_harvest_hidden(p_community) THEN RETURN NULL; END IF;');
  IF patched = def OR position('p_community uuid' in def) = 0 THEN RAISE EXCEPTION '0137: community_chat_role has an unexpected shape'; END IF;
  EXECUTE patched;
END $$;--> statement-breakpoint
-- Reviewer (#324): owner-role readers bypass the application's row policies, so the email digest leaves out the titles of posts Harvest hid, and link
-- in bio leaves out paused communities. Patched on the live definitions (other open PRs redefine bio_public_page_scoped); each patch must apply.
DO $$ DECLARE def text; patched text; fn regprocedure; n integer := 0; BEGIN
  def := pg_get_functiondef('public.community_email_claim(integer)'::regprocedure);
  patched := replace(def, 'CASE WHEN p.removed_at IS NULL AND p.held_at IS NULL THEN p.title END',
    'CASE WHEN p.removed_at IS NULL AND p.held_at IS NULL AND NOT public.community_harvest_hidden(p.id) THEN p.title END');
  IF (length(patched) - length(def)) <> 2 * length(' AND NOT public.community_harvest_hidden(p.id)') THEN RAISE EXCEPTION '0137: community_email_claim has an unexpected shape'; END IF;
  EXECUTE patched;
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'bio_public_page_scoped' LOOP
    def := pg_get_functiondef(fn);
    patched := replace(def, $s$c.status = 'published' AND c.visibility <> 'hidden'$s$, $s$c.status = 'published' AND c.visibility <> 'hidden' AND NOT public.community_harvest_hidden(c.id)$s$);
    IF patched = def THEN RAISE EXCEPTION '0137: bio_public_page_scoped has an unexpected shape'; END IF;
    EXECUTE patched; n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION '0137: bio_public_page_scoped not found'; END IF;
END $$;
--> statement-breakpoint
-- The blog definers' entry reset (0135) blanks this migration's flag too. Patched on the live definition; it must apply exactly once.
DO $$ DECLARE def text; patched text; BEGIN
  def := pg_get_functiondef('public.blog_scope_clear()'::regprocedure);
  patched := replace(def, $s$'app.community_purge',$s$, $s$'app.community_purge','app.community_takedown',$s$);
  IF (length(patched) - length(def)) <> length($s$'app.community_takedown',$s$) THEN RAISE EXCEPTION '0137: blog_scope_clear has an unexpected shape'; END IF;
  EXECUTE patched;
END $$;
