CREATE TABLE "community_event_links" (
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	CONSTRAINT "community_event_links_tenant_id_event_id_community_id_pk" PRIMARY KEY("tenant_id","event_id","community_id"),
	CONSTRAINT "community_event_link_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "event_join_links" (
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"url" text NOT NULL,
	"window_minutes" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "event_join_links_tenant_id_event_id_pk" PRIMARY KEY("tenant_id","event_id"),
	CONSTRAINT "event_join_https" CHECK (length("event_join_links"."url") between 9 and 2048 and "event_join_links"."url" ~ '^https://[^/?#@[:space:]]+([/?#]|$)' and "event_join_links"."url" !~ '[[:space:]]' and strpos("event_join_links"."url",chr(92)) = 0),
	CONSTRAINT "event_join_window" CHECK ("event_join_links"."window_minutes" between 0 and 1440)
);
--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"state" text NOT NULL,
	"waitlisted_at" timestamp with time zone,
	"sources" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvps_tenant_id_event_id_user_id_pk" PRIMARY KEY("tenant_id","event_id","user_id"),
	CONSTRAINT "event_rsvp_state" CHECK ("event_rsvps"."state" in ('going','maybe','not_going','waitlisted') and ("event_rsvps"."state" = 'waitlisted') = ("event_rsvps"."waitlisted_at" is not null) and "event_rsvps"."version" > 0 and jsonb_typeof("event_rsvps"."sources") = 'object')
);
--> statement-breakpoint
CREATE TABLE "events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"time_zone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer,
	"reminder_minutes" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "event_content" CHECK (length(btrim("events"."title")) between 1 and 120 and length("events"."description") <= 4000 and length("events"."time_zone") between 1 and 100),
	CONSTRAINT "event_interval" CHECK ("events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "event_capacity" CHECK ("events"."capacity" is null or "events"."capacity" > 0),
	CONSTRAINT "event_reminder_minutes" CHECK ("events"."reminder_minutes" between 1 and 10080),
	CONSTRAINT "event_status" CHECK ("events"."status" in ('draft','published','cancelled') and "events"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "event_publication_epoch" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "event_access_epoch" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "community_event_links" ADD CONSTRAINT "community_event_links_tenant_id_event_id_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_event_links" ADD CONSTRAINT "community_event_links_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_join_links" ADD CONSTRAINT "event_join_links_tenant_id_event_id_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_tenant_id_event_id_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_event_link_community_idx" ON "community_event_links" USING btree ("tenant_id","community_id","event_id");--> statement-breakpoint
CREATE INDEX "event_rsvps_going_idx" ON "event_rsvps" USING btree ("tenant_id","event_id") WHERE "event_rsvps"."state" = 'going';--> statement-breakpoint
CREATE INDEX "event_rsvps_waitlist_idx" ON "event_rsvps" USING btree ("tenant_id","event_id","waitlisted_at","user_id") WHERE "event_rsvps"."state" = 'waitlisted';--> statement-breakpoint
CREATE INDEX "events_tenant_start_idx" ON "events" USING btree ("tenant_id","starts_at","id");
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['events','event_join_links','event_rsvps','community_event_links'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,harvest_app',table_name);
    EXECUTE format($p$CREATE POLICY event_owner_scope ON public.%I TO %I
      USING (tenant_id=nullif(current_setting('app.events_tenant',true),'')::uuid)
      WITH CHECK (tenant_id=nullif(current_setting('app.events_tenant',true),'')::uuid)$p$,table_name,current_user);
  END LOOP;
  EXECUTE format($p$CREATE POLICY event_owner_staff ON public.workspace_members TO %I
    USING (tenant_id=nullif(current_setting('app.events_tenant',true),'')::uuid
      AND user_id=nullif(current_setting('app.user_id',true),''))
    WITH CHECK (tenant_id=nullif(current_setting('app.events_tenant',true),'')::uuid
      AND user_id=nullif(current_setting('app.user_id',true),''))$p$,current_user);
  EXECUTE format($p$CREATE POLICY event_owner_outbox ON public.outbox_events FOR INSERT TO %I
    WITH CHECK (tenant_id=nullif(current_setting('app.events_tenant',true),'')::uuid AND kind LIKE 'events.%%')$p$,current_user);
END $$;
--> statement-breakpoint
-- Admission epochs change on access transitions only. Chat and notification updates are independent.
CREATE FUNCTION public.events_membership_epoch() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR
     (NEW.role IN ('owner','admin','moderator','contributor')) IS DISTINCT FROM
     (OLD.role IN ('owner','admin','moderator','contributor')) THEN
    NEW.event_access_epoch := gen_random_uuid();
  ELSE
    NEW.event_access_epoch := OLD.event_access_epoch;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.events_membership_epoch() FROM PUBLIC;
CREATE TRIGGER events_membership_epoch BEFORE UPDATE ON public.community_memberships
  FOR EACH ROW EXECUTE FUNCTION public.events_membership_epoch();
--> statement-breakpoint
-- Publication changes invalidate admission sources without taking additional locks.
CREATE FUNCTION public.events_community_publication_epoch() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.event_publication_epoch := gen_random_uuid();
  ELSE
    NEW.event_publication_epoch := OLD.event_publication_epoch;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.events_community_publication_epoch() FROM PUBLIC;
CREATE TRIGGER events_community_publication_epoch BEFORE UPDATE ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.events_community_publication_epoch();
--> statement-breakpoint
-- One source key per placement/grant (or placement/staff). IDs never encode personal data.
CREATE FUNCTION public.events_sources(p_tenant uuid,p_event uuid,p_user text,p_now timestamptz,p_unmuted boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(link_id || ':' || grant_key,
    jsonb_build_object('epoch', epoch, 'until', valid_until)), '{}'::jsonb)
  FROM (
    SELECT (l.id::text || ':' || c.event_publication_epoch::text) AS link_id,'staff'::text AS grant_key,m.event_access_epoch AS epoch,NULL::timestamptz AS valid_until
    FROM public.community_event_links l
    JOIN public.communities c ON c.tenant_id=l.tenant_id AND c.id=l.community_id AND c.status='published'
    JOIN public.community_memberships m ON m.tenant_id=l.tenant_id AND m.community_id=l.community_id
      AND m.user_id=p_user AND (NOT p_unmuted OR NOT m.notifications_muted) AND m.status='active' AND m.role IN ('owner','admin','moderator','contributor')
    WHERE l.tenant_id=p_tenant AND l.event_id=p_event
    UNION ALL
    SELECT l.id::text || ':' || c.event_publication_epoch::text,e.id::text,m.event_access_epoch,e.valid_until
    FROM public.community_event_links l
    JOIN public.communities c ON c.tenant_id=l.tenant_id AND c.id=l.community_id AND c.status='published'
    JOIN public.community_memberships m ON m.tenant_id=l.tenant_id AND m.community_id=l.community_id
      AND m.user_id=p_user AND (NOT p_unmuted OR NOT m.notifications_muted) AND m.status='active'
    JOIN public.entitlements e ON e.tenant_id=l.tenant_id AND e.resource_type='community'
      AND e.resource_id=l.community_id AND e.user_id=p_user AND e.revoked_at IS NULL
      AND e.valid_from<=p_now AND (e.valid_until IS NULL OR e.valid_until>p_now)
    WHERE l.tenant_id=p_tenant AND l.event_id=p_event
  ) sources
$$;
REVOKE ALL ON FUNCTION public.events_sources(uuid,uuid,text,timestamptz,boolean) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.events_still_admitted(p_saved jsonb,p_current jsonb,p_now timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS (SELECT FROM jsonb_each(p_saved) AS saved(key,value)
    WHERE saved.value->>'epoch' = p_current->saved.key->>'epoch'
      AND ((saved.value->>'until') IS NULL OR (saved.value->>'until')::timestamptz>p_now))
$$;
REVOKE ALL ON FUNCTION public.events_still_admitted(jsonb,jsonb,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.events_occupied(p_tenant uuid,p_event uuid,p_now timestamptz)
RETURNS integer LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT count(*)::integer FROM public.event_rsvps r
  WHERE r.tenant_id=p_tenant AND r.event_id=p_event AND r.state='going'
    AND public.events_still_admitted(r.sources,public.events_sources(p_tenant,p_event,r.user_id,p_now),p_now)
$$;
REVOKE ALL ON FUNCTION public.events_occupied(uuid,uuid,timestamptz) FROM PUBLIC;

-- Event row serializes queue changes. The caller can claim a seat when fewer
-- eligible earlier entries are waiting than there are vacant seats.
CREATE FUNCTION public.events_waiting_ahead(p_event public.events,p_user text,p_queued timestamptz,p_now timestamptz)
RETURNS integer LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT count(*)::integer FROM public.event_rsvps r
  WHERE r.tenant_id=p_event.tenant_id AND r.event_id=p_event.id AND r.state='waitlisted'
    AND p_event.starts_at>p_now
    AND (p_queued IS NULL OR (r.waitlisted_at,r.user_id)<(p_queued,p_user))
    AND public.events_still_admitted(r.sources,public.events_sources(r.tenant_id,r.event_id,r.user_id,p_now),p_now)
$$;
REVOKE ALL ON FUNCTION public.events_waiting_ahead(public.events,text,timestamptz,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.events_project(p_event public.events,p_actor text,p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object(
    'id',p_event.id,'title',p_event.title,'description',p_event.description,'timeZone',p_event.time_zone,
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
  FROM (SELECT 1) one LEFT JOIN public.event_rsvps r ON r.tenant_id=p_event.tenant_id AND r.event_id=p_event.id AND r.user_id=p_actor
$$;
REVOKE ALL ON FUNCTION public.events_project(public.events,text,timestamptz) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.events_record(p_event public.events,p_actor text,p_action text,p_rsvp_version integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE kind text := 'events.' || p_action;
  payload jsonb := jsonb_build_object('eventId',p_event.id,'version',p_event.version);
  idempotency text := kind || ':' || p_event.id::text || ':' || p_event.version::text;
BEGIN
  IF p_rsvp_version IS NOT NULL THEN
    idempotency := kind || ':' || p_event.id::text || ':' ||
      encode(sha256(convert_to(p_actor,'UTF8')),'hex') || ':' || p_rsvp_version::text;
  END IF;
  INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata)
    VALUES(p_event.tenant_id,p_actor,kind,p_event.id::text,payload);
  INSERT INTO public.outbox_events(tenant_id,kind,idempotency_key,fingerprint,payload)
    VALUES(p_event.tenant_id,kind,idempotency,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),payload)
    ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.events_record(public.events,text,text,integer) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.events_perform(p_tenant uuid,p_id uuid,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),'');
  is_manager boolean; event public.events; entry public.event_rsvps; access jsonb;
  moment timestamptz:=statement_timestamp(); start_at timestamptz; end_at timestamptz;
  limit_capacity integer; lead_minutes integer; queue_at timestamptz; expected integer; wanted text; link record;
  result jsonb; missing jsonb:='{"outcome":"not_found"}'; stale jsonb:='{"outcome":"conflict"}';
  invalid jsonb:='{"outcome":"invalid"}'; replay boolean;
BEGIN
  IF actor IS NULL OR p_tenant IS NULL OR p_action IS NULL OR p_action NOT IN ('save','publish','cancel','get','list','rsvp','join','preview_join','roster','reminder_candidates') THEN RETURN missing; END IF;

  -- Lock memberships before the event. Grant writes take that membership lock through
  -- the existing grant-revision trigger. They never take an event lock.
  IF p_action IN ('rsvp','join') THEN
    PERFORM 1 FROM public.community_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=actor
      ORDER BY m.community_id FOR SHARE;
  END IF;
  IF p_action IN ('save','publish','cancel','preview_join','roster','reminder_candidates') THEN
    PERFORM 1 FROM public.workspace_members w WHERE w.tenant_id=p_tenant AND w.user_id=actor FOR SHARE;
  END IF;
  is_manager:=EXISTS (SELECT FROM public.workspace_members w WHERE w.tenant_id=p_tenant AND w.user_id=actor AND w.role_id IN ('owner','admin'));
  IF p_action IN ('save','publish','cancel','preview_join','roster','reminder_candidates') AND NOT is_manager THEN RETURN missing; END IF;

  IF p_action='list' THEN
    start_at:=(p_input->>'from')::timestamptz;
    end_at:=(p_input->>'to')::timestamptz;
    IF start_at IS NULL OR end_at IS NULL OR end_at<=start_at OR end_at-start_at>interval '100 days' THEN RETURN invalid; END IF;
    SELECT coalesce(jsonb_agg(public.events_project(q.event,actor,moment) ORDER BY (q.event).starts_at,(q.event).id),'[]'::jsonb)
      INTO result FROM (
      SELECT e AS event FROM public.events e WHERE e.tenant_id=p_tenant AND e.starts_at<end_at AND e.ends_at>start_at
        AND (is_manager OR (e.published_at IS NOT NULL AND public.events_sources(p_tenant,e.id,actor,moment)<>'{}'::jsonb))
      ORDER BY e.starts_at,e.id LIMIT 100) q;
    RETURN jsonb_build_object('outcome','ok','data',result);
  END IF;
  IF p_id IS NULL THEN RETURN missing; END IF;
  IF p_action IN ('save','publish','cancel','rsvp','join','preview_join') THEN
    SELECT * INTO event FROM public.events e WHERE e.tenant_id=p_tenant AND e.id=p_id FOR UPDATE;
  ELSE
    SELECT * INTO event FROM public.events e WHERE e.tenant_id=p_tenant AND e.id=p_id;
  END IF;
  moment:=clock_timestamp();

  IF p_action='save' THEN
    expected:=(p_input->>'version')::integer;
    start_at:=(p_input->>'startsAt')::timestamptz;
    end_at:=(p_input->>'endsAt')::timestamptz;
    limit_capacity:=(p_input->>'capacity')::integer;
    lead_minutes:=(p_input->>'reminderMinutes')::integer;
    IF expected IS NULL OR expected<0 OR start_at IS NULL OR end_at IS NULL OR start_at>=end_at OR
      coalesce(length(btrim(p_input->>'title')),0) NOT BETWEEN 1 AND 120 OR
      coalesce(length(p_input->>'description'),0)>4000 OR (limit_capacity IS NOT NULL AND limit_capacity<1) OR
      (lead_minutes IS NOT NULL AND lead_minutes NOT BETWEEN 1 AND 10080) OR
      NOT EXISTS (SELECT FROM pg_timezone_names WHERE name=p_input->>'timeZone') THEN RETURN invalid; END IF;
    IF expected=0 THEN
      IF event.id IS NULL THEN
        INSERT INTO public.events(tenant_id,id,title,description,time_zone,starts_at,ends_at,capacity,reminder_minutes,created_by)
          VALUES(p_tenant,p_id,btrim(p_input->>'title'),coalesce(p_input->>'description',''),p_input->>'timeZone',start_at,end_at,limit_capacity,lead_minutes,actor)
          ON CONFLICT DO NOTHING RETURNING * INTO event;
        IF event.id IS NOT NULL THEN wanted:='create';
        ELSE SELECT * INTO event FROM public.events WHERE tenant_id=p_tenant AND id=p_id FOR UPDATE;
        END IF;
      END IF;
      IF wanted IS NULL THEN
        SELECT * INTO link FROM public.event_join_links WHERE tenant_id=p_tenant AND event_id=p_id;
        IF event.version=1 AND event.created_by=actor AND
          (event.title,event.description,event.time_zone,event.starts_at,event.ends_at,event.capacity,event.reminder_minutes,link.url,link.window_minutes)
           IS NOT DISTINCT FROM (btrim(p_input->>'title'),coalesce(p_input->>'description',''),p_input->>'timeZone',start_at,end_at,limit_capacity,lead_minutes,
             p_input->>'joinUrl',CASE WHEN p_input->>'joinUrl' IS NOT NULL THEN coalesce((p_input->>'joinWindowMinutes')::integer,30) END) THEN
          RETURN jsonb_build_object('outcome','ok','data',public.events_project(event,actor,moment));
        END IF;
        RETURN stale;
      END IF;
    ELSE
      IF event.id IS NULL THEN RETURN missing; END IF;
      IF event.version<>expected OR event.status='cancelled' THEN RETURN stale; END IF;
      IF limit_capacity IS NOT NULL AND limit_capacity<public.events_occupied(p_tenant,p_id,moment) THEN RETURN jsonb_build_object('outcome','full'); END IF;
      UPDATE public.events SET title=btrim(p_input->>'title'),description=coalesce(p_input->>'description',''),
        time_zone=p_input->>'timeZone',starts_at=start_at,ends_at=end_at,capacity=limit_capacity,reminder_minutes=lead_minutes,
        version=version+1,updated_at=moment WHERE tenant_id=p_tenant AND id=p_id RETURNING * INTO event;
      wanted:='update';
    END IF;
    IF p_input->>'joinUrl' IS NULL THEN
      DELETE FROM public.event_join_links WHERE tenant_id=p_tenant AND event_id=p_id;
    ELSE
      INSERT INTO public.event_join_links(tenant_id,event_id,url,window_minutes)
        VALUES(p_tenant,p_id,p_input->>'joinUrl',coalesce((p_input->>'joinWindowMinutes')::integer,30))
        ON CONFLICT(tenant_id,event_id) DO UPDATE SET url=excluded.url,window_minutes=excluded.window_minutes;
    END IF;
    PERFORM public.events_record(event,actor,wanted);
  ELSE
    IF event.id IS NULL THEN RETURN missing; END IF;
    IF p_action IN ('publish','cancel') THEN
      wanted:=CASE WHEN p_action='publish' THEN 'published' ELSE 'cancelled' END;
      expected:=(p_input->>'version')::integer;
      IF expected IS NULL OR expected<1 THEN RETURN invalid; END IF;
      -- A repeated transition with the original or returned version is a no-op.
      IF event.status=wanted AND event.version IN (expected,expected+1) THEN
        RETURN jsonb_build_object('outcome','ok','data',public.events_project(event,actor,moment));
      END IF;
      IF event.version<>expected OR (p_action='publish' AND (event.status<>'draft' OR event.ends_at<=moment)) THEN RETURN stale; END IF;
      UPDATE public.events SET status=wanted,version=version+1,updated_at=moment,
        published_at=CASE WHEN p_action='publish' THEN moment ELSE published_at END
        WHERE tenant_id=p_tenant AND id=p_id RETURNING * INTO event;
      PERFORM public.events_record(event,actor,p_action);
    ELSE
      access:=public.events_sources(p_tenant,p_id,actor,moment);
      IF NOT is_manager AND (event.published_at IS NULL OR access='{}'::jsonb) THEN RETURN missing; END IF;
      IF p_action IN ('join','preview_join') THEN
        IF p_action='join' AND (access='{}'::jsonb OR event.status<>'published') THEN RETURN missing; END IF;
        IF p_action='preview_join' AND event.status='cancelled' THEN RETURN missing; END IF;
        SELECT * INTO link FROM public.event_join_links WHERE tenant_id=p_tenant AND event_id=p_id;
        IF link.url IS NULL OR (p_action='join' AND (moment<event.starts_at-make_interval(mins=>link.window_minutes) OR moment>=event.ends_at)) THEN RETURN missing; END IF;
        RETURN jsonb_build_object('outcome','ok','data',jsonb_build_object('url',link.url));
      ELSIF p_action='roster' THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object('userId',r.user_id,'state',r.state,
          'eligible',public.events_still_admitted(r.sources,public.events_sources(p_tenant,p_id,r.user_id,moment),moment))
          ORDER BY r.user_id),'[]'::jsonb) INTO result
        FROM (SELECT er.* FROM public.event_rsvps er WHERE er.tenant_id=p_tenant AND er.event_id=p_id
          AND (p_input->>'after' IS NULL OR er.user_id>p_input->>'after') ORDER BY er.user_id LIMIT 100) r;
        RETURN jsonb_build_object('outcome','ok','data',result);
      ELSIF p_action='reminder_candidates' THEN
        -- Bounded read for an authorized future dispatcher. The delivery slice
        -- must claim and deduplicate, then recheck permissions and preferences.
        SELECT coalesce(jsonb_agg(jsonb_build_object('userId',r.user_id,'eventVersion',event.version,
          'rsvpVersion',r.version,'dueAt',event.starts_at-make_interval(mins=>event.reminder_minutes))
          ORDER BY r.user_id),'[]'::jsonb) INTO result
        FROM (SELECT er.user_id,er.version FROM public.event_rsvps er
          WHERE er.tenant_id=p_tenant AND er.event_id=p_id AND er.state='going'
            AND event.status='published' AND event.reminder_minutes IS NOT NULL
            AND moment>=event.starts_at-make_interval(mins=>event.reminder_minutes) AND moment<event.starts_at
            AND (p_input->>'after' IS NULL OR er.user_id>p_input->>'after')
            AND public.events_still_admitted(er.sources,public.events_sources(p_tenant,p_id,er.user_id,moment,true),moment)
          ORDER BY er.user_id LIMIT 100) r;
        RETURN jsonb_build_object('outcome','ok','data',result);
      ELSIF p_action='rsvp' THEN
        IF access='{}'::jsonb OR event.status<>'published' OR event.ends_at<=moment THEN RETURN missing; END IF;
        wanted:=p_input->>'state';
        IF wanted IS NULL OR wanted NOT IN ('going','maybe','not_going','waitlisted') THEN RETURN invalid; END IF;
        SELECT * INTO entry FROM public.event_rsvps WHERE tenant_id=p_tenant AND event_id=p_id AND user_id=actor;
        expected:=(p_input->>'expectedVersion')::integer;
        IF expected IS NULL OR expected<0 THEN RETURN invalid; END IF;
        replay:=coalesce(entry.state=wanted AND public.events_still_admitted(entry.sources,access,moment),false);
        IF expected<>coalesce(entry.version,0) AND NOT (replay AND expected=entry.version-1) THEN RETURN stale; END IF;
        IF NOT replay THEN
          IF wanted='waitlisted' AND (event.capacity IS NULL OR event.starts_at<=moment) THEN RETURN invalid; END IF;
          queue_at:=CASE WHEN entry.state='waitlisted' AND public.events_still_admitted(entry.sources,access,moment)
            THEN entry.waitlisted_at END;
          IF wanted='going' AND event.capacity IS NOT NULL AND event.capacity<=public.events_occupied(p_tenant,p_id,moment)
            + public.events_waiting_ahead(event,actor,queue_at,moment) THEN
            RETURN jsonb_build_object('outcome','full');
          END IF;
          INSERT INTO public.event_rsvps(tenant_id,event_id,user_id,state,sources,waitlisted_at)
            VALUES(p_tenant,p_id,actor,wanted,access,CASE WHEN wanted='waitlisted' THEN moment END)
            ON CONFLICT(tenant_id,event_id,user_id) DO UPDATE SET state=excluded.state,waitlisted_at=excluded.waitlisted_at,
              sources=excluded.sources,version=event_rsvps.version+1,updated_at=moment RETURNING * INTO entry;
          PERFORM public.events_record(event,actor,'rsvp',entry.version);
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('outcome','ok','data',public.events_project(event,actor,moment));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR check_violation OR numeric_value_out_of_range THEN
  RETURN invalid;
END $$;
REVOKE ALL ON FUNCTION public.events_perform(uuid,uuid,text,jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.events_operate(p_tenant uuid,p_id uuid,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous_tenant text:=current_setting('app.events_tenant',true);
  previous_community text:=current_setting('app.community_definer_tenant',true);
  result jsonb;
BEGIN
  PERFORM set_config('app.events_tenant',coalesce(p_tenant::text,''),true);
  PERFORM set_config('app.community_definer_tenant',coalesce(p_tenant::text,''),true);
  result:=public.events_perform(p_tenant,p_id,p_action,p_input);
  PERFORM set_config('app.events_tenant',coalesce(previous_tenant,''),true);
  PERFORM set_config('app.community_definer_tenant',coalesce(previous_community,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.events_operate(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.events_operate(uuid,uuid,text,jsonb) TO harvest_app;
