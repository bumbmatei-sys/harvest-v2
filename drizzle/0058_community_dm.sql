CREATE TABLE "community_dm_blocks" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_dm_blocks_community_id_blocker_id_blocked_id_pk" PRIMARY KEY("community_id","blocker_id","blocked_id"),
	CONSTRAINT "community_dm_block_distinct" CHECK ("community_dm_blocks"."blocker_id" <> "community_dm_blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "community_dm_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"pair_key" text NOT NULL,
	"origin" text NOT NULL,
	"started_by" text,
	"staff_engaged_by" text,
	"staff_engaged_at" timestamp with time zone,
	"last_rev" bigint DEFAULT 0 NOT NULL,
	"last_sender_id" text,
	"unanswered" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_dm_conversations_scope" UNIQUE("tenant_id","community_id","id"),
	CONSTRAINT "community_dm_conversations_pair" UNIQUE("community_id","pair_key"),
	CONSTRAINT "community_dm_origin" CHECK ("community_dm_conversations"."origin" in ('staff', 'member')),
	CONSTRAINT "community_dm_unanswered" CHECK ("community_dm_conversations"."unanswered" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "community_dm_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_id" text,
	"client_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"body" text NOT NULL,
	"seq" bigint NOT NULL,
	"rev" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"purge_after" timestamp with time zone,
	CONSTRAINT "community_dm_message_body" CHECK (length(trim("community_dm_messages"."body")) between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "community_dm_participants" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"state_rev" bigint DEFAULT 0 NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"hidden_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	CONSTRAINT "community_dm_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_dm_report_evidence" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reporter_key" text NOT NULL,
	"subject_key" text,
	"reporter_name" text,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "community_dm_evidence_bound" CHECK (jsonb_array_length("community_dm_report_evidence"."snapshot") between 1 and 6)
);
--> statement-breakpoint
ALTER TABLE "community_moderation_actions" DROP CONSTRAINT "community_moderation_action";--> statement-breakpoint
ALTER TABLE "community_moderation_actions" DROP CONSTRAINT "community_moderation_target";--> statement-breakpoint
ALTER TABLE "community_reports" DROP CONSTRAINT "community_report_target";--> statement-breakpoint
ALTER TABLE "community_reports" DROP CONSTRAINT "community_report_status";--> statement-breakpoint
ALTER TABLE "community_reports" ADD COLUMN "needs_escalation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community_reports" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_dm_blocks" ADD CONSTRAINT "community_dm_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_blocks" ADD CONSTRAINT "community_dm_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_blocks" ADD CONSTRAINT "community_dm_blocks_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_conversations" ADD CONSTRAINT "community_dm_conversations_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_conversations" ADD CONSTRAINT "community_dm_conversations_staff_engaged_by_users_id_fk" FOREIGN KEY ("staff_engaged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_conversations" ADD CONSTRAINT "community_dm_conversations_last_sender_id_users_id_fk" FOREIGN KEY ("last_sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_conversations" ADD CONSTRAINT "community_dm_conversations_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_messages" ADD CONSTRAINT "community_dm_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_messages" ADD CONSTRAINT "community_dm_messages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_messages" ADD CONSTRAINT "community_dm_messages_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_messages" ADD CONSTRAINT "community_dm_messages_tenant_id_community_id_conversation_id_community_dm_conversations_tenant_id_community_id_id_fk" FOREIGN KEY ("tenant_id","community_id","conversation_id") REFERENCES "public"."community_dm_conversations"("tenant_id","community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_participants" ADD CONSTRAINT "community_dm_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_participants" ADD CONSTRAINT "community_dm_participants_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_participants" ADD CONSTRAINT "community_dm_participants_tenant_id_community_id_conversation_id_community_dm_conversations_tenant_id_community_id_id_fk" FOREIGN KEY ("tenant_id","community_id","conversation_id") REFERENCES "public"."community_dm_conversations"("tenant_id","community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_dm_report_evidence" ADD CONSTRAINT "community_dm_report_evidence_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_scope" UNIQUE("tenant_id","community_id","id");--> statement-breakpoint
ALTER TABLE "community_dm_report_evidence" ADD CONSTRAINT "community_dm_report_evidence_tenant_id_community_id_report_id_community_reports_tenant_id_community_id_id_fk" FOREIGN KEY ("tenant_id","community_id","report_id") REFERENCES "public"."community_reports"("tenant_id","community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_dm_conversations_starter_idx" ON "community_dm_conversations" USING btree ("community_id","started_by","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_dm_client_idx" ON "community_dm_messages" USING btree ("community_id","author_id","client_id");--> statement-breakpoint
CREATE INDEX "community_dm_messages_seq_idx" ON "community_dm_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "community_dm_messages_rev_idx" ON "community_dm_messages" USING btree ("conversation_id","rev");--> statement-breakpoint
CREATE INDEX "community_dm_messages_author_idx" ON "community_dm_messages" USING btree ("community_id","author_id","created_at");--> statement-breakpoint
CREATE INDEX "community_dm_messages_purge_idx" ON "community_dm_messages" USING btree ("purge_after") WHERE "community_dm_messages"."purge_after" is not null;--> statement-breakpoint
CREATE INDEX "community_dm_participants_user_idx" ON "community_dm_participants" USING btree ("user_id","community_id","conversation_id");--> statement-breakpoint
CREATE INDEX "community_dm_evidence_expiry_idx" ON "community_dm_report_evidence" USING btree ("expires_at") WHERE "community_dm_report_evidence"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "community_dm_reports_open_age_idx" ON "community_reports" USING btree ("created_at","id") WHERE "community_reports"."target_type" = 'dm_message' and "community_reports"."status" = 'open';--> statement-breakpoint
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_action" CHECK ("community_moderation_actions"."action" in ('report_dismiss', 'report_remove', 'held_approve', 'held_reject', 'mute', 'unmute', 'ban', 'unban', 'warn', 'appeal_approve', 'appeal_decline', 'message_remove', 'message_restore', 'message_pin', 'message_unpin', 'dm_evidence_view', 'report_expire', 'report_action'));--> statement-breakpoint
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_target" CHECK ("community_moderation_actions"."target_type" in ('post', 'comment', 'member', 'message', 'dm_message'));--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_report_target" CHECK ("community_reports"."target_type" in ('post', 'comment', 'member', 'message', 'dm_message') and length("community_reports"."target_id") between 1 and 200);--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_report_status" CHECK ("community_reports"."status" in ('open', 'dismissed', 'actioned', 'expired'));
--> statement-breakpoint
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_system_actor;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_system_actor CHECK (actor_id IS NOT NULL OR
  action IN ('followup.case.withdraw','followup.case.revoke','community.live.auto_close','community.moderation_report_expire'));

-- Every DM table has FORCE RLS. Only the migration owner gets scoped definer policies.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['community_dm_conversations','community_dm_participants','community_dm_messages','community_dm_blocks','community_dm_report_evidence'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', t);
    EXECUTE format($p$CREATE POLICY dm_owner ON public.%I TO %I
      USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid OR current_setting('app.dm_purge', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid OR current_setting('app.dm_purge', true) = 'on')$p$, t, current_user);
  END LOOP;
  EXECUTE format($p$CREATE POLICY dm_worker_reports ON public.community_reports TO %I
    USING (current_setting('app.dm_purge', true) = 'on' AND target_type = 'dm_message')
    WITH CHECK (current_setting('app.dm_purge', true) = 'on' AND target_type = 'dm_message')$p$, current_user);
  EXECUTE format($p$CREATE POLICY dm_rate_audit ON public.audit_logs FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid
      AND actor_id = nullif(current_setting('app.user_id', true), '') AND action = 'community.dm.edit')$p$, current_user);
END $$;

GRANT SELECT ON public.community_dm_conversations, public.community_dm_participants, public.community_dm_messages, public.community_dm_blocks TO harvest_app;
-- C12's general host/report SELECT path must not expose a DM report's reporter or target.
-- Tenant audit readers may not identify DM activity, reports or evidence access.
CREATE POLICY dm_audit_metadata_private ON public.audit_logs AS RESTRICTIVE FOR SELECT TO harvest_app
  USING (action NOT LIKE 'community.dm.%' AND metadata->>'targetType' IS DISTINCT FROM 'dm_message');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_moderation_log(p_tenant uuid, p_community uuid, p_action text, p_target_type text, p_target_id text,
  p_subject text, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  INSERT INTO public.community_moderation_actions(tenant_id,community_id,actor_id,action,target_type,target_id,subject_user_id,detail)
    VALUES(p_tenant,p_community,actor,p_action,p_target_type,p_target_id,p_subject,coalesce(p_detail,'{}'::jsonb));
  INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata)
    VALUES(p_tenant,actor,'community.moderation_' || p_action,p_target_id,
      CASE WHEN p_target_type='dm_message' THEN jsonb_build_object('targetType',p_target_type) ELSE '{}'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.community_moderation_log(uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY dm_report_metadata_private ON public.community_reports AS RESTRICTIVE FOR SELECT TO harvest_app
  USING (target_type <> 'dm_message');
CREATE POLICY dm_actions_private ON public.community_moderation_actions AS RESTRICTIVE FOR SELECT TO harvest_app
  USING (target_type <> 'dm_message');

CREATE FUNCTION public.community_dm_participant_allowed(p_tenant uuid, p_community uuid, p_conversation uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  previous text := current_setting('app.community_definer_tenant', true);
  allowed boolean;
BEGIN
  IF actor IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.community_definer_tenant', p_tenant::text, true);
  SELECT EXISTS (
    SELECT 1 FROM public.community_dm_participants p
    JOIN public.communities c ON c.tenant_id = p.tenant_id AND c.id = p.community_id
    WHERE p.tenant_id = p_tenant AND p.community_id = p_community AND p.conversation_id = p_conversation
      AND p.user_id = actor AND p.left_at IS NULL AND c.status = 'published' AND c.chat_enabled
      AND public.community_chat_role(p_tenant, p_community, actor) IS NOT NULL
  ) INTO allowed;
  PERFORM set_config('app.community_definer_tenant', coalesce(previous, ''), true);
  RETURN allowed;
END $$;

CREATE POLICY dm_participant_conversation ON public.community_dm_conversations FOR SELECT TO harvest_app
  USING (public.community_dm_participant_allowed(tenant_id, community_id, id));
CREATE POLICY dm_participant_roster ON public.community_dm_participants FOR SELECT TO harvest_app
  USING (public.community_dm_participant_allowed(tenant_id, community_id, conversation_id));
CREATE POLICY dm_participant_messages ON public.community_dm_messages FOR SELECT TO harvest_app
  USING (deleted_at IS NULL AND public.community_dm_participant_allowed(tenant_id, community_id, conversation_id));
CREATE POLICY dm_blocker_read ON public.community_dm_blocks FOR SELECT TO harvest_app
  USING (blocker_id = nullif(current_setting('app.user_id', true), ''));

--> statement-breakpoint
CREATE FUNCTION public.community_dm_pair(a text, b text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_array(least(a COLLATE "C", b COLLATE "C"), greatest(a COLLATE "C", b COLLATE "C"))::text
$$;

CREATE FUNCTION public.community_dm_lock_members(p_tenant uuid, p_community uuid, p_users text[])
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.community_memberships
    WHERE tenant_id = p_tenant AND community_id = p_community AND user_id = ANY(p_users)
    ORDER BY user_id FOR UPDATE;
  PERFORM 1 FROM public.workspace_members
    WHERE tenant_id = p_tenant AND user_id = ANY(p_users) ORDER BY user_id FOR SHARE;
END $$;

CREATE FUNCTION public.community_dm_active(p_tenant uuid, p_community uuid, p_user text)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN EXISTS(SELECT 1 FROM public.communities c
    WHERE c.tenant_id = p_tenant AND c.id = p_community AND c.chat_enabled AND c.status = 'published')
    THEN public.community_chat_role(p_tenant, p_community, p_user) END
$$;

CREATE FUNCTION public.community_dm_blocked(p_tenant uuid, p_community uuid, a text, b text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.community_dm_blocks x
    WHERE x.tenant_id = p_tenant AND x.community_id = p_community
      AND ((x.blocker_id = a AND x.blocked_id = b) OR (x.blocker_id = b AND x.blocked_id = a)))
$$;

-- Channel revisions stay channel-only. DM preference changes are covered by the private rail detector.
CREATE OR REPLACE FUNCTION public.community_chat_membership_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF (NEW.role,NEW.status) IS DISTINCT FROM (OLD.role,OLD.status) THEN NEW.chat_state_rev:=OLD.chat_state_rev+1; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.community_chat_membership_revision() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.community_dm_bump(p_tenant uuid, p_community uuid, p_conversation uuid, p_users text[])
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.community_dm_participants SET state_rev = state_rev + 1
    WHERE conversation_id = p_conversation AND tenant_id = p_tenant AND community_id = p_community
      AND user_id = ANY(p_users);
END $$;

CREATE FUNCTION public.community_dm_project(p public.community_dm_messages)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id', p.id, 'conversationId', p.conversation_id, 'authorId', p.author_id,
    'clientId', p.client_id, 'body', CASE WHEN p.deleted_at IS NULL THEN p.body END,
    'seq', p.seq::text, 'rev', p.rev::text, 'createdAt', p.created_at, 'editedAt', p.edited_at, 'deletedAt', p.deleted_at)
$$;

CREATE FUNCTION public.community_dm_can_send(p_tenant uuid, p_community uuid, p_actor text, p_other text,
  p_existing boolean, p_engaged_by text, p_engaged_at timestamptz, p_ignore_block boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  sender_role text := public.community_dm_active(p_tenant, p_community, p_actor);
  other_role text := public.community_dm_active(p_tenant, p_community, p_other);
  sender_host boolean := coalesce(public.community_chat_can(sender_role, 'chat:manage_channels'), false);
  other_host boolean := coalesce(public.community_chat_can(other_role, 'chat:manage_channels'), false);
  staff_reply boolean := p_existing AND p_engaged_at IS NOT NULL AND p_engaged_by = p_other AND other_host;
BEGIN
  IF p_actor IS NULL OR p_other IS NULL OR p_actor = p_other OR sender_role IS NULL OR other_role IS NULL
    OR (NOT p_ignore_block AND public.community_dm_blocked(p_tenant, p_community, p_actor, p_other)) THEN RETURN false; END IF;
  IF staff_reply THEN RETURN true; END IF;
  IF EXISTS(SELECT 1 FROM public.community_memberships WHERE tenant_id = p_tenant AND community_id = p_community
    AND user_id = p_actor AND muted_until > clock_timestamp()) THEN RETURN false; END IF;
  IF sender_host THEN RETURN true; END IF;
  RETURN EXISTS(SELECT 1 FROM public.communities WHERE tenant_id = p_tenant AND id = p_community AND dm_policy = 'members')
    AND (p_existing OR other_host OR EXISTS(SELECT 1 FROM public.community_memberships
      WHERE tenant_id = p_tenant AND community_id = p_community AND user_id = p_other AND dm_accept_members));
END $$;

-- The sender holds the conversation lock and locks both participants before calling this helper.
CREATE FUNCTION public.community_dm_notify(p_tenant uuid, p_community uuid, p_conversation uuid, p_sender text, p_recipient text)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_sender IS NOT DISTINCT FROM p_recipient OR public.community_dm_active(p_tenant, p_community, p_recipient) IS NULL
    OR public.community_dm_blocked(p_tenant, p_community, p_sender, p_recipient)
    OR NOT EXISTS(SELECT 1 FROM public.community_dm_participants WHERE conversation_id = p_conversation AND user_id = p_recipient AND NOT muted AND left_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.community_memberships WHERE tenant_id = p_tenant AND community_id = p_community
      AND user_id = p_recipient AND notifications_muted) THEN RETURN; END IF;
  INSERT INTO public.community_notifications(tenant_id, community_id, recipient_id, kind, target_type, target_id, actor_id, detail)
    VALUES(p_tenant, p_community, p_recipient, 'dm', 'dm_conversation', p_conversation::text, p_sender, '{}'::jsonb)
    ON CONFLICT (recipient_id, community_id, kind, target_type, target_id)
      WHERE kind IN ('chat_mention','chat_reply','dm') AND read_at IS NULL
    DO UPDATE SET actor_count = community_notifications.actor_count + 1, updated_at = now();
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_dm_write(p_slug text, p_conversation uuid, p_target text, p_body text, p_client uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
  conversation public.community_dm_conversations%ROWTYPE;
  previous public.community_dm_messages%ROWTYPE;
  saved public.community_dm_messages%ROWTYPE;
  other_user text;
  pair text;
  host boolean;
  stamp timestamptz;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;

  -- The same per-author lock as channels, followed by conversation then membership rows.
  PERFORM pg_advisory_xact_lock(hashtext(actor || ctx.community::text));
  IF p_conversation IS NULL THEN
    IF p_target IS NULL OR actor = p_target THEN RETURN public.community_chat_done('{"outcome":"not_available"}'); END IF;
    other_user := p_target;
    pair := public.community_dm_pair(actor, other_user);
    PERFORM pg_advisory_xact_lock(hashtextextended(ctx.community::text || pair, 12058));
    SELECT * INTO conversation FROM public.community_dm_conversations c
      WHERE c.tenant_id = ctx.tenant AND c.community_id = ctx.community AND c.pair_key = pair FOR UPDATE;
  ELSE
    SELECT * INTO conversation FROM public.community_dm_conversations c
      WHERE c.tenant_id = ctx.tenant AND c.community_id = ctx.community AND c.id = p_conversation
      AND EXISTS(SELECT 1 FROM public.community_dm_participants p WHERE p.conversation_id = c.id AND p.user_id = actor AND p.left_at IS NULL)
      FOR UPDATE;
    IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
    SELECT p.user_id INTO other_user FROM public.community_dm_participants p
      WHERE p.conversation_id = conversation.id AND p.user_id <> actor AND p.left_at IS NULL;
  END IF;
  PERFORM public.community_dm_lock_members(ctx.tenant, ctx.community, ARRAY[actor, other_user]);
  IF NOT public.community_dm_can_send(ctx.tenant, ctx.community, actor, other_user,
    conversation.id IS NOT NULL, conversation.staff_engaged_by, conversation.staff_engaged_at) THEN
    RETURN public.community_chat_done('{"outcome":"not_available"}');
  END IF;
  IF p_body IS NULL OR p_body !~ '[^[:space:]]' OR length(p_body) NOT BETWEEN 1 AND 2000 OR p_client IS NULL THEN
    RETURN public.community_chat_done('{"outcome":"invalid"}');
  END IF;
  SELECT * INTO previous FROM public.community_dm_messages
    WHERE community_id = ctx.community AND author_id = actor AND client_id = p_client;
  IF FOUND THEN
    IF previous.conversation_id IS DISTINCT FROM conversation.id OR previous.request_hash IS DISTINCT FROM encode(sha256(convert_to(p_body, 'UTF8')), 'hex') THEN
      RETURN public.community_chat_done('{"outcome":"client_id_conflict"}');
    END IF;
    RETURN public.community_chat_done(jsonb_build_object('outcome','ok','conversationId',conversation.id,'message',public.community_dm_project(previous)));
  END IF;
  stamp := clock_timestamp();
  host := public.community_chat_can(public.community_dm_active(ctx.tenant, ctx.community, actor), 'chat:manage_channels');

  IF (SELECT count(*) FROM public.community_dm_messages WHERE community_id = ctx.community AND author_id = actor
      AND created_at > stamp - interval '10 seconds') >= 5 THEN
    RETURN public.community_chat_done('{"outcome":"rate_limited","retryAfter":10}');
  END IF;
  IF (SELECT count(*) FROM public.community_dm_messages WHERE community_id = ctx.community AND author_id = actor
      AND created_at > stamp - interval '10 minutes') >= 60 THEN
    RETURN public.community_chat_done('{"outcome":"rate_limited","retryAfter":600}');
  END IF;
  IF conversation.last_sender_id = actor AND conversation.unanswered >= 3 THEN
    RETURN public.community_chat_done('{"outcome":"unanswered_limit"}');
  END IF;
  IF conversation.id IS NULL THEN
    IF (SELECT count(*) FROM public.community_dm_conversations WHERE community_id = ctx.community AND started_by = actor
        AND created_at > stamp - interval '1 day') >= 10 THEN
      RETURN public.community_chat_done('{"outcome":"rate_limited","retryAfter":86400}');
    END IF;
    IF NOT host AND (SELECT count(*) FROM public.community_dm_conversations WHERE community_id = ctx.community AND started_by = actor
        AND created_at > stamp - interval '1 hour') >= 3 THEN
      RETURN public.community_chat_done('{"outcome":"rate_limited","retryAfter":3600}');
    END IF;
    INSERT INTO public.community_dm_conversations(tenant_id, community_id, pair_key, origin, started_by, created_at)
      VALUES(ctx.tenant, ctx.community, pair, CASE WHEN host THEN 'staff' ELSE 'member' END, actor, stamp)
      RETURNING * INTO conversation;
    INSERT INTO public.community_dm_participants(tenant_id, community_id, conversation_id, user_id)
      VALUES (ctx.tenant, ctx.community, conversation.id, actor), (ctx.tenant, ctx.community, conversation.id, other_user);
  END IF;
  UPDATE public.community_dm_conversations SET last_rev = last_rev + 1, last_message_at = stamp,
    unanswered = CASE WHEN last_sender_id = actor THEN unanswered + 1 ELSE 1 END, last_sender_id = actor,
    staff_engaged_at = CASE WHEN host THEN stamp ELSE staff_engaged_at END,
    staff_engaged_by = CASE WHEN host THEN actor ELSE staff_engaged_by END
    WHERE id = conversation.id RETURNING * INTO conversation;
  IF host THEN
    UPDATE public.community_dm_participants SET hidden_at = NULL WHERE conversation_id = conversation.id AND user_id = other_user;
  END IF;
  UPDATE public.community_dm_participants SET hidden_at = NULL WHERE conversation_id = conversation.id AND user_id = actor;
  INSERT INTO public.community_dm_messages(tenant_id, community_id, conversation_id, author_id, client_id, request_hash, body, seq, rev, created_at)
    VALUES(ctx.tenant, ctx.community, conversation.id, actor, p_client, encode(sha256(convert_to(p_body, 'UTF8')), 'hex'),
      p_body, conversation.last_rev, conversation.last_rev, stamp)
    RETURNING * INTO saved;
  PERFORM public.community_dm_bump(ctx.tenant, ctx.community, conversation.id, ARRAY[actor, other_user]);
  PERFORM public.community_dm_notify(ctx.tenant, ctx.community, conversation.id, actor, other_user);
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','conversationId',conversation.id,'message',public.community_dm_project(saved)));
END $$;

CREATE FUNCTION public.community_dm_start(p_slug text, p_target text, p_body text, p_client uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_write(p_slug, NULL, p_target, p_body, p_client)
$$;
CREATE FUNCTION public.community_dm_send(p_slug text, p_conversation uuid, p_body text, p_client uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_write(p_slug, p_conversation, NULL, p_body, p_client)
$$;

--> statement-breakpoint
CREATE FUNCTION public.community_dm_lock_conversation(p_tenant uuid, p_community uuid, p_conversation uuid, p_actor text)
RETURNS public.community_dm_conversations LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE result public.community_dm_conversations%ROWTYPE;
BEGIN
  SELECT * INTO result FROM public.community_dm_conversations c
    WHERE c.id = p_conversation AND c.tenant_id = p_tenant AND c.community_id = p_community
      AND EXISTS(SELECT 1 FROM public.community_dm_participants p WHERE p.conversation_id = c.id AND p.user_id = p_actor AND p.left_at IS NULL)
    FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public.community_dm_lock_members(p_tenant, p_community,
    ARRAY(SELECT user_id FROM public.community_dm_participants WHERE conversation_id = p_conversation));
  IF public.community_dm_active(p_tenant, p_community, p_actor) IS NULL THEN RETURN NULL; END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.community_dm_change_message(p_slug text, p_id uuid, p_action text, p_body text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
  conversation public.community_dm_conversations%ROWTYPE;
  m public.community_dm_messages%ROWTYPE;
  stamp timestamptz;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext(actor || ctx.community::text));
  SELECT * INTO m FROM public.community_dm_messages
    WHERE id = p_id AND tenant_id = ctx.tenant AND community_id = ctx.community AND author_id = actor;
  IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  conversation := public.community_dm_lock_conversation(ctx.tenant, ctx.community, m.conversation_id, actor);
  IF conversation.id IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  SELECT * INTO m FROM public.community_dm_messages WHERE id = p_id AND author_id = actor FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  stamp := clock_timestamp();
  IF p_action = 'edit' THEN
    IF m.deleted_at IS NOT NULL OR p_body IS NULL OR p_body !~ '[^[:space:]]' OR length(p_body) NOT BETWEEN 1 AND 2000 THEN
      RETURN public.community_chat_done('{"outcome":"invalid"}');
    END IF;
    IF NOT public.community_dm_can_send(ctx.tenant, ctx.community, actor,
      (SELECT user_id FROM public.community_dm_participants WHERE conversation_id = conversation.id AND user_id <> actor AND left_at IS NULL),
      true, conversation.staff_engaged_by, conversation.staff_engaged_at) THEN
      RETURN public.community_chat_done('{"outcome":"not_available"}');
    END IF;
    IF m.body = p_body THEN RETURN public.community_chat_done(jsonb_build_object('outcome','ok','message',public.community_dm_project(m))); END IF;
    IF (SELECT count(*) FROM public.audit_logs WHERE tenant_id = ctx.tenant AND actor_id = actor AND action = 'community.dm.edit'
      AND metadata->>'communityId' = ctx.community::text AND created_at > stamp - interval '1 minute') >= 10 THEN
      RETURN public.community_chat_done('{"outcome":"rate_limited","retryAfter":60}');
    END IF;
    INSERT INTO public.audit_logs(tenant_id, actor_id, action, target_id, metadata, created_at)
      VALUES(ctx.tenant, actor, 'community.dm.edit', p_id::text, jsonb_build_object('communityId',ctx.community), stamp);
  ELSIF p_action = 'restore' THEN
    IF m.deleted_at IS NULL OR m.purge_after <= stamp THEN RETURN public.community_chat_done('{"outcome":"not_available"}'); END IF;
  ELSIF p_action = 'delete' THEN
    IF m.deleted_at IS NOT NULL THEN RETURN public.community_chat_done(jsonb_build_object('outcome','ok','message',public.community_dm_project(m))); END IF;
  ELSE
    RETURN public.community_chat_done('{"outcome":"invalid"}');
  END IF;

  UPDATE public.community_dm_conversations SET last_rev = last_rev + 1 WHERE id = conversation.id RETURNING * INTO conversation;
  UPDATE public.community_dm_messages SET rev = conversation.last_rev,
    body = CASE WHEN p_action = 'edit' THEN p_body ELSE body END,
    edited_at = CASE WHEN p_action = 'edit' THEN stamp ELSE edited_at END,
    deleted_at = CASE p_action WHEN 'delete' THEN stamp WHEN 'restore' THEN NULL ELSE deleted_at END,
    deleted_by = CASE p_action WHEN 'delete' THEN actor WHEN 'restore' THEN NULL ELSE deleted_by END,
    purge_after = CASE p_action WHEN 'delete' THEN stamp + interval '30 days' WHEN 'restore' THEN NULL ELSE purge_after END
    WHERE id = p_id RETURNING * INTO m;
  PERFORM public.community_dm_bump(ctx.tenant, ctx.community, conversation.id,
    ARRAY(SELECT user_id FROM public.community_dm_participants WHERE conversation_id = conversation.id));
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','message',public.community_dm_project(m)));
END $$;

CREATE FUNCTION public.community_dm_edit(p_slug text, p_id uuid, p_body text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_change_message(p_slug, p_id, 'edit', p_body)
$$;
CREATE FUNCTION public.community_dm_delete_message(p_slug text, p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_change_message(p_slug, p_id, 'delete')
$$;
CREATE FUNCTION public.community_dm_restore_message(p_slug text, p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_change_message(p_slug, p_id, 'restore')
$$;

CREATE FUNCTION public.community_dm_preferences(p_slug text, p_conversation uuid, p_action text, p_value boolean, p_seq bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
  conversation public.community_dm_conversations%ROWTYPE;
  read_seq bigint;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  conversation := public.community_dm_lock_conversation(ctx.tenant, ctx.community, p_conversation, actor);
  IF conversation.id IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;

  IF p_action = 'read' AND p_seq >= 0 THEN
    SELECT least(p_seq, coalesce(max(seq), 0)) INTO read_seq FROM public.community_dm_messages WHERE conversation_id = p_conversation;
    UPDATE public.community_dm_participants SET last_read_seq = read_seq
      WHERE conversation_id = p_conversation AND user_id = actor AND last_read_seq < read_seq;
    IF FOUND THEN
      PERFORM public.community_dm_bump(ctx.tenant, ctx.community, p_conversation, ARRAY[actor]);
      IF NOT EXISTS(SELECT 1 FROM public.community_dm_messages WHERE conversation_id = p_conversation
        AND seq > read_seq AND author_id IS DISTINCT FROM actor AND deleted_at IS NULL) THEN
        UPDATE public.community_notifications SET read_at = now() WHERE tenant_id = ctx.tenant AND community_id = ctx.community
          AND recipient_id = actor AND kind = 'dm' AND target_type = 'dm_conversation' AND target_id = p_conversation::text AND read_at IS NULL;
      END IF;
    END IF;
  ELSIF p_action = 'mute' AND p_value IS NOT NULL THEN
    UPDATE public.community_dm_participants SET muted = p_value WHERE conversation_id = p_conversation AND user_id = actor AND muted <> p_value;
    IF FOUND THEN PERFORM public.community_dm_bump(ctx.tenant, ctx.community, p_conversation, ARRAY[actor]); END IF;
  ELSIF p_action = 'hide' AND p_value IS NOT NULL THEN
    UPDATE public.community_dm_participants SET hidden_at = CASE WHEN p_value THEN now() END
      WHERE conversation_id = p_conversation AND user_id = actor AND (hidden_at IS NOT NULL) <> p_value;
    IF FOUND THEN PERFORM public.community_dm_bump(ctx.tenant, ctx.community, p_conversation, ARRAY[actor]); END IF;
  ELSE
    RETURN public.community_chat_done('{"outcome":"invalid"}');
  END IF;
  RETURN public.community_chat_done('{"outcome":"ok"}');
END $$;

CREATE FUNCTION public.community_dm_read(p_slug text, p_conversation uuid, p_seq bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_preferences(p_slug, p_conversation, 'read', NULL, p_seq)
$$;
CREATE FUNCTION public.community_dm_hide(p_slug text, p_conversation uuid, p_hidden boolean)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_preferences(p_slug, p_conversation, 'hide', p_hidden, NULL)
$$;
CREATE FUNCTION public.community_dm_mute(p_slug text, p_conversation uuid, p_muted boolean)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_preferences(p_slug, p_conversation, 'mute', p_muted, NULL)
$$;

CREATE FUNCTION public.community_dm_accept_save(p_slug text, p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  PERFORM public.community_dm_lock_members(ctx.tenant, ctx.community, ARRAY[actor]);
  IF public.community_dm_active(ctx.tenant, ctx.community, actor) IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  IF p_accept IS NULL THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
  UPDATE public.community_memberships SET dm_accept_members = p_accept
    WHERE tenant_id = ctx.tenant AND community_id = ctx.community AND user_id = actor AND status = 'active'
      AND dm_accept_members IS DISTINCT FROM p_accept;
  -- Only the private rail detector observes the preference.
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','acceptMembers',p_accept));
END $$;

CREATE FUNCTION public.community_dm_set_block(p_slug text, p_other text, p_block boolean, p_hide boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
  pair text;
  conversation uuid;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  IF p_other IS NULL OR p_other = actor THEN RETURN public.community_chat_done('{"outcome":"not_available"}'); END IF;
  pair := public.community_dm_pair(actor, p_other);
  PERFORM pg_advisory_xact_lock(hashtextextended(ctx.community::text || pair, 12058));
  SELECT id INTO conversation FROM public.community_dm_conversations
    WHERE tenant_id = ctx.tenant AND community_id = ctx.community AND pair_key = pair FOR UPDATE;
  PERFORM public.community_dm_lock_members(ctx.tenant, ctx.community, ARRAY[actor, p_other]);
  IF public.community_dm_active(ctx.tenant, ctx.community, actor) IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  IF p_block THEN
    -- A target who is not an active member gets the same answer as one who is, so the response is not an oracle for membership.
    IF public.community_dm_active(ctx.tenant, ctx.community, p_other) IS NOT NULL THEN
      INSERT INTO public.community_dm_blocks(tenant_id, community_id, blocker_id, blocked_id)
        VALUES(ctx.tenant, ctx.community, actor, p_other) ON CONFLICT DO NOTHING;
    END IF;
    IF p_hide THEN UPDATE public.community_dm_participants SET hidden_at = coalesce(hidden_at, now())
      WHERE conversation_id = conversation AND user_id = actor; END IF;
  ELSE
    DELETE FROM public.community_dm_blocks WHERE tenant_id = ctx.tenant AND community_id = ctx.community AND blocker_id = actor AND blocked_id = p_other;
  END IF;
  PERFORM public.community_dm_bump(ctx.tenant, ctx.community, conversation, ARRAY[actor]);
  RETURN public.community_chat_done('{"outcome":"ok"}');
END $$;
CREATE FUNCTION public.community_dm_block(p_slug text, p_other text, p_hide boolean)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_set_block(p_slug, p_other, true, p_hide)
$$;
CREATE FUNCTION public.community_dm_unblock(p_slug text, p_other text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_set_block(p_slug, p_other, false, false)
$$;

--> statement-breakpoint
CREATE FUNCTION public.community_dm_messages(p_slug text, p_conversation uuid, p_since bigint, p_before bigint, p_limit integer, p_etag text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
  revision bigint;
  tag text;
  events jsonb;
  cursor_rev bigint;
  has_more boolean;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL OR NOT public.community_dm_participant_allowed(ctx.tenant, ctx.community, p_conversation) THEN
    RETURN public.community_chat_done('{"outcome":"not_found"}');
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_since < 0 OR p_before < 0
    OR (p_since IS NOT NULL AND p_before IS NOT NULL) THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
  SELECT last_rev INTO revision FROM public.community_dm_conversations WHERE id = p_conversation;
  tag := 'W/"' || p_conversation::text || ':' || revision::text || '"';
  IF p_etag = tag AND p_before IS NULL AND (p_since IS NULL OR NOT EXISTS(SELECT 1 FROM public.community_dm_messages
    WHERE conversation_id = p_conversation AND rev > p_since)) THEN
    RETURN public.community_chat_done(jsonb_build_object('outcome','ok','notModified',true,'etag',tag));
  END IF;
  WITH page AS MATERIALIZED (
    SELECT * FROM public.community_dm_messages m WHERE m.conversation_id = p_conversation
      AND (p_since IS NULL OR m.rev > p_since) AND (p_before IS NULL OR m.seq < p_before)
    ORDER BY CASE WHEN p_since IS NOT NULL THEN m.rev END ASC, CASE WHEN p_since IS NULL THEN m.seq END DESC
    LIMIT p_limit + 1
  ), bounded AS (SELECT * FROM page
    ORDER BY CASE WHEN p_since IS NOT NULL THEN rev END ASC, CASE WHEN p_since IS NULL THEN seq END DESC LIMIT p_limit)
  SELECT coalesce(jsonb_agg(public.community_dm_project(bounded) ORDER BY rev), '[]'),
    coalesce(max(rev), p_since, 0), (SELECT count(*) > p_limit FROM page)
  INTO events, cursor_rev, has_more FROM bounded;
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','events',events,
    'cursor',CASE WHEN p_before IS NULL THEN cursor_rev::text END,'hasMore',has_more,'etag',tag));
END $$;

CREATE FUNCTION public.community_dm_visible(p_tenant uuid, p_community uuid, p_actor text)
RETURNS TABLE(id uuid, last_rev bigint, last_message_at timestamptz, other_id text, other_name text, muted boolean,
  last_read_seq bigint, state_rev bigint, can_send boolean)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.id, c.last_rev, c.last_message_at, other.user_id, u.name, own.muted, own.last_read_seq, own.state_rev,
    -- Blocks are deliberately not reflected here: a blocked person must see the same list and rail token as before the block.
    public.community_dm_can_send(p_tenant, p_community, p_actor, other.user_id, true, c.staff_engaged_by, c.staff_engaged_at, true)
  FROM public.community_dm_participants own
  JOIN public.community_dm_conversations c ON c.id = own.conversation_id
  LEFT JOIN public.community_dm_participants other ON other.conversation_id = c.id AND other.user_id <> p_actor
  LEFT JOIN public.community_memberships m ON m.tenant_id = own.tenant_id AND m.community_id = own.community_id AND m.user_id = other.user_id
  LEFT JOIN public.users u ON u.id = other.user_id
  WHERE own.tenant_id = p_tenant AND own.community_id = p_community AND own.user_id = p_actor
    AND own.hidden_at IS NULL AND own.left_at IS NULL AND m.status IS DISTINCT FROM 'banned' AND m.status IS DISTINCT FROM 'removed'
$$;

CREATE FUNCTION public.community_dm_list(p_slug text, p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
  items jsonb;
  policy text;
  accepts boolean;
  blocks jsonb;
  next_page jsonb;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL OR public.community_dm_active(ctx.tenant, ctx.community, actor) IS NULL THEN
    RETURN public.community_chat_done('{"outcome":"not_found"}');
  END IF;
  SELECT dm_policy INTO policy FROM public.communities WHERE tenant_id = ctx.tenant AND id = ctx.community;
  SELECT dm_accept_members INTO accepts FROM public.community_memberships WHERE community_id = ctx.community AND user_id = actor;
  WITH page AS MATERIALIZED (
    SELECT * FROM public.community_dm_visible(ctx.tenant,ctx.community,actor) v
    WHERE p_before_id IS NULL OR coalesce(v.last_message_at,'-infinity'::timestamptz) < coalesce(p_before_at,'-infinity'::timestamptz)
      OR (v.last_message_at IS NOT DISTINCT FROM p_before_at AND v.id > p_before_id)
    ORDER BY last_message_at DESC NULLS LAST,id LIMIT 101
  ), bounded AS (SELECT * FROM page ORDER BY last_message_at DESC NULLS LAST,id LIMIT 100)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'latestRev', v.last_rev::text, 'lastMessageAt', v.last_message_at,
    'otherId', v.other_id, 'otherName', v.other_name, 'muted', v.muted, 'canSend', v.can_send,
    'unread', CASE WHEN v.muted THEN 0 ELSE (SELECT count(*) FROM (SELECT 1 FROM public.community_dm_messages m
      WHERE m.conversation_id = v.id AND m.seq > v.last_read_seq AND m.author_id IS DISTINCT FROM actor
        AND m.deleted_at IS NULL LIMIT 100) bounded) END) ORDER BY v.last_message_at DESC NULLS LAST, v.id), '[]')
    , CASE WHEN (SELECT count(*) FROM page)>100 THEN
      (SELECT jsonb_build_object('at', n.last_message_at, 'id', n.id) FROM bounded n
        ORDER BY n.last_message_at ASC NULLS FIRST,n.id DESC LIMIT 1) END
    INTO items, next_page FROM bounded v;
  SELECT coalesce(jsonb_agg(blocked_id ORDER BY blocked_id), '[]') INTO blocks FROM public.community_dm_blocks
    WHERE tenant_id = ctx.tenant AND community_id = ctx.community AND blocker_id = actor;
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','items',items,'policy',policy,
    'next',next_page,'acceptMembers',coalesce(accepts,true),'blockedUserIds',blocks));
END $$;

CREATE FUNCTION public.community_dm_rail(p_slug text, p_detector_only boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
  token text;
  latest bigint;
  unread integer;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL OR public.community_dm_active(ctx.tenant, ctx.community, actor) IS NULL THEN
    RETURN public.community_chat_done('{"token":"","latestRev":"0","unreadConversations":0}');
  END IF;
  WITH mine AS MATERIALIZED (
    SELECT v.id, v.last_rev, v.state_rev, v.muted, v.last_read_seq, v.can_send
      FROM public.community_dm_visible(ctx.tenant, ctx.community, actor) v
  )
  SELECT md5(coalesce(string_agg(id::text || ':' || last_rev::text || ':' || state_rev::text || ':' || can_send::text,
      ',' ORDER BY id), '') || ':' || coalesce((SELECT dm_accept_members FROM public.community_memberships
        WHERE tenant_id=ctx.tenant AND community_id=ctx.community AND user_id=actor),true)::text),
    coalesce(max(last_rev), 0), CASE WHEN p_detector_only THEN 0 ELSE least(100, count(*) FILTER(WHERE NOT muted AND EXISTS (
      SELECT 1 FROM public.community_dm_messages m WHERE m.conversation_id = mine.id AND m.seq > mine.last_read_seq
        AND m.author_id IS DISTINCT FROM actor AND m.deleted_at IS NULL))) END
  INTO token, latest, unread FROM mine;
  RETURN public.community_chat_done(jsonb_build_object('token',token,'latestRev',latest::text,'unreadConversations',unread));
END $$;

CREATE FUNCTION public.community_dm_people(p_slug text, p_query text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; people jsonb;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL OR public.community_dm_active(ctx.tenant, ctx.community, actor) IS NULL THEN
    RETURN public.community_chat_done('{"outcome":"not_found"}');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.user_id, 'name', x.name) ORDER BY x.name, x.user_id), '[]') INTO people
  FROM (SELECT m.user_id, u.name FROM public.community_memberships m JOIN public.users u ON u.id = m.user_id
    LEFT JOIN public.community_dm_conversations c ON c.community_id = m.community_id AND c.pair_key = public.community_dm_pair(actor, m.user_id)
    WHERE m.tenant_id = ctx.tenant AND m.community_id = ctx.community AND m.user_id <> actor AND m.status = 'active'
      AND strpos(lower(u.name), lower(coalesce(p_query, ''))) > 0
      AND public.community_dm_can_send(ctx.tenant, ctx.community, actor, m.user_id, c.id IS NOT NULL, c.staff_engaged_by, c.staff_engaged_at, true)
    ORDER BY u.name, m.user_id LIMIT 50) x;
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','items',people));
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_dm_reviewers(p_tenant uuid, p_community uuid, p_reporter text, p_subject text)
RETURNS SETOF text LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT candidate.user_id FROM (
    SELECT user_id FROM public.community_memberships
      WHERE tenant_id = p_tenant AND community_id = p_community AND status = 'active' AND role IN ('owner','admin')
    UNION SELECT user_id FROM public.workspace_members WHERE tenant_id = p_tenant AND role_id IN ('owner','admin')
  ) candidate
  WHERE candidate.user_id IS DISTINCT FROM p_reporter AND candidate.user_id IS DISTINCT FROM p_subject
    AND public.community_chat_can(public.community_chat_role(p_tenant, p_community, candidate.user_id), 'chat:manage_channels')
$$;

CREATE FUNCTION public.community_dm_notify_reviewers(p_tenant uuid, p_community uuid, p_reporter text, p_subject text)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE recipient text; found_reviewer boolean := false;
BEGIN
  FOR recipient IN SELECT * FROM public.community_dm_reviewers(p_tenant, p_community, p_reporter, p_subject) LOOP
    found_reviewer := true;
    IF EXISTS(SELECT 1 FROM public.community_memberships WHERE tenant_id = p_tenant AND community_id = p_community
        AND user_id = recipient AND notifications_muted) THEN CONTINUE; END IF;
    INSERT INTO public.community_notifications(tenant_id, community_id, recipient_id, kind, target_type, target_id, actor_id, detail)
      VALUES(p_tenant, p_community, recipient, 'host_queue', 'community', p_community::text, NULL, '{}'::jsonb)
      ON CONFLICT (recipient_id, community_id) WHERE kind = 'host_queue' AND read_at IS NULL
      DO UPDATE SET actor_count = community_notifications.actor_count + 1, updated_at = now();
  END LOOP;
  RETURN NOT found_reviewer;
END $$;

CREATE FUNCTION public.community_dm_report(p_slug text, p_message uuid, p_reason text, p_note text, p_conversation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
  conversation public.community_dm_conversations%ROWTYPE;
  m public.community_dm_messages%ROWTYPE;
  report uuid;
  no_reviewer boolean;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('spam','harassment','inappropriate','other')
    OR (p_note IS NOT NULL AND length(p_note) NOT BETWEEN 1 AND 500) THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
  SELECT * INTO m FROM public.community_dm_messages WHERE tenant_id = ctx.tenant AND community_id = ctx.community AND id = p_message
    AND (p_conversation IS NULL OR conversation_id = p_conversation);
  IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  conversation := public.community_dm_lock_conversation(ctx.tenant, ctx.community, m.conversation_id, actor);
  IF conversation.id IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  SELECT * INTO m FROM public.community_dm_messages WHERE id = p_message AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR m.author_id = actor THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  INSERT INTO public.community_reports(tenant_id, community_id, reporter_id, target_type, target_id, reason, note)
    VALUES(ctx.tenant, ctx.community, actor, 'dm_message', p_message::text, p_reason, p_note)
    ON CONFLICT (community_id, reporter_id, target_type, target_id) WHERE status = 'open' DO NOTHING RETURNING id INTO report;
  IF report IS NULL THEN RETURN public.community_chat_done('{"outcome":"duplicate"}'); END IF;
  INSERT INTO public.community_dm_report_evidence(tenant_id, community_id, report_id, conversation_id,
    reporter_key, subject_key, reporter_name, snapshot)
  SELECT ctx.tenant, ctx.community, report, conversation.id, actor, m.author_id,
    (SELECT name FROM public.users WHERE id = actor),
    (SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', u.name, 'at', x.created_at, 'body', x.body) ORDER BY x.seq)
      FROM (SELECT id, author_id, created_at, body, seq FROM public.community_dm_messages
        WHERE conversation_id = conversation.id AND seq <= m.seq AND deleted_at IS NULL ORDER BY seq DESC LIMIT 6) x
      LEFT JOIN public.users u ON u.id = x.author_id);
  no_reviewer := public.community_dm_notify_reviewers(ctx.tenant, ctx.community, actor, m.author_id);
  UPDATE public.community_reports SET needs_escalation = no_reviewer WHERE id = report;
  INSERT INTO public.audit_logs(tenant_id, actor_id, action, target_id)
    VALUES(ctx.tenant, actor, 'community.dm.report', report::text);
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','id',report,'needsEscalation',no_reviewer));
END $$;

CREATE FUNCTION public.community_dm_reports(p_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; items jsonb; reviewer boolean;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL OR NOT coalesce(public.community_chat_can(ctx.role, 'chat:moderate'), false) THEN
    RETURN public.community_chat_done('{"outcome":"not_found"}');
  END IF;
  reviewer := public.community_chat_can(ctx.role, 'chat:manage_channels');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'reason', q.reason, 'note', q.note,
    'createdAt', q.created_at, 'needsEscalation', q.escalate, 'reporterName', q.reporter_name, 'reporterId', q.reporter_id)
    ORDER BY q.created_at, q.id), '[]') INTO items FROM (
    SELECT r.id, r.reason, r.note, r.created_at, NOT EXISTS(SELECT 1 FROM public.community_dm_reviewers(
      r.tenant_id, r.community_id, e.reporter_key, e.subject_key)) AS escalate,
      CASE WHEN reviewer THEN e.reporter_name END AS reporter_name, CASE WHEN reviewer THEN r.reporter_id END AS reporter_id
    FROM public.community_reports r JOIN public.community_dm_report_evidence e ON e.report_id = r.id
    WHERE r.tenant_id = ctx.tenant AND r.community_id = ctx.community AND r.target_type = 'dm_message' AND r.status = 'open'
      AND actor IS DISTINCT FROM e.reporter_key AND actor IS DISTINCT FROM e.subject_key
    ORDER BY r.created_at, r.id LIMIT 200) q;
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','items',items));
END $$;

CREATE FUNCTION public.community_dm_evidence_view(p_report uuid, p_expected_slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); e public.community_dm_report_evidence%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  -- Scope the UUID lookup to metadata before authorizing the snapshot read.
  PERFORM set_config('app.dm_evidence_report', coalesce(p_report::text, ''), true);
  SELECT report_id, tenant_id, community_id, reporter_key, subject_key, expires_at
    INTO e.report_id, e.tenant_id, e.community_id, e.reporter_key, e.subject_key, e.expires_at
    FROM public.community_dm_report_evidence WHERE report_id = p_report;
  PERFORM set_config('app.dm_evidence_report', '', true);
  IF e.report_id IS NULL OR e.expires_at <= clock_timestamp()
    OR actor = e.reporter_key OR actor IS NOT DISTINCT FROM e.subject_key THEN
    RETURN public.community_chat_done('{"outcome":"not_found"}');
  END IF;
  PERFORM set_config('app.community_definer_tenant', e.tenant_id::text, true);
  PERFORM public.community_dm_lock_members(e.tenant_id, e.community_id, ARRAY[actor]);
  IF NOT coalesce(public.community_chat_can(public.community_dm_active(e.tenant_id, e.community_id, actor), 'chat:manage_channels'),false)
    OR (p_expected_slug IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.communities WHERE id = e.community_id AND tenant_id = e.tenant_id AND slug = p_expected_slug)) THEN
    RETURN public.community_chat_done('{"outcome":"not_found"}');
  END IF;
  SELECT * INTO e FROM public.community_dm_report_evidence WHERE report_id = p_report
    AND (expires_at IS NULL OR expires_at > clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  PERFORM public.community_moderation_log(e.tenant_id, e.community_id, 'dm_evidence_view', 'dm_message', p_report::text, NULL, '{}'::jsonb);
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','reporterName',e.reporter_name,'subjectId',e.subject_key,
    'reportedMessageId',e.snapshot->-1->>'id','messages',e.snapshot));
END $$;
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY dm_evidence_lookup ON public.community_dm_report_evidence FOR SELECT TO %I
    USING (report_id = nullif(current_setting('app.dm_evidence_report', true), '')::uuid)$p$, current_user);
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_dm_member_moderate_core(p_slug text, p_user_id text, p_action text, p_days integer, p_from_dm boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; target record; actor_rank integer; target_rank integer;
BEGIN
  IF p_from_dm THEN
    SELECT tenant AS o_tenant,community AS o_community,role AS o_role INTO ctx FROM public.community_chat_actor(p_slug);
    IF NOT coalesce(public.community_chat_can(ctx.o_role,'chat:manage_channels'),false) THEN RETURN public.community_forum_done('not_found'); END IF;
  ELSE
    SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  END IF;
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_action IS NULL OR p_action NOT IN ('mute', 'unmute', 'ban', 'unban') OR (p_action = 'mute' AND coalesce(p_days, 0) NOT IN (1, 7, 30)) THEN
    RETURN public.community_forum_done('invalid');
  END IF;
  SELECT * INTO target FROM public.community_memberships WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  actor_rank := CASE ctx.o_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 1 ELSE 0 END;
  target_rank := CASE target.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 1 ELSE 0 END;
  IF p_from_dm THEN
    target_rank := greatest(target_rank,CASE public.community_chat_role(ctx.o_tenant,ctx.o_community,p_user_id)
      WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 1 ELSE 0 END);
  END IF;
  IF p_user_id = actor OR target.role = 'owner' OR actor_rank <= target_rank THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_action = 'mute' THEN
    IF target.status <> 'active' THEN RETURN public.community_forum_done('invalid'); END IF;
    UPDATE public.community_memberships SET muted_until = now() + make_interval(days => p_days), updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id;
  ELSIF p_action = 'unmute' THEN
    -- Active members only: touching a banned membership would move updated_at and re-open the one-appeal-per-ban window (review on #65).
    IF target.status <> 'active' THEN RETURN public.community_forum_done('invalid'); END IF;
    UPDATE public.community_memberships SET muted_until = NULL, updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id;
  ELSIF p_action = 'ban' THEN
    IF target.status = 'banned' THEN RETURN public.community_forum_done('invalid'); END IF;
    UPDATE public.community_memberships SET status = 'banned', role = 'member', muted_until = NULL, updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id;
    UPDATE public.entitlements SET revoked_at = now(), revoked_by = actor
      WHERE tenant_id = ctx.o_tenant AND user_id = p_user_id AND resource_type = 'community' AND resource_id = ctx.o_community AND revoked_at IS NULL;
    UPDATE public.community_applications SET status = 'declined', decided_by = actor, decided_at = now(), updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id AND status IN ('pending', 'info_requested');
  ELSE
    IF target.status <> 'banned' OR actor_rank < 2 THEN RETURN public.community_forum_done(CASE WHEN target.status <> 'banned' THEN 'invalid' ELSE 'forbidden' END); END IF;
    UPDATE public.community_memberships SET status = 'left', updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id;
    -- An unban settles the person's open appeal as approved (C12b).
    UPDATE public.community_appeals SET status = 'approved', decided_by = actor, decided_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id AND status = 'open';
  END IF;
  PERFORM public.community_moderation_log(ctx.o_tenant, ctx.o_community, p_action, 'member', p_user_id, p_user_id,
    CASE WHEN p_action = 'mute' THEN jsonb_build_object('days', p_days) ELSE '{}'::jsonb END);
  RETURN public.community_forum_done('ok');
END $$;
REVOKE ALL ON FUNCTION public.community_dm_member_moderate_core(text,text,text,integer,boolean) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.community_member_moderate(p_slug text, p_user_id text, p_action text, p_days integer) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT public.community_dm_member_moderate_core(p_slug,p_user_id,p_action,p_days,false)
$$;
REVOKE ALL ON FUNCTION public.community_member_moderate(text,text,text,integer) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.community_dm_warn_core(p_slug text, p_user_id text, p_reason text, p_from_dm boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; target record; actor_rank integer; target_rank integer;
  v_reason text := btrim(coalesce(p_reason, '')); v_warning uuid;
BEGIN
  IF p_from_dm THEN
    SELECT tenant AS o_tenant,community AS o_community,role AS o_role INTO ctx FROM public.community_chat_actor(p_slug);
    IF NOT coalesce(public.community_chat_can(ctx.o_role,'chat:manage_channels'),false) THEN RETURN public.community_forum_done('not_found'); END IF;
  ELSE
    SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  END IF;
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF length(v_reason) NOT BETWEEN 1 AND 500 THEN RETURN public.community_forum_done('invalid'); END IF;
  SELECT * INTO target FROM public.community_memberships WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  actor_rank := CASE ctx.o_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 1 ELSE 0 END;
  target_rank := CASE target.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 1 ELSE 0 END;
  IF p_from_dm THEN
    target_rank := greatest(target_rank,CASE public.community_chat_role(ctx.o_tenant,ctx.o_community,p_user_id)
      WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 1 ELSE 0 END);
  END IF;
  IF p_user_id = actor OR target.role = 'owner' OR actor_rank <= target_rank THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF target.status <> 'active' THEN RETURN public.community_forum_done('invalid'); END IF;
  INSERT INTO public.community_warnings (tenant_id, community_id, user_id, issued_by, reason)
    VALUES (ctx.o_tenant, ctx.o_community, p_user_id, actor, v_reason) RETURNING id INTO v_warning;
  PERFORM public.community_moderation_log(ctx.o_tenant, ctx.o_community, 'warn', 'member', p_user_id, p_user_id, jsonb_build_object('warningId', v_warning));
  PERFORM public.community_notify(ctx.o_tenant, ctx.o_community, p_user_id, 'warning', 'warning', v_warning::text, NULL, '{}'::jsonb);
  RETURN public.community_forum_done('ok', v_warning);
END $$;
REVOKE ALL ON FUNCTION public.community_dm_warn_core(text,text,text,boolean) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.community_warn(p_slug text, p_user_id text, p_reason text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT public.community_dm_warn_core(p_slug,p_user_id,p_reason,false)
$$;
REVOKE ALL ON FUNCTION public.community_warn(text,text,text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.community_dm_decide(p_slug text, p_report uuid, p_decision text, p_moderation jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
  e public.community_dm_report_evidence%ROWTYPE;
  decided timestamptz;
  applied jsonb;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  SELECT * INTO e FROM public.community_dm_report_evidence
    WHERE report_id=p_report AND tenant_id=ctx.tenant AND community_id=ctx.community;
  IF e.report_id IS NULL OR actor=e.reporter_key OR actor IS NOT DISTINCT FROM e.subject_key THEN
    RETURN public.community_chat_done('{"outcome":"not_found"}');
  END IF;
  PERFORM public.community_dm_lock_members(ctx.tenant,ctx.community,ARRAY[actor,e.subject_key]);
  IF NOT coalesce(public.community_chat_can(public.community_dm_active(ctx.tenant, ctx.community, actor), 'chat:manage_channels'),false) THEN
    RETURN public.community_chat_done('{"outcome":"not_found"}');
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('keep','action') THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
  PERFORM 1 FROM public.community_reports WHERE id = p_report AND tenant_id = ctx.tenant AND community_id = ctx.community
    AND target_type = 'dm_message' AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
  IF p_moderation IS NOT NULL THEN
    IF p_decision<>'action' OR e.subject_key IS NULL THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
    CASE p_moderation->>'action'
      WHEN 'warn' THEN applied:=public.community_dm_warn_core(p_slug,e.subject_key,p_moderation->>'reason',true);
      WHEN 'mute' THEN
        IF coalesce(p_moderation->>'days','') NOT IN ('1','7','30') THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
        applied:=public.community_dm_member_moderate_core(p_slug,e.subject_key,'mute',(p_moderation->>'days')::integer,true);
      WHEN 'ban' THEN applied:=public.community_dm_member_moderate_core(p_slug,e.subject_key,'ban',NULL,true);
      ELSE RETURN public.community_chat_done('{"outcome":"invalid"}');
    END CASE;
    IF applied->>'outcome' IS DISTINCT FROM 'ok' THEN RETURN public.community_chat_done(applied); END IF;
    -- Existing moderation helpers reset their scoped settings before returning.
    PERFORM set_config('app.community_definer_tenant',ctx.tenant::text,true);
  END IF;
  decided := clock_timestamp();
  UPDATE public.community_reports SET status = CASE WHEN p_decision = 'action' THEN 'actioned' ELSE 'dismissed' END,
    decided_by = actor, decided_at = decided, needs_escalation = false WHERE id = p_report;
  UPDATE public.community_dm_report_evidence SET expires_at = decided + interval '180 days' WHERE report_id = p_report;
  PERFORM public.community_moderation_log(ctx.tenant, ctx.community,
    CASE WHEN p_decision = 'action' THEN 'report_action' ELSE 'report_dismiss' END, 'dm_message', p_report::text, NULL, '{}'::jsonb);
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','id',p_report));
END $$;

CREATE FUNCTION public.community_dm_notice_allowed(p_tenant uuid, p_community uuid, p_target text, p_sender text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  previous text := current_setting('app.community_definer_tenant', true);
  allowed boolean;
BEGIN
  IF actor IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.community_definer_tenant', p_tenant::text, true);
  SELECT public.community_dm_active(p_tenant, p_community, actor) IS NOT NULL
    AND public.community_dm_active(p_tenant, p_community, p_sender) IS NOT NULL
    AND NOT public.community_dm_blocked(p_tenant, p_community, actor, p_sender)
    AND NOT EXISTS(SELECT 1 FROM public.community_memberships WHERE tenant_id = p_tenant AND community_id = p_community
      AND user_id = actor AND notifications_muted)
    AND EXISTS(SELECT 1 FROM public.community_dm_participants WHERE tenant_id = p_tenant AND community_id = p_community
      AND conversation_id::text = p_target AND user_id = actor AND NOT muted AND hidden_at IS NULL AND left_at IS NULL)
  INTO allowed;
  PERFORM set_config('app.community_definer_tenant', coalesce(previous, ''), true);
  RETURN allowed;
END $$;

CREATE POLICY dm_notifications_private ON public.community_notifications AS RESTRICTIVE FOR SELECT TO harvest_app
  USING (kind <> 'dm' OR (target_type = 'dm_conversation' AND recipient_id = nullif(current_setting('app.user_id',true),'')
    AND public.community_dm_notice_allowed(tenant_id, community_id, target_id, actor_id)));

--> statement-breakpoint
CREATE FUNCTION public.community_chat_purge_dm(p_batch integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  batch integer := least(greatest(coalesce(p_batch, 200), 1), 1000);
  stamp timestamptz := clock_timestamp();
  deleted integer;
  conversations integer;
  evidence integer;
  expired integer := 0;
  reminded integer := 0;
  r record;
  escalation boolean;
BEGIN
  PERFORM set_config('app.dm_purge', 'on', true);
  PERFORM set_config('app.chat_purge', 'on', true);
  WITH picked AS (
    SELECT id FROM public.community_dm_messages WHERE purge_after <= stamp ORDER BY purge_after, id LIMIT batch FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.community_dm_messages m USING picked WHERE m.id = picked.id;
  GET DIAGNOSTICS deleted = ROW_COUNT;

  WITH picked AS (
    SELECT c.id FROM public.community_dm_conversations c
    WHERE coalesce(c.last_message_at, c.created_at) < stamp - interval '30 days'
      AND NOT EXISTS(SELECT 1 FROM public.community_dm_messages m WHERE m.conversation_id = c.id)
      AND NOT EXISTS(SELECT 1 FROM public.community_dm_participants p WHERE p.conversation_id = c.id AND p.hidden_at IS NULL)
    ORDER BY coalesce(c.last_message_at,c.created_at), c.id LIMIT batch FOR UPDATE OF c SKIP LOCKED
  )
  DELETE FROM public.community_dm_conversations c USING picked WHERE c.id = picked.id;
  GET DIAGNOSTICS conversations = ROW_COUNT;

  WITH picked AS (
    SELECT report_id FROM public.community_dm_report_evidence WHERE expires_at <= stamp
    ORDER BY expires_at, report_id LIMIT batch FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.community_dm_report_evidence e USING picked WHERE e.report_id = picked.report_id;
  GET DIAGNOSTICS evidence = ROW_COUNT;

  FOR r IN SELECT p.id, p.tenant_id, p.community_id, p.created_at, e.reporter_key, e.subject_key
    FROM public.community_reports p JOIN public.community_dm_report_evidence e ON e.report_id = p.id
    WHERE p.target_type = 'dm_message' AND p.status = 'open'
      AND (p.created_at <= stamp - interval '90 days'
        OR p.created_at <= stamp - interval '14 days' AND p.reminded_at IS NULL
        OR p.created_at <= stamp - interval '45 days' AND p.reminded_at < p.created_at + interval '45 days')
    ORDER BY p.created_at, p.id LIMIT batch FOR UPDATE OF p SKIP LOCKED
  LOOP
    PERFORM set_config('app.community_definer_tenant', r.tenant_id::text, true);
    IF r.created_at <= stamp - interval '90 days' THEN
      UPDATE public.community_reports SET status = 'expired', decided_at = stamp, needs_escalation = false WHERE id = r.id;
      UPDATE public.community_dm_report_evidence SET expires_at = stamp + interval '30 days' WHERE report_id = r.id;
      PERFORM public.community_moderation_log(r.tenant_id, r.community_id, 'report_expire', 'dm_message', r.id::text, NULL, '{}'::jsonb);
      expired := expired + 1;
    ELSE
      escalation := public.community_dm_notify_reviewers(r.tenant_id, r.community_id, r.reporter_key, r.subject_key);
      UPDATE public.community_reports SET reminded_at = stamp, needs_escalation = escalation WHERE id = r.id;
      reminded := reminded + 1;
    END IF;
  END LOOP;

  INSERT INTO public.community_chat_purge_runs(kind, deleted, status) VALUES('dm', deleted + conversations + evidence, 'ok');
  PERFORM set_config('app.dm_purge', '', true);
  PERFORM set_config('app.chat_purge', '', true);
  PERFORM public.community_definer_reset();
  RETURN jsonb_build_object('deleted',deleted,'conversations',conversations,'evidence',evidence,'expired',expired,'reminded',reminded);
END $$;

--> statement-breakpoint
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.proname AS name FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'community_dm_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, harvest_app', f.sig);
    IF f.name = ANY(ARRAY['community_dm_participant_allowed','community_dm_notice_allowed','community_dm_start','community_dm_send',
      'community_dm_edit','community_dm_delete_message','community_dm_restore_message','community_dm_read','community_dm_hide',
      'community_dm_mute','community_dm_accept_save','community_dm_block','community_dm_unblock','community_dm_messages',
      'community_dm_list','community_dm_rail','community_dm_people','community_dm_report','community_dm_reports','community_dm_evidence_view']) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO harvest_app', f.sig);
    END IF;
  END LOOP;
END $$;

-- 0058 worker-role grant: replay this block after provisioning the role, never create it in a migration.
REVOKE ALL ON FUNCTION public.community_chat_purge_dm(integer) FROM PUBLIC, harvest_app;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'harvest_worker') THEN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'harvest_worker'
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit))
      OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member = 'harvest_worker'::regrole) THEN
      RAISE EXCEPTION 'harvest_worker must be an unprivileged SQL-created role without inherited memberships';
    END IF;
    GRANT EXECUTE ON FUNCTION public.community_chat_purge_dm(integer) TO harvest_worker;
  END IF;
END $$;
-- End 0058 worker-role grant.

--> statement-breakpoint
CREATE FUNCTION public.community_report_decide_forum(p_slug text, p_report_id uuid, p_decision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; r record; v_subject text; v_closed integer; v_actor_rank integer; v_ch uuid; v_rev bigint;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN
    SELECT tenant AS o_tenant,community AS o_community,role AS o_role INTO ctx FROM public.community_chat_actor(p_slug);
    IF ctx.o_tenant IS NULL OR NOT EXISTS(SELECT 1 FROM public.community_reports WHERE tenant_id=ctx.o_tenant AND community_id=ctx.o_community AND id=p_report_id AND target_type='message') THEN RETURN public.community_forum_done('not_found'); END IF;
  END IF;
  IF ctx.o_role NOT IN ('owner', 'admin', 'moderator') THEN RETURN public.community_forum_done('forbidden'); END IF;
  IF p_decision NOT IN ('keep', 'remove') THEN RETURN public.community_forum_done('invalid'); END IF;
  SELECT * INTO r FROM public.community_reports WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_report_id AND status = 'open' AND target_type <> 'dm_message';
  IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
  IF r.target_type='message' THEN
    IF NOT EXISTS(SELECT 1 FROM public.communities WHERE tenant_id=ctx.o_tenant AND id=ctx.o_community AND chat_enabled) THEN RETURN public.community_forum_done('not_found'); END IF;
    SELECT channel_id INTO v_ch FROM public.community_messages WHERE tenant_id=ctx.o_tenant AND community_id=ctx.o_community AND id::text=r.target_id;
    PERFORM 1 FROM public.community_channels WHERE id=v_ch FOR UPDATE;
    PERFORM public.community_chat_lock_members(ctx.o_tenant,ctx.o_community);
    IF NOT coalesce(public.community_chat_can(public.community_chat_role(ctx.o_tenant,ctx.o_community,actor),'chat:moderate'),false) THEN RETURN public.community_forum_done('forbidden'); END IF;
    SELECT author_id INTO v_subject FROM public.community_messages WHERE id::text=r.target_id AND channel_id=v_ch;
    IF v_subject=actor OR (p_decision='remove' AND public.community_chat_rank(public.community_chat_role(ctx.o_tenant,ctx.o_community,v_subject))>=public.community_chat_rank(public.community_chat_role(ctx.o_tenant,ctx.o_community,actor))) THEN RETURN public.community_forum_done('forbidden'); END IF;
    PERFORM 1 FROM public.community_reports WHERE id=p_report_id AND status='open' FOR UPDATE;
    IF NOT FOUND THEN RETURN public.community_forum_done('not_found'); END IF;
    UPDATE public.community_channels SET last_rev=last_rev+1 WHERE id=v_ch RETURNING last_rev INTO v_rev;
    UPDATE public.community_messages SET rev=v_rev,deleted_at=CASE WHEN p_decision='remove' THEN coalesce(deleted_at,now()) ELSE deleted_at END,
      deleted_by=CASE WHEN p_decision='remove' THEN actor ELSE deleted_by END,deleted_kind=CASE WHEN p_decision='remove' THEN 'host' ELSE deleted_kind END,
      purge_after=CASE WHEN p_decision='remove' OR deleted_at IS NOT NULL THEN now()+interval '30 days' ELSE purge_after END WHERE id::text=r.target_id;
    UPDATE public.community_reports SET status=CASE WHEN p_decision='remove' THEN 'actioned' ELSE 'dismissed' END,decided_by=actor,decided_at=now()
      WHERE tenant_id=ctx.o_tenant AND community_id=ctx.o_community AND target_type='message' AND target_id=r.target_id AND status='open';
    GET DIAGNOSTICS v_closed=ROW_COUNT;
    PERFORM public.community_moderation_log(ctx.o_tenant,ctx.o_community,CASE WHEN p_decision='remove' THEN 'report_remove' ELSE 'report_dismiss' END,'message',r.target_id,v_subject,jsonb_build_object('reports',v_closed));
    PERFORM public.community_chat_bump(ctx.o_tenant,ctx.o_community);
    RETURN public.community_forum_done('ok',p_report_id);
  END IF;
  IF p_decision = 'remove' AND r.target_type = 'member' THEN RETURN public.community_forum_done('invalid'); END IF;
  IF r.target_type = 'post' THEN
    SELECT author_id INTO v_subject FROM public.community_posts WHERE tenant_id = ctx.o_tenant AND id::text = r.target_id;
  ELSIF r.target_type = 'comment' THEN
    SELECT author_id INTO v_subject FROM public.community_comments WHERE tenant_id = ctx.o_tenant AND id::text = r.target_id;
  ELSE v_subject := r.target_id;
  END IF;
  IF v_subject = actor THEN RETURN public.community_forum_done('forbidden'); END IF;
  v_actor_rank := public.community_member_rank(ctx.o_tenant, ctx.o_community, actor);
  IF p_decision = 'remove' AND v_subject IS NOT NULL AND public.community_member_rank(ctx.o_tenant, ctx.o_community, v_subject) >= v_actor_rank THEN
    RETURN public.community_forum_done('forbidden');
  END IF;
  IF p_decision = 'remove' AND r.target_type = 'post' THEN
    UPDATE public.community_posts SET removed_at = now(), removed_by = actor, updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id::text = r.target_id AND removed_at IS NULL;
  ELSIF p_decision = 'remove' THEN
    UPDATE public.community_comments SET removed_at = now(), removed_by = actor, updated_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id::text = r.target_id AND removed_at IS NULL;
  END IF;
  UPDATE public.community_reports SET status = CASE WHEN p_decision = 'remove' THEN 'actioned' ELSE 'dismissed' END, decided_by = actor, decided_at = now()
    WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND target_type = r.target_type AND target_id = r.target_id AND status = 'open';
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  PERFORM public.community_moderation_log(ctx.o_tenant, ctx.o_community, CASE WHEN p_decision = 'remove' THEN 'report_remove' ELSE 'report_dismiss' END,
    r.target_type, r.target_id, v_subject, jsonb_build_object('reports', v_closed));
  RETURN public.community_forum_done('ok', p_report_id);
END $$;
REVOKE ALL ON FUNCTION public.community_report_decide_forum(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_report_decide_forum(text,uuid,text) TO harvest_app;

CREATE OR REPLACE FUNCTION public.community_report_decide(p_slug text, p_report_id uuid, p_decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ctx record;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NOT NULL AND EXISTS(SELECT 1 FROM public.community_reports
    WHERE id = p_report_id AND tenant_id = ctx.tenant AND community_id = ctx.community AND target_type = 'dm_message') THEN
    RETURN public.community_dm_decide(p_slug, p_report_id, p_decision);
  END IF;
  PERFORM public.community_definer_reset();
  RETURN public.community_report_decide_forum(p_slug, p_report_id, p_decision);
END $$;
REVOKE ALL ON FUNCTION public.community_report_decide(text,uuid,text) FROM PUBLIC;

--> statement-breakpoint
CREATE FUNCTION public.community_notifications_list(p_slug text, p_limit integer, p_include_dm boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; m record; v_since timestamptz; v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  forum_access boolean;
  v_announce boolean; v_items jsonb; v_unread integer;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  forum_access:=ctx.o_tenant IS NOT NULL;
  IF NOT forum_access THEN
    SELECT tenant AS o_tenant,community AS o_community,role AS o_role INTO ctx FROM public.community_chat_actor(p_slug);
    IF NOT p_include_dm OR ctx.o_tenant IS NULL OR NOT coalesce(public.community_chat_can(ctx.o_role,'chat:manage_channels'),false) THEN
      RETURN public.community_forum_done('not_found');
    END IF;
  END IF;
  SELECT * INTO m FROM public.community_memberships WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = actor;
  v_since := coalesce(m.notifications_seen_at, m.joined_at, m.created_at);
  v_announce := m.notify_announcements AND NOT m.notifications_muted;
  WITH n AS (
    SELECT jsonb_build_object('id', x.id, 'kind', x.kind, 'targetType', x.target_type, 'postId', x.post_id, 'actorName', u.name, 'count', x.actor_count,
        'detail', x.detail, 'read', x.read_at IS NOT NULL, 'createdAt', x.updated_at) AS j, x.updated_at AS at
      FROM public.community_notifications x LEFT JOIN public.users u ON u.id = x.actor_id
      WHERE x.tenant_id = ctx.o_tenant AND x.community_id = ctx.o_community AND x.recipient_id = actor AND (forum_access OR x.kind IN ('dm','host_queue')) AND (CASE WHEN x.kind IN ('chat_mention','chat_reply') THEN (public.community_chat_user_can_read(x.tenant_id,x.community_id,x.target_id::uuid,actor) AND NOT EXISTS(SELECT 1 FROM public.community_channel_reads cr WHERE cr.channel_id=x.target_id::uuid AND cr.user_id=actor AND cr.mute='all')) WHEN x.kind = 'dm' THEN p_include_dm AND x.target_type = 'dm_conversation' AND public.community_dm_notice_allowed(x.tenant_id,x.community_id,x.target_id,x.actor_id) ELSE true END)
      ORDER BY x.updated_at DESC, x.id LIMIT v_limit),
  a AS (
    SELECT jsonb_build_object('id', 'announcement-' || p.id::text, 'kind', 'announcement', 'targetType', 'post', 'postId', p.id, 'actorName', u.name, 'count', 1,
        'detail', '{}'::jsonb, 'read', false, 'createdAt', p.created_at) AS j, p.created_at AS at
      FROM public.community_posts p JOIN public.community_categories c ON c.id = p.category_id LEFT JOIN public.users u ON u.id = p.author_id
      WHERE v_announce AND p.tenant_id = ctx.o_tenant AND p.community_id = ctx.o_community AND p.removed_at IS NULL AND p.held_at IS NULL
        AND (c.hosts_only OR p.pinned) AND p.created_at > v_since AND p.author_id IS DISTINCT FROM actor
      ORDER BY p.created_at DESC, p.id LIMIT 20)
  SELECT (SELECT coalesce(jsonb_agg(s.j ORDER BY s.at DESC), '[]'::jsonb) FROM (SELECT * FROM n UNION ALL SELECT * FROM a) s),
    (SELECT count(*)::int FROM a) + (SELECT count(*)::int FROM public.community_notifications y WHERE y.tenant_id = ctx.o_tenant AND y.community_id = ctx.o_community
      AND y.recipient_id = actor AND y.read_at IS NULL AND (forum_access OR y.kind IN ('dm','host_queue'))
      AND (y.kind <> 'dm' OR (p_include_dm AND y.target_type = 'dm_conversation' AND public.community_dm_notice_allowed(y.tenant_id,y.community_id,y.target_id,y.actor_id))))
    INTO v_items, v_unread;
  PERFORM public.community_definer_reset();
  RETURN jsonb_build_object('outcome', 'ok', 'items', v_items, 'unread', v_unread);
END $$;
REVOKE ALL ON FUNCTION public.community_notifications_list(text,integer,boolean) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.community_notifications_read(p_slug text, p_ids uuid[], p_include_dm boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; forum_access boolean;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  forum_access:=ctx.o_tenant IS NOT NULL;
  IF NOT forum_access THEN
    SELECT tenant AS o_tenant,community AS o_community,role AS o_role INTO ctx FROM public.community_chat_actor(p_slug);
    IF NOT p_include_dm OR ctx.o_tenant IS NULL OR NOT coalesce(public.community_chat_can(ctx.o_role,'chat:manage_channels'),false) THEN
      RETURN public.community_forum_done('not_found');
    END IF;
  END IF;
  IF p_ids IS NOT NULL AND cardinality(p_ids) > 100 THEN RETURN public.community_forum_done('invalid'); END IF;
  IF p_ids IS NULL THEN
    UPDATE public.community_notifications SET read_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND recipient_id = actor AND read_at IS NULL AND (forum_access OR kind IN ('dm','host_queue'));
  ELSIF cardinality(p_ids) > 0 THEN
    UPDATE public.community_notifications SET read_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND recipient_id = actor AND read_at IS NULL AND (forum_access OR kind IN ('dm','host_queue')) AND id = ANY (p_ids);
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    -- Not updated_at: a ban or an unmute is detected from it.
    UPDATE public.community_memberships SET notifications_seen_at = now()
      WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = actor;
  END IF;
  RETURN public.community_forum_done('ok');
END $$;
REVOKE ALL ON FUNCTION public.community_notifications_read(text,uuid[],boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_notifications_read(text,uuid[],boolean) TO harvest_app;
GRANT EXECUTE ON FUNCTION public.community_notifications_list(text,integer,boolean) TO harvest_app;

CREATE OR REPLACE FUNCTION public.community_notifications_list(p_slug text, p_limit integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_notifications_list(p_slug, p_limit, false)
$$;
REVOKE ALL ON FUNCTION public.community_notifications_list(text,integer) FROM PUBLIC;

--> statement-breakpoint
-- The DM HTTP route can only decide DMs. The C12 route calls the forum/channel-only entry point.
CREATE FUNCTION public.community_dm_report_decide(p_slug text, p_report uuid, p_decision text, p_moderation jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.community_dm_decide(p_slug, p_report, p_decision, p_moderation)
$$;
REVOKE ALL ON FUNCTION public.community_dm_report_decide(text,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_dm_report_decide(text,uuid,text,jsonb) TO harvest_app;
