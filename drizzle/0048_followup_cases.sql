CREATE TABLE "followup_cases" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"state" text DEFAULT 'requested' NOT NULL,
	"assignee_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	CONSTRAINT "followup_cases_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "followup_case_state" CHECK ("followup_cases"."state" in ('requested', 'awaiting_assignment', 'assigned', 'attempted', 'no_response', 'connected', 'closed', 'withdrawn')),
	CONSTRAINT "followup_case_assignee" CHECK (("followup_cases"."state" in ('assigned', 'attempted') and "followup_cases"."assignee_id" is not null)
    or ("followup_cases"."state" in ('requested', 'awaiting_assignment', 'withdrawn') and "followup_cases"."assignee_id" is null) or "followup_cases"."state" in ('no_response', 'connected', 'closed')),
	CONSTRAINT "followup_case_assigned_at" CHECK (("followup_cases"."assignee_id" is null) or ("followup_cases"."assigned_at" is not null)),
	CONSTRAINT "followup_case_version" CHECK ("followup_cases"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "followup_cases" ADD CONSTRAINT "followup_cases_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_cases" ADD CONSTRAINT "followup_cases_tenant_id_response_id_campaign_responses_tenant_id_id_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."campaign_responses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_cases" ADD CONSTRAINT "followup_cases_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_cases" ADD CONSTRAINT "followup_cases_tenant_id_assignee_id_workspace_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","assignee_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "followup_cases_response_idx" ON "followup_cases" USING btree ("tenant_id","response_id");--> statement-breakpoint
CREATE INDEX "followup_cases_queue_idx" ON "followup_cases" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "followup_cases_assignee_idx" ON "followup_cases" USING btree ("tenant_id","assignee_id","created_at","id") WHERE "followup_cases"."assignee_id" is not null;--> statement-breakpoint
CREATE INDEX "followup_cases_contact_idx" ON "followup_cases" USING btree ("tenant_id","contact_id");--> statement-breakpoint
-- HC-13 (server side). The DDL above is generated from src/db/schema.ts; everything below is hand-written. Spec: docs/plans/hc-13-follow-up-cases.md.
-- Nothing here sends a message, collects data or enables an intake path. Cases hold ids, a state and timestamps only.

-- 1) The transition table, in one place. src/lib/follow-up-cases.ts mirrors it and a test compares the two.
CREATE FUNCTION public.followup_case_transition_allowed(p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM (VALUES
    ('requested', 'awaiting_assignment'), ('requested', 'withdrawn'),
    ('awaiting_assignment', 'assigned'), ('awaiting_assignment', 'withdrawn'),
    ('assigned', 'assigned'), ('assigned', 'awaiting_assignment'), ('assigned', 'attempted'), ('assigned', 'withdrawn'),
    ('attempted', 'assigned'), ('attempted', 'awaiting_assignment'), ('attempted', 'connected'), ('attempted', 'no_response'), ('attempted', 'withdrawn'),
    ('no_response', 'assigned'), ('no_response', 'awaiting_assignment'), ('no_response', 'attempted'), ('no_response', 'closed'), ('no_response', 'withdrawn'),
    ('connected', 'closed'), ('connected', 'withdrawn')) AS t(a, b) WHERE t.a = p_from AND t.b = p_to)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_case_transition_allowed(text, text) FROM PUBLIC;--> statement-breakpoint

-- 2) Follow-up consent recheck (HC-06: "a response and a CRM withdrawal must agree before any assigner acts"). True only while the
-- response's own grant is unwithdrawn AND the CRM ledger's effective state for that contact, purpose and channel is granted (same rule as
-- the consent ledger: an unsuperseded withdrawal wins on both clocks, otherwise the latest decision). Invoker rights; no application grant.
CREATE FUNCTION public.followup_consent_effective(p_tenant uuid, p_response uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_responses r
    JOIN public.campaign_response_consents g ON g.tenant_id = r.tenant_id AND g.response_id = r.id AND g.purpose = 'outreach_follow_up'
      AND g.status = 'granted' AND g.redacted_at IS NULL AND g.channel IS NOT NULL
    WHERE r.tenant_id = p_tenant AND r.id = p_response AND r.status = 'associated' AND r.contact_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.campaign_response_consents w WHERE w.tenant_id = r.tenant_id AND w.response_id = r.id
        AND w.purpose = 'outreach_follow_up' AND w.status = 'withdrawn')
      AND NOT EXISTS (SELECT 1 FROM public.contact_consents w WHERE w.tenant_id = r.tenant_id AND w.contact_id = r.contact_id
        AND w.purpose = 'outreach_follow_up' AND w.channel = g.channel AND w.status = 'withdrawn' AND w.redacted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.contact_consents n WHERE n.tenant_id = w.tenant_id AND n.contact_id = w.contact_id
          AND n.channel = w.channel AND n.purpose = w.purpose AND n.status = 'granted' AND n.redacted_at IS NULL
          AND n.recorded_at > w.recorded_at AND n.occurred_at > w.occurred_at))
      AND (SELECT l.status FROM public.contact_consents l WHERE l.tenant_id = r.tenant_id AND l.contact_id = r.contact_id
        AND l.purpose = 'outreach_follow_up' AND l.channel = g.channel AND l.redacted_at IS NULL
        ORDER BY l.recorded_at DESC, l.occurred_at DESC, l.id DESC LIMIT 1) = 'granted')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_consent_effective(uuid, uuid) FROM PUBLIC;--> statement-breakpoint

-- 3) Row-level security. Application role: read-only through the policy (owner/admin all, the assigned member their own open cases), minimal
-- columns, no write grant at all. campaign_id and response_id stay unreadable. The migration owner gets a tenant-scoped policy for the definers.
ALTER TABLE public.followup_cases ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.followup_cases FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.followup_cases FROM PUBLIC, harvest_app;--> statement-breakpoint
GRANT SELECT (tenant_id, id, state, contact_id, assignee_id, version, created_at, updated_at, state_changed_at, assigned_at) ON public.followup_cases TO harvest_app;--> statement-breakpoint
CREATE POLICY followup_cases_read ON public.followup_cases FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = followup_cases.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND (m.role_id IN ('owner', 'admin')
        OR (m.role_id = 'member' AND followup_cases.assignee_id = m.user_id AND followup_cases.state NOT IN ('closed', 'withdrawn')))));--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY followup_definer_tenant ON public.followup_cases TO %I
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, current_user);
END $$;--> statement-breakpoint

-- 4) The guard: the database refuses what the application and the definers must never do, whoever writes.
CREATE FUNCTION public.guard_followup_case() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only the response-scrub hook below deletes a case (nested one level deep, flag set by it).
    IF pg_trigger_depth() > 1 AND current_setting('app.followup_erasure', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'cases are removed only with their response' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'requested' OR NEW.assignee_id IS NOT NULL OR NEW.assigned_at IS NOT NULL OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'cases start requested and unassigned' USING ERRCODE = '23514';
    END IF;
    -- Lock order matches erasure and merge: contact first, then the response.
    PERFORM 1 FROM public.contacts ct WHERE ct.tenant_id = NEW.tenant_id AND ct.id = NEW.contact_id AND ct.erased_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'case contact is unavailable' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.campaign_responses r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.response_id AND r.status = 'associated'
      AND r.contact_id = NEW.contact_id AND r.campaign_id = NEW.campaign_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'case requires a verified associated response' USING ERRCODE = '23514'; END IF;
    IF NOT public.followup_consent_effective(NEW.tenant_id, NEW.response_id) THEN
      RAISE EXCEPTION 'follow-up consent is not in effect' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := now(); NEW.updated_at := now(); NEW.state_changed_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.campaign_id, NEW.response_id, NEW.created_at) IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.campaign_id, OLD.response_id, OLD.created_at) THEN
    RAISE EXCEPTION 'case identity is immutable' USING ERRCODE = '23514';
  END IF;
  -- The person reference changes only when an explicit merge moves the response (merge_contacts sets app.merge_source).
  IF NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    IF OLD.contact_id::text IS DISTINCT FROM nullif(current_setting('app.merge_source', true), '')
      OR NOT EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.tenant_id = NEW.tenant_id AND ct.id = NEW.contact_id AND ct.erased_at IS NULL) THEN
      RAISE EXCEPTION 'case contact changes only with a merge' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT public.followup_case_transition_allowed(OLD.state, NEW.state) THEN
      RAISE EXCEPTION 'case transition is not allowed' USING ERRCODE = '23514';
    END IF;
    NEW.state_changed_at := now();
  ELSIF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    -- Same state: only a reassignment of an assigned case, or clearing the assignee of a finished-contact case.
    IF NOT ((NEW.state = 'assigned' AND NEW.assignee_id IS NOT NULL) OR (NEW.assignee_id IS NULL AND NEW.state IN ('no_response', 'connected', 'closed'))) THEN
      RAISE EXCEPTION 'case assignment is not allowed in this state' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    IF NEW.assignee_id IS NOT NULL THEN
      PERFORM 1 FROM public.workspace_members m WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.assignee_id AND m.role_id IN ('owner', 'admin', 'member') FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'assignee is not an eligible member' USING ERRCODE = '23514'; END IF;
      NEW.assigned_at := now();
    END IF;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    NEW.version := OLD.version + 1; NEW.updated_at := now();
  ELSE
    NEW.version := OLD.version; NEW.assigned_at := OLD.assigned_at;
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_followup_case() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER followup_case_guard BEFORE INSERT OR UPDATE OR DELETE ON public.followup_cases
  FOR EACH ROW EXECUTE FUNCTION public.guard_followup_case();--> statement-breakpoint

-- 5) The acting member: live, same ministry, role owner/admin/member. Raises 42501 for everyone else (one answer for non-members,
-- viewers and forged contexts). Takes a share lock so a concurrent demotion waits. Invoker rights; only the definers below call it.
CREATE FUNCTION public.followup_actor_role(p_tenant uuid) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); actor_role text;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'follow-up access denied' USING ERRCODE = '42501';
  END IF;
  SELECT m.role_id INTO actor_role FROM public.workspace_members m WHERE m.tenant_id = p_tenant AND m.user_id = actor
    AND m.role_id IN ('owner', 'admin', 'member') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'follow-up access denied' USING ERRCODE = '42501'; END IF;
  RETURN actor_role;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_actor_role(uuid) FROM PUBLIC;--> statement-breakpoint

-- 6) Open cases for verified, associated responses whose follow-up consent is in effect. Owner/admin only, idempotent (one case per
-- response), bounded (default 50, at most 200 per call). Returns the number opened; one audit row per case, with the case id only.
CREATE FUNCTION public.open_eligible_followup_cases(p_tenant uuid, p_limit integer DEFAULT 50) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); actor_role text; cap integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  cand record; opened integer := 0; new_id uuid;
BEGIN
  actor_role := public.followup_actor_role(p_tenant);
  IF actor_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'follow-up access denied' USING ERRCODE = '42501'; END IF;
  FOR cand IN SELECT r.id AS response_id, r.campaign_id, r.contact_id FROM public.campaign_responses r
      WHERE r.tenant_id = p_tenant AND r.status = 'associated' AND r.contact_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.followup_cases c WHERE c.tenant_id = r.tenant_id AND c.response_id = r.id)
        AND public.followup_consent_effective(r.tenant_id, r.id)
      ORDER BY r.associated_at, r.id LIMIT cap LOOP
    -- Contact before response, as erasure and merge do; both are rechecked once locked.
    PERFORM 1 FROM public.contacts ct WHERE ct.tenant_id = p_tenant AND ct.id = cand.contact_id AND ct.erased_at IS NULL FOR SHARE;
    CONTINUE WHEN NOT FOUND;
    PERFORM 1 FROM public.campaign_responses r WHERE r.tenant_id = p_tenant AND r.id = cand.response_id AND r.status = 'associated'
      AND r.contact_id = cand.contact_id FOR SHARE;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN NOT public.followup_consent_effective(p_tenant, cand.response_id);
    new_id := NULL;
    INSERT INTO public.followup_cases (tenant_id, campaign_id, response_id, contact_id) VALUES (p_tenant, cand.campaign_id, cand.response_id, cand.contact_id)
      ON CONFLICT (tenant_id, response_id) DO NOTHING RETURNING id INTO new_id;
    IF new_id IS NOT NULL THEN
      opened := opened + 1;
      INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata) VALUES (p_tenant, actor, 'followup.case.open', new_id::text, '{}'::jsonb);
    END IF;
  END LOOP;
  RETURN opened;
END $$;--> statement-breakpoint

-- 7) Assign, reassign or unassign (p_assignee NULL). Owner/admin only. Optimistic version. The assignee must be an active member of this
-- ministry with role owner/admin/member (locked while we act, so a concurrent demotion waits or this fails). Assigning rechecks consent.
CREATE FUNCTION public.assign_followup_case(p_tenant uuid, p_case uuid, p_assignee text, p_version integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); actor_role text; c public.followup_cases; target text; updated public.followup_cases;
BEGIN
  actor_role := public.followup_actor_role(p_tenant);
  IF actor_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'follow-up access denied' USING ERRCODE = '42501'; END IF;
  -- Membership row before case row, the order demotion uses.
  IF p_assignee IS NOT NULL THEN
    PERFORM 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant AND m.user_id = p_assignee AND m.role_id IN ('owner', 'admin', 'member') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'assignee is not an eligible member' USING ERRCODE = '23514'; END IF;
  END IF;
  SELECT * INTO c FROM public.followup_cases f WHERE f.tenant_id = p_tenant AND f.id = p_case FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'case not found' USING ERRCODE = 'P0002'; END IF;
  IF c.version <> p_version THEN RAISE EXCEPTION 'case version conflict' USING ERRCODE = '40001'; END IF;
  IF p_assignee IS NULL THEN target := 'awaiting_assignment';
  ELSE
    target := 'assigned';
    IF c.state = 'assigned' AND c.assignee_id = p_assignee THEN
      RETURN jsonb_build_object('id', c.id, 'state', c.state, 'contactId', c.contact_id, 'assigneeId', c.assignee_id, 'version', c.version,
        'createdAt', c.created_at, 'updatedAt', c.updated_at, 'stateChangedAt', c.state_changed_at, 'assignedAt', c.assigned_at);
    END IF;
    IF NOT public.followup_consent_effective(p_tenant, c.response_id) THEN RAISE EXCEPTION 'follow-up consent is not in effect' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NOT public.followup_case_transition_allowed(c.state, target) THEN RAISE EXCEPTION 'case transition is not allowed' USING ERRCODE = '23514'; END IF;
  UPDATE public.followup_cases f SET state = target, assignee_id = p_assignee WHERE f.tenant_id = p_tenant AND f.id = p_case RETURNING * INTO updated;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata) VALUES (p_tenant, actor,
    CASE WHEN p_assignee IS NULL THEN 'followup.case.unassign' ELSE 'followup.case.assign' END, p_case::text,
    jsonb_strip_nulls(jsonb_build_object('from', c.state, 'to', target, 'assignee', p_assignee, 'previousAssignee', c.assignee_id)));
  RETURN jsonb_build_object('id', updated.id, 'state', updated.state, 'contactId', updated.contact_id, 'assigneeId', updated.assignee_id, 'version', updated.version,
    'createdAt', updated.created_at, 'updatedAt', updated.updated_at, 'stateChangedAt', updated.state_changed_at, 'assignedAt', updated.assigned_at);
END $$;--> statement-breakpoint

-- 8) Every other state change. Owner/admin: any legal transition. The assigned member (role member, case open and assigned to them):
-- contact progress only. A case that is not the caller's, or does not exist for a counselor, is the same 42501; only owners/admins learn 404.
CREATE FUNCTION public.transition_followup_case(p_tenant uuid, p_case uuid, p_to text, p_version integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); actor_role text; c public.followup_cases; updated public.followup_cases; manager boolean;
BEGIN
  actor_role := public.followup_actor_role(p_tenant);
  manager := actor_role IN ('owner', 'admin');
  SELECT * INTO c FROM public.followup_cases f WHERE f.tenant_id = p_tenant AND f.id = p_case FOR UPDATE;
  IF NOT FOUND THEN
    IF manager THEN RAISE EXCEPTION 'case not found' USING ERRCODE = 'P0002'; END IF;
    RAISE EXCEPTION 'follow-up access denied' USING ERRCODE = '42501';
  END IF;
  IF NOT manager AND (c.assignee_id IS DISTINCT FROM actor OR c.state IN ('closed', 'withdrawn')) THEN RAISE EXCEPTION 'follow-up access denied' USING ERRCODE = '42501'; END IF;
  IF p_to = 'assigned' THEN RAISE EXCEPTION 'use assignment to assign a case' USING ERRCODE = '23514'; END IF;
  IF NOT public.followup_case_transition_allowed(c.state, p_to) THEN RAISE EXCEPTION 'case transition is not allowed' USING ERRCODE = '23514'; END IF;
  IF NOT manager AND (c.state, p_to) NOT IN (('assigned', 'attempted'), ('attempted', 'connected'), ('attempted', 'no_response'), ('no_response', 'attempted'), ('connected', 'closed')) THEN
    RAISE EXCEPTION 'follow-up access denied' USING ERRCODE = '42501';
  END IF;
  IF c.version <> p_version THEN RAISE EXCEPTION 'case version conflict' USING ERRCODE = '40001'; END IF;
  -- Making contact is the act the consent gates: refuse it while follow-up is withdrawn or unrecorded.
  IF p_to = 'attempted' AND NOT public.followup_consent_effective(p_tenant, c.response_id) THEN RAISE EXCEPTION 'follow-up consent is not in effect' USING ERRCODE = '23514'; END IF;
  UPDATE public.followup_cases f SET state = p_to, assignee_id = CASE WHEN p_to IN ('awaiting_assignment', 'withdrawn') THEN NULL ELSE f.assignee_id END
    WHERE f.tenant_id = p_tenant AND f.id = p_case RETURNING * INTO updated;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata) VALUES (p_tenant, actor,
    CASE WHEN p_to = 'awaiting_assignment' AND c.assignee_id IS NOT NULL THEN 'followup.case.unassign' ELSE 'followup.case.transition' END, p_case::text,
    jsonb_strip_nulls(jsonb_build_object('from', c.state, 'to', p_to, 'previousAssignee', CASE WHEN p_to = 'awaiting_assignment' THEN c.assignee_id END)));
  RETURN jsonb_build_object('id', updated.id, 'state', updated.state, 'contactId', updated.contact_id, 'assigneeId', updated.assignee_id, 'version', updated.version,
    'createdAt', updated.created_at, 'updatedAt', updated.updated_at, 'stateChangedAt', updated.state_changed_at, 'assignedAt', updated.assigned_at);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.open_eligible_followup_cases(uuid, integer), public.assign_followup_case(uuid, uuid, text, integer), public.transition_followup_case(uuid, uuid, text, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.open_eligible_followup_cases(uuid, integer), public.assign_followup_case(uuid, uuid, text, integer), public.transition_followup_case(uuid, uuid, text, integer) TO harvest_app;--> statement-breakpoint

-- 9) Lifecycle hooks on existing tables (all invoker-neutral definers, tenant context set while they work).
-- 9a) A response scrub (contact erasure, response erasure, subject rights, retention expiry) deletes its case: nothing identifying survives
-- and the case id was never linked to the response id. Fires before the scrub re-keys the response.
CREATE FUNCTION public.followup_case_response_erased() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.tenant_id', true), '');
BEGIN
  PERFORM set_config('app.tenant_id', OLD.tenant_id::text, true);
  PERFORM set_config('app.followup_erasure', 'on', true);
  DELETE FROM public.followup_cases WHERE tenant_id = OLD.tenant_id AND response_id = OLD.id;
  PERFORM set_config('app.followup_erasure', '', true);
  PERFORM set_config('app.tenant_id', previous, true);
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_case_response_erased() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER campaign_response_followup_erase BEFORE UPDATE ON public.campaign_responses
  FOR EACH ROW WHEN (NEW.status = 'erased' AND OLD.status IS DISTINCT FROM 'erased') EXECUTE FUNCTION public.followup_case_response_erased();--> statement-breakpoint

-- 9b) An explicit merge moves the response to the kept contact; its case follows (the guard admits this only under app.merge_source).
CREATE FUNCTION public.followup_case_response_moved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.tenant_id', true), '');
BEGIN
  PERFORM set_config('app.tenant_id', NEW.tenant_id::text, true);
  UPDATE public.followup_cases SET contact_id = NEW.contact_id WHERE tenant_id = NEW.tenant_id AND response_id = NEW.id;
  PERFORM set_config('app.tenant_id', previous, true);
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_case_response_moved() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER campaign_response_followup_move AFTER UPDATE OF contact_id ON public.campaign_responses
  FOR EACH ROW WHEN (OLD.contact_id IS NOT NULL AND NEW.contact_id IS NOT NULL AND OLD.contact_id IS DISTINCT FROM NEW.contact_id)
  EXECUTE FUNCTION public.followup_case_response_moved();--> statement-breakpoint

-- 9c) Demotion to viewer, or removal, ends a member's assignments: their open cases return to the queue (the policy already hides them at once).
CREATE FUNCTION public.followup_member_revoked() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.tenant_id', true), '');
  actor text := coalesce(nullif(current_setting('app.user_id', true), ''), OLD.user_id); c record; next_state text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.role_id IN ('owner', 'admin', 'member') THEN RETURN NEW; END IF;
  PERFORM set_config('app.tenant_id', OLD.tenant_id::text, true);
  FOR c IN SELECT f.id, f.state FROM public.followup_cases f WHERE f.tenant_id = OLD.tenant_id AND f.assignee_id = OLD.user_id ORDER BY f.id FOR UPDATE LOOP
    next_state := CASE WHEN c.state IN ('assigned', 'attempted') THEN 'awaiting_assignment' ELSE c.state END;
    UPDATE public.followup_cases SET assignee_id = NULL, state = next_state WHERE tenant_id = OLD.tenant_id AND id = c.id;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
      VALUES (OLD.tenant_id, actor, 'followup.case.revoke', c.id::text, jsonb_build_object('from', c.state, 'to', next_state, 'previousAssignee', OLD.user_id));
  END LOOP;
  PERFORM set_config('app.tenant_id', previous, true);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.followup_member_revoked() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER workspace_member_followup_revoke BEFORE UPDATE OF role_id OR DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.followup_member_revoked();
