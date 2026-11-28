CREATE TABLE "community_challenge_members" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "challenge_members_pk" PRIMARY KEY("tenant_id","community_id","challenge_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_challenges" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"goal" text NOT NULL,
	"target" integer NOT NULL,
	CONSTRAINT "community_challenges_tenant_id_community_id_id_pk" PRIMARY KEY("tenant_id","community_id","id"),
	CONSTRAINT "community_challenges_title_check" CHECK (length(btrim("community_challenges"."title")) BETWEEN 1 AND 120 AND "community_challenges"."title" !~ '[[:cntrl:]]'),
	CONSTRAINT "community_challenges_ends_at_check" CHECK ("community_challenges"."ends_at" > "community_challenges"."starts_at"),
	CONSTRAINT "community_challenges_goal_check" CHECK ("community_challenges"."goal" IN ('post', 'reply', 'lesson', 'event')),
	CONSTRAINT "community_challenges_target_check" CHECK ("community_challenges"."target" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "community_point_attendance" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "point_attendance_pk" PRIMARY KEY("tenant_id","community_id","event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_point_settings" (
	"enabled" boolean DEFAULT false NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"post_points" integer DEFAULT 5 NOT NULL,
	"reply_points" integer DEFAULT 2 NOT NULL,
	"lesson_points" integer DEFAULT 10 NOT NULL,
	"event_points" integer DEFAULT 15 NOT NULL,
	"thresholds" integer[] DEFAULT ARRAY[25, 100, 250] NOT NULL,
	CONSTRAINT "community_point_settings_tenant_id_community_id_pk" PRIMARY KEY("tenant_id","community_id"),
	CONSTRAINT "community_point_settings_post_points_check" CHECK ("community_point_settings"."post_points" BETWEEN 0 AND 1000),
	CONSTRAINT "community_point_settings_reply_points_check" CHECK ("community_point_settings"."reply_points" BETWEEN 0 AND 1000),
	CONSTRAINT "community_point_settings_lesson_points_check" CHECK ("community_point_settings"."lesson_points" BETWEEN 0 AND 1000),
	CONSTRAINT "community_point_settings_event_points_check" CHECK ("community_point_settings"."event_points" BETWEEN 0 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "community_points_hidden_members" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "point_hidden_member_pk" PRIMARY KEY("tenant_id","community_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "community_challenge_members" ADD CONSTRAINT "challenge_members_challenge_fk" FOREIGN KEY ("tenant_id","community_id","challenge_id") REFERENCES "public"."community_challenges"("tenant_id","community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_challenge_members" ADD CONSTRAINT "challenge_members_member_fk" FOREIGN KEY ("tenant_id","community_id","user_id") REFERENCES "public"."community_memberships"("tenant_id","community_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_challenges" ADD CONSTRAINT "community_challenges_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_point_attendance" ADD CONSTRAINT "point_attendance_event_link_fk" FOREIGN KEY ("tenant_id","event_id","community_id") REFERENCES "public"."community_event_links"("tenant_id","event_id","community_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_point_attendance" ADD CONSTRAINT "point_attendance_member_fk" FOREIGN KEY ("tenant_id","community_id","user_id") REFERENCES "public"."community_memberships"("tenant_id","community_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_point_settings" ADD CONSTRAINT "point_settings_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_points_hidden_members" ADD CONSTRAINT "point_hidden_member_fk" FOREIGN KEY ("tenant_id","community_id","user_id") REFERENCES "public"."community_memberships"("tenant_id","community_id","user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DO $$
DECLARE relation text; scope text;
BEGIN
  scope := 'tenant_id = nullif(current_setting(''app.points_tenant'', true), '''')::uuid AND community_id = nullif(current_setting(''app.points_community'', true), '''')::uuid';
  FOREACH relation IN ARRAY ARRAY['community_point_settings','community_point_attendance','community_challenges','community_challenge_members','community_points_hidden_members'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', relation);
    EXECUTE format('CREATE POLICY points_scope ON public.%I TO %I USING (%s) WITH CHECK (%s)', relation, current_user, scope, scope);
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['community_memberships','community_categories','community_posts','community_comments','community_product_links','community_event_links'] LOOP
    EXECUTE format('CREATE POLICY points_read ON public.%I FOR SELECT TO %I USING (%s)', relation, current_user, scope);
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['catalog_items','catalog_lessons','catalog_progress','events'] LOOP
    EXECUTE format('CREATE POLICY points_read ON public.%I FOR SELECT TO %I USING (tenant_id = nullif(current_setting(''app.points_tenant'', true), '''')::uuid AND nullif(current_setting(''app.points_community'', true), '''') IS NOT NULL)', relation, current_user);
  END LOOP;
  EXECUTE format('CREATE POLICY points_read ON public.communities FOR SELECT TO %I USING
    (tenant_id = nullif(current_setting(''app.points_tenant'', true), '''')::uuid AND id = nullif(current_setting(''app.points_community'', true), '''')::uuid)', current_user);
END $$;
--> statement-breakpoint
DO $$
DECLARE patch record; def text; patched text; replacement text;
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    ('public.blog_scope_clear()', '''app.blog_publish'''),
    ('public.account_self_reset()', '''app.community_stats_write'''),
    ('public.community_definer_reset()', '''app.community_stats_write''')
  ) AS p(signature, anchor)
  LOOP
    replacement := patch.anchor || ',''app.points_tenant'',''app.points_community''';
    def := pg_catalog.pg_get_functiondef(patch.signature::regprocedure);
    patched := pg_catalog.replace(def, patch.anchor, replacement);
    IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(patch.anchor) THEN
      RAISE EXCEPTION 'Expected one insertion point for community points in %', patch.signature;
    END IF;
    EXECUTE patched;
  END LOOP;
END $$;
--> statement-breakpoint
-- Each source already has a unique identity. A reply needs a visible parent, and lessons and
-- attendance need a current community placement. This internal function cannot be called by runtime roles.
CREATE FUNCTION public.community_point_activity(p_tenant uuid, p_community uuid, p_actor text DEFAULT NULL)
RETURNS TABLE (user_id text, action text, occurred_at timestamptz)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p.author_id, 'post', p.created_at FROM public.community_posts p
  JOIN public.community_categories category ON category.id = p.category_id AND category.tenant_id = p.tenant_id
    AND category.community_id = p.community_id AND NOT category.hosts_only
  WHERE p.tenant_id = p_tenant AND p.community_id = p_community AND p.removed_at IS NULL AND p.held_at IS NULL
    AND (p_actor IS NULL OR p_actor = p.author_id)
  UNION ALL
  SELECT r.author_id, 'reply', r.created_at FROM public.community_comments r
  JOIN public.community_posts p ON p.id = r.post_id AND p.tenant_id = r.tenant_id AND p.community_id = r.community_id
  JOIN public.community_categories category ON category.id = p.category_id AND category.tenant_id = p.tenant_id
    AND category.community_id = p.community_id AND NOT category.hosts_only
  WHERE r.tenant_id = p_tenant AND r.community_id = p_community AND r.removed_at IS NULL AND r.held_at IS NULL
    AND p.removed_at IS NULL AND p.held_at IS NULL AND (p_actor IS NULL OR p_actor = r.author_id)
  UNION ALL
  SELECT progress.user_id, 'lesson', progress.completed_at
  FROM public.community_product_links link
  JOIN public.catalog_items item ON item.tenant_id = link.tenant_id AND item.id = link.item_id AND item.state = 'published'
  JOIN public.catalog_progress progress ON progress.tenant_id = item.tenant_id AND progress.item_id = item.id
  JOIN public.catalog_lessons lesson ON lesson.tenant_id = progress.tenant_id AND lesson.item_id = progress.item_id
      AND lesson.id = progress.lesson_id AND lesson.published
  WHERE link.tenant_id = p_tenant AND link.community_id = p_community AND link.kind = 'course' AND (p_actor IS NULL OR p_actor = progress.user_id)
  UNION ALL
  SELECT a.user_id, 'event', e.starts_at FROM public.community_point_attendance a
  JOIN public.events e ON e.tenant_id = a.tenant_id AND e.id = a.event_id AND e.status = 'published'
  WHERE a.tenant_id = p_tenant AND a.community_id = p_community AND (p_actor IS NULL OR p_actor = a.user_id)
$$;
REVOKE ALL ON FUNCTION public.community_point_activity(uuid, uuid, text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.community_points_scoped(p_tenant uuid, p_community uuid, p_actor text, p_action text, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor_role text;
  prefs public.community_point_settings;
  report jsonb;
  challenge public.community_challenges;
  thresholds integer[];
  changed_id uuid;
  target_user text;
  event uuid;
  cutoff timestamptz;
  moment timestamptz := statement_timestamp();
  missing constant jsonb := '{"outcome":"not_found"}';
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.tenant_id = p_tenant AND c.id = p_community
    AND c.status = 'published') THEN RETURN missing; END IF;
  SELECT m.role INTO actor_role FROM public.community_memberships m
    WHERE m.tenant_id = p_tenant AND m.community_id = p_community AND m.user_id = p_actor AND m.status = 'active';
  IF actor_role IS NULL THEN RETURN missing; END IF;

  SELECT s.* INTO prefs FROM public.community_point_settings s WHERE s.tenant_id = p_tenant AND s.community_id = p_community;
  IF NOT FOUND THEN
    prefs.enabled := false; prefs.post_points := 5; prefs.reply_points := 2; prefs.lesson_points := 10; prefs.event_points := 15;
    prefs.thresholds := ARRAY[25,100,250];
  END IF;
  IF NOT prefs.enabled AND p_action NOT IN ('settings', 'read') THEN RETURN missing; END IF;
  IF p_action IN ('settings', 'create', 'attendance', 'hide') AND actor_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN missing; END IF;
  IF p_action = 'settings' THEN
    SELECT array_agg(value::int ORDER BY n) INTO thresholds
      FROM jsonb_array_elements_text(p_input->'thresholds') WITH ORDINALITY AS a(value,n);
    thresholds := coalesce(thresholds, ARRAY[]::int[]);
    IF cardinality(thresholds) > 20 OR EXISTS (SELECT 1 FROM generate_subscripts(thresholds, 1) AS n
      WHERE thresholds[n] IS NULL OR thresholds[n] NOT BETWEEN 1 AND 1000000 OR (n > 1 AND thresholds[n] <= thresholds[n-1])) THEN
      RETURN '{"outcome":"invalid"}';
    END IF;
    INSERT INTO public.community_point_settings(tenant_id, community_id, enabled, post_points, reply_points, lesson_points, event_points, thresholds)
    VALUES (p_tenant, p_community, (p_input->>'enabled')::boolean, (p_input->>'post')::int, (p_input->>'reply')::int, (p_input->>'lesson')::int, (p_input->>'event')::int, thresholds)
    ON CONFLICT (tenant_id, community_id) DO UPDATE SET enabled = excluded.enabled, post_points = excluded.post_points, reply_points = excluded.reply_points,
      lesson_points = excluded.lesson_points, event_points = excluded.event_points, thresholds = excluded.thresholds;
    RETURN '{"outcome":"ok"}';
  ELSIF p_action = 'create' THEN
    INSERT INTO public.community_challenges(tenant_id, community_id, title, starts_at, ends_at, goal, target)
    VALUES (p_tenant, p_community, btrim(p_input->>'title'), (p_input->>'startsAt')::timestamptz,
      (p_input->>'endsAt')::timestamptz, p_input->>'goal', (p_input->>'target')::int)
    RETURNING id INTO changed_id;
    RETURN jsonb_build_object('outcome', 'ok', 'id', changed_id);
  ELSIF p_action IN ('attendance', 'hide') THEN
    target_user := p_input->>'userId';
    IF NOT EXISTS (SELECT 1 FROM public.community_memberships m WHERE m.tenant_id = p_tenant AND m.community_id = p_community
      AND m.user_id = target_user AND m.status = 'active') THEN RETURN missing; END IF;
    IF p_action = 'hide' THEN
      IF (p_input->>'hidden')::boolean THEN
        INSERT INTO public.community_points_hidden_members VALUES (p_tenant, p_community, target_user) ON CONFLICT DO NOTHING;
      ELSE
        DELETE FROM public.community_points_hidden_members h WHERE h.tenant_id = p_tenant AND h.community_id = p_community AND h.user_id = target_user;
      END IF;
    ELSE
      event := (p_input->>'eventId')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.community_event_links link JOIN public.events e ON e.tenant_id = link.tenant_id AND e.id = link.event_id
        WHERE link.tenant_id = p_tenant AND link.community_id = p_community AND e.id = event AND e.status = 'published' AND e.starts_at <= moment)
        THEN RETURN missing; END IF;
      IF (p_input->>'attended')::boolean THEN
        INSERT INTO public.community_point_attendance VALUES (p_tenant, p_community, event, target_user) ON CONFLICT DO NOTHING;
      ELSE
        DELETE FROM public.community_point_attendance a WHERE a.tenant_id = p_tenant AND a.community_id = p_community
          AND a.event_id = event AND a.user_id = target_user;
      END IF;
    END IF;
    RETURN '{"outcome":"ok"}';
  ELSIF p_action = 'join' THEN
    SELECT c.* INTO challenge FROM public.community_challenges c WHERE c.tenant_id = p_tenant AND c.community_id = p_community
      AND c.id = (p_input->>'challengeId')::uuid AND c.ends_at > moment;
    IF NOT FOUND THEN RETURN missing; END IF;
    INSERT INTO public.community_challenge_members(tenant_id, community_id, challenge_id, user_id, joined_at)
    VALUES (p_tenant, p_community, challenge.id, p_actor, moment) ON CONFLICT DO NOTHING;
    RETURN '{"outcome":"ok"}';
  ELSIF p_action <> 'read' OR p_action IS NULL THEN
    RETURN missing;
  END IF;

  IF NOT prefs.enabled THEN
    RETURN jsonb_build_object('outcome','ok', 'settings', jsonb_build_object('enabled',false,'post',prefs.post_points,
      'reply',prefs.reply_points,'lesson',prefs.lesson_points,'event',prefs.event_points,'thresholds',prefs.thresholds),
      'leaderboard','[]'::jsonb,'challenges','[]'::jsonb);
  END IF;
  cutoff := CASE p_input->>'period' WHEN '7' THEN moment - interval '168 hours' WHEN '30' THEN moment - interval '720 hours' ELSE '-infinity'::timestamptz END;

  -- Completion is recorded from the timestamp of the qualifying action, even if the
  -- participant reads progress after the challenge has ended.
  WITH progress AS (
    SELECT m.challenge_id,
      (array_agg(a.occurred_at ORDER BY a.occurred_at))[c.target] AS reached
    FROM public.community_challenge_members m
    JOIN public.community_challenges c ON (c.tenant_id,c.community_id,c.id) = (m.tenant_id,m.community_id,m.challenge_id)
    JOIN public.community_point_activity(p_tenant,p_community,p_actor) a ON a.user_id = m.user_id AND a.action = c.goal
      AND a.occurred_at >= greatest(c.starts_at,m.joined_at) AND a.occurred_at < c.ends_at AND a.occurred_at <= moment
    WHERE m.tenant_id = p_tenant AND m.community_id = p_community AND m.user_id = p_actor AND m.completed_at IS NULL
    GROUP BY m.challenge_id,c.target
  )
  UPDATE public.community_challenge_members m SET completed_at = progress.reached FROM progress
  WHERE m.tenant_id = p_tenant AND m.community_id = p_community AND m.user_id = p_actor
    AND m.challenge_id = progress.challenge_id AND m.completed_at IS NULL AND progress.reached IS NOT NULL;

  WITH member_activity AS MATERIALIZED (SELECT * FROM public.community_point_activity(p_tenant,p_community,p_actor))
  SELECT jsonb_build_object('outcome','ok',
    'settings', jsonb_build_object('enabled',true,'post',prefs.post_points,'reply',prefs.reply_points,'lesson',prefs.lesson_points,'event',prefs.event_points,'thresholds',prefs.thresholds),
    'leaderboard', coalesce((
      SELECT jsonb_agg(jsonb_build_object('userId', scores.user_id, 'points', scores.points, 'level',
        1 + (SELECT count(*) FROM unnest(prefs.thresholds) t(threshold) WHERE t.threshold <= scores.lifetime))
        ORDER BY scores.points DESC, scores.user_id)
      FROM (
        SELECT a.user_id, sum(weight) FILTER (WHERE a.occurred_at >= cutoff) AS points, sum(weight) AS lifetime
        FROM public.community_point_activity(p_tenant,p_community) a
        JOIN public.community_memberships m ON m.tenant_id = p_tenant AND m.community_id = p_community AND m.user_id = a.user_id AND m.status = 'active'
        CROSS JOIN LATERAL (SELECT CASE a.action WHEN 'post' THEN prefs.post_points WHEN 'reply' THEN prefs.reply_points
          WHEN 'lesson' THEN prefs.lesson_points ELSE prefs.event_points END AS weight) w
        WHERE a.occurred_at <= moment AND NOT EXISTS (SELECT 1 FROM public.community_points_hidden_members h
          WHERE h.tenant_id = p_tenant AND h.community_id = p_community AND h.user_id = a.user_id)
        GROUP BY a.user_id HAVING sum(weight) FILTER (WHERE a.occurred_at >= cutoff) > 0
        ORDER BY points DESC, a.user_id LIMIT 100
      ) scores
    ), '[]'::jsonb),
    'challenges', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'startsAt',c.starts_at,'endsAt',c.ends_at,'goal',c.goal,'target',c.target,
        'joinedAt',m.joined_at,'completedAt',m.completed_at,'progress',
        CASE WHEN m.joined_at IS NOT NULL THEN (SELECT count(*) FROM member_activity a
          WHERE a.user_id = p_actor AND a.action = c.goal AND a.occurred_at >= greatest(c.starts_at,m.joined_at)
            AND a.occurred_at < c.ends_at AND a.occurred_at <= moment) ELSE 0 END) ORDER BY c.starts_at DESC,c.id)
      FROM (SELECT * FROM public.community_challenges WHERE tenant_id = p_tenant AND community_id = p_community ORDER BY starts_at DESC,id LIMIT 100) c
      LEFT JOIN public.community_challenge_members m ON (m.tenant_id,m.community_id,m.challenge_id) = (c.tenant_id,c.community_id,c.id) AND m.user_id = p_actor
    ), '[]'::jsonb)) INTO report;
  RETURN report;
END $$;
REVOKE ALL ON FUNCTION public.community_points_scoped(uuid, uuid, text, text, jsonb) FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.community_points(p_tenant uuid, p_community uuid, p_action text, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); prior jsonb; result jsonb;
BEGIN
  prior := public.blog_scope_clear();
  PERFORM set_config('app.points_tenant', coalesce(p_tenant::text,''), true);
  PERFORM set_config('app.points_community', coalesce(p_community::text,''), true);
  result := public.community_points_scoped(p_tenant, p_community, actor, p_action, p_input);
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.community_points(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_points(uuid, uuid, text, jsonb) TO harvest_app;
