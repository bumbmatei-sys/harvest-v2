ALTER TABLE "audit_logs" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_system_actor" CHECK ("audit_logs"."actor_id" is not null or "audit_logs"."action" in ('followup.case.withdraw', 'followup.case.revoke'));
--> statement-breakpoint
-- HC-14 / system audit actors. No intake, delivery or read-policy changes. All defaults remain UNAPPROVED.
-- A NULL actor is a system action, not a login. audit_insert still rejects NULL for harvest_app.
-- Outstanding withdrawal uses the same two-clock / any-channel rule as 0050. A missing grant alone is not a withdrawal.
CREATE FUNCTION public.followup_withdrawal_recorded(p_tenant uuid, p_contact uuid, p_response uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.contact_consents w
    WHERE w.tenant_id = p_tenant AND w.contact_id = p_contact AND w.purpose = 'outreach_follow_up'
      AND w.status = 'withdrawn' AND w.redacted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.contact_consents g WHERE g.tenant_id = w.tenant_id AND g.contact_id = w.contact_id
        AND g.purpose = w.purpose AND g.channel = w.channel AND g.status = 'granted' AND g.redacted_at IS NULL
        AND g.recorded_at > w.recorded_at AND g.occurred_at > w.occurred_at))
    OR EXISTS (SELECT 1 FROM public.campaign_response_consents w WHERE w.tenant_id = p_tenant AND w.response_id = p_response
      AND w.purpose = 'outreach_follow_up' AND w.status = 'withdrawn' AND w.redacted_at IS NULL)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_withdrawal_recorded(uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
-- Only triggers and the migration call this; no runtime-role EXECUTE grant. Contact before case matches opening and merging.
CREATE FUNCTION public.withdraw_followup_cases(p_tenant uuid, p_contact uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.tenant_id', true), ''); c record;
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  PERFORM 1 FROM public.contacts WHERE tenant_id = p_tenant AND id = p_contact AND erased_at IS NULL FOR UPDATE;
  IF FOUND THEN
    FOR c IN SELECT f.id, f.state, f.response_id, f.assignee_id FROM public.followup_cases f
      WHERE f.tenant_id = p_tenant AND f.contact_id = p_contact AND f.state NOT IN ('closed', 'withdrawn') ORDER BY f.id FOR UPDATE LOOP
      IF public.followup_withdrawal_recorded(p_tenant, p_contact, c.response_id) THEN
        UPDATE public.followup_cases SET state = 'withdrawn', assignee_id = NULL WHERE tenant_id = p_tenant AND id = c.id;
        INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
          VALUES (p_tenant, NULL, 'followup.case.withdraw', c.id::text,
            jsonb_strip_nulls(jsonb_build_object('from', c.state, 'to', 'withdrawn', 'previousAssignee', c.assignee_id)));
      END IF;
    END LOOP;
  END IF;
  PERFORM set_config('app.tenant_id', previous, true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.withdraw_followup_cases(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.followup_consent_withdrawn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.withdraw_followup_cases(NEW.tenant_id, NEW.contact_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_consent_withdrawn() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER contact_consent_followup_withdraw AFTER INSERT ON public.contact_consents
  FOR EACH ROW WHEN (NEW.purpose = 'outreach_follow_up' AND NEW.status = 'withdrawn' AND NEW.redacted_at IS NULL)
  EXECUTE FUNCTION public.followup_consent_withdrawn();
--> statement-breakpoint
-- Merge moves all consent rows before moving responses. Evaluate the final ledger, not an intermediate row order:
-- a historical withdrawal already superseded on both clocks must not close a live target case.
CREATE CONSTRAINT TRIGGER contact_consent_followup_merge AFTER UPDATE ON public.contact_consents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.contact_id IS DISTINCT FROM NEW.contact_id AND NEW.contact_id IS NOT NULL
    AND NEW.purpose = 'outreach_follow_up' AND NEW.redacted_at IS NULL)
  EXECUTE FUNCTION public.followup_consent_withdrawn();
--> statement-breakpoint
-- The existing response projection inserts into contact_consents, so subject and staff response withdrawals use the trigger above.
-- Recheck after the response/case follows a merge as well: the kept contact may already have an outstanding withdrawal.
CREATE OR REPLACE FUNCTION public.followup_case_response_moved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.tenant_id', true), '');
BEGIN
  PERFORM set_config('app.tenant_id', NEW.tenant_id::text, true);
  UPDATE public.followup_cases SET contact_id = NEW.contact_id WHERE tenant_id = NEW.tenant_id AND response_id = NEW.id;
  PERFORM public.withdraw_followup_cases(NEW.tenant_id, NEW.contact_id);
  PERFORM set_config('app.tenant_id', previous, true);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_case_response_moved() FROM PUBLIC;
--> statement-breakpoint
-- Erasure still removes the case completely. Record its legal terminal transition before deletion, in the same transaction.
CREATE OR REPLACE FUNCTION public.followup_case_response_erased() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.tenant_id', true), '');
  previous_erasure text := coalesce(current_setting('app.followup_erasure', true), ''); c record;
BEGIN
  PERFORM set_config('app.tenant_id', OLD.tenant_id::text, true);
  FOR c IN SELECT f.id, f.state, f.assignee_id FROM public.followup_cases f WHERE f.tenant_id = OLD.tenant_id
    AND f.response_id = OLD.id AND f.state NOT IN ('closed', 'withdrawn') ORDER BY f.id FOR UPDATE LOOP
    UPDATE public.followup_cases SET state = 'withdrawn', assignee_id = NULL WHERE tenant_id = OLD.tenant_id AND id = c.id;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
      VALUES (OLD.tenant_id, NULL, 'followup.case.withdraw', c.id::text,
        jsonb_strip_nulls(jsonb_build_object('from', c.state, 'to', 'withdrawn', 'previousAssignee', c.assignee_id)));
  END LOOP;
  PERFORM set_config('app.followup_erasure', 'on', true);
  DELETE FROM public.followup_cases WHERE tenant_id = OLD.tenant_id AND response_id = OLD.id;
  PERFORM set_config('app.followup_erasure', previous_erasure, true);
  PERFORM set_config('app.tenant_id', previous, true);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_case_response_erased() FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.followup_member_revoked() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.tenant_id', true), '');
  c record; next_state text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.role_id IN ('owner', 'admin', 'member') THEN RETURN NEW; END IF;
  PERFORM set_config('app.tenant_id', OLD.tenant_id::text, true);
  FOR c IN SELECT f.id, f.state FROM public.followup_cases f WHERE f.tenant_id = OLD.tenant_id AND f.assignee_id = OLD.user_id ORDER BY f.id FOR UPDATE LOOP
    next_state := CASE WHEN c.state IN ('assigned', 'attempted') THEN 'awaiting_assignment' ELSE c.state END;
    UPDATE public.followup_cases SET assignee_id = NULL, state = next_state WHERE tenant_id = OLD.tenant_id AND id = c.id;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
      VALUES (OLD.tenant_id, NULL, 'followup.case.revoke', c.id::text, jsonb_build_object('from', c.state, 'to', next_state, 'previousAssignee', OLD.user_id));
  END LOOP;
  PERFORM set_config('app.tenant_id', previous, true);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_member_revoked() FROM PUBLIC;--> statement-breakpoint

-- Reconcile pre-0052 open cases, including upgrades from 0050. Temporary owner-only scan, removed before migration commits.
DO $$ BEGIN
  EXECUTE format('CREATE POLICY hc14_backfill_scan ON public.followup_cases FOR SELECT TO %I USING (true)', current_user);
END $$;
--> statement-breakpoint
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT DISTINCT tenant_id, contact_id FROM public.followup_cases WHERE state NOT IN ('closed', 'withdrawn') ORDER BY tenant_id, contact_id LOOP
    PERFORM public.withdraw_followup_cases(c.tenant_id, c.contact_id);
  END LOOP;
END $$;
--> statement-breakpoint
DROP POLICY hc14_backfill_scan ON public.followup_cases;
