CREATE TABLE "event_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"uploader_id" text,
	"key" text NOT NULL,
	"kind" text DEFAULT 'cover' NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"checksum" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_files_key_unique" UNIQUE("key"),
	CONSTRAINT "event_file_kind" CHECK ("event_files"."kind" = 'cover'),
	CONSTRAINT "event_file_mime" CHECK ("event_files"."mime" in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "event_file_name" CHECK (length(btrim("event_files"."name")) between 1 and 200),
	CONSTRAINT "event_file_size" CHECK ("event_files"."size" between 1 and 10485760),
	CONSTRAINT "event_file_checksum" CHECK ("event_files"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "event_file_status" CHECK ("event_files"."status" in ('pending','uploaded','quarantined','ready')),
	CONSTRAINT "event_file_key" CHECK ("event_files"."key" = 'workspaces/' || "event_files"."tenant_id"::text || '/events/' || "event_files"."event_id"::text || '/files/' || "event_files"."id"::text)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cover_file_id" uuid;--> statement-breakpoint
ALTER TABLE "event_files" ADD CONSTRAINT "event_files_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_files" ADD CONSTRAINT "event_files_tenant_id_event_id_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_files_parent" ON "event_files" USING btree ("tenant_id","event_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cover_file_id_event_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."event_files"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.event_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_files FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_files FROM PUBLIC, harvest_app;
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY event_file_owner_scope ON public.event_files TO %I
    USING (tenant_id=nullif(current_setting('app.events_tenant',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.events_tenant',true),'')::uuid)$p$,current_user);
END $$;

-- The single-column reference can SET NULL on delete. The guard enforces the full
-- event and ministry match and readiness at the database boundary.
CREATE FUNCTION public.events_guard_cover() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.cover_file_id IS NOT NULL AND NOT EXISTS (SELECT FROM public.event_files f
    WHERE f.id=NEW.cover_file_id AND f.tenant_id=NEW.tenant_id AND f.event_id=NEW.id
      AND f.status='ready' AND f.retired_at IS NULL) THEN
    RAISE EXCEPTION 'cover does not belong to this event or is unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.events_guard_cover() FROM PUBLIC, harvest_app;
CREATE TRIGGER events_guard_cover BEFORE INSERT OR UPDATE OF cover_file_id,tenant_id,id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_guard_cover();

--> statement-breakpoint
CREATE FUNCTION public.events_cover_perform(p_tenant uuid,p_event uuid,p_action text,p_file uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),'');
  event public.events; file public.event_files; manager boolean; requested_status text; previous_file uuid;
  expected integer; payload jsonb; missing jsonb:='{"outcome":"not_found"}';
BEGIN
  IF actor IS NULL OR p_event IS NULL OR p_tenant IS NULL OR p_action IS NULL OR
    p_action NOT IN ('serve','create','inspect','status','set') THEN RETURN missing; END IF;
  IF p_action<>'serve' THEN
    PERFORM 1 FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=actor FOR SHARE;
  END IF;
  manager:=EXISTS (SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=actor AND role_id IN ('owner','admin'));
  IF p_action='serve' THEN
    SELECT * INTO event FROM public.events WHERE tenant_id=p_tenant AND id=p_event FOR SHARE;
    IF NOT FOUND OR (NOT manager AND (event.published_at IS NULL OR
      public.events_sources(p_tenant,p_event,actor,clock_timestamp())='{}'::jsonb)) THEN RETURN missing; END IF;
    SELECT * INTO file FROM public.event_files WHERE tenant_id=p_tenant AND event_id=p_event AND id=event.cover_file_id
      AND status='ready' AND retired_at IS NULL;
    IF NOT FOUND THEN RETURN missing; END IF;
    RETURN jsonb_build_object('outcome','ok','data',jsonb_build_object('key',file.key,'name',file.name,'mime',file.mime));
  END IF;
  IF NOT manager THEN RETURN missing; END IF;
  SELECT * INTO event FROM public.events WHERE tenant_id=p_tenant AND id=p_event FOR UPDATE;
  IF NOT FOUND THEN RETURN missing; END IF;

  IF p_action='set' THEN
    expected:=(p_input->>'version')::integer;
    IF expected IS NULL OR expected<1 THEN RETURN '{"outcome":"invalid"}'; END IF;
    IF event.version<>expected AND NOT (event.version=expected+1 AND event.cover_file_id IS NOT DISTINCT FROM p_file) THEN
      RETURN '{"outcome":"conflict"}';
    END IF;
    IF event.cover_file_id IS DISTINCT FROM p_file THEN
      IF p_file IS NOT NULL AND NOT EXISTS (SELECT FROM public.event_files f
        WHERE f.tenant_id=p_tenant AND f.event_id=p_event AND f.id=p_file AND f.status='ready' AND f.retired_at IS NULL) THEN
        RETURN missing;
      END IF;
      previous_file:=event.cover_file_id;
      UPDATE public.events SET cover_file_id=p_file,version=version+1,updated_at=clock_timestamp()
        WHERE tenant_id=p_tenant AND id=p_event RETURNING * INTO event;
      IF previous_file IS NOT NULL THEN
        UPDATE public.event_files SET retired_at=clock_timestamp()
          WHERE tenant_id=p_tenant AND event_id=p_event AND id=previous_file;
        payload:=jsonb_build_object('eventId',p_event,'fileId',previous_file);
        INSERT INTO public.outbox_events(tenant_id,kind,idempotency_key,fingerprint,payload,scheduled_for)
          VALUES(p_tenant,'events.cover_cleanup','events.cover_cleanup:' || previous_file::text,
            encode(sha256(convert_to(payload::text,'UTF8')),'hex'),payload,clock_timestamp()+interval '5 minutes')
          ON CONFLICT DO NOTHING;
      END IF;
      INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata)
        VALUES(p_tenant,actor,'events.cover_change',p_event::text,jsonb_build_object('version',event.version));
    END IF;
    RETURN jsonb_build_object('outcome','ok','data',jsonb_build_object('coverFileId',event.cover_file_id,'version',event.version));
  END IF;

  IF p_file IS NULL THEN RETURN missing; END IF;
  IF p_action='create' THEN
    INSERT INTO public.event_files(id,tenant_id,event_id,uploader_id,key,name,mime,size,checksum)
      VALUES(p_file,p_tenant,p_event,actor,'workspaces/' || p_tenant::text || '/events/' || p_event::text || '/files/' || p_file::text,
        p_input->>'name',p_input->>'mime',(p_input->>'size')::integer,p_input->>'checksum')
      RETURNING * INTO file;
  ELSE
    SELECT * INTO file FROM public.event_files WHERE tenant_id=p_tenant AND event_id=p_event AND id=p_file
      AND uploader_id=actor AND retired_at IS NULL;
    IF NOT FOUND THEN RETURN missing; END IF;
    IF p_action='status' THEN
      requested_status:=p_input->>'status';
      IF (file.status='pending' AND requested_status IN ('uploaded','quarantined'))
        OR (file.status='uploaded' AND requested_status IN ('ready','quarantined')) THEN
        UPDATE public.event_files SET status=requested_status WHERE id=file.id RETURNING * INTO file;
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('outcome','ok','data',jsonb_build_object('id',file.id,'key',file.key,'name',file.name,
    'mime',file.mime,'size',file.size,'status',file.status,'checksum',file.checksum,'kind',file.kind));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN
  RETURN '{"outcome":"invalid"}';
END $$;
REVOKE ALL ON FUNCTION public.events_cover_perform(uuid,uuid,text,uuid,jsonb) FROM PUBLIC, harvest_app;

CREATE FUNCTION public.events_cover_operate(p_tenant uuid,p_event uuid,p_action text,p_file uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous_tenant text:=current_setting('app.events_tenant',true);
  previous_community text:=current_setting('app.community_definer_tenant',true);
  result jsonb;
BEGIN
  PERFORM set_config('app.events_tenant',coalesce(p_tenant::text,''),true);
  PERFORM set_config('app.community_definer_tenant',coalesce(p_tenant::text,''),true);
  result:=public.events_cover_perform(p_tenant,p_event,p_action,p_file,p_input);
  PERFORM set_config('app.events_tenant',coalesce(previous_tenant,''),true);
  PERFORM set_config('app.community_definer_tenant',coalesce(previous_community,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.events_cover_operate(uuid,uuid,text,uuid,jsonb) FROM PUBLIC, harvest_app;
GRANT EXECUTE ON FUNCTION public.events_cover_operate(uuid,uuid,text,uuid,jsonb) TO harvest_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.events_project(p_event public.events,p_actor text,p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object(
    'id',p_event.id,'title',p_event.title,'description',p_event.description,'location',p_event.location,'timeZone',p_event.time_zone,
    'waitlistEnabled',p_event.waitlist_enabled,'coverFileId',p_event.cover_file_id,
    'startsAt',p_event.starts_at,'endsAt',p_event.ends_at,'capacity',p_event.capacity,'status',p_event.status,
    'version',p_event.version,'updatedAt',p_event.updated_at,'reminderMinutes',p_event.reminder_minutes,
    'canClaimSeat',coalesce(r.state='waitlisted' AND p_event.status='published' AND p_event.starts_at>p_now
      AND public.events_still_admitted(r.sources,public.events_sources(r.tenant_id,r.event_id,p_actor,p_now),p_now)
      AND (p_event.capacity IS NULL OR p_event.capacity>public.events_occupied(r.tenant_id,r.event_id,p_now)
        + public.events_waiting_ahead(p_event,p_actor,r.waitlisted_at,p_now)),false),
    'available',CASE WHEN p_event.capacity IS NOT NULL THEN
      greatest(0,p_event.capacity-public.events_occupied(p_event.tenant_id,p_event.id,p_now)
        - public.events_waiting_ahead(p_event,p_actor,NULL,p_now)) END,
    'rsvpVersion',coalesce(r.version,0),
    'rsvp',CASE WHEN public.events_still_admitted(r.sources,public.events_sources(p_event.tenant_id,p_event.id,p_actor,p_now),p_now)
      THEN r.state END)
    || CASE WHEN EXISTS (SELECT FROM public.workspace_members w WHERE w.tenant_id=p_event.tenant_id
      AND w.user_id=p_actor AND w.role_id IN ('owner','admin')) THEN jsonb_build_object(
      'joinWindowMinutes', (SELECT l.window_minutes FROM public.event_join_links l WHERE l.tenant_id=p_event.tenant_id AND l.event_id=p_event.id))
    ELSE '{}'::jsonb END
  FROM (SELECT 1) one LEFT JOIN public.event_rsvps r ON r.tenant_id=p_event.tenant_id AND r.event_id=p_event.id AND r.user_id=p_actor
$$;
REVOKE ALL ON FUNCTION public.events_project(public.events,text,timestamptz) FROM PUBLIC;
