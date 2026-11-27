CREATE TABLE "account_export_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_export_requests" ADD CONSTRAINT "account_export_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_export_requests_user_idx" ON "account_export_requests" USING btree ("user_id","requested_at");--> statement-breakpoint
-- "Your data" (founder, 27 Nov), part 1: a signed-in person downloads everything Harvest holds about them as a user. public.account_export runs as
-- this migration's owner and reads only the caller's own rows (app.user_id), under app.account_export, which it sets and clears itself. Other
-- people's personal data is limited to what the export needs to be readable: a DM counterpart's display name, and the names of ministries,
-- communities, channels, courses, lessons and events the person's own rows point to.
ALTER TABLE public.account_export_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.account_export_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.account_export_requests FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Every app.* flag an owner-role policy reads, except app.user_id (the verified caller), blanked by the account definers on entry and on exit.
-- pg_settings does not list custom settings (the 0120 defect fixed in 0124), so the names are explicit; an integration test compares this list
-- with pg_policies. The four app.blog_* names belong to the native blog (#315), listed ahead so either merge order is covered. app.tenant_id is
-- blanked too, so the account definers must only run in a personal (withUser) transaction, never inside a ministry (withTenant) transaction.
CREATE FUNCTION public.account_self_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT pg_catalog.set_config(name, '', true) FROM pg_catalog.unnest(ARRAY['app.account_export','app.account_erase',
    'app.access_tenant','app.access_token','app.ads_definer','app.blog_public_file','app.blog_public_handle','app.blog_public_tenant','app.blog_publish','app.bio_handle','app.bio_tenant','app.campaign_budget_tenant','app.campaign_invite_tenant',
    'app.campaign_invite_token','app.catalog_learner_tenant','app.catalog_my_notes','app.catalog_progress_tenant','app.catalog_slug','app.catalog_tenant',
    'app.chat_purge','app.chat_settings','app.community_definer_tenant','app.community_email_worker','app.community_purge','app.community_resolve_email',
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
REVOKE ALL ON FUNCTION public.account_self_reset() FROM PUBLIC, harvest_app;--> statement-breakpoint
-- The community definers blank their flags through community_definer_reset(); it now also blanks the two account flags, so an app-set flag can
-- never widen what a community or catalogue definer reads. The list is 0129's plus the two new names.
CREATE OR REPLACE FUNCTION public.community_definer_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT set_config(name, '', true) FROM unnest(ARRAY['app.community_resolve_slug','app.community_definer_tenant','app.community_resolve_ids',
    'app.community_resolve_invite','app.community_resolve_email','app.discover_read','app.community_resolve_user','app.community_purge',
    'app.community_email_worker','app.giving_definer','app.giving_definer_tenant','app.giving_public_tenant',
    'app.give_public_slug','app.give_public_tenant','app.give_public_fundraising',
    'app.catalog_tenant','app.chat_purge','app.chat_settings','app.community_stats_write','app.discover_platform',
    'app.dm_evidence_report','app.dm_purge','app.events_tenant','app.live_community',
    'app.account_export','app.account_erase']) AS name;
$$;--> statement-breakpoint
-- Owner read policies. Each personal table is pinned to the caller's own rows (app.user_id) and is active only while app.account_export is on.
-- The named-reference tables are readable only where one of the caller's own rows points to them; none of these policies refers to its own table.
DO $$ DECLARE pair text[]; BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['account_export_requests','user_id'], ARRAY['user_profiles','user_id'], ARRAY['workspace_members','user_id'],
    ARRAY['community_memberships','user_id'], ARRAY['community_member_profiles','user_id'], ARRAY['community_applications','user_id'],
    ARRAY['community_posts','author_id'], ARRAY['community_comments','author_id'], ARRAY['community_messages','author_id'],
    ARRAY['community_dm_messages','author_id'], ARRAY['community_dm_participants','user_id'], ARRAY['community_likes','user_id'],
    ARRAY['community_message_reactions','user_id'], ARRAY['community_files','uploader_id'], ARRAY['catalog_enrolments','user_id'],
    ARRAY['catalog_progress','user_id'], ARRAY['catalog_notes','user_id'], ARRAY['event_rsvps','user_id'], ARRAY['entitlements','user_id']] LOOP
    EXECUTE format($p$CREATE POLICY account_export_own ON public.%I FOR SELECT TO %I
      USING (%I = nullif(current_setting('app.user_id', true), '') AND current_setting('app.account_export', true) = 'on')$p$, pair[1], current_user, pair[2]);
  END LOOP;
  EXECUTE format($p$CREATE POLICY account_export_write ON public.account_export_requests FOR INSERT TO %I
    WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '') AND current_setting('app.account_export', true) = 'on')$p$, current_user);
  EXECUTE format($p$CREATE POLICY account_export_prune ON public.account_export_requests FOR DELETE TO %I
    USING (user_id = nullif(current_setting('app.user_id', true), '') AND current_setting('app.account_export', true) = 'on')$p$, current_user);
  EXECUTE format($p$CREATE POLICY account_export_audit ON public.audit_logs FOR INSERT TO %I
    WITH CHECK (tenant_id IS NULL AND actor_id = nullif(current_setting('app.user_id', true), '') AND action = 'account.export'
      AND current_setting('app.account_export', true) = 'on')$p$, current_user);
  EXECUTE format($p$CREATE POLICY account_export_ref ON public.workspaces FOR SELECT TO %I
    USING (current_setting('app.account_export', true) = 'on' AND EXISTS (SELECT 1 FROM public.workspace_members m
      WHERE m.tenant_id = workspaces.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')))$p$, current_user);
  EXECUTE format($p$CREATE POLICY account_export_ref ON public.communities FOR SELECT TO %I
    USING (current_setting('app.account_export', true) = 'on' AND EXISTS (SELECT 1 FROM public.community_memberships m
      WHERE m.tenant_id = communities.tenant_id AND m.community_id = communities.id AND m.user_id = nullif(current_setting('app.user_id', true), '')))$p$, current_user);
  EXECUTE format($p$CREATE POLICY account_export_ref ON public.community_channels FOR SELECT TO %I
    USING (current_setting('app.account_export', true) = 'on' AND EXISTS (SELECT 1 FROM public.community_messages x
      WHERE x.channel_id = community_channels.id AND x.author_id = nullif(current_setting('app.user_id', true), '')))$p$, current_user);
  EXECUTE format($p$CREATE POLICY account_export_ref ON public.community_dm_conversations FOR SELECT TO %I
    USING (current_setting('app.account_export', true) = 'on' AND EXISTS (SELECT 1 FROM public.community_dm_participants p
      WHERE p.conversation_id = community_dm_conversations.id AND p.user_id = nullif(current_setting('app.user_id', true), '')))$p$, current_user);
  EXECUTE format($p$CREATE POLICY account_export_ref ON public.catalog_items FOR SELECT TO %I
    USING (current_setting('app.account_export', true) = 'on' AND (
      EXISTS (SELECT 1 FROM public.catalog_enrolments e WHERE e.tenant_id = catalog_items.tenant_id AND e.item_id = catalog_items.id AND e.user_id = nullif(current_setting('app.user_id', true), ''))
      OR EXISTS (SELECT 1 FROM public.catalog_progress p WHERE p.tenant_id = catalog_items.tenant_id AND p.item_id = catalog_items.id AND p.user_id = nullif(current_setting('app.user_id', true), ''))
      OR EXISTS (SELECT 1 FROM public.catalog_notes n WHERE n.tenant_id = catalog_items.tenant_id AND n.item_id = catalog_items.id AND n.user_id = nullif(current_setting('app.user_id', true), ''))))$p$, current_user);
  EXECUTE format($p$CREATE POLICY account_export_ref ON public.catalog_lessons FOR SELECT TO %I
    USING (current_setting('app.account_export', true) = 'on' AND (
      EXISTS (SELECT 1 FROM public.catalog_progress p WHERE p.tenant_id = catalog_lessons.tenant_id AND p.item_id = catalog_lessons.item_id AND p.lesson_id = catalog_lessons.id AND p.user_id = nullif(current_setting('app.user_id', true), ''))
      OR EXISTS (SELECT 1 FROM public.catalog_notes n WHERE n.tenant_id = catalog_lessons.tenant_id AND n.item_id = catalog_lessons.item_id AND n.lesson_id = catalog_lessons.id AND n.user_id = nullif(current_setting('app.user_id', true), ''))))$p$, current_user);
  EXECUTE format($p$CREATE POLICY account_export_ref ON public.events FOR SELECT TO %I
    USING (current_setting('app.account_export', true) = 'on' AND EXISTS (SELECT 1 FROM public.event_rsvps r
      WHERE r.tenant_id = events.tenant_id AND r.event_id = events.id AND r.user_id = nullif(current_setting('app.user_id', true), '')))$p$, current_user);
END $$;--> statement-breakpoint
-- The export. At most 3 per rolling hour per person (older requests are pruned). Each list holds at most 5,000 rows, oldest first; a longer list is
-- cut and named in "truncated". File keys are returned for signing by the web layer, which removes them before the download is built.
CREATE FUNCTION public.account_export() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); recent integer; oldest timestamptz; cap constant integer := 5000;
  result jsonb := '{}'::jsonb; section jsonb; truncated text[] := ARRAY[]::text[]; name text;
BEGIN
  PERFORM public.community_definer_reset();
  PERFORM public.account_self_reset();
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = actor) THEN RETURN pg_catalog.jsonb_build_object('outcome', 'not_found'); END IF;
  PERFORM pg_catalog.set_config('app.account_export', 'on', true);
  -- One person's requests are serialised by their account row, so two parallel requests cannot both pass the limit.
  PERFORM 1 FROM public.users u WHERE u.id = actor FOR UPDATE;
  DELETE FROM public.account_export_requests r WHERE r.user_id = actor AND r.requested_at < pg_catalog.now() - interval '1 hour';
  SELECT count(*)::int, min(r.requested_at) INTO recent, oldest FROM public.account_export_requests r WHERE r.user_id = actor;
  IF recent >= 3 THEN
    PERFORM public.account_self_reset();
    RETURN pg_catalog.jsonb_build_object('outcome', 'limited', 'retryAfter',
      greatest(1, ceil(extract(epoch FROM (oldest + interval '1 hour' - pg_catalog.now())))::int));
  END IF;
  INSERT INTO public.account_export_requests (user_id) VALUES (actor);
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (NULL, actor, 'account.export', actor);

  SELECT pg_catalog.jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'emailVerified', u.email_verified, 'language', u.locale,
    'createdAt', u.created_at, 'cityRegion', p.city_region, 'onboardingCompletedAt', p.onboarding_completed_at, 'onboardingSkippedAt', p.onboarding_skipped_at)
    INTO section FROM public.users u LEFT JOIN public.user_profiles p ON p.user_id = u.id WHERE u.id = actor;
  result := result || pg_catalog.jsonb_build_object('account', section);
  -- Sign-in history: the person's current sessions (Harvest keeps no older ones). The session token is never exported.
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signedInAt', s.created_at, 'lastActiveAt', s.updated_at, 'expiresAt', s.expires_at,
    'ipAddress', s.ip_address, 'userAgent', s.user_agent) ORDER BY s.created_at), '[]'::jsonb) INTO section FROM public.sessions s WHERE s.user_id = actor;
  result := result || pg_catalog.jsonb_build_object('signIns', section);

  FOR name, section IN
    SELECT 'ministries', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'joinedAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('ministry', w.name, 'role', m.role_id,
      'joinedAt', m.created_at) x FROM public.workspace_members m JOIN public.workspaces w ON w.tenant_id = m.tenant_id WHERE m.user_id = actor
      ORDER BY m.created_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'communities', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'joinedAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('community', c.name, 'address', c.slug,
      'role', m.role, 'status', m.status, 'joinedAt', m.joined_at, 'rulesVersionAccepted', m.rules_version_accepted, 'adultConfirmedAt', m.adult_confirmed_at,
      'joinAnswers', m.join_answers, 'notifications', pg_catalog.jsonb_build_object('replies', m.notify_replies, 'likes', m.notify_likes,
        'announcements', m.notify_announcements, 'muted', m.notifications_muted, 'email', m.email_frequency), 'acceptsMessages', m.dm_accept_members,
      'profile', CASE WHEN pr.user_id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('displayName', pr.display_name, 'bio', pr.bio,
        'language', pr.language, 'links', pr.links, 'visibility', pr.visibility, 'updatedAt', pr.updated_at) END) x
      FROM public.community_memberships m JOIN public.communities c ON c.tenant_id = m.tenant_id AND c.id = m.community_id
      LEFT JOIN public.community_member_profiles pr ON pr.tenant_id = m.tenant_id AND pr.community_id = m.community_id AND pr.user_id = m.user_id
      WHERE m.user_id = actor ORDER BY m.created_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'communityApplications', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'createdAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('community', c.name,
      'status', a.status, 'answers', a.answers, 'createdAt', a.created_at) x
      FROM public.community_applications a LEFT JOIN public.communities c ON c.tenant_id = a.tenant_id AND c.id = a.community_id
      WHERE a.user_id = actor ORDER BY a.created_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'posts', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'createdAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('id', p.id, 'community', c.name,
      'title', p.title, 'text', p.body_text, 'videoUrl', p.video_url, 'createdAt', p.created_at, 'editedAt', p.edited_at, 'removed', p.removed_at IS NOT NULL) x
      FROM public.community_posts p LEFT JOIN public.communities c ON c.tenant_id = p.tenant_id AND c.id = p.community_id
      WHERE p.author_id = actor ORDER BY p.created_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'replies', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'createdAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('id', r.id, 'postId', r.post_id,
      'community', c.name, 'text', r.body, 'createdAt', r.created_at, 'updatedAt', r.updated_at, 'removed', r.removed_at IS NOT NULL) x
      FROM public.community_comments r LEFT JOIN public.communities c ON c.tenant_id = r.tenant_id AND c.id = r.community_id
      WHERE r.author_id = actor ORDER BY r.created_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'chatMessages', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'createdAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('id', m.id, 'community', c.name,
      'channel', ch.name, 'replyTo', m.parent_id, 'text', CASE WHEN m.deleted_at IS NULL THEN m.body END, 'createdAt', m.created_at, 'editedAt', m.edited_at,
      'deleted', m.deleted_at IS NOT NULL) x
      FROM public.community_messages m LEFT JOIN public.communities c ON c.tenant_id = m.tenant_id AND c.id = m.community_id
      LEFT JOIN public.community_channels ch ON ch.id = m.channel_id WHERE m.author_id = actor ORDER BY m.created_at LIMIT cap + 1) q
    UNION ALL
    -- DMs the person sent. The other person appears by their display name only (no id, email or profile).
    SELECT 'directMessages', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'createdAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('conversation', m.conversation_id,
      'community', c.name, 'to', other.name, 'text', CASE WHEN m.deleted_at IS NULL THEN m.body END, 'createdAt', m.created_at, 'editedAt', m.edited_at,
      'deleted', m.deleted_at IS NOT NULL) x
      FROM public.community_dm_messages m LEFT JOIN public.communities c ON c.tenant_id = m.tenant_id AND c.id = m.community_id
      LEFT JOIN public.community_dm_conversations cv ON cv.id = m.conversation_id
      LEFT JOIN public.users other ON other.id = (SELECT e FROM pg_catalog.jsonb_array_elements_text(cv.pair_key::jsonb) e WHERE e <> actor LIMIT 1)
      WHERE m.author_id = actor ORDER BY m.created_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'likes', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'createdAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('community', c.name, 'type', l.target_type,
      'target', l.target_id, 'createdAt', l.created_at) x FROM public.community_likes l LEFT JOIN public.communities c ON c.tenant_id = l.tenant_id AND c.id = l.community_id
      WHERE l.user_id = actor ORDER BY l.created_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'reactions', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'createdAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('community', c.name, 'message', r.message_id,
      'emoji', r.emoji, 'createdAt', r.created_at) x FROM public.community_message_reactions r LEFT JOIN public.communities c ON c.tenant_id = r.tenant_id AND c.id = r.community_id
      WHERE r.user_id = actor ORDER BY r.created_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'courseEnrolments', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'enrolledAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('course', i.title,
      'enrolledAt', e.enrolled_at) x FROM public.catalog_enrolments e LEFT JOIN public.catalog_items i ON i.tenant_id = e.tenant_id AND i.id = e.item_id
      WHERE e.user_id = actor ORDER BY e.enrolled_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'courseProgress', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'completedAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('course', i.title,
      'lesson', l.title, 'completedAt', p.completed_at) x FROM public.catalog_progress p
      LEFT JOIN public.catalog_items i ON i.tenant_id = p.tenant_id AND i.id = p.item_id
      LEFT JOIN public.catalog_lessons l ON l.tenant_id = p.tenant_id AND l.item_id = p.item_id AND l.id = p.lesson_id
      WHERE p.user_id = actor ORDER BY p.completed_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'courseNotes', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'updatedAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('course', i.title,
      'lesson', l.title, 'note', n.body, 'updatedAt', n.updated_at) x FROM public.catalog_notes n
      LEFT JOIN public.catalog_items i ON i.tenant_id = n.tenant_id AND i.id = n.item_id
      LEFT JOIN public.catalog_lessons l ON l.tenant_id = n.tenant_id AND l.item_id = n.item_id AND l.id = n.lesson_id
      WHERE n.user_id = actor ORDER BY n.updated_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'access', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'createdAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('type', g.resource_type, 'tier', g.tier,
      'source', g.source, 'validFrom', g.valid_from, 'validUntil', g.valid_until, 'revokedAt', g.revoked_at, 'createdAt', g.created_at) x
      FROM public.entitlements g WHERE g.user_id = actor ORDER BY g.created_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'events', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'createdAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('event', ev.title, 'startsAt', ev.starts_at,
      'answer', r.state, 'createdAt', r.created_at, 'updatedAt', r.updated_at) x FROM public.event_rsvps r
      LEFT JOIN public.events ev ON ev.tenant_id = r.tenant_id AND ev.id = r.event_id WHERE r.user_id = actor ORDER BY r.created_at LIMIT cap + 1) q
    UNION ALL
    SELECT 'files', coalesce(pg_catalog.jsonb_agg(x ORDER BY x->>'createdAt'), '[]') FROM (SELECT pg_catalog.jsonb_build_object('id', f.id, 'community', c.name,
      'name', f.name, 'type', f.mime, 'size', f.size, 'kind', f.kind, 'status', f.status, 'createdAt', f.created_at, 'key', CASE WHEN f.status = 'ready' THEN f.key END) x
      FROM public.community_files f LEFT JOIN public.communities c ON c.tenant_id = f.tenant_id AND c.id = f.community_id
      WHERE f.uploader_id = actor ORDER BY f.created_at LIMIT cap + 1) q
  LOOP
    IF pg_catalog.jsonb_array_length(section) > cap THEN section := section - cap; truncated := truncated || name; END IF;
    result := result || pg_catalog.jsonb_build_object(name, section);
  END LOOP;
  PERFORM public.account_self_reset();
  RETURN pg_catalog.jsonb_build_object('outcome', 'ok', 'data', result, 'truncated', pg_catalog.to_jsonb(truncated));
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_export() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.account_export() TO harvest_app;
