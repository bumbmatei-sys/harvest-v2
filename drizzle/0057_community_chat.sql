CREATE TABLE "community_channel_members" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_channel_members_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_channel_reads" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"mute" text DEFAULT 'none' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_channel_reads_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id"),
	CONSTRAINT "community_channel_mute" CHECK ("community_channel_reads"."mute" in ('none','mentions_only','all'))
);
--> statement-breakpoint
CREATE TABLE "community_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"posting" text DEFAULT 'members' NOT NULL,
	"access_mode" text DEFAULT 'all' NOT NULL,
	"min_role" text DEFAULT 'member' NOT NULL,
	"slow_mode_seconds" integer DEFAULT 0 NOT NULL,
	"last_rev" bigint DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_channels_scope" UNIQUE("tenant_id","community_id","id"),
	CONSTRAINT "community_channel_name" CHECK (length(trim("community_channels"."name")) between 1 and 60),
	CONSTRAINT "community_channel_emoji" CHECK ("community_channels"."emoji" is null or length("community_channels"."emoji") <= 16),
	CONSTRAINT "community_channel_description" CHECK ("community_channels"."description" is null or length("community_channels"."description") <= 200),
	CONSTRAINT "community_channel_posting" CHECK ("community_channels"."posting" in ('members','hosts')),
	CONSTRAINT "community_channel_access" CHECK ("community_channels"."access_mode" in ('all','role','invite','tier','tag')),
	CONSTRAINT "community_channel_role" CHECK ("community_channels"."min_role" in ('member','contributor','moderator','admin','owner')),
	CONSTRAINT "community_channel_slow" CHECK ("community_channels"."slow_mode_seconds" between 0 and 3600)
);
--> statement-breakpoint
CREATE TABLE "community_chat_purge_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"deleted" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"failure_code" text,
	CONSTRAINT "community_chat_purge_status" CHECK ("community_chat_purge_runs"."status" in ('ok','failed'))
);
--> statement-breakpoint
CREATE TABLE "community_chat_state" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"rev" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "community_chat_state_tenant_id_community_id_pk" PRIMARY KEY("tenant_id","community_id")
);
--> statement-breakpoint
CREATE TABLE "community_message_reactions" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji"),
	CONSTRAINT "community_reaction_emoji" CHECK ("community_message_reactions"."emoji" in ('👍','❤️','🙏','😊','🎉','👏','💡','🔥','😮','😢','✅','🙌'))
);
--> statement-breakpoint
CREATE TABLE "community_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"author_id" text,
	"parent_id" uuid,
	"client_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mention_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"seq" bigint NOT NULL,
	"rev" bigint NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"edited_at" timestamp with time zone,
	"pinned_at" timestamp with time zone,
	"pinned_by" text,
	"held_at" timestamp with time zone,
	"held_reason" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_kind" text,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_messages_scope" UNIQUE("tenant_id","community_id","channel_id","id"),
	CONSTRAINT "community_message_body" CHECK (length(trim("community_messages"."body")) between 1 and 2000),
	CONSTRAINT "community_message_mentions" CHECK (cardinality("community_messages"."mention_ids") <= 10),
	CONSTRAINT "community_message_deleted_kind" CHECK ("community_messages"."deleted_kind" is null or "community_messages"."deleted_kind" in ('author','host'))
);
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "chat_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "dm_policy" text DEFAULT 'channels_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "dm_accept_members" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "chat_state_rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "community_channel_members" ADD CONSTRAINT "community_channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_channel_members" ADD CONSTRAINT "community_channel_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_channel_members" ADD CONSTRAINT "community_channel_members_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_channel_members" ADD CONSTRAINT "community_channel_members_tenant_id_community_id_channel_id_community_channels_tenant_id_community_id_id_fk" FOREIGN KEY ("tenant_id","community_id","channel_id") REFERENCES "public"."community_channels"("tenant_id","community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_channel_reads" ADD CONSTRAINT "community_channel_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_channel_reads" ADD CONSTRAINT "community_channel_reads_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_channel_reads" ADD CONSTRAINT "community_channel_reads_tenant_id_community_id_channel_id_community_channels_tenant_id_community_id_id_fk" FOREIGN KEY ("tenant_id","community_id","channel_id") REFERENCES "public"."community_channels"("tenant_id","community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_channels" ADD CONSTRAINT "community_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_channels" ADD CONSTRAINT "community_channels_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_chat_state" ADD CONSTRAINT "community_chat_state_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_message_reactions" ADD CONSTRAINT "community_message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_message_reactions" ADD CONSTRAINT "community_message_reactions_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_message_reactions" ADD CONSTRAINT "community_message_reactions_tenant_id_community_id_channel_id_message_id_community_messages_tenant_id_community_id_channel_id_id_fk" FOREIGN KEY ("tenant_id","community_id","channel_id","message_id") REFERENCES "public"."community_messages"("tenant_id","community_id","channel_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_tenant_id_community_id_channel_id_community_channels_tenant_id_community_id_id_fk" FOREIGN KEY ("tenant_id","community_id","channel_id") REFERENCES "public"."community_channels"("tenant_id","community_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_messages" ADD CONSTRAINT "community_messages_tenant_id_community_id_channel_id_parent_id_community_messages_tenant_id_community_id_channel_id_id_fk" FOREIGN KEY ("tenant_id","community_id","channel_id","parent_id") REFERENCES "public"."community_messages"("tenant_id","community_id","channel_id","id") ON DELETE SET NULL ("parent_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_channels_order_idx" ON "community_channels" USING btree ("community_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "community_messages_client_idx" ON "community_messages" USING btree ("author_id","client_id");--> statement-breakpoint
CREATE INDEX "community_messages_seq_idx" ON "community_messages" USING btree ("channel_id","seq");--> statement-breakpoint
CREATE INDEX "community_messages_rev_idx" ON "community_messages" USING btree ("channel_id","rev");--> statement-breakpoint
CREATE INDEX "community_messages_thread_idx" ON "community_messages" USING btree ("parent_id","seq");--> statement-breakpoint
CREATE INDEX "community_messages_author_idx" ON "community_messages" USING btree ("community_id","author_id","created_at");--> statement-breakpoint
CREATE INDEX "community_messages_purge_idx" ON "community_messages" USING btree ("purge_after") WHERE "community_messages"."deleted_at" is not null;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_dm_policy" CHECK ("communities"."dm_policy" in ('channels_only','members'));
--> statement-breakpoint
-- C11a. No application table writes. Scoped owner policies also work for a NOCREATEROLE migration owner.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['community_channels','community_channel_members','community_messages','community_message_reactions','community_channel_reads','community_chat_state','community_chat_purge_runs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,harvest_app',t);
  IF t <> 'community_chat_purge_runs' THEN
   EXECUTE format('GRANT SELECT ON public.%I TO harvest_app',t);
   EXECUTE format($p$CREATE POLICY chat_owner ON public.%I TO %I USING (tenant_id=nullif(current_setting('app.community_definer_tenant',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.community_definer_tenant',true),'')::uuid)$p$,t,current_user);
  END IF;
 END LOOP;
 EXECUTE format($p$CREATE POLICY chat_run_owner ON public.community_chat_purge_runs TO %I USING (current_setting('app.chat_purge',true)='on') WITH CHECK (current_setting('app.chat_purge',true)='on')$p$,current_user);
 EXECUTE format($p$CREATE POLICY chat_purge_owner ON public.community_messages TO %I USING (current_setting('app.chat_purge',true)='on')$p$,current_user);
 EXECUTE format($p$CREATE POLICY chat_purge_owner ON public.community_message_reactions TO %I USING (current_setting('app.chat_purge',true)='on')$p$,current_user);
 EXECUTE format($p$CREATE POLICY chat_purge_reports ON public.community_reports FOR SELECT TO %I USING (current_setting('app.chat_purge',true)='on')$p$,current_user);
 EXECUTE format($p$CREATE POLICY chat_backfill ON public.communities FOR SELECT TO %I USING (true)$p$,current_user);
END $$;
--> statement-breakpoint
-- Initialize new and existing communities without locking the wide community row during message writes.
CREATE FUNCTION public.community_chat_initialize() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text:=current_setting('app.community_definer_tenant',true);
BEGIN
 PERFORM set_config('app.community_definer_tenant',NEW.tenant_id::text,true);
 INSERT INTO public.community_chat_state(tenant_id,community_id) VALUES(NEW.tenant_id,NEW.id);
 INSERT INTO public.community_channels(tenant_id,community_id,name,created_by) VALUES(NEW.tenant_id,NEW.id,'General',NEW.created_by);
 PERFORM set_config('app.community_definer_tenant',coalesce(previous,''),true); RETURN NEW;
END $$;
CREATE TRIGGER community_chat_initialize AFTER INSERT ON public.communities FOR EACH ROW EXECUTE FUNCTION public.community_chat_initialize();
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT * FROM public.communities LOOP
  PERFORM set_config('app.community_definer_tenant',c.tenant_id::text,true);
  INSERT INTO public.community_chat_state(tenant_id,community_id) VALUES(c.tenant_id,c.id);
  INSERT INTO public.community_channels(tenant_id,community_id,name,created_by) VALUES(c.tenant_id,c.id,'General',c.created_by);
 END LOOP;
 PERFORM public.community_definer_reset();
END $$;
DROP POLICY chat_backfill ON public.communities;
--> statement-breakpoint
-- Invoker helpers below run only within a scoped definer, except chat_rank (pure).
CREATE FUNCTION public.community_chat_rank(p_role text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE p_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'moderator' THEN 2 WHEN 'contributor' THEN 1 ELSE 0 END
$$;
CREATE FUNCTION public.community_chat_can(p_role text,p_capability text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE p_capability WHEN 'chat:read' THEN p_role IN ('owner','admin','moderator','contributor','member')
 WHEN 'chat:post' THEN p_role IN ('owner','admin','moderator','contributor','member')
 WHEN 'chat:manage_channels' THEN p_role IN ('owner','admin') WHEN 'chat:restore' THEN p_role IN ('owner','admin')
 WHEN 'chat:moderate' THEN p_role IN ('owner','admin','moderator') ELSE false END
$$;
CREATE FUNCTION public.community_chat_role(p_tenant uuid,p_community uuid,p_user text) RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE r text; st text;
BEGIN
 SELECT role,status INTO r,st FROM public.community_memberships WHERE tenant_id=p_tenant AND community_id=p_community AND user_id=p_user;
 IF st IN ('banned','removed','left','pending') THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=p_user AND role_id IN ('owner','admin')) THEN
  SELECT role_id INTO r FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=p_user; RETURN r;
 END IF;
 IF st='active' AND public.community_user_can_read(p_tenant,p_community,p_user) THEN RETURN r; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION public.community_chat_user_can_read(p_tenant uuid,p_community uuid,p_channel uuid,p_user text) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE c record; r text;
BEGIN
 r:=public.community_chat_role(p_tenant,p_community,p_user);
 IF r IS NULL THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.communities WHERE tenant_id=p_tenant AND id=p_community AND chat_enabled AND (status='published' OR coalesce(public.community_chat_can(r,'chat:manage_channels'),false))) THEN RETURN false; END IF;
 SELECT * INTO c FROM public.community_channels WHERE tenant_id=p_tenant AND community_id=p_community AND id=p_channel;
 IF NOT FOUND THEN RETURN false; END IF;
 IF public.community_chat_rank(r)>=2 THEN RETURN true; END IF;
 RETURN c.archived_at IS NULL AND (c.access_mode='all' OR (c.access_mode='role' AND public.community_chat_rank(r)>=public.community_chat_rank(c.min_role))
 OR (c.access_mode='invite' AND EXISTS(SELECT 1 FROM public.community_channel_members WHERE channel_id=p_channel AND user_id=p_user)));
END $$;
-- Set-based readability for one caller whose role is already known: one query for every channel of a community.
CREATE FUNCTION public.community_chat_readable_channels(p_tenant uuid,p_community uuid,p_user text,p_role text) RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT c.id FROM public.community_channels c
 WHERE p_role IS NOT NULL AND c.tenant_id=p_tenant AND c.community_id=p_community
 AND EXISTS(SELECT 1 FROM public.communities k WHERE k.tenant_id=p_tenant AND k.id=p_community AND k.chat_enabled AND (k.status='published' OR coalesce(public.community_chat_can(p_role,'chat:manage_channels'),false)))
 AND (public.community_chat_rank(p_role)>=2 OR (c.archived_at IS NULL AND (c.access_mode='all' OR (c.access_mode='role' AND public.community_chat_rank(p_role)>=public.community_chat_rank(c.min_role))
 OR (c.access_mode='invite' AND EXISTS(SELECT 1 FROM public.community_channel_members cm WHERE cm.channel_id=c.id AND cm.user_id=p_user)))))
$$;
-- Public read predicate safely scopes its owner access, then restores the enclosing definer's context.
CREATE FUNCTION public.community_channel_can_read(p_tenant uuid,p_community uuid,p_channel uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text:=current_setting('app.community_definer_tenant',true); ok boolean;
BEGIN
 PERFORM set_config('app.community_definer_tenant',p_tenant::text,true);
 SELECT c.chat_enabled AND c.status='published' AND public.community_chat_user_can_read(p_tenant,p_community,p_channel,nullif(current_setting('app.user_id',true),'')) INTO ok
 FROM public.communities c WHERE tenant_id=p_tenant AND id=p_community;
 PERFORM set_config('app.community_definer_tenant',coalesce(previous,''),true); RETURN coalesce(ok,false);
END $$;
CREATE FUNCTION public.community_chat_actor(p_slug text,OUT tenant uuid,OUT community uuid,OUT role text) RETURNS record LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM set_config('app.community_resolve_slug',coalesce(p_slug,''),true);
 SELECT c.tenant_id,c.id INTO tenant,community FROM public.communities c WHERE c.slug=p_slug AND c.chat_enabled;
 IF tenant IS NULL THEN RETURN; END IF;
 PERFORM set_config('app.community_definer_tenant',tenant::text,true);
 role:=public.community_chat_role(tenant,community,nullif(current_setting('app.user_id',true),''));
 IF role IS NULL OR NOT EXISTS(SELECT 1 FROM public.communities c WHERE c.id=community AND c.tenant_id=tenant AND (c.status='published' OR public.community_chat_rank(role)>=3)) THEN tenant:=NULL; END IF;
END $$;
CREATE FUNCTION public.community_chat_done(p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM public.community_definer_reset(); RETURN p_result; END $$;
CREATE FUNCTION public.community_chat_bump(p_tenant uuid,p_community uuid) RETURNS void LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
 UPDATE public.community_chat_state SET rev=rev+1 WHERE tenant_id=p_tenant AND community_id=p_community
$$;
-- Authorization lock is taken AFTER channel locks; community state is always last.
CREATE FUNCTION public.community_chat_lock_members(p_tenant uuid,p_community uuid,p_users text[] DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM 1 FROM public.community_memberships WHERE tenant_id=p_tenant AND community_id=p_community AND user_id=ANY(coalesce(p_users,ARRAY[nullif(current_setting('app.user_id',true),'')])) ORDER BY user_id FOR UPDATE;
 PERFORM 1 FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'') FOR SHARE;
END $$;
-- Membership changes bump only the changed member, without acquiring a second row lock.
CREATE FUNCTION public.community_chat_membership_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (NEW.role,NEW.status,NEW.dm_accept_members) IS DISTINCT FROM (OLD.role,OLD.status,OLD.dm_accept_members) THEN NEW.chat_state_rev:=OLD.chat_state_rev+1; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER community_chat_membership_revision BEFORE UPDATE ON public.community_memberships FOR EACH ROW EXECUTE FUNCTION public.community_chat_membership_revision();
CREATE FUNCTION public.community_chat_grant_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text:=current_setting('app.community_definer_tenant',true);
BEGIN
 PERFORM set_config('app.community_definer_tenant',NEW.tenant_id::text,true);
 IF NEW.resource_type='community' THEN UPDATE public.community_memberships SET chat_state_rev=chat_state_rev+1 WHERE tenant_id=NEW.tenant_id AND community_id=NEW.resource_id AND user_id=NEW.user_id; END IF;
 PERFORM set_config('app.community_definer_tenant',coalesce(previous,''),true); RETURN NEW;
END $$;
CREATE TRIGGER community_chat_grant_revision AFTER INSERT OR UPDATE ON public.entitlements FOR EACH ROW EXECUTE FUNCTION public.community_chat_grant_revision();
--> statement-breakpoint
CREATE POLICY chat_channels_read ON public.community_channels FOR SELECT TO harvest_app USING (public.community_channel_can_read(tenant_id,community_id,id));
CREATE POLICY chat_messages_read ON public.community_messages FOR SELECT TO harvest_app USING (public.community_channel_can_read(tenant_id,community_id,channel_id)
 AND (deleted_at IS NULL OR public.community_is_host(tenant_id,community_id) OR public.community_live_can_manage(tenant_id,community_id)) AND (held_at IS NULL OR author_id=nullif(current_setting('app.user_id',true),'') OR public.community_is_host(tenant_id,community_id) OR public.community_live_can_manage(tenant_id,community_id)));
CREATE POLICY chat_reactions_read ON public.community_message_reactions FOR SELECT TO harvest_app USING (EXISTS(SELECT 1 FROM public.community_messages m WHERE m.id=message_id AND m.deleted_at IS NULL AND m.held_at IS NULL));
CREATE POLICY chat_reads_read ON public.community_channel_reads FOR SELECT TO harvest_app USING (user_id=nullif(current_setting('app.user_id',true),'') AND public.community_channel_can_read(tenant_id,community_id,channel_id));
CREATE POLICY chat_members_read ON public.community_channel_members FOR SELECT TO harvest_app USING (public.community_is_host(tenant_id,community_id) AND public.community_channel_can_read(tenant_id,community_id,channel_id));
-- ADR 0013 staff path. Services use the member-scoped definers, never this broad staff path.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['community_channels','community_channel_members','community_messages','community_message_reactions','community_channel_reads','community_chat_state'] LOOP
 EXECUTE format($p$CREATE POLICY chat_staff ON public.%I FOR SELECT TO harvest_app USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM public.workspace_members wm WHERE wm.tenant_id=%I.tenant_id AND wm.user_id=nullif(current_setting('app.user_id',true),'') AND wm.role_id IN ('owner','admin')))$p$,t,t);
 END LOOP;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_channel_save(p_slug text,p_channel uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; saved public.community_channels%ROWTYPE; v_id uuid:=coalesce(p_channel,gen_random_uuid());
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 PERFORM 1 FROM public.community_channels WHERE tenant_id=ctx.tenant AND community_id=ctx.community ORDER BY id FOR UPDATE; PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community);
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF; IF NOT coalesce(public.community_chat_can(ctx.role,'chat:manage_channels'),false) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF p_input->>'accessMode' IN ('tier','tag') THEN RETURN public.community_chat_done('{"outcome":"not_available"}'); END IF;
 -- Last shared lock, before the cap check: it also serializes creators when no channel rows exist.
 PERFORM 1 FROM public.community_chat_state WHERE tenant_id=ctx.tenant AND community_id=ctx.community FOR UPDATE;
 IF NOT coalesce((p_input->>'archived')::boolean,false) AND (p_channel IS NULL OR EXISTS(SELECT 1 FROM public.community_channels WHERE id=p_channel AND archived_at IS NOT NULL)) AND (SELECT count(*) FROM public.community_channels WHERE community_id=ctx.community AND archived_at IS NULL)>=30 THEN RETURN public.community_chat_done('{"outcome":"channel_limit"}'); END IF;
 IF p_channel IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.community_channels WHERE id=p_channel AND community_id=ctx.community AND tenant_id=ctx.tenant) THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 INSERT INTO public.community_channels(id,tenant_id,community_id,name,emoji,description,position,posting,access_mode,min_role,slow_mode_seconds,archived_at,created_by,last_rev)
 VALUES(v_id,ctx.tenant,ctx.community,trim(p_input->>'name'),p_input->>'emoji',p_input->>'description',coalesce((p_input->>'position')::int,0),coalesce(p_input->>'posting','members'),coalesce(p_input->>'accessMode','all'),coalesce(p_input->>'minRole','member'),coalesce((p_input->>'slowModeSeconds')::int,0),CASE WHEN (p_input->>'archived')::boolean THEN now() END,actor,1)
 ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,emoji=EXCLUDED.emoji,description=EXCLUDED.description,position=EXCLUDED.position,posting=EXCLUDED.posting,access_mode=EXCLUDED.access_mode,min_role=EXCLUDED.min_role,slow_mode_seconds=EXCLUDED.slow_mode_seconds,archived_at=EXCLUDED.archived_at,last_rev=community_channels.last_rev+1 RETURNING * INTO saved;
 INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata) VALUES(ctx.tenant,actor,'community.channel.save',v_id,jsonb_build_object('communityId',ctx.community));
 PERFORM public.community_chat_bump(ctx.tenant,ctx.community);
 RETURN public.community_chat_done(jsonb_build_object('outcome','ok','channel',to_jsonb(saved)));

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_channel_delete(p_slug text,p_channel uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; 
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 PERFORM 1 FROM public.community_channels WHERE tenant_id=ctx.tenant AND community_id=ctx.community ORDER BY id FOR UPDATE; PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community);
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF; IF NOT coalesce(public.community_chat_can(ctx.role,'chat:manage_channels'),false) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.community_channels WHERE id=p_channel AND community_id=ctx.community) THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 IF EXISTS(SELECT 1 FROM public.community_messages WHERE channel_id=p_channel) THEN UPDATE public.community_channels SET archived_at=now(),last_rev=last_rev+1 WHERE id=p_channel;
 ELSE DELETE FROM public.community_channels WHERE id=p_channel; END IF;
 PERFORM public.community_chat_bump(ctx.tenant,ctx.community);
 RETURN public.community_chat_done('{"outcome":"ok"}');

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_channel_reorder(p_slug text,p_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; 
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 PERFORM 1 FROM public.community_channels WHERE tenant_id=ctx.tenant AND community_id=ctx.community ORDER BY id FOR UPDATE; PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community);
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF; IF NOT coalesce(public.community_chat_can(ctx.role,'chat:manage_channels'),false) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF cardinality(p_ids)<>(SELECT count(DISTINCT id) FROM public.community_channels WHERE tenant_id=ctx.tenant AND community_id=ctx.community AND id=ANY(p_ids)) THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 UPDATE public.community_channels c SET position=u.n::int,last_rev=last_rev+1 FROM unnest(p_ids) WITH ORDINALITY u(id,n) WHERE c.id=u.id;
 PERFORM public.community_chat_bump(ctx.tenant,ctx.community); RETURN public.community_chat_done('{"outcome":"ok"}');

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_channel_members_set(p_slug text,p_channel uuid,p_users text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; changed text[];
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 PERFORM 1 FROM public.community_channels WHERE id=p_channel AND community_id=ctx.community FOR UPDATE;
 IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community,ARRAY(SELECT user_id FROM public.community_channel_members WHERE channel_id=p_channel UNION SELECT unnest(p_users) UNION SELECT actor));
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF; IF NOT coalesce(public.community_chat_can(ctx.role,'chat:manage_channels'),false) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF cardinality(p_users)>1000 OR EXISTS(SELECT 1 FROM unnest(p_users) u WHERE NOT EXISTS(SELECT 1 FROM public.community_memberships m WHERE m.community_id=ctx.community AND m.user_id=u AND m.status='active')) THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 SELECT array_agg(u) INTO changed FROM (SELECT user_id u FROM public.community_channel_members WHERE channel_id=p_channel UNION SELECT unnest(p_users)) all_users;
 DELETE FROM public.community_channel_members WHERE channel_id=p_channel;
 INSERT INTO public.community_channel_members(tenant_id,community_id,channel_id,user_id,added_by) SELECT ctx.tenant,ctx.community,p_channel,u,actor FROM (SELECT DISTINCT unnest(p_users) u) x;
 UPDATE public.community_memberships SET chat_state_rev=chat_state_rev+1 WHERE community_id=ctx.community AND user_id=ANY(changed);
 UPDATE public.community_channels SET last_rev=last_rev+1 WHERE id=p_channel;
 PERFORM public.community_chat_bump(ctx.tenant,ctx.community); RETURN public.community_chat_done('{"outcome":"ok"}');

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_chat_message_projection(p public.community_messages,p_host boolean) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',p.id,'channelId',p.channel_id,'authorId',p.author_id,'clientId',p.client_id,'parentId',p.parent_id,'seq',p.seq::text,'rev',p.rev::text,
 'authorName',(SELECT name FROM public.users WHERE id=p.author_id),'mentions',CASE WHEN p.deleted_at IS NOT NULL AND NOT p_host THEN '[]'::jsonb ELSE (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]'::jsonb) FROM public.users WHERE id=ANY(p.mention_ids)) END,
 'body',CASE WHEN p.deleted_at IS NOT NULL AND NOT p_host THEN NULL ELSE p.body END,'mentionIds',CASE WHEN p.deleted_at IS NOT NULL AND NOT p_host THEN ARRAY[]::text[] ELSE p.mention_ids END,
 'createdAt',p.created_at,'editedAt',p.edited_at,'deletedAt',p.deleted_at,'deletedKind',p.deleted_kind,'heldAt',p.held_at,'pinnedAt',p.pinned_at,'replyCount',p.reply_count,
 'reactions',CASE WHEN p.deleted_at IS NOT NULL OR p.held_at IS NOT NULL THEN '[]'::jsonb ELSE
 (SELECT coalesce(jsonb_agg(jsonb_build_object('emoji',emoji,'count',n,'reactedByMe',mine)),'[]'::jsonb) FROM (SELECT emoji,count(*) n,coalesce(bool_or(user_id=nullif(current_setting('app.user_id',true),'')),false) mine FROM public.community_message_reactions WHERE message_id=p.id GROUP BY emoji) r) END)
$$;

--> statement-breakpoint
-- Called while the channel lock is held; hidden/deleted replies never inflate a visible root count.
CREATE FUNCTION public.community_chat_refresh_thread(p_root uuid,p_channel uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE total integer; v_rev bigint;
BEGIN
 IF p_root IS NULL THEN RETURN; END IF;
 SELECT count(*)::int INTO total FROM public.community_messages WHERE parent_id=p_root AND deleted_at IS NULL AND held_at IS NULL;
 IF EXISTS(SELECT 1 FROM public.community_messages WHERE id=p_root AND reply_count IS DISTINCT FROM total) THEN
 UPDATE public.community_channels SET last_rev=last_rev+1 WHERE id=p_channel RETURNING last_rev INTO v_rev;
 UPDATE public.community_messages SET reply_count=total,rev=v_rev WHERE id=p_root;
 END IF;
END $$;
CREATE FUNCTION public.community_message_send(p_slug text,p_channel uuid,p_parent uuid,p_body text,p_mentions text[],p_client uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; ch record; oldrow public.community_messages%ROWTYPE; saved public.community_messages%ROWTYPE; root uuid; mentions text[]; v_rev bigint; held boolean; conflict_constraint text;
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 PERFORM pg_advisory_xact_lock(hashtext(actor||ctx.community::text));
 SELECT * INTO ch FROM public.community_channels WHERE id=p_channel AND community_id=ctx.community FOR UPDATE;
 PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community);
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF; IF NOT public.community_chat_user_can_read(ctx.tenant,ctx.community,p_channel,actor) THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 IF ch.archived_at IS NOT NULL OR (ch.posting='hosts' AND NOT coalesce(public.community_chat_can(ctx.role,'chat:moderate'),false)) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=ctx.community AND user_id=actor AND muted_until>now()) THEN RETURN public.community_chat_done('{"outcome":"muted"}'); END IF;
 IF p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 2000 OR p_client IS NULL OR cardinality(p_mentions)>10 THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 root:=p_parent;
 IF root IS NOT NULL THEN
  SELECT coalesce(parent_id,id) INTO root FROM public.community_messages WHERE id=p_parent AND channel_id=p_channel AND deleted_at IS NULL AND (held_at IS NULL OR author_id=actor OR public.community_chat_rank(ctx.role)>=2);
  IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 END IF;
 SELECT * INTO oldrow FROM public.community_messages WHERE author_id=actor AND client_id=p_client;
 IF FOUND THEN
  IF oldrow.channel_id<>p_channel OR oldrow.body<>p_body OR oldrow.parent_id IS DISTINCT FROM root THEN RETURN public.community_chat_done('{"outcome":"client_id_conflict"}'); END IF;
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','message',public.community_chat_message_projection(oldrow,public.community_chat_rank(ctx.role)>=2)));
 END IF;
 IF (SELECT count(*) FROM public.community_messages WHERE community_id=ctx.community AND author_id=actor AND created_at>now()-interval '10 seconds')>=5
 THEN RETURN public.community_chat_done('{"outcome":"rate_limited","retryAfter":10}'); END IF;
 IF (SELECT count(*) FROM public.community_messages WHERE community_id=ctx.community AND author_id=actor AND created_at>now()-interval '10 minutes')>=60 THEN RETURN public.community_chat_done('{"outcome":"rate_limited","retryAfter":600}'); END IF;
 IF ch.slow_mode_seconds>0 AND NOT coalesce(public.community_chat_can(ctx.role,'chat:moderate'),false) AND EXISTS(SELECT 1 FROM public.community_messages WHERE channel_id=p_channel AND author_id=actor AND created_at>now()-make_interval(secs=>ch.slow_mode_seconds)) THEN RETURN public.community_chat_done(jsonb_build_object('outcome','rate_limited','retryAfter',ch.slow_mode_seconds)); END IF;
 SELECT coalesce(array_agg(DISTINCT u),'{}') INTO mentions FROM unnest(p_mentions) u WHERE EXISTS(SELECT 1 FROM public.community_memberships am WHERE am.tenant_id=ctx.tenant AND am.community_id=ctx.community AND am.user_id=u AND am.status='active') AND public.community_chat_user_can_read(ctx.tenant,ctx.community,p_channel,u);
 SELECT public.community_banned_word_match(p_body,c.banned_words) INTO held FROM public.communities c WHERE c.id=ctx.community AND c.tenant_id=ctx.tenant;
 UPDATE public.community_channels SET last_rev=last_rev+1,last_message_at=now() WHERE id=p_channel RETURNING last_rev INTO v_rev;
 INSERT INTO public.community_messages(tenant_id,community_id,channel_id,author_id,parent_id,client_id,body,mention_ids,seq,rev,held_at,held_reason)
 VALUES(ctx.tenant,ctx.community,p_channel,actor,root,p_client,p_body,mentions,v_rev,v_rev,CASE WHEN held THEN now() END,CASE WHEN held THEN 'banned_word' END) RETURNING * INTO saved;
 PERFORM public.community_chat_refresh_thread(root,p_channel);
 IF NOT held THEN PERFORM public.community_chat_notify(saved); ELSE PERFORM public.community_notify_hosts(ctx.tenant,ctx.community,NULL); END IF;
 PERFORM public.community_chat_bump(ctx.tenant,ctx.community);
 RETURN public.community_chat_done(jsonb_build_object('outcome','ok','message',public.community_chat_message_projection(saved,public.community_chat_rank(ctx.role)>=2)));

EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS conflict_constraint=CONSTRAINT_NAME;
 IF conflict_constraint='community_messages_client_idx' THEN RETURN public.community_chat_done('{"outcome":"client_id_conflict"}'); END IF;
 PERFORM public.community_definer_reset(); RAISE;
 WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE INDEX community_chat_mutations_idx ON public.audit_logs(actor_id,action,created_at);

--> statement-breakpoint
CREATE FUNCTION public.community_message_edit(p_slug text,p_id uuid,p_body text,p_mentions text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; m public.community_messages%ROWTYPE; ch uuid; mentions text[]; v_rev bigint; held boolean;
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 SELECT channel_id INTO ch FROM public.community_messages WHERE id=p_id AND community_id=ctx.community;
 PERFORM pg_advisory_xact_lock(hashtext(actor||ctx.community::text));
 PERFORM 1 FROM public.community_channels WHERE id=ch FOR UPDATE; PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community);
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 IF NOT public.community_chat_user_can_read(ctx.tenant,ctx.community,ch,actor) THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 SELECT * INTO m FROM public.community_messages WHERE id=p_id AND channel_id=ch;
 IF m.author_id IS DISTINCT FROM actor OR m.deleted_at IS NOT NULL THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=ctx.community AND user_id=actor AND muted_until>now()) THEN RETURN public.community_chat_done('{"outcome":"muted"}'); END IF;
 IF p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 2000 OR cardinality(p_mentions)>10 THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 IF (SELECT count(*) FROM public.audit_logs WHERE tenant_id=ctx.tenant AND actor_id=actor AND action='community.chat.edit' AND created_at>now()-interval '1 minute')>=10 THEN RETURN public.community_chat_done('{"outcome":"rate_limited","retryAfter":60}'); END IF;
 SELECT coalesce(array_agg(DISTINCT u),'{}') INTO mentions FROM unnest(p_mentions) u WHERE EXISTS(SELECT 1 FROM public.community_memberships am WHERE am.tenant_id=ctx.tenant AND am.community_id=ctx.community AND am.user_id=u AND am.status='active') AND public.community_chat_user_can_read(ctx.tenant,ctx.community,ch,u);
 SELECT public.community_banned_word_match(p_body,c.banned_words) INTO held FROM public.communities c WHERE c.id=ctx.community AND c.tenant_id=ctx.tenant;
 UPDATE public.community_channels SET last_rev=last_rev+1 WHERE id=ch RETURNING last_rev INTO v_rev;
 UPDATE public.community_messages SET body=p_body,mention_ids=mentions,edited_at=now(),rev=v_rev,held_at=CASE WHEN held THEN now() END,held_reason=CASE WHEN held THEN 'banned_word' END WHERE id=p_id RETURNING * INTO m;
 INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id) VALUES(ctx.tenant,actor,'community.chat.edit',p_id);
 PERFORM public.community_chat_refresh_thread(m.parent_id,ch);
 PERFORM public.community_chat_bump(ctx.tenant,ctx.community);
 RETURN public.community_chat_done(jsonb_build_object('outcome','ok','message',public.community_chat_message_projection(m,public.community_chat_rank(ctx.role)>=2)));

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_message_delete(p_slug text,p_id uuid,p_restore boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; m public.community_messages%ROWTYPE; ch uuid; v_rev bigint;
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 SELECT channel_id INTO ch FROM public.community_messages WHERE id=p_id AND community_id=ctx.community;
 PERFORM 1 FROM public.community_channels WHERE id=ch FOR UPDATE; PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community);
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 IF NOT public.community_chat_user_can_read(ctx.tenant,ctx.community,ch,actor) THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 SELECT * INTO m FROM public.community_messages WHERE id=p_id AND channel_id=ch;
 IF m.author_id IS DISTINCT FROM actor OR (NOT p_restore AND m.deleted_kind='host') OR (p_restore AND (m.deleted_kind IS DISTINCT FROM 'author' OR m.purge_after<=now())) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 UPDATE public.community_channels SET last_rev=last_rev+1 WHERE id=ch RETURNING last_rev INTO v_rev;
 UPDATE public.community_messages SET pinned_at=NULL,pinned_by=NULL,deleted_at=CASE WHEN p_restore THEN NULL ELSE coalesce(deleted_at,now()) END,deleted_by=CASE WHEN p_restore THEN NULL ELSE actor END,deleted_kind=CASE WHEN p_restore THEN NULL ELSE 'author' END,purge_after=CASE WHEN p_restore THEN NULL ELSE coalesce(purge_after,now()+interval '30 days') END,rev=v_rev WHERE id=p_id;
 PERFORM public.community_chat_refresh_thread(m.parent_id,ch);
 PERFORM public.community_chat_bump(ctx.tenant,ctx.community); RETURN public.community_chat_done('{"outcome":"ok"}');

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_message_moderate(p_slug text,p_id uuid,p_action text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; m public.community_messages%ROWTYPE; ch uuid; v_rev bigint; target_role text;
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 SELECT channel_id INTO ch FROM public.community_messages WHERE id=p_id AND community_id=ctx.community;
 PERFORM 1 FROM public.community_channels WHERE id=ch FOR UPDATE; PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community);
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 SELECT * INTO m FROM public.community_messages WHERE id=p_id AND channel_id=ch;
 IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 IF NOT coalesce(public.community_chat_can(ctx.role,'chat:moderate'),false) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 target_role:=public.community_chat_role(ctx.tenant,ctx.community,m.author_id);
 IF p_action IN ('approve','reject') AND m.author_id=actor THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF p_action IN ('remove','reject') AND (m.author_id=actor OR public.community_chat_rank(ctx.role)<=public.community_chat_rank(target_role)) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF p_action IN ('pin','unpin') AND m.author_id IS DISTINCT FROM actor AND public.community_chat_rank(target_role)>=public.community_chat_rank(ctx.role) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF p_action IN ('approve','reject') AND m.held_at IS NULL THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 IF p_action='restore' AND (NOT coalesce(public.community_chat_can(ctx.role,'chat:manage_channels'),false) OR m.deleted_at IS NULL OR m.deleted_kind IS DISTINCT FROM 'host' OR m.purge_after<=now()) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF p_action NOT IN ('pin','unpin','remove','restore','approve','reject') THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 IF p_action='pin' AND (m.deleted_at IS NOT NULL OR m.held_at IS NOT NULL OR (m.pinned_at IS NULL AND (SELECT count(*) FROM public.community_messages WHERE channel_id=ch AND pinned_at IS NOT NULL)>=5)) THEN RETURN public.community_chat_done('{"outcome":"pin_limit"}'); END IF;
 UPDATE public.community_channels SET last_rev=last_rev+1 WHERE id=ch RETURNING last_rev INTO v_rev;
 UPDATE public.community_messages SET rev=v_rev,
 pinned_at=CASE WHEN p_action='pin' THEN now() WHEN p_action IN ('unpin','remove','reject') THEN NULL ELSE pinned_at END,pinned_by=CASE WHEN p_action='pin' THEN actor WHEN p_action IN ('unpin','remove','reject') THEN NULL ELSE pinned_by END,
 deleted_at=CASE WHEN p_action IN ('remove','reject') THEN coalesce(deleted_at,now()) WHEN p_action='restore' THEN NULL ELSE deleted_at END,
 deleted_by=CASE WHEN p_action IN ('remove','reject') THEN actor WHEN p_action='restore' THEN NULL ELSE deleted_by END,
 deleted_kind=CASE WHEN p_action IN ('remove','reject') THEN 'host' WHEN p_action='restore' THEN NULL ELSE deleted_kind END,
 purge_after=CASE WHEN p_action IN ('remove','reject') THEN coalesce(purge_after,now()+interval '30 days') WHEN p_action='restore' THEN NULL ELSE purge_after END,
 held_at=CASE WHEN p_action='approve' THEN NULL ELSE held_at END,held_reason=CASE WHEN p_action='approve' THEN NULL ELSE held_reason END WHERE id=p_id RETURNING * INTO m;
 INSERT INTO public.community_moderation_actions(tenant_id,community_id,actor_id,action,target_type,target_id,subject_user_id)
 VALUES(ctx.tenant,ctx.community,actor,CASE p_action WHEN 'approve' THEN 'held_approve' WHEN 'reject' THEN 'held_reject' ELSE 'message_'||p_action END,'message',p_id::text,m.author_id);
 IF p_action='approve' THEN PERFORM public.community_chat_notify(m); END IF;
 PERFORM public.community_chat_refresh_thread(m.parent_id,ch);
 PERFORM public.community_chat_bump(ctx.tenant,ctx.community); RETURN public.community_chat_done('{"outcome":"ok"}');

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_reaction_toggle(p_slug text,p_id uuid,p_emoji text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; m record; ch uuid; v_rev bigint;
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 SELECT channel_id INTO ch FROM public.community_messages WHERE id=p_id AND community_id=ctx.community;
 PERFORM pg_advisory_xact_lock(hashtext(actor||ctx.community::text));
 PERFORM 1 FROM public.community_channels WHERE id=ch FOR UPDATE; PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community);
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 IF NOT public.community_chat_user_can_read(ctx.tenant,ctx.community,ch,actor) THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 IF EXISTS(SELECT 1 FROM public.community_channels WHERE id=ch AND (archived_at IS NOT NULL OR (posting='hosts' AND NOT coalesce(public.community_chat_can(ctx.role,'chat:moderate'),false)))) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 SELECT * INTO m FROM public.community_messages WHERE id=p_id AND deleted_at IS NULL AND held_at IS NULL;
 IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 IF p_emoji IS NULL OR p_emoji NOT IN ('👍','❤️','🙏','😊','🎉','👏','💡','🔥','😮','😢','✅','🙌') THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 IF EXISTS(SELECT 1 FROM public.community_memberships WHERE community_id=ctx.community AND user_id=actor AND muted_until>now()) THEN RETURN public.community_chat_done('{"outcome":"muted"}'); END IF;
 IF (SELECT count(*) FROM public.audit_logs WHERE tenant_id=ctx.tenant AND actor_id=actor AND action='community.chat.react' AND created_at>now()-interval '1 minute')>=30 THEN RETURN public.community_chat_done('{"outcome":"rate_limited","retryAfter":60}'); END IF;
 DELETE FROM public.community_message_reactions WHERE message_id=p_id AND user_id=actor AND emoji=p_emoji;
 IF NOT FOUND THEN INSERT INTO public.community_message_reactions(tenant_id,community_id,channel_id,message_id,user_id,emoji) VALUES(ctx.tenant,ctx.community,ch,p_id,actor,p_emoji); END IF;
 UPDATE public.community_channels SET last_rev=last_rev+1 WHERE id=ch RETURNING last_rev INTO v_rev;
 UPDATE public.community_messages SET rev=v_rev WHERE id=p_id;
 INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id) VALUES(ctx.tenant,actor,'community.chat.react',p_id);
 PERFORM public.community_chat_bump(ctx.tenant,ctx.community); RETURN public.community_chat_done('{"outcome":"ok"}');

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_channel_read(p_slug text,p_channel uuid,p_up_to bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; 
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 PERFORM 1 FROM public.community_channels WHERE id=p_channel AND community_id=ctx.community FOR UPDATE; PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community);
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF; IF NOT public.community_chat_user_can_read(ctx.tenant,ctx.community,p_channel,actor) THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF; IF p_up_to IS NULL OR p_up_to<0 THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 INSERT INTO public.community_channel_reads(tenant_id,community_id,channel_id,user_id,last_read_seq) VALUES(ctx.tenant,ctx.community,p_channel,actor,greatest(0,least(p_up_to,coalesce((SELECT max(seq) FROM public.community_messages WHERE channel_id=p_channel),0))))
 ON CONFLICT(channel_id,user_id) DO UPDATE SET last_read_seq=greatest(community_channel_reads.last_read_seq,EXCLUDED.last_read_seq),updated_at=now();
 UPDATE public.community_memberships SET chat_state_rev=chat_state_rev+1 WHERE tenant_id=ctx.tenant AND community_id=ctx.community AND user_id=actor;
 RETURN public.community_chat_done('{"outcome":"ok"}');

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_channel_prefs_save(p_slug text,p_channel uuid,p_mute text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; 
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 PERFORM 1 FROM public.community_channels WHERE id=p_channel AND community_id=ctx.community FOR UPDATE; PERFORM public.community_chat_lock_members(ctx.tenant,ctx.community);
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF; IF NOT public.community_chat_user_can_read(ctx.tenant,ctx.community,p_channel,actor) THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF; IF p_mute IS NULL OR p_mute NOT IN ('none','mentions_only','all') THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 INSERT INTO public.community_channel_reads(tenant_id,community_id,channel_id,user_id,mute) VALUES(ctx.tenant,ctx.community,p_channel,actor,p_mute)
 ON CONFLICT(channel_id,user_id) DO UPDATE SET mute=EXCLUDED.mute,updated_at=now();
 UPDATE public.community_memberships SET chat_state_rev=chat_state_rev+1 WHERE tenant_id=ctx.tenant AND community_id=ctx.community AND user_id=actor;
 RETURN public.community_chat_done('{"outcome":"ok"}');

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_chat_messages(p_slug text,p_channel uuid,p_since bigint,p_before bigint,p_limit integer,p_etag text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; ch record; events jsonb; v_cursor bigint; has_more boolean; tag text;
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 IF NOT public.community_chat_user_can_read(ctx.tenant,ctx.community,p_channel,actor) THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 SELECT * INTO ch FROM public.community_channels WHERE id=p_channel;
 tag:='W/"'||p_channel::text||':'||ch.last_rev::text||'"';
 IF p_etag=tag AND p_before IS NULL AND (p_since IS NULL OR p_since>=ch.last_rev) THEN RETURN public.community_chat_done(jsonb_build_object('outcome','ok','notModified',true,'etag',tag)); END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_since<0 OR p_before<0 THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 WITH page AS (
 SELECT * FROM public.community_messages WHERE channel_id=p_channel AND (p_since IS NULL OR rev>p_since) AND (p_before IS NULL OR seq<p_before)
 AND (held_at IS NULL OR author_id=actor OR public.community_chat_rank(ctx.role)>=2)
 ORDER BY CASE WHEN p_since IS NOT NULL THEN rev END ASC,CASE WHEN p_since IS NULL THEN seq END DESC LIMIT p_limit+1),
 bounded AS (SELECT * FROM page LIMIT p_limit)
 SELECT coalesce(jsonb_agg(public.community_chat_message_projection(bounded,public.community_chat_rank(ctx.role)>=2) ORDER BY rev),'[]'::jsonb),coalesce(max(rev),p_since,0),(SELECT count(*)>p_limit FROM page)
 INTO events,v_cursor,has_more FROM bounded;
 RETURN public.community_chat_done(jsonb_build_object('outcome','ok','events',events,'cursor',CASE WHEN p_before IS NULL THEN v_cursor::text END,'hasMore',has_more,'etag',tag));

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_chat_state_read(p_slug text,p_detector_only boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); ctx record; channels jsonb; own_rev text;
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 
 SELECT chat_state_rev::text INTO own_rev FROM public.community_memberships WHERE tenant_id=ctx.tenant AND community_id=ctx.community AND user_id=actor;
 -- Ministry hosts need not have a community membership. Their own read rows supply a private detector fallback.
 IF own_rev IS NULL THEN
 SELECT md5(coalesce(string_agg(channel_id::text||':'||last_read_seq::text||':'||mute||':'||updated_at::text,',' ORDER BY channel_id),'')) INTO own_rev
 FROM public.community_channel_reads WHERE tenant_id=ctx.tenant AND community_id=ctx.community AND user_id=actor;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',ch.id,'latestRev',ch.last_rev::text,'name',ch.name,'emoji',ch.emoji,'description',ch.description,'posting',ch.posting,'accessMode',ch.access_mode,'position',ch.position,
 'mute',coalesce(r.mute,'none'),
 'unread',CASE WHEN p_detector_only OR r.mute='all' THEN 0 ELSE (SELECT count(*) FROM (SELECT 1 FROM public.community_messages m WHERE m.channel_id=ch.id AND m.seq>coalesce(r.last_read_seq,0) AND m.author_id IS DISTINCT FROM actor AND m.deleted_at IS NULL AND m.held_at IS NULL LIMIT 100) u) END,
 'mentions',CASE WHEN p_detector_only OR r.mute='all' THEN 0 ELSE (SELECT count(*) FROM (SELECT 1 FROM public.community_messages m WHERE m.channel_id=ch.id AND m.seq>coalesce(r.last_read_seq,0) AND actor=ANY(m.mention_ids) AND m.author_id IS DISTINCT FROM actor AND m.deleted_at IS NULL AND m.held_at IS NULL LIMIT 100) u) END)
 ORDER BY ch.id),'[]'::jsonb) INTO channels FROM public.community_channels ch LEFT JOIN public.community_channel_reads r ON r.channel_id=ch.id AND r.user_id=actor
 WHERE ch.tenant_id=ctx.tenant AND ch.community_id=ctx.community AND ch.id IN (SELECT public.community_chat_readable_channels(ctx.tenant,ctx.community,actor,ctx.role));
 RETURN public.community_chat_done(jsonb_build_object('outcome','ok','channels',channels,'chatStateRev',coalesce(own_rev,'0')));

EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN RETURN public.community_chat_done('{"outcome":"invalid"}');
 WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;

--> statement-breakpoint
ALTER TABLE public.community_reports DROP CONSTRAINT community_report_target;
ALTER TABLE public.community_reports ADD CONSTRAINT community_report_target CHECK(target_type IN ('post','comment','member','message') AND length(target_id) BETWEEN 1 AND 200);
ALTER TABLE public.community_moderation_actions DROP CONSTRAINT community_moderation_action;
ALTER TABLE public.community_moderation_actions ADD CONSTRAINT community_moderation_action CHECK(action IN ('report_dismiss','report_remove','held_approve','held_reject','mute','unmute','ban','unban','warn','appeal_approve','appeal_decline','message_remove','message_restore','message_pin','message_unpin'));
ALTER TABLE public.community_moderation_actions DROP CONSTRAINT community_moderation_target;
ALTER TABLE public.community_moderation_actions ADD CONSTRAINT community_moderation_target CHECK(target_type IN ('post','comment','member','message'));
ALTER TABLE public.community_notifications DROP CONSTRAINT community_notification_kind;
ALTER TABLE public.community_notifications ADD CONSTRAINT community_notification_kind CHECK(kind IN ('reply','thread_reply','like','application','warning','held_decision','appeal_decision','host_queue','chat_mention','chat_reply','dm'));
ALTER TABLE public.community_notifications DROP CONSTRAINT community_notification_target;
ALTER TABLE public.community_notifications ADD CONSTRAINT community_notification_target CHECK(target_type IN ('post','comment','application','warning','appeal','community','message','dm_conversation','channel') AND length(target_id) BETWEEN 1 AND 200);
CREATE UNIQUE INDEX community_chat_notifications_group_idx ON public.community_notifications(recipient_id,community_id,kind,target_type,target_id) WHERE kind IN ('chat_mention','chat_reply','dm') AND read_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION public.community_chat_notify(p public.community_messages) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE recipient text; v_kind text;
BEGIN
 FOR recipient,v_kind IN
 SELECT u,'chat_mention' FROM unnest(p.mention_ids) u
 UNION SELECT author_id,'chat_reply' FROM public.community_messages WHERE (id=p.parent_id OR parent_id=p.parent_id) AND deleted_at IS NULL AND held_at IS NULL AND p.parent_id IS NOT NULL
 LOOP
 PERFORM public.community_notify_as(p.author_id,p.tenant_id,p.community_id,recipient,v_kind,'channel',p.channel_id::text,NULL,'{}'::jsonb);
 END LOOP;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_report(p_slug text, p_target_type text, p_target_id text, p_reason text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; v_owner text; v_found boolean := false; v_report uuid;
BEGIN
  IF p_target_type='message' THEN SELECT tenant AS o_tenant,community AS o_community,role AS o_role INTO ctx FROM public.community_chat_actor(p_slug); ELSE SELECT * INTO ctx FROM public.community_forum_actor(p_slug); END IF;
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  IF p_reason NOT IN ('spam', 'harassment', 'inappropriate', 'other') OR (p_note IS NOT NULL AND length(p_note) NOT BETWEEN 1 AND 500) THEN
    RETURN public.community_forum_done('invalid');
  END IF;
  IF p_target_type = 'post' THEN
    SELECT true, p.author_id INTO v_found, v_owner FROM public.community_posts p WHERE p.tenant_id = ctx.o_tenant AND p.community_id = ctx.o_community
      AND p.id::text = p_target_id AND p.removed_at IS NULL AND p.held_at IS NULL;
  ELSIF p_target_type = 'comment' THEN
    SELECT true, c.author_id INTO v_found, v_owner FROM public.community_comments c WHERE c.tenant_id = ctx.o_tenant AND c.community_id = ctx.o_community
      AND c.id::text = p_target_id AND c.removed_at IS NULL AND c.held_at IS NULL;
  ELSIF p_target_type = 'message' THEN
    IF NOT EXISTS(SELECT 1 FROM public.communities WHERE tenant_id=ctx.o_tenant AND id=ctx.o_community AND chat_enabled) THEN RETURN public.community_forum_done('not_found'); END IF;
    SELECT true,m.author_id INTO v_found,v_owner FROM public.community_messages m WHERE m.tenant_id=ctx.o_tenant AND m.community_id=ctx.o_community AND m.id::text=p_target_id AND m.deleted_at IS NULL AND m.held_at IS NULL
    AND public.community_chat_user_can_read(ctx.o_tenant,ctx.o_community,m.channel_id,actor);
  ELSIF p_target_type = 'member' THEN
    SELECT true, m.user_id INTO v_found, v_owner FROM public.community_memberships m WHERE m.tenant_id = ctx.o_tenant AND m.community_id = ctx.o_community
      AND m.user_id = p_target_id AND m.status = 'active';
  ELSE RETURN public.community_forum_done('invalid');
  END IF;
  IF NOT coalesce(v_found, false) THEN RETURN public.community_forum_done('not_found'); END IF;
  IF v_owner = actor THEN RETURN public.community_forum_done('forbidden'); END IF;
  INSERT INTO public.community_reports (tenant_id, community_id, reporter_id, target_type, target_id, reason, note)
    VALUES (ctx.o_tenant, ctx.o_community, actor, p_target_type, p_target_id, p_reason, p_note)
    ON CONFLICT (community_id, reporter_id, target_type, target_id) WHERE status = 'open' DO NOTHING RETURNING id INTO v_report;
  IF v_report IS NULL THEN RETURN public.community_forum_done('duplicate'); END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (ctx.o_tenant, actor, 'community.report', v_report::text);
  -- Hosts are told, except the person reported (or whose content was reported): they never see that queue item.
  PERFORM public.community_notify_hosts(ctx.o_tenant, ctx.o_community, v_owner);
  RETURN public.community_forum_done('ok', v_report);
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_report_decide(p_slug text, p_report_id uuid, p_decision text) RETURNS jsonb
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
  SELECT * INTO r FROM public.community_reports WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND id = p_report_id AND status = 'open';
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

--> statement-breakpoint
CREATE FUNCTION public.community_chat_purge_channels(p_batch integer DEFAULT 200) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE total integer;
BEGIN
 IF p_batch IS NULL OR p_batch NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid_batch' USING ERRCODE='22023'; END IF;
 PERFORM set_config('app.chat_purge','on',true);
 WITH expired AS (SELECT m.id FROM public.community_messages m WHERE purge_after<now()
 AND NOT EXISTS(SELECT 1 FROM public.community_reports r WHERE r.tenant_id=m.tenant_id AND r.community_id=m.community_id AND r.target_type='message' AND r.target_id=m.id::text AND r.status='open')
 ORDER BY purge_after,id LIMIT p_batch FOR UPDATE OF m SKIP LOCKED), removed AS (DELETE FROM public.community_messages WHERE id IN (SELECT id FROM expired) RETURNING id)
 SELECT count(*) INTO total FROM removed;
 INSERT INTO public.community_chat_purge_runs(kind,deleted,status) VALUES('channels',total,'ok');
 PERFORM set_config('app.chat_purge','',true); RETURN jsonb_build_object('deleted',total);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.chat_purge','',true); RAISE;
END $$;
CREATE FUNCTION public.community_chat_purge_record_failure(p_code text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM set_config('app.chat_purge','on',true);
 INSERT INTO public.community_chat_purge_runs(kind,status,failure_code) VALUES('channels','failed',CASE WHEN p_code IN ('sweep_failed','row_failed') THEN p_code ELSE 'sweep_failed' END);
 PERFORM set_config('app.chat_purge','',true);
END $$;
CREATE FUNCTION public.community_chat_purge_health() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE success_at timestamptz; latest record; result jsonb;
BEGIN
 PERFORM set_config('app.chat_purge','on',true);
 SELECT max(created_at) INTO success_at FROM public.community_chat_purge_runs WHERE status='ok';
 SELECT status,created_at INTO latest FROM public.community_chat_purge_runs ORDER BY created_at DESC,id DESC LIMIT 1;
 result:=jsonb_build_object('lastSuccessAt',success_at,'lastStatus',latest.status,'overdue',success_at IS NULL OR success_at<now()-interval '26 hours','failedSinceSuccess',EXISTS(SELECT 1 FROM public.community_chat_purge_runs WHERE status='failed' AND (success_at IS NULL OR created_at>=success_at)));
 PERFORM set_config('app.chat_purge','',true); RETURN result;
END $$;

--> statement-breakpoint
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['community_chat_initialize','community_chat_rank','community_chat_role','community_chat_user_can_read','community_chat_readable_channels','community_channel_can_read','community_chat_actor','community_chat_done','community_chat_bump','community_chat_lock_members','community_chat_membership_revision','community_chat_grant_revision','community_channel_save','community_channel_delete','community_channel_reorder','community_channel_members_set','community_chat_message_projection','community_message_send','community_message_edit','community_message_delete','community_message_moderate','community_reaction_toggle','community_channel_read','community_channel_prefs_save','community_chat_messages','community_chat_state_read','community_chat_notify','community_chat_purge_channels','community_chat_purge_record_failure','community_chat_purge_health']) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,harvest_app',f.sig);
 END LOOP;
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['community_channel_save','community_channel_delete','community_channel_reorder','community_channel_members_set','community_message_send','community_message_edit','community_message_delete','community_message_moderate','community_reaction_toggle','community_channel_read','community_channel_prefs_save','community_chat_messages','community_chat_state_read','community_channel_can_read','community_chat_rank']) LOOP
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO harvest_app',f.sig);
 END LOOP;
 
END $$;

--> statement-breakpoint
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY chat_rate_audit ON public.audit_logs FOR SELECT TO %I USING(tenant_id=nullif(current_setting('app.community_definer_tenant',true),'')::uuid AND actor_id=nullif(current_setting('app.user_id',true),'') AND action IN ('community.chat.edit','community.chat.react'))$p$,current_user);
END $$;

--> statement-breakpoint
ALTER TABLE public.community_memberships ADD CONSTRAINT community_chat_state_rev CHECK(chat_state_rev>=0);

--> statement-breakpoint
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY chat_staff_context ON public.workspace_members FOR SELECT TO %I USING(tenant_id=nullif(current_setting('app.community_definer_tenant',true),'')::uuid)$p$,current_user);
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_notifications_list(p_slug text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ctx record; m record; v_since timestamptz; v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_announce boolean; v_items jsonb; v_unread integer;
BEGIN
  SELECT * INTO ctx FROM public.community_forum_actor(p_slug);
  IF ctx.o_tenant IS NULL THEN RETURN public.community_forum_done('not_found'); END IF;
  SELECT * INTO m FROM public.community_memberships WHERE tenant_id = ctx.o_tenant AND community_id = ctx.o_community AND user_id = actor;
  v_since := coalesce(m.notifications_seen_at, m.joined_at, m.created_at);
  v_announce := m.notify_announcements AND NOT m.notifications_muted;
  WITH n AS (
    SELECT jsonb_build_object('id', x.id, 'kind', x.kind, 'targetType', x.target_type, 'postId', x.post_id, 'actorName', u.name, 'count', x.actor_count,
        'detail', x.detail, 'read', x.read_at IS NOT NULL, 'createdAt', x.updated_at) AS j, x.updated_at AS at
      FROM public.community_notifications x LEFT JOIN public.users u ON u.id = x.actor_id
      WHERE x.tenant_id = ctx.o_tenant AND x.community_id = ctx.o_community AND x.recipient_id = actor AND (CASE WHEN x.kind IN ('chat_mention','chat_reply') THEN (public.community_chat_user_can_read(x.tenant_id,x.community_id,x.target_id::uuid,actor) AND NOT EXISTS(SELECT 1 FROM public.community_channel_reads cr WHERE cr.channel_id=x.target_id::uuid AND cr.user_id=actor AND cr.mute='all')) ELSE true END)
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
      AND y.recipient_id = actor AND y.read_at IS NULL)
    INTO v_items, v_unread;
  PERFORM public.community_definer_reset();
  RETURN jsonb_build_object('outcome', 'ok', 'items', v_items, 'unread', v_unread);
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_email_enqueue(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE t uuid; queued integer := 0; n integer; v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  -- A window ends a minute in the past: a notification written by a transaction that started earlier but commits after this
  -- snapshot is then still ahead of the cursor and lands in the next window instead of being lost (review on #72).
  v_end timestamptz := now() - interval '1 minute';
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
      UPDATE public.community_memberships m SET email_digest_cursor = v_end
        FROM due WHERE m.tenant_id = due.tenant_id AND m.community_id = due.community_id AND m.user_id = due.user_id
        RETURNING due.tenant_id, due.community_id, due.user_id, due.since, due.muted),
    ins AS (
      INSERT INTO public.community_email_deliveries (tenant_id, community_id, recipient_id, kind, window_start, window_end, idempotency_key)
      SELECT mv.tenant_id, mv.community_id, mv.user_id, 'digest', mv.since, v_end,
             'd:' || mv.user_id || ':' || mv.community_id::text || ':' || (extract(epoch FROM v_end) * 1000000)::bigint::text
        FROM moved mv
       WHERE NOT mv.muted AND public.community_user_can_read(mv.tenant_id, mv.community_id, mv.user_id)
         AND EXISTS (SELECT 1 FROM public.community_notifications n
           WHERE n.tenant_id = mv.tenant_id AND n.community_id = mv.community_id AND n.recipient_id = mv.user_id AND n.read_at IS NULL
             AND n.kind NOT IN ('application', 'warning', 'held_decision', 'appeal_decision','dm') AND (CASE WHEN n.kind IN ('chat_mention','chat_reply') THEN (public.community_chat_user_can_read(n.tenant_id,n.community_id,n.target_id::uuid,n.recipient_id) AND NOT EXISTS(SELECT 1 FROM public.community_channel_reads cr WHERE cr.channel_id=n.target_id::uuid AND cr.user_id=n.recipient_id AND cr.mute='all')) ELSE true END) AND n.updated_at >= mv.since AND n.updated_at < v_end)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING 1)
    SELECT count(*)::int INTO n FROM ins;
    queued := queued + n;
  END LOOP;
  PERFORM public.community_definer_reset();
  RETURN queued;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_email_claim(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r record; jobs jsonb := '[]'::jsonb; picked integer := 0; v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_user record; v_comm record; v_member record; v_items jsonb; v_total integer; v_nkind text; v_exempt boolean;
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
      UPDATE public.community_email_deliveries d SET status = 'sending', locked_until = now() + interval '15 minutes', attempts = d.attempts + 1
        FROM picked WHERE d.id = picked.id RETURNING d.*)
    SELECT * FROM taken ORDER BY created_at
  LOOP
    picked := picked + 1;
    PERFORM set_config('app.community_definer_tenant', r.tenant_id::text, true);
    SELECT u.email, u.name INTO v_user FROM public.users u WHERE u.id = r.recipient_id;
    SELECT c.name, c.slug INTO v_comm FROM public.communities c WHERE c.tenant_id = r.tenant_id AND c.id = r.community_id;
    SELECT m.email_frequency, m.notifications_muted INTO v_member FROM public.community_memberships m
      WHERE m.tenant_id = r.tenant_id AND m.community_id = r.community_id AND m.user_id = r.recipient_id;
    IF r.kind = 'instant' THEN SELECT n.kind INTO v_nkind FROM public.community_notifications n WHERE n.id = r.notification_id; END IF;
    -- Application and appeal decisions are about the person's own request: they ignore mute and reading rights.
    v_exempt := r.kind = 'instant' AND v_nkind IN ('application', 'appeal_decision');
    IF v_user.email IS NULL OR v_comm.slug IS NULL OR coalesce(v_member.email_frequency, 'important') = 'off'
       OR (r.kind = 'instant' AND v_nkind IS NULL)
       OR (NOT v_exempt AND (coalesce(v_member.notifications_muted, false) OR NOT public.community_user_can_read(r.tenant_id, r.community_id, r.recipient_id))) THEN
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
          AND n.kind NOT IN ('application', 'warning', 'held_decision', 'appeal_decision','dm') AND (CASE WHEN n.kind IN ('chat_mention','chat_reply') THEN (public.community_chat_user_can_read(n.tenant_id,n.community_id,n.target_id::uuid,n.recipient_id) AND NOT EXISTS(SELECT 1 FROM public.community_channel_reads cr WHERE cr.channel_id=n.target_id::uuid AND cr.user_id=n.recipient_id AND cr.mute='all')) ELSE true END) AND n.updated_at >= r.window_start AND n.updated_at < r.window_end
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
  RETURN jsonb_build_object('jobs', jobs, 'picked', picked);
END $$;

--> statement-breakpoint
CREATE FUNCTION public.community_chat_settings_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous text:=current_setting('app.community_definer_tenant',true);
BEGIN
 IF (NEW.chat_enabled,NEW.dm_policy) IS DISTINCT FROM (OLD.chat_enabled,OLD.dm_policy) THEN
 PERFORM set_config('app.community_definer_tenant',NEW.tenant_id::text,true);
 PERFORM public.community_chat_bump(NEW.tenant_id,NEW.id);
 PERFORM set_config('app.community_definer_tenant',coalesce(previous,''),true);
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER community_chat_settings_revision AFTER UPDATE ON public.communities FOR EACH ROW EXECUTE FUNCTION public.community_chat_settings_revision();
CREATE FUNCTION public.community_chat_settings_save(p_slug text,p_enabled boolean,p_policy text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ctx record; actor text:=nullif(current_setting('app.user_id',true),'');
BEGIN
 PERFORM set_config('app.community_resolve_slug',coalesce(p_slug,''),true);
 SELECT tenant_id,id INTO ctx FROM public.communities WHERE slug=p_slug;
 IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 PERFORM set_config('app.community_definer_tenant',ctx.tenant_id::text,true);
 -- The community settings row is already the canonical owner of these settings, never message counters.
 PERFORM 1 FROM public.community_channels WHERE community_id=ctx.id ORDER BY id FOR UPDATE;
 PERFORM public.community_chat_lock_members(ctx.tenant_id,ctx.id);
 IF NOT coalesce(public.community_chat_can(public.community_chat_role(ctx.tenant_id,ctx.id,actor),'chat:manage_channels'),false) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF p_enabled IS NULL OR p_policy IS NULL OR p_policy NOT IN ('channels_only','members') THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 PERFORM set_config('app.chat_settings','on',true);
 UPDATE public.communities SET chat_enabled=p_enabled,dm_policy=p_policy WHERE tenant_id=ctx.tenant_id AND id=ctx.id;
 PERFORM set_config('app.chat_settings','',true);
 INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata) VALUES(ctx.tenant_id,actor,'community.chat.settings',ctx.id,jsonb_build_object('chatEnabled',p_enabled,'dmPolicy',p_policy));
 RETURN public.community_chat_done('{"outcome":"ok"}');
EXCEPTION WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;
REVOKE ALL ON FUNCTION public.community_chat_settings_save(text,boolean,text),public.community_chat_settings_revision() FROM PUBLIC,harvest_app;
GRANT EXECUTE ON FUNCTION public.community_chat_settings_save(text,boolean,text) TO harvest_app;

--> statement-breakpoint
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY chat_settings_owner ON public.communities FOR UPDATE TO %I USING(current_setting('app.chat_settings',true)='on' AND tenant_id=nullif(current_setting('app.community_definer_tenant',true),'')::uuid) WITH CHECK(current_setting('app.chat_settings',true)='on' AND tenant_id=nullif(current_setting('app.community_definer_tenant',true),'')::uuid)$p$,current_user);
END $$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_chat_can(text,text) FROM PUBLIC,harvest_app;

--> statement-breakpoint
-- 0057 worker-role grant: replay this block after provisioning the role, never create it in a migration.
REVOKE ALL ON FUNCTION public.community_chat_purge_channels(integer),public.community_chat_purge_record_failure(text),public.community_chat_purge_health() FROM PUBLIC,harvest_app;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harvest_worker') THEN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harvest_worker' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit)) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='harvest_worker'::regrole) THEN RAISE EXCEPTION 'harvest_worker must be an unprivileged SQL-created role without inherited memberships'; END IF;
  GRANT EXECUTE ON FUNCTION public.community_chat_purge_channels(integer),public.community_chat_purge_record_failure(text),public.community_chat_purge_health() TO harvest_worker;
 END IF;
END $$;
-- End 0057 worker-role grant.

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_chat_refresh_thread(uuid,uuid) FROM PUBLIC,harvest_app;

--> statement-breakpoint
CREATE FUNCTION public.community_chat_moderation_read(p_slug text,p_source text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ctx record; result jsonb; actor text:=nullif(current_setting('app.user_id',true),'');
BEGIN
 SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
 IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
 IF NOT coalesce(public.community_chat_can(ctx.role,'chat:moderate'),false) THEN RETURN public.community_chat_done('{"outcome":"forbidden"}'); END IF;
 IF p_source='held' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result FROM (SELECT m.id,m.channel_id,left(m.body,280) excerpt,m.author_id,m.held_at,m.held_reason
 FROM public.community_messages m WHERE m.tenant_id=ctx.tenant AND m.community_id=ctx.community AND m.held_at IS NOT NULL AND m.deleted_at IS NULL AND m.author_id IS DISTINCT FROM actor ORDER BY m.held_at,m.id LIMIT 200) q;
 ELSIF p_source='reports' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result FROM (SELECT m.id,m.channel_id,left(m.body,280) excerpt,m.author_id,m.deleted_at,
 (array_agg(r.id ORDER BY r.created_at))[1] report_id,count(*) reports,min(r.created_at) first_reported_at,array_agg(DISTINCT r.reason) reasons,array_remove(array_agg(r.note),NULL) notes
 FROM public.community_reports r JOIN public.community_messages m ON m.id::text=r.target_id AND m.tenant_id=r.tenant_id AND m.community_id=r.community_id
 WHERE r.tenant_id=ctx.tenant AND r.community_id=ctx.community AND r.target_type='message' AND r.status='open' AND m.author_id IS DISTINCT FROM actor
 GROUP BY m.id ORDER BY min(r.created_at),m.id LIMIT 200) q;
 ELSE RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
 RETURN public.community_chat_done(jsonb_build_object('outcome','ok','items',result));
EXCEPTION WHEN OTHERS THEN PERFORM public.community_definer_reset(); RAISE;
END $$;
REVOKE ALL ON FUNCTION public.community_chat_moderation_read(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_chat_moderation_read(text,text) TO harvest_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_notify_as(p_actor text, p_tenant uuid, p_community uuid, p_recipient text, p_kind text, p_target_type text, p_target_id text,
  p_post_id uuid, p_detail jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := p_actor; m record; v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
BEGIN
  IF p_recipient IS NULL OR p_recipient IS NOT DISTINCT FROM actor THEN RETURN; END IF;
  SELECT m2.notify_replies, m2.notify_likes, m2.notifications_muted INTO m FROM public.community_memberships m2
    WHERE m2.tenant_id = p_tenant AND m2.community_id = p_community AND m2.user_id = p_recipient;
  IF FOUND THEN
    -- Appeal decisions are about the member's own ban and ignore mute (founder decision, 12 Nov).
    IF m.notifications_muted AND p_kind <> 'appeal_decision' THEN RETURN; END IF;
    IF p_kind IN ('reply', 'thread_reply','chat_reply') AND NOT m.notify_replies THEN RETURN; END IF;
    IF p_kind = 'like' AND NOT m.notify_likes THEN RETURN; END IF;
  END IF;
  IF p_kind <> 'appeal_decision' AND NOT public.community_user_can_read(p_tenant, p_community, p_recipient) THEN RETURN; END IF;
  IF p_kind IN ('chat_mention','chat_reply') THEN
    IF p_target_type<>'channel' OR NOT public.community_chat_user_can_read(p_tenant,p_community,p_target_id::uuid,p_recipient)
      OR EXISTS(SELECT 1 FROM public.community_channel_reads WHERE channel_id=p_target_id::uuid AND user_id=p_recipient AND mute='all') THEN RETURN; END IF;
    INSERT INTO public.community_notifications(tenant_id,community_id,recipient_id,kind,target_type,target_id,actor_id,detail)
    SELECT p_tenant,p_community,p_recipient,p_kind,'channel',p_target_id,actor,jsonb_build_object('channelName',c.name) FROM public.community_channels c WHERE c.tenant_id=p_tenant AND c.community_id=p_community AND c.id=p_target_id::uuid
    ON CONFLICT(recipient_id,community_id,kind,target_type,target_id) WHERE kind IN ('chat_mention','chat_reply','dm') AND read_at IS NULL
    DO UPDATE SET actor_count=community_notifications.actor_count+1,actor_id=EXCLUDED.actor_id,updated_at=now();
  ELSIF p_kind = 'like' THEN
    INSERT INTO public.community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, post_id, actor_id, detail)
      VALUES (p_tenant, p_community, p_recipient, p_kind, p_target_type, p_target_id, p_post_id, actor, v_detail)
      ON CONFLICT (recipient_id, community_id, target_type, target_id) WHERE kind = 'like' AND read_at IS NULL
      -- Count distinct people who like it now (since this group started), so like/unlike/like never inflates it (review on #67).
      DO UPDATE SET actor_count = greatest(1, (SELECT count(*)::int FROM public.community_likes l
          WHERE l.target_type = EXCLUDED.target_type AND l.target_id = EXCLUDED.target_id::uuid AND l.user_id IS DISTINCT FROM EXCLUDED.recipient_id
            AND l.created_at >= community_notifications.created_at)),
        actor_id = EXCLUDED.actor_id, updated_at = now();
  ELSIF p_kind = 'host_queue' THEN
    INSERT INTO public.community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, post_id, actor_id, detail)
      VALUES (p_tenant, p_community, p_recipient, p_kind, p_target_type, p_target_id, p_post_id, actor, v_detail)
      ON CONFLICT (recipient_id, community_id) WHERE kind = 'host_queue' AND read_at IS NULL
      DO UPDATE SET actor_count = community_notifications.actor_count + 1, actor_id = EXCLUDED.actor_id, updated_at = now();
  ELSE
    INSERT INTO public.community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, post_id, actor_id, detail)
      VALUES (p_tenant, p_community, p_recipient, p_kind, p_target_type, p_target_id, p_post_id, actor, v_detail);
  END IF;
END $$;
