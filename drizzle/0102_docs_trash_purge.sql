ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_system_actor";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_system_actor" CHECK ("audit_logs"."actor_id" is not null or "audit_logs"."action" in ('followup.case.withdraw', 'followup.case.revoke', 'community.live.auto_close', 'community.moderation_report_expire', 'newsletter.signup.confirmed', 'newsletter.unsubscribe.list', 'newsletter.unsubscribe.all', 'newsletter.withdrawal.propagated', 'community.profile_save', 'community.profile_withdraw', 'community.profile_erase', 'crm.form.submit', 'docs.trash.purge'));--> statement-breakpoint
-- Docs trash retention: a doc that has been in the trash for 30 days is purged for good by the worker role, in bounded batches.
-- The worker is not a tenant member, so the purge works through policies that apply only to a non-application owner, only for the worker's
-- session and only while the purge function has switched app.docs_purge on inside its own transaction.
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['docs','doc_pages','doc_favorites'] LOOP
    EXECUTE format($p$CREATE POLICY docs_purge_read ON public.%I FOR SELECT TO PUBLIC
      USING (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.docs_purge', true) = 'on')$p$, rel);
    EXECUTE format($p$CREATE POLICY docs_purge_remove ON public.%I FOR DELETE TO PUBLIC
      USING (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.docs_purge', true) = 'on')$p$, rel);
  END LOOP;
END $$;
--> statement-breakpoint
-- The purge locks the doc row (SELECT ... FOR UPDATE needs an UPDATE policy); WITH CHECK (false) means it can never change one.
CREATE POLICY docs_purge_lock ON public.docs FOR UPDATE TO PUBLIC
  USING (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.docs_purge', true) = 'on' AND deleted_at IS NOT NULL)
  WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY docs_purge_audit ON public.audit_logs FOR INSERT TO PUBLIC
  WITH CHECK (current_user <> 'harvest_app' AND session_user = 'harvest_worker' AND current_setting('app.docs_purge', true) = 'on'
    AND actor_id IS NULL AND action = 'docs.trash.purge' AND target_id IS NULL);
--> statement-breakpoint
CREATE FUNCTION public.docs_purge_trash(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  cutoff timestamptz := clock_timestamp() - interval '30 days';
  previous text := current_setting('app.docs_purge', true);
  candidate record; tally record; purged integer := 0; blocked integer := 0; extra text; tenants uuid[] := ARRAY[]::uuid[];
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.docs_purge', 'on', true);
  FOR candidate IN SELECT d.tenant_id, d.id FROM public.docs d
    WHERE d.deleted_at IS NOT NULL AND d.deleted_at < cutoff ORDER BY d.deleted_at, d.id LIMIT p_limit
  LOOP
    BEGIN
      -- The lock and the re-check make a restore that lands first win; a doc restored after the scan is left alone.
      PERFORM 1 FROM public.docs WHERE tenant_id = candidate.tenant_id AND id = candidate.id AND deleted_at IS NOT NULL AND deleted_at < cutoff FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN CONTINUE; END IF;
      -- Tables from later Docs slices (comments, shares, links, history, attachments, notifications) are cleared when they exist.
      FOREACH extra IN ARRAY ARRAY['doc_page_shares', 'doc_shares', 'doc_comments', 'doc_links', 'doc_page_versions', 'doc_attachments', 'doc_notifications'] LOOP
        IF to_regclass('public.' || extra) IS NOT NULL THEN
          EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1 AND doc_id = $2', extra) USING candidate.tenant_id, candidate.id;
        END IF;
      END LOOP;
      DELETE FROM public.doc_favorites WHERE tenant_id = candidate.tenant_id AND doc_id = candidate.id;
      DELETE FROM public.doc_pages WHERE tenant_id = candidate.tenant_id AND doc_id = candidate.id;
      DELETE FROM public.docs WHERE tenant_id = candidate.tenant_id AND id = candidate.id;
      tenants := tenants || candidate.tenant_id;
      purged := purged + 1;
    EXCEPTION WHEN foreign_key_violation OR insufficient_privilege THEN
      -- A table this function cannot clear yet leaves the doc in the trash for the next run instead of failing the batch.
      blocked := blocked + 1;
    END;
  END LOOP;
  -- One audit row per ministry with the count only: no title, id or content of a purged doc is kept.
  FOR tally IN SELECT tenant_id, count(*)::integer AS n FROM unnest(tenants) AS t(tenant_id) GROUP BY tenant_id LOOP
    INSERT INTO public.audit_logs(tenant_id, actor_id, action, metadata)
      VALUES (tally.tenant_id, NULL, 'docs.trash.purge', jsonb_build_object('count', tally.n::text));
  END LOOP;
  PERFORM set_config('app.docs_purge', coalesce(previous, ''), true);
  RETURN purged;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.docs_purge_trash(integer) FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.docs_purge_trash(integer) TO harvest_worker;
  END IF;
END $$;
