CREATE TABLE "account_deletions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"reference" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "account_deletions" ADD CONSTRAINT "account_deletions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- "Your data" (founder, 27 Nov), part 2: self-serve account deletion, and "Former member" on leaving a community (policy pack §11, G2).
-- The account row itself stays, scrubbed: append-only audit logs and other people's records (CRM notes, documents, campaigns a staff member
-- created) still point at it, so it cannot be deleted. Everything that is about the person is deleted or detached by public.account_delete,
-- which runs as this migration's owner under app.account_erase and touches only rows of the caller (app.user_id).
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.account_deletions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.account_deletions FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Owner write policies, one per (table, person column). Each is active only while app.account_erase is on, for the caller's rows and for rows
-- with no person (PostgreSQL also checks a detaching update's new row, author set to null, against the SELECT side); every statement in
-- account_delete filters on the caller's id, so a detached row of someone else is never touched. No policy refers to its own table.
DO $$ DECLARE pair text[]; BEGIN
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
    ARRAY['discover_reports','reporter_id']] LOOP
    EXECUTE format($p$CREATE POLICY %I ON public.%I TO %I
      USING ((%I IS NULL OR %I = nullif(current_setting('app.user_id', true), '')) AND current_setting('app.account_erase', true) = 'on')
      WITH CHECK ((%I IS NULL OR %I = nullif(current_setting('app.user_id', true), '')) AND current_setting('app.account_erase', true) = 'on')$p$,
      'account_erase_' || pair[2], pair[1], current_user, pair[2], pair[2], pair[2], pair[2]);
  END LOOP;
  EXECUTE format($p$CREATE POLICY account_erase_audit ON public.audit_logs FOR INSERT TO %I
    WITH CHECK (tenant_id IS NULL AND actor_id = nullif(current_setting('app.user_id', true), '') AND action = 'account.delete'
      AND current_setting('app.account_erase', true) = 'on')$p$, current_user);
  -- The sole-owner check names the ministries the caller owns, and nothing else.
  EXECUTE format($p$CREATE POLICY account_erase_ref ON public.workspaces FOR SELECT TO %I
    USING (current_setting('app.account_erase', true) = 'on' AND EXISTS (SELECT 1 FROM public.workspace_members m
      WHERE m.tenant_id = workspaces.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.access_role(m.tenant_id, m.user_id, 'owner_admin', m.role_id) = 'owner'))$p$, current_user);
  -- Co-owners are counted (not read) to decide whether the caller is the only owner. Roles are read through public.access_role ('owner_admin' is
-- never grantable to a collaborator, so this is the stored owner role).
  EXECUTE format($p$CREATE POLICY account_erase_owners ON public.workspace_members FOR SELECT TO %I
    USING (current_setting('app.account_erase', true) = 'on' AND public.access_role(tenant_id, user_id, 'owner_admin', role_id) = 'owner')$p$, current_user);
END $$;--> statement-breakpoint
-- Internal: the ministries the caller is the only owner of, under app.account_erase (set by the caller).
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); result jsonb;
BEGIN
  PERFORM public.community_definer_reset();
  PERFORM public.account_self_reset();
  IF actor IS NULL THEN RETURN '[]'::jsonb; END IF;
  PERFORM pg_catalog.set_config('app.account_erase', 'on', true);
  result := public.account_sole_owner_ministries(actor);
  PERFORM public.account_self_reset();
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.account_delete_blockers() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.account_delete_blockers() TO harvest_app;--> statement-breakpoint
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
  PERFORM pg_catalog.set_config('app.account_erase', 'on', true);
  IF EXISTS (SELECT 1 FROM public.account_deletions d WHERE d.user_id = actor) THEN
    PERFORM public.account_self_reset(); RETURN pg_catalog.jsonb_build_object('outcome', 'not_found');
  END IF;
  -- Owner rows are locked so a concurrent ownership change cannot leave a ministry without an owner.
  PERFORM 1 FROM public.workspace_members m WHERE public.access_role(m.tenant_id, m.user_id, 'owner_admin', m.role_id) = 'owner' AND m.tenant_id IN (SELECT x.tenant_id FROM public.workspace_members x WHERE x.user_id = actor) FOR UPDATE;
  blockers := public.account_sole_owner_ministries(actor);
  IF pg_catalog.jsonb_array_length(blockers) > 0 THEN
    PERFORM public.account_self_reset(); RETURN pg_catalog.jsonb_build_object('outcome', 'sole_owner', 'ministries', blockers);
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
  DELETE FROM public.social_approval_notices WHERE recipient_user_id = actor;
  DELETE FROM public.platform_staff WHERE user_id = actor;
  DELETE FROM public.discover_reports WHERE reporter_id = actor;
  DELETE FROM public.account_export_requests WHERE user_id = actor;
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
  PERFORM public.account_self_reset();
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
$$;
