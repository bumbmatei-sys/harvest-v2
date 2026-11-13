CREATE TABLE "community_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" text NOT NULL,
	"notification_id" uuid,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "community_email_delivery_kind" CHECK ("community_email_deliveries"."kind" in ('instant', 'digest') and ("community_email_deliveries"."kind" = 'instant') = ("community_email_deliveries"."notification_id" is not null)),
	CONSTRAINT "community_email_delivery_status" CHECK ("community_email_deliveries"."status" in ('queued', 'sending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "community_email_delivery_error" CHECK ("community_email_deliveries"."last_error" is null or length("community_email_deliveries"."last_error") <= 40)
);
--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "email_frequency" text DEFAULT 'important' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "email_digest_cursor" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_email_deliveries" ADD CONSTRAINT "community_email_deliveries_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_email_deliveries" ADD CONSTRAINT "community_email_deliveries_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_email_deliveries_key_idx" ON "community_email_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "community_email_deliveries_due_idx" ON "community_email_deliveries" USING btree ("status","locked_until","created_at");--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_membership_email_frequency" CHECK ("community_memberships"."email_frequency" in ('off', 'important', 'daily', 'weekly'));
--> statement-breakpoint
-- C15b: notification email. The delivery log is written and read only by the definers below (no application grants).
-- It holds no address and no message text. Owner policies are keyed on settings that only these definers set and clear.
ALTER TABLE public.community_email_deliveries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.community_email_deliveries FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.community_email_deliveries FROM PUBLIC, harvest_app;--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY community_definer_email_worker ON public.community_email_deliveries TO %I
    USING (current_setting('app.community_email_worker', true) = 'on')
    WITH CHECK (current_setting('app.community_email_worker', true) = 'on')$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_email_purge ON public.community_email_deliveries TO %I
    USING (current_setting('app.community_purge', true) = 'on' AND created_at < now() - interval '90 days')$p$, current_user);
  -- The worker first needs to know which ministries have anything to send. Read-only, and only while it is working.
  EXECUTE format($p$CREATE POLICY community_definer_email_scan ON public.community_notifications FOR SELECT TO %I
    USING (current_setting('app.community_email_worker', true) = 'on')$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_email_scan ON public.community_memberships FOR SELECT TO %I
    USING (current_setting('app.community_email_worker', true) = 'on')$p$, current_user);
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_definer_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT set_config(name, '', true) FROM unnest(ARRAY['app.community_resolve_slug','app.community_definer_tenant','app.community_resolve_ids',
    'app.community_resolve_invite','app.community_resolve_email','app.discover_read','app.community_resolve_user','app.community_purge',
    'app.community_email_worker']) AS name;
$$;--> statement-breakpoint
-- Queues the emails that are due. Instant: a member's own important events (application decisions, warnings, held decisions,
-- appeal decisions), unless they turned email off; a warning or held decision also needs an unmuted member who can still read
-- the community. Digest: members on daily or weekly whose window has elapsed; the window ends now and the cursor moves with
-- it in the same statement, so two workers never queue the same window. Idempotency keys make reruns harmless.
CREATE FUNCTION public.community_email_enqueue(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE t uuid; queued integer := 0; n integer; v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
BEGIN
  PERFORM set_config('app.community_email_worker', 'on', true);
  FOR t IN SELECT DISTINCT x.tenant_id FROM (
      SELECT tenant_id FROM public.community_notifications
        WHERE kind IN ('application', 'warning', 'held_decision', 'appeal_decision') AND created_at > now() - interval '7 days'
      UNION SELECT tenant_id FROM public.community_memberships WHERE email_frequency IN ('daily', 'weekly')) x
    ORDER BY 1
  LOOP
    PERFORM set_config('app.community_definer_tenant', t::text, true);
    WITH ins AS (
      INSERT INTO public.community_email_deliveries (tenant_id, community_id, recipient_id, kind, notification_id, idempotency_key)
      SELECT n.tenant_id, n.community_id, n.recipient_id, 'instant', n.id, 'n:' || n.id::text
        FROM public.community_notifications n
        LEFT JOIN public.community_memberships m ON m.tenant_id = n.tenant_id AND m.community_id = n.community_id AND m.user_id = n.recipient_id
       WHERE n.tenant_id = t AND n.kind IN ('application', 'warning', 'held_decision', 'appeal_decision') AND n.created_at > now() - interval '7 days'
         AND coalesce(m.email_frequency, 'important') <> 'off'
         AND (n.kind IN ('application', 'appeal_decision')
           OR (NOT coalesce(m.notifications_muted, false) AND public.community_user_can_read(n.tenant_id, n.community_id, n.recipient_id)))
         AND NOT EXISTS (SELECT 1 FROM public.community_email_deliveries d WHERE d.idempotency_key = 'n:' || n.id::text)
       ORDER BY n.created_at LIMIT v_limit
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING 1)
    SELECT count(*)::int INTO n FROM ins;
    queued := queued + n;
    WITH due AS (
      SELECT m.tenant_id, m.community_id, m.user_id, m.email_digest_cursor AS since, m.notifications_muted AS muted
        FROM public.community_memberships m
       WHERE m.tenant_id = t AND m.status = 'active' AND m.email_frequency IN ('daily', 'weekly') AND m.email_digest_cursor IS NOT NULL
         AND m.email_digest_cursor <= now() - CASE m.email_frequency WHEN 'daily' THEN interval '1 day' ELSE interval '7 days' END
       ORDER BY m.email_digest_cursor LIMIT v_limit FOR UPDATE SKIP LOCKED),
    moved AS (
      UPDATE public.community_memberships m SET email_digest_cursor = now()
        FROM due WHERE m.tenant_id = due.tenant_id AND m.community_id = due.community_id AND m.user_id = due.user_id
        RETURNING due.tenant_id, due.community_id, due.user_id, due.since, due.muted),
    ins AS (
      INSERT INTO public.community_email_deliveries (tenant_id, community_id, recipient_id, kind, window_start, window_end, idempotency_key)
      SELECT mv.tenant_id, mv.community_id, mv.user_id, 'digest', mv.since, now(),
             'd:' || mv.user_id || ':' || mv.community_id::text || ':' || (extract(epoch FROM now()) * 1000000)::bigint::text
        FROM moved mv
       WHERE NOT mv.muted AND public.community_user_can_read(mv.tenant_id, mv.community_id, mv.user_id)
         AND EXISTS (SELECT 1 FROM public.community_notifications n
           WHERE n.tenant_id = mv.tenant_id AND n.community_id = mv.community_id AND n.recipient_id = mv.user_id AND n.read_at IS NULL
             AND n.kind NOT IN ('application', 'warning', 'held_decision', 'appeal_decision') AND n.updated_at >= mv.since AND n.updated_at < now())
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING 1)
    SELECT count(*)::int INTO n FROM ins;
    queued := queued + n;
  END LOOP;
  PERFORM public.community_definer_reset();
  RETURN queued;
END $$;--> statement-breakpoint
-- Hands the worker a batch to send. This is the only place an address leaves the database. A row is taken when queued, when a
-- failed attempt's back-off has passed (fewer than 5 attempts), or when a crashed worker's lock expired. Anything that no longer
-- applies (email turned off, instant event already read, digest emptied by reading) is marked skipped instead of sent.
CREATE FUNCTION public.community_email_claim(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r record; jobs jsonb := '[]'::jsonb; v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_user record; v_comm record; v_member record; v_items jsonb; v_total integer;
BEGIN
  PERFORM set_config('app.community_email_worker', 'on', true);
  UPDATE public.community_email_deliveries SET status = 'failed', last_error = 'lock_expired', locked_until = NULL
    WHERE status = 'sending' AND locked_until < now() AND attempts >= 5;
  FOR r IN
    WITH picked AS (
      SELECT id FROM public.community_email_deliveries
       WHERE (status = 'queued' OR (status = 'failed' AND attempts < 5 AND coalesce(locked_until, now()) <= now())
              OR (status = 'sending' AND locked_until < now() AND attempts < 5))
       ORDER BY created_at LIMIT v_limit FOR UPDATE SKIP LOCKED),
    taken AS (
      UPDATE public.community_email_deliveries d SET status = 'sending', locked_until = now() + interval '5 minutes', attempts = d.attempts + 1
        FROM picked WHERE d.id = picked.id RETURNING d.*)
    SELECT * FROM taken ORDER BY created_at
  LOOP
    PERFORM set_config('app.community_definer_tenant', r.tenant_id::text, true);
    SELECT u.email, u.name INTO v_user FROM public.users u WHERE u.id = r.recipient_id;
    SELECT c.name, c.slug INTO v_comm FROM public.communities c WHERE c.tenant_id = r.tenant_id AND c.id = r.community_id;
    SELECT m.email_frequency INTO v_member FROM public.community_memberships m
      WHERE m.tenant_id = r.tenant_id AND m.community_id = r.community_id AND m.user_id = r.recipient_id;
    IF v_user.email IS NULL OR v_comm.slug IS NULL OR coalesce(v_member.email_frequency, 'important') = 'off' THEN
      UPDATE public.community_email_deliveries SET status = 'skipped', locked_until = NULL WHERE id = r.id;
      CONTINUE;
    END IF;
    IF r.kind = 'instant' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'targetType', n.target_type, 'count', n.actor_count, 'actorName', a.name,
          'postTitle', CASE WHEN p.removed_at IS NULL AND p.held_at IS NULL THEN p.title END, 'postId', n.post_id, 'detail', n.detail)), '[]'::jsonb), count(*)::int
        INTO v_items, v_total
        FROM public.community_notifications n LEFT JOIN public.users a ON a.id = n.actor_id LEFT JOIN public.community_posts p ON p.id = n.post_id
        WHERE n.id = r.notification_id AND n.read_at IS NULL;
    ELSE
      SELECT coalesce(jsonb_agg(x.j ORDER BY x.at DESC), '[]'::jsonb), max(x.total)::int INTO v_items, v_total FROM (
        SELECT jsonb_build_object('kind', n.kind, 'targetType', n.target_type, 'count', n.actor_count, 'actorName', a.name,
            'postTitle', CASE WHEN p.removed_at IS NULL AND p.held_at IS NULL THEN p.title END, 'postId', n.post_id, 'detail', n.detail) AS j,
          n.updated_at AS at, count(*) OVER () AS total
        FROM public.community_notifications n LEFT JOIN public.users a ON a.id = n.actor_id LEFT JOIN public.community_posts p ON p.id = n.post_id
        WHERE n.tenant_id = r.tenant_id AND n.community_id = r.community_id AND n.recipient_id = r.recipient_id AND n.read_at IS NULL
          AND n.kind NOT IN ('application', 'warning', 'held_decision', 'appeal_decision') AND n.updated_at >= r.window_start AND n.updated_at < r.window_end
        ORDER BY n.updated_at DESC LIMIT 20) x;
    END IF;
    IF jsonb_array_length(v_items) = 0 THEN
      UPDATE public.community_email_deliveries SET status = 'skipped', locked_until = NULL WHERE id = r.id;
      CONTINUE;
    END IF;
    jobs := jobs || jsonb_build_array(jsonb_build_object('id', r.id, 'kind', r.kind, 'to', v_user.email, 'name', v_user.name, 'tenantId', r.tenant_id,
      'communityId', r.community_id, 'recipientId', r.recipient_id, 'communityName', v_comm.name, 'communitySlug', v_comm.slug,
      'hasMembership', v_member.email_frequency IS NOT NULL, 'items', v_items, 'total', coalesce(v_total, jsonb_array_length(v_items)),
      'attempt', r.attempts, 'idempotencyKey', r.idempotency_key));
  END LOOP;
  PERFORM public.community_definer_reset();
  RETURN jobs;
END $$;--> statement-breakpoint
-- Records the result of one send. Only a row this worker holds (sending) can change; a failure backs off by 10 minutes per attempt.
CREATE FUNCTION public.community_email_complete(p_id uuid, p_status text, p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE changed integer;
BEGIN
  IF p_status NOT IN ('sent', 'failed') OR (p_error IS NOT NULL AND p_error !~ '^[a-z_]{1,40}$') THEN RETURN false; END IF;
  PERFORM set_config('app.community_email_worker', 'on', true);
  UPDATE public.community_email_deliveries SET status = p_status, last_error = CASE WHEN p_status = 'failed' THEN coalesce(p_error, 'send_failed') END,
      sent_at = CASE WHEN p_status = 'sent' THEN now() END,
      locked_until = CASE WHEN p_status = 'failed' THEN now() + attempts * interval '10 minutes' END
    WHERE id = p_id AND status = 'sending';
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM public.community_definer_reset();
  RETURN changed = 1;
END $$;--> statement-breakpoint
-- The caller's own email frequency for one community. Moving onto a digest starts its window now; leaving a digest clears it.
CREATE FUNCTION public.community_email_prefs_save(p_slug text, p_frequency text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF p_frequency IS NULL OR p_frequency NOT IN ('off', 'important', 'daily', 'weekly') THEN RETURN public.community_forum_done('invalid'); END IF;
  UPDATE public.community_memberships SET email_frequency = p_frequency,
      email_digest_cursor = CASE WHEN p_frequency NOT IN ('daily', 'weekly') THEN NULL
        WHEN email_frequency IN ('daily', 'weekly') THEN email_digest_cursor ELSE now() END
    WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = actor AND status = 'active';
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.email_prefs', ctx.o_community::text);
  RETURN public.community_forum_done('ok');
END $$;--> statement-breakpoint
-- One-click unsubscribe. The caller (the application) has already verified a signed token for this exact membership.
-- The only change possible is email off, so a stolen or replayed token can do no more than that.
CREATE FUNCTION public.community_email_unsubscribe(p_tenant uuid, p_community uuid, p_user text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE changed integer;
BEGIN
  PERFORM set_config('app.community_definer_tenant', p_tenant::text, true);
  UPDATE public.community_memberships SET email_frequency = 'off', email_digest_cursor = NULL
    WHERE tenant_id = p_tenant AND community_id = p_community AND user_id = p_user;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed = 1 THEN
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (p_tenant, p_user, 'community.email_unsubscribe', p_community::text);
  END IF;
  PERFORM public.community_definer_reset();
  RETURN changed = 1;
END $$;--> statement-breakpoint
-- Retention: deliveries older than 90 days go with the read notifications.
CREATE OR REPLACE FUNCTION public.community_purge_notifications() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE removed integer; removed_email integer;
BEGIN
  PERFORM set_config('app.community_purge', 'on', true);
  DELETE FROM public.community_notifications WHERE read_at IS NOT NULL AND read_at < now() - interval '90 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  DELETE FROM public.community_email_deliveries WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS removed_email = ROW_COUNT;
  PERFORM public.community_definer_reset();
  RETURN removed + removed_email;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_email_enqueue(integer), public.community_email_claim(integer), public.community_email_complete(uuid, text, text),
  public.community_email_prefs_save(text, text), public.community_email_unsubscribe(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
-- The application role runs the worker script (like the purge and the Connect dispatcher); no separate worker role exists yet.
GRANT EXECUTE ON FUNCTION public.community_email_enqueue(integer), public.community_email_claim(integer), public.community_email_complete(uuid, text, text),
  public.community_email_prefs_save(text, text), public.community_email_unsubscribe(uuid, uuid, text) TO harvest_app;
