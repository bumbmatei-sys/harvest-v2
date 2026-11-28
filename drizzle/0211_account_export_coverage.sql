-- Extend the personal export with owner-only reads. All subject predicates are
-- independent of ministry membership and remain scoped to the verified caller.
DO $$
DECLARE
  entry text[];
  actor text := $s$nullif(current_setting('app.user_id', true), '')$s$;
  scope text := $s$current_setting('app.account_export', true) = 'on'$s$;
BEGIN
  FOREACH entry SLICE 1 IN ARRAY ARRAY[
    ARRAY['community_point_attendance','user_id'], ARRAY['community_points_hidden_members','user_id'],
    ARRAY['community_challenge_members','user_id'], ARRAY['volunteers','user_id'],
    ARRAY['volunteer_availability','user_id'], ARRAY['ministry_donation_receipts','donor_id'],
    ARRAY['ministry_payment_intents','payer_id'], ARRAY['blog_posts','created_by']
  ] LOOP
    EXECUTE format('CREATE POLICY export_personal_entry ON public.%I FOR SELECT TO %I USING (%s AND %I = %s)',
      entry[1], current_user, scope, entry[2], actor);
  END LOOP;

  EXECUTE format($p$CREATE POLICY export_personal_entry ON public.volunteer_assignments FOR SELECT TO %I USING (%s AND
    (user_id = %s OR EXISTS (SELECT 1 FROM public.volunteers v
      WHERE v.tenant_id = volunteer_assignments.tenant_id AND v.id = volunteer_assignments.volunteer_id AND v.user_id = %s)))$p$,
    current_user, scope, actor, actor);
  EXECUTE format($p$CREATE POLICY export_personal_entry ON public.volunteer_requests FOR SELECT TO %I
    USING (%s AND (%s IN (user_id, replacement_user_id)))$p$, current_user, scope, actor);
  EXECUTE format($p$CREATE POLICY export_personal_entry ON public.workspace_ownership_offers FOR SELECT TO %I
    USING (%s AND (%s IN (from_user_id, to_user_id)))$p$, current_user, scope, actor);
  EXECUTE format($p$CREATE POLICY export_personal_entry ON public.community_post_details FOR SELECT TO %I USING (%s AND EXISTS (
    SELECT 1 FROM public.community_posts p WHERE p.id = post_id AND p.tenant_id = community_post_details.tenant_id
      AND p.community_id = community_post_details.community_id AND p.author_id = %s))$p$, current_user, scope, actor);
  EXECUTE format($p$CREATE POLICY export_personal_entry ON public.community_point_settings FOR SELECT TO %I USING (%s AND enabled AND EXISTS (
    SELECT 1 FROM public.community_memberships m WHERE m.tenant_id = community_point_settings.tenant_id
      AND m.community_id = community_point_settings.community_id AND m.user_id = %s AND m.status = 'active'))$p$, current_user, scope, actor);
  EXECUTE format($p$CREATE POLICY export_personal_entry ON public.community_challenges FOR SELECT TO %I USING (%s AND EXISTS (
    SELECT 1 FROM public.community_challenge_members m WHERE m.tenant_id = community_challenges.tenant_id
      AND m.community_id = community_challenges.community_id AND m.challenge_id = community_challenges.id AND m.user_id = %s))$p$,
    current_user, scope, actor);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.account_export_points(p_tenant uuid, p_community uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
DECLARE settings public.community_point_settings;
DECLARE totals jsonb;
BEGIN
  IF actor IS NULL OR current_setting('app.account_export', true) IS DISTINCT FROM 'on' THEN RETURN NULL; END IF;
  PERFORM set_config('app.points_tenant', p_tenant::text, true);
  PERFORM set_config('app.points_community', p_community::text, true);
  SELECT * INTO settings FROM public.community_point_settings
    WHERE tenant_id = p_tenant AND community_id = p_community AND enabled;
  IF FOUND THEN
    SELECT jsonb_build_object('communityId', p_community, 'lifetimePoints', coalesce(sum(
      CASE a.action WHEN 'post' THEN settings.post_points WHEN 'reply' THEN settings.reply_points
        WHEN 'lesson' THEN settings.lesson_points ELSE settings.event_points END), 0))
    INTO totals FROM public.community_point_activity(p_tenant, p_community, actor) a
    WHERE a.user_id = actor AND a.occurred_at <= statement_timestamp();
  END IF;
  PERFORM set_config('app.points_tenant', '', true);
  PERFORM set_config('app.points_community', '', true);
  RETURN totals;
END $$;
REVOKE ALL ON FUNCTION public.account_export_points(uuid,uuid) FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$
DECLARE
  original text := pg_catalog.pg_get_functiondef('public.account_export()'::regprocedure);
  patched text;
  anchor text := $a$  LOOP
    IF pg_catalog.jsonb_array_length(section) > cap$a$;
  dm_comment text := $a$-- DMs the person sent. The other person appears by their display name only (no id, email or profile).$a$;
  dm_name text := $a$, 'to', other.name$a$;
  dm_join text := $a$      LEFT JOIN public.community_dm_conversations cv ON cv.id = m.conversation_id
      LEFT JOIN public.users other ON other.id = (SELECT e FROM pg_catalog.jsonb_array_elements_text(cv.pair_key::jsonb) e WHERE e <> actor LIMIT 1)
$a$;
  additions text := $s$    UNION ALL
    SELECT 'postDetails', coalesce(jsonb_agg(x ORDER BY created_at, id), '[]') FROM (
      SELECT p.created_at, p.id, jsonb_build_object('postId', p.id,
        'location', d.details->'location', 'feeling', d.details->'feeling',
        'photoIds', coalesce((SELECT jsonb_agg(photo.id ORDER BY photo.position)
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d.details->'photoIds') = 'array' THEN d.details->'photoIds' ELSE '[]'::jsonb END) WITH ORDINALITY photo(id, position)
          JOIN public.community_files f ON f.id::text = photo.id AND f.tenant_id = p.tenant_id
            AND f.community_id = p.community_id AND f.uploader_id = actor), '[]'),
        'mentionIds', coalesce(d.details->'mentionIds', '[]')) x
      FROM public.community_post_details d JOIN public.community_posts p
        ON p.id = d.post_id AND p.tenant_id = d.tenant_id AND p.community_id = d.community_id
      WHERE p.author_id = actor ORDER BY p.created_at, p.id LIMIT cap + 1) q
    UNION ALL
    SELECT 'communityPoints', coalesce(jsonb_agg(x ORDER BY community_id), '[]') FROM (
      SELECT m.community_id, public.account_export_points(m.tenant_id, m.community_id) x
      FROM public.community_memberships m JOIN public.community_point_settings s
        ON s.tenant_id = m.tenant_id AND s.community_id = m.community_id AND s.enabled
      WHERE m.user_id = actor AND m.status = 'active' ORDER BY m.community_id LIMIT cap + 1) q
    UNION ALL
    SELECT 'communityPointAttendance', coalesce(jsonb_agg(x ORDER BY community_id, event_id), '[]') FROM (
      SELECT a.community_id, a.event_id, jsonb_build_object('communityId', a.community_id, 'eventId', a.event_id) x
      FROM public.community_point_attendance a WHERE a.user_id = actor
      ORDER BY a.community_id, a.event_id LIMIT cap + 1) q
    UNION ALL
    SELECT 'communityPointVisibility', coalesce(jsonb_agg(x ORDER BY community_id), '[]') FROM (
      SELECT h.community_id, jsonb_build_object('communityId', h.community_id, 'hidden', true) x
      FROM public.community_points_hidden_members h WHERE h.user_id = actor
      ORDER BY h.community_id LIMIT cap + 1) q
    UNION ALL
    SELECT 'communityChallenges', coalesce(jsonb_agg(x ORDER BY joined_at, challenge_id), '[]') FROM (
      SELECT m.joined_at, m.challenge_id, jsonb_build_object('communityId', m.community_id, 'challengeId', m.challenge_id,
        'title', c.title, 'joinedAt', m.joined_at, 'completedAt', m.completed_at) x
      FROM public.community_challenge_members m LEFT JOIN public.community_challenges c
        ON c.tenant_id = m.tenant_id AND c.community_id = m.community_id AND c.id = m.challenge_id
      WHERE m.user_id = actor ORDER BY m.joined_at, m.challenge_id LIMIT cap + 1) q
    UNION ALL
    SELECT 'volunteerRoles', coalesce(jsonb_agg(x ORDER BY start_date, id), '[]') FROM (
      SELECT v.start_date, v.id, jsonb_build_object('ministryId', v.tenant_id, 'roleId', v.role_id, 'volunteerId', v.id,
        'startDate', v.start_date, 'endDate', v.end_date) x
      FROM public.volunteers v WHERE v.user_id = actor ORDER BY v.start_date, v.id LIMIT cap + 1) q
    UNION ALL
    SELECT 'volunteerAssignments', coalesce(jsonb_agg(x ORDER BY tenant_id, id), '[]') FROM (
      SELECT a.tenant_id, a.id, jsonb_build_object('id', a.id, 'ministryId', a.tenant_id, 'slotId', a.slot_id, 'roleId', a.role_id) x
      FROM public.volunteer_assignments a
      LEFT JOIN public.volunteers v ON v.tenant_id = a.tenant_id AND v.id = a.volunteer_id AND v.user_id = actor
      WHERE a.user_id = actor OR v.id IS NOT NULL ORDER BY a.tenant_id, a.id LIMIT cap + 1) q
    UNION ALL
    SELECT 'volunteerAvailability', coalesce(jsonb_agg(x ORDER BY unavailable_date, tenant_id), '[]') FROM (
      SELECT a.unavailable_date, a.tenant_id, jsonb_build_object('ministryId', a.tenant_id, 'unavailableDate', a.unavailable_date) x
      FROM public.volunteer_availability a WHERE a.user_id = actor
      ORDER BY a.unavailable_date, a.tenant_id LIMIT cap + 1) q
    UNION ALL
    SELECT 'volunteerRequests', coalesce(jsonb_agg(x ORDER BY created_at, id), '[]') FROM (
      SELECT r.created_at, r.id, jsonb_build_object('id', r.id, 'ministryId', r.tenant_id, 'slotId', r.slot_id,
        'participation', CASE WHEN r.user_id = actor THEN 'requester' ELSE 'replacement' END,
        'kind', r.kind, 'state', r.state, 'createdAt', r.created_at,
        'acceptedAt', CASE WHEN r.replacement_user_id = actor THEN r.replacement_accepted_at END) x
      FROM public.volunteer_requests r WHERE actor IN (r.user_id, r.replacement_user_id)
      ORDER BY r.created_at, r.id LIMIT cap + 1) q
    UNION ALL
    SELECT 'donationReceipts', coalesce(jsonb_agg(x ORDER BY paid_at, id), '[]') FROM (
      SELECT r.paid_at, r.id, jsonb_build_object('id', r.id, 'ministryId', r.tenant_id, 'amountMinor', r.amount_minor,
        'currency', r.currency, 'paidAt', r.paid_at, 'personalSupport', r.personal_support, 'cadence', r.cadence) x
      FROM public.ministry_donation_receipts r WHERE r.donor_id = actor ORDER BY r.paid_at, r.id LIMIT cap + 1) q
    UNION ALL
    SELECT 'paymentIntents', coalesce(jsonb_agg(x ORDER BY created_at, id), '[]') FROM (
      SELECT i.created_at, i.id, jsonb_build_object('id', i.id, 'ministryId', i.tenant_id, 'kind', i.kind, 'cadence', i.cadence,
        'itemId', i.item_id, 'amountMinor', i.amount_minor, 'currency', i.currency, 'createdAt', i.created_at,
        'subscriptionEndedAt', i.subscription_ended_at) x
      FROM public.ministry_payment_intents i WHERE i.payer_id = actor ORDER BY i.created_at, i.id LIMIT cap + 1) q
    UNION ALL
    SELECT 'ministryOwnershipOffers', coalesce(jsonb_agg(x ORDER BY created_at, id), '[]') FROM (
      SELECT o.created_at, o.id, jsonb_build_object('id', o.id, 'ministryId', o.tenant_id,
        'participation', CASE WHEN o.from_user_id = actor THEN 'sender' ELSE 'recipient' END,
        'status', o.status, 'createdAt', o.created_at, 'expiresAt', o.expires_at) x
      FROM public.workspace_ownership_offers o WHERE actor IN (o.from_user_id, o.to_user_id)
      ORDER BY o.created_at, o.id LIMIT cap + 1) q
    UNION ALL
    SELECT 'authoredArticles', coalesce(jsonb_agg(x ORDER BY updated_at, id), '[]') FROM (
      SELECT p.updated_at, p.id, jsonb_build_object('id', p.id, 'ministryId', p.tenant_id,
        'createdAt', p.created_at, 'updatedAt', p.updated_at) x
      FROM public.blog_posts p WHERE p.created_by = actor ORDER BY p.updated_at, p.id LIMIT cap + 1) q
$s$;
BEGIN
  patched := pg_catalog.replace(original, anchor, additions || anchor);
  IF pg_catalog.length(patched) - pg_catalog.length(original) <> pg_catalog.length(additions) THEN
    RAISE EXCEPTION 'account_export: expected one section insertion point';
  END IF;
  original := patched;
  patched := pg_catalog.replace(original, dm_name, '');
  IF pg_catalog.length(original) - pg_catalog.length(patched) <> pg_catalog.length(dm_name) THEN
    RAISE EXCEPTION 'account_export: expected the DM counterpart projection';
  END IF;
  original := patched;
  patched := pg_catalog.replace(original, dm_join, '');
  IF pg_catalog.length(original) - pg_catalog.length(patched) <> pg_catalog.length(dm_join) THEN
    RAISE EXCEPTION 'account_export: expected the DM counterpart join';
  END IF;
  EXECUTE pg_catalog.replace(patched, dm_comment, '-- DMs the person sent.');
END $$;
