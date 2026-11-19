ALTER TABLE "events" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "waitlist_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "event_location" CHECK (length(btrim("events"."location")) between 1 and 240 and "events"."location" !~ '[[:cntrl:]]');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.events_project(p_event public.events,p_actor text,p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object(
    'id',p_event.id,'title',p_event.title,'description',p_event.description,'location',p_event.location,'timeZone',p_event.time_zone,
    'waitlistEnabled',p_event.waitlist_enabled,
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.events_perform(p_tenant uuid,p_id uuid,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text:=nullif(current_setting('app.user_id',true),'');
  is_manager boolean; event public.events; entry public.event_rsvps; access jsonb;
  moment timestamptz:=statement_timestamp(); start_at timestamptz; end_at timestamptz;
  limit_capacity integer; lead_minutes integer; queue_at timestamptz; expected integer; wanted text; link record;
  event_location text; queue_enabled boolean; join_window integer; target_community uuid; placement_changed boolean;
  result jsonb; missing jsonb:='{"outcome":"not_found"}'; stale jsonb:='{"outcome":"conflict"}';
  invalid jsonb:='{"outcome":"invalid"}'; replay boolean;
BEGIN
  IF actor IS NULL OR p_tenant IS NULL OR p_action IS NULL OR p_action NOT IN ('save','publish','cancel','get','list','rsvp','join','preview_join','roster','reminder_candidates','link_community','unlink_community') THEN RETURN missing; END IF;

  -- Lock memberships before the event. Grant writes take that membership lock through
  -- the existing grant-revision trigger. They never take an event lock.
  IF p_action IN ('rsvp','join') THEN
    PERFORM 1 FROM public.community_memberships m WHERE m.tenant_id=p_tenant AND m.user_id=actor
      ORDER BY m.community_id FOR SHARE;
  END IF;
  IF p_action IN ('save','publish','cancel','preview_join','roster','reminder_candidates','link_community','unlink_community') THEN
    PERFORM 1 FROM public.workspace_members w WHERE w.tenant_id=p_tenant AND w.user_id=actor FOR SHARE;
  END IF;
  is_manager:=EXISTS (SELECT FROM public.workspace_members w WHERE w.tenant_id=p_tenant AND w.user_id=actor AND w.role_id IN ('owner','admin'));
  IF p_action IN ('save','publish','cancel','preview_join','roster','reminder_candidates','link_community','unlink_community') AND NOT is_manager THEN RETURN missing; END IF;

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
  IF p_action IN ('save','publish','cancel','rsvp','join','preview_join','link_community','unlink_community') THEN
    SELECT * INTO event FROM public.events e WHERE e.tenant_id=p_tenant AND e.id=p_id FOR UPDATE;
  ELSE
    SELECT * INTO event FROM public.events e WHERE e.tenant_id=p_tenant AND e.id=p_id;
  END IF;
  moment:=clock_timestamp();

  IF p_action IN ('link_community','unlink_community') THEN
    IF event.id IS NULL THEN RETURN missing; END IF;
    target_community:=(p_input->>'communityId')::uuid;
    IF NOT EXISTS (SELECT FROM public.communities c WHERE c.tenant_id=p_tenant AND c.id=target_community) THEN RETURN missing; END IF;
    -- The event lock serializes placements with RSVP and capacity decisions.
    IF p_action='link_community' THEN
      INSERT INTO public.community_event_links(tenant_id,event_id,community_id)
        VALUES(p_tenant,p_id,target_community) ON CONFLICT (tenant_id,event_id,community_id) DO NOTHING;
    ELSE
      DELETE FROM public.community_event_links WHERE tenant_id=p_tenant AND event_id=p_id AND community_id=target_community;
    END IF;
    placement_changed:=FOUND;
    IF placement_changed THEN
      INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata)
        VALUES(p_tenant,actor,'events.' || p_action,p_id::text,jsonb_build_object('communityId',target_community));
    END IF;
    RETURN jsonb_build_object('outcome','ok','data',jsonb_build_object('linked',p_action='link_community'));
  END IF;

  IF p_action='save' THEN
    expected:=(p_input->>'version')::integer;
    start_at:=(p_input->>'startsAt')::timestamptz;
    end_at:=(p_input->>'endsAt')::timestamptz;
    limit_capacity:=(p_input->>'capacity')::integer;
    lead_minutes:=(p_input->>'reminderMinutes')::integer;
    event_location:=CASE WHEN p_input ? 'location' THEN nullif(btrim(p_input->>'location'),'') ELSE event.location END;
    queue_enabled:=coalesce((p_input->>'waitlistEnabled')::boolean,event.waitlist_enabled,true);
    join_window:=(p_input->>'joinWindowMinutes')::integer;
    IF expected IS NULL OR expected<0 OR start_at IS NULL OR end_at IS NULL OR start_at>=end_at OR
      coalesce(length(btrim(p_input->>'title')),0) NOT BETWEEN 1 AND 120 OR
      coalesce(length(p_input->>'description'),0)>4000 OR (limit_capacity IS NOT NULL AND limit_capacity<1) OR
      (join_window IS NOT NULL AND join_window NOT BETWEEN 0 AND 1440) OR
      (event_location IS NOT NULL AND (length(event_location)>240 OR event_location ~ '[[:cntrl:]]')) OR
      (lead_minutes IS NOT NULL AND lead_minutes NOT BETWEEN 1 AND 10080) OR
      NOT EXISTS (SELECT FROM pg_timezone_names WHERE name=p_input->>'timeZone') THEN RETURN invalid; END IF;
    IF expected=0 THEN
      IF event.id IS NULL THEN
        INSERT INTO public.events(tenant_id,id,title,description,time_zone,starts_at,ends_at,capacity,reminder_minutes,location,waitlist_enabled,created_by)
          VALUES(p_tenant,p_id,btrim(p_input->>'title'),coalesce(p_input->>'description',''),p_input->>'timeZone',start_at,end_at,limit_capacity,lead_minutes,event_location,queue_enabled,actor)
          ON CONFLICT DO NOTHING RETURNING * INTO event;
        IF event.id IS NOT NULL THEN wanted:='create';
        ELSE SELECT * INTO event FROM public.events WHERE tenant_id=p_tenant AND id=p_id FOR UPDATE;
        END IF;
      END IF;
      IF wanted IS NULL THEN
        SELECT * INTO link FROM public.event_join_links WHERE tenant_id=p_tenant AND event_id=p_id;
        IF event.version=1 AND event.created_by=actor AND
          (event.title,event.description,event.time_zone,event.starts_at,event.ends_at,event.capacity,event.reminder_minutes,event.location,event.waitlist_enabled,link.url,link.window_minutes)
           IS NOT DISTINCT FROM (btrim(p_input->>'title'),coalesce(p_input->>'description',''),p_input->>'timeZone',start_at,end_at,limit_capacity,lead_minutes,
             nullif(btrim(p_input->>'location'),''),coalesce((p_input->>'waitlistEnabled')::boolean,true),p_input->>'joinUrl',CASE WHEN p_input->>'joinUrl' IS NOT NULL THEN coalesce(join_window,30) END) THEN
          RETURN jsonb_build_object('outcome','ok','data',public.events_project(event,actor,moment));
        END IF;
        RETURN stale;
      END IF;
    ELSE
      IF event.id IS NULL THEN RETURN missing; END IF;
      IF event.version<>expected OR event.status='cancelled' THEN RETURN stale; END IF;
      IF limit_capacity IS NOT NULL AND limit_capacity<public.events_occupied(p_tenant,p_id,moment) THEN RETURN jsonb_build_object('outcome','full'); END IF;
      UPDATE public.events SET title=btrim(p_input->>'title'),description=coalesce(p_input->>'description',''),
        time_zone=p_input->>'timeZone',starts_at=start_at,ends_at=end_at,capacity=limit_capacity,reminder_minutes=lead_minutes,location=event_location,waitlist_enabled=queue_enabled,
        version=version+1,updated_at=moment WHERE tenant_id=p_tenant AND id=p_id RETURNING * INTO event;
      wanted:='update';
    END IF;
    IF p_input->>'joinUrl' IS NULL THEN
      DELETE FROM public.event_join_links WHERE tenant_id=p_tenant AND event_id=p_id;
    ELSE
      INSERT INTO public.event_join_links(tenant_id,event_id,url,window_minutes)
        VALUES(p_tenant,p_id,p_input->>'joinUrl',coalesce(join_window,30))
        ON CONFLICT(tenant_id,event_id) DO UPDATE SET url=excluded.url,window_minutes=coalesce(join_window,public.event_join_links.window_minutes);
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
          IF wanted='waitlisted' AND (NOT event.waitlist_enabled OR event.capacity IS NULL OR event.starts_at<=moment) THEN RETURN invalid; END IF;
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
