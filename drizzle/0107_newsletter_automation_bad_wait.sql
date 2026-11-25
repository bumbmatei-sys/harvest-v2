-- A malformed wait step stops only its own run; it no longer aborts the whole tick batch. Same signature, owner and grants as 0096.
CREATE OR REPLACE FUNCTION public.newsletter_automation_tick(p_limit integer, p_lease_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r record; step jsonb; idx integer; jobs jsonb := '[]'::jsonb; new_lease uuid; seconds bigint;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 3600 THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_auto_private', 'on', true);
  FOR r IN SELECT ru.tenant_id, ru.id, ru.step_index, ru.attempt_id, a.steps FROM public.newsletter_automation_runs ru
      JOIN public.newsletter_automations a ON a.tenant_id = ru.tenant_id AND a.id = ru.automation_id
      WHERE ru.state = 'active' AND ru.next_run_at <= clock_timestamp() AND (ru.lease IS NULL OR ru.lease_until <= clock_timestamp()) AND a.state = 'active'
      ORDER BY ru.next_run_at LIMIT p_limit FOR UPDATE OF ru SKIP LOCKED LOOP
    idx := r.step_index;
    IF r.attempt_id IS NOT NULL THEN
      UPDATE public.newsletter_automation_log SET outcome = 'unknown', reason = 'worker_lost' WHERE tenant_id = r.tenant_id AND run_id = r.id AND attempt_id = r.attempt_id AND outcome = 'unknown';
      idx := idx + 1;
    END IF;
    step := r.steps -> idx;
    IF step IS NULL OR step ->> 'type' = 'end' THEN
      UPDATE public.newsletter_automation_runs SET state = 'completed', step_index = idx, attempt_id = NULL, lease = NULL, lease_until = NULL, finished_at = clock_timestamp()
        WHERE tenant_id = r.tenant_id AND id = r.id;
      INSERT INTO public.newsletter_automation_log(tenant_id, run_id, step_index, step_type, outcome) VALUES (r.tenant_id, r.id, idx, 'end', 'completed');
    ELSIF step ->> 'type' = 'wait' THEN
      -- A wait step that cannot be read (a missing or oversized amount, an unknown unit) stops only this run, with a reason; the rest of the batch carries on.
      BEGIN
        IF step ->> 'unit' NOT IN ('hours', 'days') THEN RAISE invalid_parameter_value; END IF;
        seconds := (step ->> 'amount')::bigint * CASE step ->> 'unit' WHEN 'hours' THEN 3600 ELSE 86400 END;
        IF seconds <= 0 OR seconds > 315360000 THEN RAISE invalid_parameter_value; END IF;
        UPDATE public.newsletter_automation_runs SET step_index = idx + 1, attempt_id = NULL, lease = NULL, lease_until = NULL, next_run_at = clock_timestamp() + make_interval(secs => seconds)
          WHERE tenant_id = r.tenant_id AND id = r.id;
        INSERT INTO public.newsletter_automation_log(tenant_id, run_id, step_index, step_type, outcome, reason) VALUES (r.tenant_id, r.id, idx, 'wait', 'waiting', step ->> 'amount' || ' ' || (step ->> 'unit'));
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.newsletter_automation_runs SET state = 'stopped', stop_reason = 'invalid_step', step_index = idx, attempt_id = NULL, lease = NULL, lease_until = NULL, finished_at = clock_timestamp()
          WHERE tenant_id = r.tenant_id AND id = r.id;
        INSERT INTO public.newsletter_automation_log(tenant_id, run_id, step_index, step_type, outcome, reason) VALUES (r.tenant_id, r.id, idx, 'stopped', 'stopped', 'invalid_step');
      END;
    ELSE
      new_lease := gen_random_uuid();
      UPDATE public.newsletter_automation_runs SET step_index = idx, attempt_id = NULL, lease = new_lease, lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
        WHERE tenant_id = r.tenant_id AND id = r.id;
      jobs := jobs || jsonb_build_array(jsonb_build_object('tenant', r.tenant_id, 'run', r.id, 'lease', new_lease));
    END IF;
  END LOOP;
  RETURN jobs;
END $$;
