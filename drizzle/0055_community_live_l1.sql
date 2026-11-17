CREATE TABLE "community_live_events" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"provider_video_id" text NOT NULL,
	"scheduled_start" timestamp with time zone NOT NULL,
	"scheduled_end" timestamp with time zone,
	"state" text DEFAULT 'draft' NOT NULL,
	"comments_mode" text DEFAULT 'held' NOT NULL,
	"donation_slot" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_live_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "community_live_title" CHECK (length(trim("community_live_events"."title")) between 1 and 120),
	CONSTRAINT "community_live_video" CHECK ("community_live_events"."provider_video_id" ~ '^[A-Za-z0-9_-]{11}$'),
	CONSTRAINT "community_live_state" CHECK ("community_live_events"."state" in ('draft','scheduled','live','ended','replay','cancelled')),
	CONSTRAINT "community_live_comments" CHECK ("community_live_events"."comments_mode" in ('held','open','off')),
	CONSTRAINT "community_live_reserved" CHECK ("community_live_events"."donation_slot" is null),
	CONSTRAINT "community_live_version" CHECK ("community_live_events"."version" >= 1),
	CONSTRAINT "community_live_schedule" CHECK ("community_live_events"."scheduled_end" is null or "community_live_events"."scheduled_end" > "community_live_events"."scheduled_start"),
	CONSTRAINT "community_live_started" CHECK ("community_live_events"."state" not in ('live','ended','replay') or "community_live_events"."started_at" is not null),
	CONSTRAINT "community_live_ended" CHECK ("community_live_events"."state" not in ('ended','replay') or "community_live_events"."ended_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "community_live_events" ADD CONSTRAINT "community_live_events_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_live_events" ADD CONSTRAINT "community_live_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_live_events" ADD CONSTRAINT "community_live_events_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_live_schedule_idx" ON "community_live_events" USING btree ("tenant_id","community_id","scheduled_start","id");--> statement-breakpoint
CREATE FUNCTION public.community_live_transition_allowed(p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT p_from = p_to OR CASE p_from
 WHEN 'draft' THEN p_to IN ('scheduled','cancelled') WHEN 'scheduled' THEN p_to IN ('live','cancelled')
 WHEN 'live' THEN p_to = 'ended' WHEN 'ended' THEN p_to = 'replay' WHEN 'replay' THEN p_to = 'ended' ELSE false END
$$;
--> statement-breakpoint
CREATE FUNCTION public.community_live_in_window(p_state text, p_start timestamptz, p_end timestamptz, p_now timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT p_state = 'replay' OR (p_state IN ('scheduled','live','ended') AND p_now >= p_start - interval '24 hours' AND p_now <= coalesce(p_end,p_start) + interval '168 hours')
$$;
--> statement-breakpoint
CREATE FUNCTION public.community_live_auto_close_due(p_state text, p_started timestamptz, p_now timestamptz) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(p_state = 'live' AND p_now >= p_started + interval '12 hours', false)
$$;
--> statement-breakpoint
-- Invoker helper: only the caller's own staff/membership rows are visible through existing RLS.
CREATE FUNCTION public.community_live_can_manage(p_tenant uuid, p_community uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM public.workspace_members w WHERE w.tenant_id=p_tenant AND w.user_id=nullif(current_setting('app.user_id',true),'') AND w.role_id IN ('owner','admin'))
 OR EXISTS (SELECT 1 FROM public.community_memberships m WHERE m.tenant_id=p_tenant AND m.community_id=p_community AND m.user_id=nullif(current_setting('app.user_id',true),'') AND m.status='active' AND m.role IN ('owner','admin'))
$$;
--> statement-breakpoint
ALTER TABLE public.community_live_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_live_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_live_events FROM PUBLIC, harvest_app;
GRANT SELECT ON public.community_live_events TO harvest_app;
CREATE POLICY community_live_member ON public.community_live_events FOR SELECT TO harvest_app USING (
 public.community_can_read(tenant_id,community_id)
 AND EXISTS (SELECT 1 FROM public.communities c WHERE c.tenant_id=community_live_events.tenant_id AND c.id=community_id AND c.status='published')
 AND public.community_live_in_window(state,scheduled_start,ended_at,now()));
CREATE POLICY community_live_manager ON public.community_live_events FOR SELECT TO harvest_app USING (public.community_live_can_manage(tenant_id,community_id));
--> statement-breakpoint
DO $$ BEGIN
 EXECUTE format($p$CREATE POLICY community_live_definer ON public.community_live_events TO %I
 USING (tenant_id=nullif(current_setting('app.community_definer_tenant',true),'')::uuid AND community_id=nullif(current_setting('app.live_community',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('app.community_definer_tenant',true),'')::uuid AND community_id=nullif(current_setting('app.live_community',true),'')::uuid)$p$,current_user);
 EXECUTE format($p$CREATE POLICY community_live_staff_lock ON public.workspace_members FOR UPDATE TO %I
 USING (user_id=nullif(current_setting('app.user_id',true),'')) WITH CHECK (false)$p$,current_user);
 -- The function owner must authorize ministry staff with FORCE RLS and NOINHERIT.
 EXECUTE format($p$CREATE POLICY community_live_staff_check ON public.workspace_members FOR SELECT TO %I
 USING (user_id=nullif(current_setting('app.user_id',true),''))$p$,current_user);
END $$;
--> statement-breakpoint
-- Resolve one community and authorize management. Not executable by the app role.
CREATE FUNCTION public.community_live_manager_context(p_slug text, OUT o_tenant uuid, OUT o_community uuid) RETURNS record
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),'');
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'live_access_denied' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.community_resolve_slug',coalesce(p_slug,''),true);
 SELECT c.tenant_id,c.id INTO o_tenant,o_community FROM public.communities c WHERE c.slug=p_slug;
 IF NOT FOUND THEN RAISE EXCEPTION 'live_not_found' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.community_definer_tenant',o_tenant::text,true);
 PERFORM set_config('app.live_community',o_community::text,true);
 -- Lock the effective authorization row so revocation cannot race a write.
 PERFORM 1 FROM public.workspace_members w WHERE w.tenant_id=o_tenant AND w.user_id=actor AND w.role_id IN ('owner','admin') FOR SHARE;
 IF FOUND THEN RETURN; END IF;
 PERFORM 1 FROM public.community_memberships m WHERE m.tenant_id=o_tenant AND m.community_id=o_community AND m.user_id=actor AND m.status='active' AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'live_access_denied' USING ERRCODE='42501'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.community_live_save(p_slug text,p_id uuid,p_version integer,p_title text,p_video text,p_start timestamptz,p_end timestamptz,p_state text,p_comments text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ctx record; oldrow public.community_live_events%ROWTYPE; saved public.community_live_events%ROWTYPE; actor text:=nullif(current_setting('app.user_id',true),'');
BEGIN
 SELECT * INTO ctx FROM public.community_live_manager_context(p_slug);
 IF p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 120 OR p_video IS NULL OR p_video !~ '^[A-Za-z0-9_-]{11}$' OR p_start IS NULL
 OR p_state IS NULL OR p_state NOT IN ('draft','scheduled','live','ended','replay','cancelled') OR p_comments IS NULL OR p_comments NOT IN ('held','open','off')
 OR (p_end IS NOT NULL AND p_end<=p_start) THEN RAISE EXCEPTION 'live_invalid' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL THEN
  IF p_version IS DISTINCT FROM 0 OR p_state NOT IN ('draft','scheduled') THEN RAISE EXCEPTION 'live_invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.community_live_events(tenant_id,community_id,title,provider_video_id,scheduled_start,scheduled_end,state,comments_mode,created_by)
   VALUES(ctx.o_tenant,ctx.o_community,trim(p_title),p_video,p_start,p_end,p_state,p_comments,actor) RETURNING * INTO saved;
 ELSE
  SELECT * INTO oldrow FROM public.community_live_events e WHERE e.tenant_id=ctx.o_tenant AND e.community_id=ctx.o_community AND e.id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'live_not_found' USING ERRCODE='P0002'; END IF;
  IF p_version IS DISTINCT FROM oldrow.version THEN RAISE EXCEPTION 'live_conflict' USING ERRCODE='40001'; END IF;
  IF NOT public.community_live_transition_allowed(oldrow.state,p_state) THEN RAISE EXCEPTION 'live_transition' USING ERRCODE='22023'; END IF;
  -- Schedule may change only before the stream starts. Replay is always an explicit admin transition.
  IF oldrow.state IN ('live','ended','replay','cancelled') AND (p_start IS DISTINCT FROM oldrow.scheduled_start OR p_end IS DISTINCT FROM oldrow.scheduled_end) THEN RAISE EXCEPTION 'live_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.community_live_events SET title=trim(p_title),provider_video_id=p_video,scheduled_start=p_start,scheduled_end=p_end,state=p_state,comments_mode=p_comments,
   started_at=CASE WHEN p_state='live' AND oldrow.started_at IS NULL THEN now() ELSE oldrow.started_at END,
   ended_at=CASE WHEN oldrow.state='live' AND p_state='ended' THEN now() ELSE oldrow.ended_at END,version=version+1,updated_at=now()
   WHERE tenant_id=ctx.o_tenant AND id=p_id RETURNING * INTO saved;
 END IF;
 INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata) VALUES(ctx.o_tenant,actor,'community.live.save',saved.id,
 jsonb_build_object('communityId',ctx.o_community,'from',oldrow.state,'to',saved.state,'version',saved.version));
 PERFORM public.community_definer_reset(); PERFORM set_config('app.live_community','',true);
 RETURN to_jsonb(saved)-'created_by'-'donation_slot';
EXCEPTION WHEN OTHERS THEN
 PERFORM public.community_definer_reset(); PERFORM set_config('app.live_community','',true); RAISE;
END $$;
--> statement-breakpoint
-- Scoped operation, not a global worker or scheduler. Caller must manage this community; actor is system/null.
CREATE FUNCTION public.community_live_auto_close(p_slug text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE ctx record; e record; total integer:=0;
BEGIN
 SELECT * INTO ctx FROM public.community_live_manager_context(p_slug);
 FOR e IN SELECT * FROM public.community_live_events WHERE tenant_id=ctx.o_tenant AND community_id=ctx.o_community AND public.community_live_auto_close_due(state,started_at,now()) FOR UPDATE LOOP
  UPDATE public.community_live_events SET state='ended',ended_at=now(),version=version+1,updated_at=now() WHERE tenant_id=e.tenant_id AND id=e.id;
  INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata) VALUES(e.tenant_id,NULL,'community.live.auto_close',e.id,
   jsonb_build_object('communityId',ctx.o_community,'from','live','to','ended','version',e.version+1));
  total:=total+1;
 END LOOP;
 PERFORM public.community_definer_reset(); PERFORM set_config('app.live_community','',true); RETURN total;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.community_definer_reset(); PERFORM set_config('app.live_community','',true); RAISE;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_live_manager_context(text),public.community_live_save(text,uuid,integer,text,text,timestamptz,timestamptz,text,text),public.community_live_auto_close(text),
 public.community_live_transition_allowed(text,text),public.community_live_in_window(text,timestamptz,timestamptz,timestamptz),public.community_live_auto_close_due(text,timestamptz,timestamptz),public.community_live_can_manage(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_live_save(text,uuid,integer,text,text,timestamptz,timestamptz,text,text),public.community_live_auto_close(text),
 public.community_live_transition_allowed(text,text),public.community_live_in_window(text,timestamptz,timestamptz,timestamptz),public.community_live_auto_close_due(text,timestamptz,timestamptz),public.community_live_can_manage(uuid,uuid) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.community_live_list(p_slug text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c record; manager boolean; result jsonb;
BEGIN
 PERFORM set_config('app.community_resolve_slug',coalesce(p_slug,''),true);
 SELECT tenant_id,id,status INTO c FROM public.communities WHERE slug=p_slug;
 IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN '[]'::jsonb; END IF;
 PERFORM set_config('app.community_definer_tenant',c.tenant_id::text,true);
 PERFORM set_config('app.live_community',c.id::text,true);
 manager:=public.community_live_can_manage(c.tenant_id,c.id);
 IF NOT manager AND (c.status<>'published' OR NOT public.community_can_read(c.tenant_id,c.id)) THEN
  PERFORM public.community_definer_reset(); PERFORM set_config('app.live_community','',true); RETURN '[]'::jsonb;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e)-'tenant_id'-'created_by'-'donation_slot' ORDER BY e.scheduled_start,e.id),'[]'::jsonb) INTO result
 FROM (SELECT * FROM public.community_live_events WHERE tenant_id=c.tenant_id AND community_id=c.id AND (p_id IS NULL OR id=p_id)
 AND (manager OR public.community_live_in_window(state,scheduled_start,ended_at,now())) ORDER BY scheduled_start,id LIMIT 100) e;
 PERFORM public.community_definer_reset(); PERFORM set_config('app.live_community','',true); RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM public.community_definer_reset(); PERFORM set_config('app.live_community','',true); RAISE;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_live_list(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_live_list(text,uuid) TO harvest_app;
--> statement-breakpoint
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_system_actor;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_system_actor CHECK (actor_id IS NOT NULL OR action IN ('followup.case.withdraw','followup.case.revoke','community.live.auto_close'));
