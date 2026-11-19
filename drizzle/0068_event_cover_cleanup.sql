-- Upload intents are counted across managers. Serialize the cap with create, confirm and attach.
CREATE FUNCTION public.events_cap_pending_covers() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.status IN ('pending','uploaded') AND NEW.retired_at IS NULL THEN
    PERFORM 1 FROM public.events WHERE tenant_id=NEW.tenant_id AND id=NEW.event_id FOR UPDATE;
    IF (SELECT count(*) FROM public.event_files WHERE tenant_id=NEW.tenant_id AND event_id=NEW.event_id
        AND status IN ('pending','uploaded') AND retired_at IS NULL) >= 10 THEN
      RAISE EXCEPTION 'too many pending event cover uploads' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.events_cap_pending_covers() FROM PUBLIC, harvest_app;
CREATE TRIGGER events_cap_pending_covers BEFORE INSERT ON public.event_files
  FOR EACH ROW EXECUTE FUNCTION public.events_cap_pending_covers();

--> statement-breakpoint
-- The migration owner needs cross-ministry reads only inside the dedicated worker functions.
-- Normal event reads, row locks and file changes continue to use app.events_tenant.
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY event_cover_cleanup_scan ON public.event_files FOR SELECT TO %I
    USING (session_user='harvest_worker')$p$,current_user);
  EXECUTE format($p$CREATE POLICY event_cover_cleanup_read ON public.outbox_events FOR SELECT TO %I
    USING (session_user='harvest_worker' AND kind='events.cover_cleanup')$p$,current_user);
  EXECUTE format($p$CREATE POLICY event_cover_cleanup_mark ON public.outbox_events FOR UPDATE TO %I
    USING (session_user='harvest_worker' AND kind='events.cover_cleanup')
    WITH CHECK (session_user='harvest_worker' AND kind='events.cover_cleanup')$p$,current_user);
END $$;

CREATE FUNCTION public.events_cover_retire_abandoned(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE candidate record; current_cover uuid; payload jsonb; retired integer:=0;
  cutoff timestamptz:=statement_timestamp()-interval '24 hours';
  previous_tenant text:=current_setting('app.events_tenant',true);
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE invalid_parameter_value; END IF;
  FOR candidate IN SELECT id,tenant_id,event_id FROM public.event_files
    WHERE retired_at IS NULL AND status IN ('pending','uploaded') AND created_at<cutoff
    ORDER BY created_at,id LIMIT p_limit
  LOOP
    PERFORM set_config('app.events_tenant',candidate.tenant_id::text,true);
    SELECT cover_file_id INTO current_cover FROM public.events
      WHERE tenant_id=candidate.tenant_id AND id=candidate.event_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR current_cover=candidate.id THEN CONTINUE; END IF;
    UPDATE public.event_files SET retired_at=clock_timestamp()
      WHERE tenant_id=candidate.tenant_id AND event_id=candidate.event_id AND id=candidate.id
        AND retired_at IS NULL AND status IN ('pending','uploaded') AND created_at<cutoff;
    IF NOT FOUND THEN CONTINUE; END IF;
    payload:=jsonb_build_object('eventId',candidate.event_id,'fileId',candidate.id);
    INSERT INTO public.outbox_events(tenant_id,kind,idempotency_key,fingerprint,payload,scheduled_for)
      VALUES(candidate.tenant_id,'events.cover_cleanup','events.cover_cleanup:' || candidate.id::text,
        encode(sha256(convert_to(payload::text,'UTF8')),'hex'),payload,clock_timestamp())
      ON CONFLICT DO NOTHING;
    retired:=retired+1;
  END LOOP;
  PERFORM set_config('app.events_tenant',coalesce(previous_tenant,''),true);
  RETURN retired;
END $$;

-- The caller holds this transaction open through object deletion and completion.
-- An outbox payload never supplies an object key. Only the matching retired row may supply it.
CREATE FUNCTION public.events_cover_cleanup_record(p_complete uuid,p_skip uuid[])
RETURNS TABLE(file_id uuid,object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job record; current_cover uuid; file_key text;
  previous_tenant text:=current_setting('app.events_tenant',true);
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  SELECT o.id,o.tenant_id,f.id AS file_id,f.event_id INTO job
    FROM public.outbox_events o JOIN public.event_files f ON f.tenant_id=o.tenant_id
      AND f.id::text=o.payload->>'fileId' AND f.event_id::text=o.payload->>'eventId'
    WHERE o.kind='events.cover_cleanup' AND o.dispatched_at IS NULL AND o.scheduled_for<=statement_timestamp()
      AND o.idempotency_key='events.cover_cleanup:' || f.id::text AND f.retired_at IS NOT NULL
      AND (p_complete IS NULL OR f.id=p_complete) AND NOT (f.id=ANY(p_skip))
    ORDER BY o.scheduled_for,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM set_config('app.events_tenant',job.tenant_id::text,true);
  SELECT cover_file_id INTO current_cover FROM public.events
    WHERE tenant_id=job.tenant_id AND id=job.event_id FOR UPDATE SKIP LOCKED;
  IF FOUND AND current_cover IS DISTINCT FROM job.file_id THEN
    SELECT key INTO file_key FROM public.event_files WHERE tenant_id=job.tenant_id AND event_id=job.event_id
      AND id=job.file_id AND retired_at IS NOT NULL FOR UPDATE;
  END IF;

  IF p_complete IS NOT NULL AND file_key IS NOT NULL THEN
    DELETE FROM public.event_files WHERE tenant_id=job.tenant_id AND event_id=job.event_id AND id=job.file_id;
    UPDATE public.outbox_events SET dispatched_at=clock_timestamp() WHERE tenant_id=job.tenant_id AND id=job.id;
  END IF;
  PERFORM set_config('app.events_tenant',coalesce(previous_tenant,''),true);
  RETURN QUERY SELECT job.file_id,file_key;
END $$;

CREATE FUNCTION public.events_cover_cleanup_pending() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  RETURN EXISTS (SELECT FROM public.outbox_events WHERE kind='events.cover_cleanup'
      AND dispatched_at IS NULL AND scheduled_for<=statement_timestamp())
    OR EXISTS (SELECT FROM public.event_files WHERE retired_at IS NULL AND status IN ('pending','uploaded')
      AND created_at<statement_timestamp()-interval '24 hours');
END $$;

REVOKE ALL ON FUNCTION public.events_cover_retire_abandoned(integer), public.events_cover_cleanup_record(uuid,uuid[]),
  public.events_cover_cleanup_pending() FROM PUBLIC, harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.events_cover_retire_abandoned(integer), public.events_cover_cleanup_record(uuid,uuid[]),
      public.events_cover_cleanup_pending() TO harvest_worker;
  END IF;
END $$;
