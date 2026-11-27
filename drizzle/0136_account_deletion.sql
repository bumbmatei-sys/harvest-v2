CREATE TABLE "account_deletions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"reference" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "account_erase_grants" (
	"token" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_deletions" ADD CONSTRAINT "account_deletions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_erase_grants" ADD CONSTRAINT "account_erase_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- "Your data" (founder, 27 Nov), part 2: self-serve account deletion, and "Former member" on leaving a community (policy pack §11, G2).
-- The account row itself stays, scrubbed: append-only audit logs and other people's records (CRM notes, documents, campaigns a staff member
-- created) still point at it, so it cannot be deleted. Everything that is about the person is deleted or detached by public.account_delete,
-- which runs as this migration's owner and touches only rows of the caller (app.user_id).
--
-- The erase flag is unforgeable. Each account definer draws a random token, stores it in account_erase_grants (no app grant) for the caller,
-- sets app.account_erase to it, and deletes the row before returning. public.account_erase_active() is true only when app.account_erase names a
-- grant row of app.user_id created in the current transaction (created_at = now()). A value the app sets by hand, an old token or another
-- person's token matches nothing, so no other owner-role definer can be widened by it. The account definers are VOLATILE: a STABLE function would
-- not see the grant row it has just inserted. These definers blank app.tenant_id and every other app.*
-- flag on entry and exit: they must only run in a personal (withUser) transaction, never inside a ministry (withTenant) transaction.
ALTER TABLE public.account_erase_grants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.account_erase_grants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.account_erase_grants FROM PUBLIC, harvest_app;--> statement-breakpoint
-- The grant table's own policy names only settings and now(), never its own table.
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY account_erase_grant_own ON public.account_erase_grants TO %I
    USING (token::text = current_setting('app.account_erase', true) AND user_id = nullif(current_setting('app.user_id', true), '') AND created_at = pg_catalog.now())
    WITH CHECK (token::text = current_setting('app.account_erase', true) AND user_id = nullif(current_setting('app.user_id', true), '') AND created_at = pg_catalog.now())$p$, current_user);
END $$;--> statement-breakpoint
CREATE FUNCTION public.account_erase_active() RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT nullif(current_setting('app.account_erase', true), '') IS NOT NULL AND nullif(current_setting('app.user_id', true), '') IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.account_erase_grants g WHERE g.token::text = current_setting('app.account_erase', true)
      AND g.user_id = nullif(current_setting('app.user_id', true), '') AND g.created_at = pg_catalog.now())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_erase_active() FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Internal: draw a token for the caller and turn the erase policies on; account_erase_end() deletes it and blanks every flag.
CREATE FUNCTION public.account_erase_begin(p_actor text) RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE t uuid := pg_catalog.gen_random_uuid();
BEGIN
  PERFORM pg_catalog.set_config('app.account_erase', t::text, true);
  INSERT INTO public.account_erase_grants (token, user_id) VALUES (t, p_actor);
END $$;--> statement-breakpoint
CREATE FUNCTION public.account_erase_end() RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  DELETE FROM public.account_erase_grants g WHERE g.token::text = current_setting('app.account_erase', true);
  PERFORM public.account_self_reset();
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_erase_begin(text) FROM PUBLIC, harvest_app;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_erase_end() FROM PUBLIC, harvest_app;--> statement-breakpoint
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.account_deletions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.account_deletions FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Owner write policies, one per (table, person column). Each is active only while the caller's erase token is live, for the caller's rows and
-- for rows with no person (PostgreSQL also checks a detaching update's new row, author set to null, against the SELECT side); every statement in
-- account_delete filters on the caller's id, so a detached row of someone else is never touched. No policy refers to its own table.
-- The token check is written out in each policy (the same test as account_erase_active()), reading the settings directly, so a policy calls no
-- erase helper: a role that copies these policies (a restricted definer owner) needs no EXECUTE on it. Reading account_erase_grants is granted
-- to PUBLIC for the same reason; FORCE RLS and its owner-only policy keep every row invisible to any other role, and a token row never
-- outlives its transaction.
GRANT SELECT ON public.account_erase_grants TO PUBLIC;--> statement-breakpoint
DO $$ DECLARE pair text[]; live text := $l$(pg_catalog.current_setting('app.account_erase', true) <> '' AND EXISTS (SELECT 1 FROM public.account_erase_grants g
      WHERE g.token::text = pg_catalog.current_setting('app.account_erase', true) AND g.user_id = nullif(pg_catalog.current_setting('app.user_id', true), '')
        AND g.created_at = pg_catalog.now()))$l$; BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['account_deletions','user_id'], ARRAY['account_export_requests','user_id'], ARRAY['user_profiles','user_id'], ARRAY['workspace_members','user_id'],
    ARRAY['community_memberships','user_id'], ARRAY['community_member_profiles','user_id'], ARRAY['community_applications','user_id'],
    ARRAY['community_appeals','user_id'], ARRAY['community_warnings','user_id'], ARRAY['community_exits','user_id'],
    ARRAY['community_channel_members','user_id'], ARRAY['community_channel_reads','user_id'], ARRAY['community_notifications','recipient_id'],
    ARRAY['community_notifications','actor_id'], ARRAY['community_email_deliveries','recipient_id'], ARRAY['community_reports','reporter_id'],
    ARRAY['community_moderation_actions','subject_user_id'], ARRAY['community_moderation_actions','actor_id'], ARRAY['community_invites','redeemed_by'],
    ARRAY['community_posts','author_id'], ARRAY['community_comments','author_id'], ARRAY['community_messages','author_id'],
    ARRAY['community_files','uploader_id'], ARRAY['community_dm_messages','author_id'], ARRAY['community_dm_participants','user_id'],
    ARRAY['community_dm_blocks','blocker_id'], ARRAY['community_dm_blocks','blocked_id'], ARRAY['community_dm_conversations','started_by'],
    ARRAY['community_dm_conversations','last_sender_id'], ARRAY['community_likes','user_id'], ARRAY['community_message_reactions','user_id'],
    ARRAY['catalog_enrolments','user_id'], ARRAY['catalog_progress','user_id'], ARRAY['catalog_notes','user_id'], ARRAY['entitlements','user_id'],
    ARRAY['event_rsvps','user_id'], ARRAY['connect_response_subjects','user_id'], ARRAY['response_account_claims','user_id'],
    ARRAY['connect_claim_completions','user_id'], ARRAY['doc_favorites','user_id'], ARRAY['doc_notifications','user_id'],
    ARRAY['doc_page_shares','user_id'], ARRAY['doc_shares','user_id'], ARRAY['crm_notification_preferences','user_id'],
    ARRAY['crm_notifications','recipient_user_id'], ARRAY['social_approval_notices','recipient_user_id'], ARRAY['platform_staff','user_id'],
    ARRAY['discover_reports','reporter_id'], ARRAY['office_connections','owner_user_id'], ARRAY['crm_saved_views','owner_user_id']] LOOP
    EXECUTE format($p$CREATE POLICY %I ON public.%I TO %I
      USING ((%I IS NULL OR %I = nullif(current_setting('app.user_id', true), '')) AND %s)
      WITH CHECK ((%I IS NULL OR %I = nullif(current_setting('app.user_id', true), '')) AND %s)$p$,
      'account_erase_' || pair[2], pair[1], current_user, pair[2], pair[2], live, pair[2], pair[2], live);
  END LOOP;
  EXECUTE format($p$CREATE POLICY account_erase_audit ON public.audit_logs FOR INSERT TO %I
    WITH CHECK (tenant_id IS NULL AND actor_id = nullif(current_setting('app.user_id', true), '') AND action = 'account.delete'
      AND %s)$p$, current_user, live);
  -- The sole-owner check names the ministries the caller owns, and nothing else.
  EXECUTE format($p$CREATE POLICY account_erase_ref ON public.workspaces FOR SELECT TO %I
    USING (%s AND EXISTS (SELECT 1 FROM public.workspace_members m
      WHERE m.tenant_id = workspaces.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.access_role(m.tenant_id, m.user_id, 'owner_admin', m.role_id) = 'owner'))$p$, current_user, live);
  -- Co-owners are counted (not read) to decide whether the caller is the only owner. Roles are read through public.access_role ('owner_admin' is
-- never grantable to a collaborator, so this is the stored owner role).
  EXECUTE format($p$CREATE POLICY account_erase_owners ON public.workspace_members FOR SELECT TO %I
    USING (%s AND public.access_role(tenant_id, user_id, 'owner_admin', role_id) = 'owner')$p$, current_user, live);
END $$;--> statement-breakpoint
-- Internal: the ministries the caller is the only owner of, while the caller's erase token is active.
CREATE FUNCTION public.account_sole_owner_ministries(p_actor text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', w.tenant_id, 'name', w.name) ORDER BY w.name, w.tenant_id), '[]'::jsonb)
  FROM public.workspace_members m JOIN public.workspaces w ON w.tenant_id = m.tenant_id
  WHERE m.user_id = p_actor AND public.access_role(m.tenant_id, m.user_id, 'owner_admin', m.role_id) = 'owner'
    AND NOT EXISTS (SELECT 1 FROM public.workspace_members o WHERE o.tenant_id = m.tenant_id AND public.access_role(o.tenant_id, o.user_id, 'owner_admin', o.role_id) = 'owner' AND o.user_id <> p_actor)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_sole_owner_ministries(text) FROM PUBLIC, harvest_app;--> statement-breakpoint
-- The confirm screen's blocker: the ministries the caller must transfer or delete first. Read-only.
CREATE FUNCTION public.account_delete_blockers() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); result jsonb;
BEGIN
  PERFORM public.community_definer_reset();
  PERFORM public.account_self_reset();
  IF actor IS NULL THEN RETURN '[]'::jsonb; END IF;
  PERFORM public.account_erase_begin(actor);
  result := public.account_sole_owner_ministries(actor);
  PERFORM public.account_erase_end();
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_delete_blockers() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.account_delete_blockers() TO harvest_app;--> statement-breakpoint
-- The person's own mail, calendar and files connections, so the web layer can revoke each one at its provider before the account is deleted
-- (Harvest stores no mailbox token itself: the provider holds the grant, and disconnecting it there is the revocation). Read-only.
CREATE FUNCTION public.account_office_connections() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); result jsonb;
BEGIN
  PERFORM public.community_definer_reset();
  PERFORM public.account_self_reset();
  IF actor IS NULL THEN RETURN '[]'::jsonb; END IF;
  PERFORM public.account_erase_begin(actor);
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', o.id, 'provider', o.provider, 'kind', o.kind, 'ref', o.external_account_ref,
      'platform', o.platform, 'profileRef', o.profile_ref) ORDER BY o.created_at, o.id), '[]'::jsonb)
    INTO result FROM public.office_connections o WHERE o.owner_user_id = actor;
  PERFORM public.account_erase_end();
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_office_connections() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.account_office_connections() TO harvest_app;--> statement-breakpoint
-- The deletion. The web layer checks a sign-in within the last 15 minutes and the typed word; the database checks the word again, refuses a sole
-- owner, and does the rest in this one transaction. It returns the storage keys of uploads that were never attached to a post, so the web layer can
-- delete those objects; their rows are already gone.
CREATE FUNCTION public.account_delete(p_confirm text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); blockers jsonb; ref uuid := pg_catalog.gen_random_uuid(); keys jsonb; old_email text;
BEGIN
  PERFORM public.community_definer_reset();
  PERFORM public.account_self_reset();
  IF actor IS NULL THEN RETURN pg_catalog.jsonb_build_object('outcome', 'not_found'); END IF;
  IF p_confirm IS DISTINCT FROM 'DELETE' THEN RETURN pg_catalog.jsonb_build_object('outcome', 'invalid'); END IF;
  SELECT u.email INTO old_email FROM public.users u WHERE u.id = actor FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('outcome', 'not_found'); END IF;
  PERFORM public.account_erase_begin(actor);
  IF EXISTS (SELECT 1 FROM public.account_deletions d WHERE d.user_id = actor) THEN
    PERFORM public.account_erase_end(); RETURN pg_catalog.jsonb_build_object('outcome', 'not_found');
  END IF;
  -- Owner rows are locked so a concurrent ownership change cannot leave a ministry without an owner.
  PERFORM 1 FROM public.workspace_members m WHERE public.access_role(m.tenant_id, m.user_id, 'owner_admin', m.role_id) = 'owner' AND m.tenant_id IN (SELECT x.tenant_id FROM public.workspace_members x WHERE x.user_id = actor) FOR UPDATE;
  blockers := public.account_sole_owner_ministries(actor);
  IF pg_catalog.jsonb_array_length(blockers) > 0 THEN
    PERFORM public.account_erase_end(); RETURN pg_catalog.jsonb_build_object('outcome', 'sole_owner', 'ministries', blockers);
  END IF;

  -- Community contributions stay, as "Former member": the author is detached from posts, replies and channel messages (G2).
  UPDATE public.community_posts SET author_id = NULL WHERE author_id = actor;
  UPDATE public.community_comments SET author_id = NULL WHERE author_id = actor;
  UPDATE public.community_messages SET author_id = NULL WHERE author_id = actor;
  -- Uploads: files on a post (or a post cover) stay with the post; uploads never attached are deleted, and their keys returned.
  WITH gone AS (DELETE FROM public.community_files f WHERE f.uploader_id = actor AND f.post_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.cover_file_id = f.id) RETURNING f.key)
    SELECT coalesce(pg_catalog.jsonb_agg(gone.key), '[]'::jsonb) INTO keys FROM gone;
  UPDATE public.community_files SET uploader_id = NULL WHERE uploader_id = actor;
  -- The chat-erasure hook: the person's own DMs are deleted. The other participant keeps their messages in a conversation shown as "Former member".
  DELETE FROM public.community_dm_messages WHERE author_id = actor;
  UPDATE public.community_dm_conversations SET started_by = NULL WHERE started_by = actor;
  UPDATE public.community_dm_conversations SET last_sender_id = NULL WHERE last_sender_id = actor;
  DELETE FROM public.community_dm_participants WHERE user_id = actor;
  DELETE FROM public.community_dm_blocks WHERE blocker_id = actor;
  DELETE FROM public.community_dm_blocks WHERE blocked_id = actor;
  -- Reactions, likes and everything about the person's membership.
  DELETE FROM public.community_message_reactions WHERE user_id = actor;
  DELETE FROM public.community_likes WHERE user_id = actor;
  DELETE FROM public.community_channel_members WHERE user_id = actor;
  DELETE FROM public.community_channel_reads WHERE user_id = actor;
  DELETE FROM public.community_notifications WHERE recipient_id = actor;
  UPDATE public.community_notifications SET actor_id = NULL WHERE actor_id = actor;
  DELETE FROM public.community_email_deliveries WHERE recipient_id = actor;
  UPDATE public.community_reports SET reporter_id = NULL WHERE reporter_id = actor;
  UPDATE public.community_moderation_actions SET subject_user_id = NULL WHERE subject_user_id = actor;
  UPDATE public.community_moderation_actions SET actor_id = NULL WHERE actor_id = actor;
  UPDATE public.community_invites SET redeemed_by = NULL WHERE redeemed_by = actor;
  DELETE FROM public.community_warnings WHERE user_id = actor;
  DELETE FROM public.community_appeals WHERE user_id = actor;
  DELETE FROM public.community_applications WHERE user_id = actor;
  DELETE FROM public.community_exits WHERE user_id = actor;
  DELETE FROM public.community_member_profiles WHERE user_id = actor;
  DELETE FROM public.community_memberships WHERE user_id = actor;
  -- Courses: progress, private notes and enrolments; every access grant; event answers.
  DELETE FROM public.catalog_progress WHERE user_id = actor;
  DELETE FROM public.catalog_notes WHERE user_id = actor;
  DELETE FROM public.entitlements WHERE user_id = actor;
  DELETE FROM public.catalog_enrolments WHERE user_id = actor;
  DELETE FROM public.event_rsvps WHERE user_id = actor;
  -- The account's links to Connect responses go; the ministry's own response and contact records stay (HC-06: account deletion is not contact erasure).
  DELETE FROM public.connect_response_subjects WHERE user_id = actor;
  DELETE FROM public.response_account_claims WHERE user_id = actor;
  DELETE FROM public.connect_claim_completions WHERE user_id = actor;
  -- Personal settings and notices in the ministries the person worked in, then the memberships themselves.
  DELETE FROM public.doc_favorites WHERE user_id = actor;
  DELETE FROM public.doc_notifications WHERE user_id = actor;
  DELETE FROM public.doc_page_shares WHERE user_id = actor;
  DELETE FROM public.doc_shares WHERE user_id = actor;
  DELETE FROM public.crm_notification_preferences WHERE user_id = actor;
  DELETE FROM public.crm_notifications WHERE recipient_user_id = actor;
  -- Personal saved CRM views (owner_user_id set); shared views the person created stay with the ministry.
  DELETE FROM public.crm_saved_views WHERE owner_user_id = actor;
  DELETE FROM public.social_approval_notices WHERE recipient_user_id = actor;
  DELETE FROM public.platform_staff WHERE user_id = actor;
  DELETE FROM public.discover_reports WHERE reporter_id = actor;
  DELETE FROM public.account_export_requests WHERE user_id = actor;
  -- Mail, calendar and files connections (already revoked at the provider by the web layer); their markers, links and attempts cascade.
  DELETE FROM public.office_connections WHERE owner_user_id = actor;
  DELETE FROM public.workspace_members WHERE user_id = actor;
  DELETE FROM public.user_profiles WHERE user_id = actor;
  -- Sign-in: every session and sign-in method ends; pending codes for the old address go.
  DELETE FROM public.sessions WHERE user_id = actor;
  DELETE FROM public.accounts WHERE user_id = actor;
  DELETE FROM public.verifications WHERE identifier = 'sign-in-otp-' || pg_catalog.lower(old_email);
  DELETE FROM public.otp_cooldowns WHERE email = pg_catalog.lower(old_email);
  -- The account row stays as a tombstone with no name, photo, language or real address, so append-only audit logs keep their reference.
  UPDATE public.users SET name = '', email = 'deleted-' || ref::text || '@deleted.invalid', email_verified = false, image = NULL, locale = NULL,
    updated_at = pg_catalog.now() WHERE id = actor;
  INSERT INTO public.account_deletions (user_id, reference) VALUES (actor, ref);
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (NULL, actor, 'account.delete', ref::text);
  PERFORM public.account_erase_end();
  RETURN pg_catalog.jsonb_build_object('outcome', 'deleted', 'reference', ref, 'fileKeys', keys);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_delete(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.account_delete(text) TO harvest_app;--> statement-breakpoint
-- Leaving a community (G2): posts, replies and channel messages in that community stay but are detached from the person, so they show as
-- "Former member". DMs keep their author (deleting the whole account deletes them later), and the other participant sees "Former member" because
-- community_dm_visible below shows a name only while the other person is an active member. Otherwise unchanged from 0101.
CREATE OR REPLACE FUNCTION public.community_leave(p_slug text, p_reason text, p_other text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); c record; m record; other text := nullif(btrim(coalesce(p_other, '')), '');
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NOT NULL AND p_reason NOT IN ('moved_away','too_busy','not_relevant','too_many_notifications','content_quality','privacy','other') THEN RAISE EXCEPTION 'invalid leave reason'; END IF;
  IF (other IS NOT NULL AND p_reason IS DISTINCT FROM 'other') OR length(coalesce(other, '')) > 200 THEN RAISE EXCEPTION 'invalid leave reason'; END IF;
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT * INTO c FROM public.communities WHERE communities.slug = p_slug;
  IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN 'not_found'; END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  SELECT * INTO m FROM public.community_memberships WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor FOR UPDATE;
  IF NOT FOUND OR m.status <> 'active' THEN PERFORM public.community_definer_reset(); RETURN 'not_member'; END IF;
  IF m.role = 'owner' THEN PERFORM public.community_definer_reset(); RETURN 'owner'; END IF;
  PERFORM set_config('app.community_leave_reason', coalesce(p_reason, ''), true);
  PERFORM set_config('app.community_leave_other', coalesce(other, ''), true);
  UPDATE public.community_memberships SET status = 'left', role = 'member', muted_until = NULL, updated_at = now() WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor;
  PERFORM set_config('app.community_leave_reason', '', true); PERFORM set_config('app.community_leave_other', '', true);
  UPDATE public.entitlements SET revoked_at = now(), revoked_by = actor
    WHERE tenant_id = c.tenant_id AND user_id = actor AND resource_type = 'community' AND resource_id = c.id AND revoked_at IS NULL;
  UPDATE public.community_applications SET status = 'withdrawn', updated_at = now()
    WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor AND status IN ('pending', 'info_requested');
  UPDATE public.community_posts SET author_id = NULL WHERE tenant_id = c.tenant_id AND community_id = c.id AND author_id = actor;
  UPDATE public.community_comments SET author_id = NULL WHERE tenant_id = c.tenant_id AND community_id = c.id AND author_id = actor;
  UPDATE public.community_messages SET author_id = NULL WHERE tenant_id = c.tenant_id AND community_id = c.id AND author_id = actor;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (c.tenant_id, actor, 'community.leave', c.id::text);
  PERFORM public.community_definer_reset();
  RETURN 'left';
END $$;--> statement-breakpoint
-- community_dm_visible as in 0058, except that the other person's name is returned only while they are an active member of the community.
CREATE OR REPLACE FUNCTION public.community_dm_visible(p_tenant uuid, p_community uuid, p_actor text)
RETURNS TABLE(id uuid, last_rev bigint, last_message_at timestamptz, other_id text, other_name text, muted boolean,
  last_read_seq bigint, state_rev bigint, can_send boolean)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.id, c.last_rev, c.last_message_at, other.user_id, CASE WHEN m.status = 'active' THEN u.name END, own.muted, own.last_read_seq, own.state_rev,
    public.community_dm_can_send(p_tenant, p_community, p_actor, other.user_id, true, c.staff_engaged_by, c.staff_engaged_at, true)
  FROM public.community_dm_participants own
  JOIN public.community_dm_conversations c ON c.id = own.conversation_id
  LEFT JOIN public.community_dm_participants other ON other.conversation_id = c.id AND other.user_id <> p_actor
  LEFT JOIN public.community_memberships m ON m.tenant_id = own.tenant_id AND m.community_id = own.community_id AND m.user_id = other.user_id
  LEFT JOIN public.users u ON u.id = other.user_id
  WHERE own.tenant_id = p_tenant AND own.community_id = p_community AND own.user_id = p_actor
    AND own.hidden_at IS NULL AND own.left_at IS NULL AND m.status IS DISTINCT FROM 'banned' AND m.status IS DISTINCT FROM 'removed'
$$;--> statement-breakpoint
-- The blog definer (0135) clears every app.* flag an owner-role policy reads; add this migration's app.account_erase.
CREATE OR REPLACE FUNCTION public.blog_scope_clear() RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := '{}'::jsonb; key text;
BEGIN
  FOREACH key IN ARRAY ARRAY['app.blog_public_handle','app.blog_public_tenant','app.blog_public_file','app.blog_publish','app.access_tenant','app.account_erase','app.account_export','app.access_token',
      'app.ads_definer','app.bio_handle','app.bio_tenant','app.campaign_budget_tenant','app.campaign_invite_tenant','app.campaign_invite_token',
      'app.catalog_slug','app.catalog_tenant','app.catalog_learner_tenant','app.catalog_my_notes','app.catalog_progress_tenant','app.chat_purge','app.chat_settings','app.community_definer_tenant','app.community_email_worker',
      'app.community_purge','app.community_resolve_email','app.community_resolve_ids','app.community_resolve_invite','app.community_resolve_slug',
      'app.community_resolve_user','app.community_stats_write','app.connect_campaign','app.connect_flow','app.connect_intake_mode',
      'app.connect_invite_id','app.connect_invite_token','app.connect_invite_worker','app.connect_landing_link','app.connect_metrics',
      'app.connect_purge','app.connect_receipt','app.connect_resolve_code','app.connect_resolve_tenant','app.connect_retention',
      'app.connect_version','app.crm_forms_slug','app.crm_forms_tenant','app.discover_platform','app.discover_read','app.dm_evidence_report',
      'app.dm_purge','app.docs_purge','app.event_cover_cleanup','app.events_tenant','app.give_public_fundraising','app.give_public_slug',
      'app.give_public_tenant','app.giving_definer','app.giving_definer_tenant','app.giving_public_tenant','app.live_community',
      'app.newsletter_erasure_contact','app.newsletter_erasure_tenant','app.nl','app.nl_auto_private','app.nl_forms_tenant','app.nl_growth_scan',
      'app.nl_send_insight','app.nl_send_tenant','app.nl_send_worker','app.office_erasure_contact','app.platform_staff',
      'app.social_analytics_worker','app.social_approval_definer','app.social_auto_dm_worker','app.social_definer','app.social_inbox_worker',
      'app.social_media_tenant','app.social_upload_cleanup','app.tenant_id','app.user_id'] LOOP
    prior := prior || pg_catalog.jsonb_build_object(key, coalesce(pg_catalog.current_setting(key, true), ''));
    PERFORM pg_catalog.set_config(key, '', true);
  END LOOP;
  RETURN prior;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_scope_clear() FROM PUBLIC, harvest_app;
