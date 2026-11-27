CREATE TABLE "volunteer_assignments" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"user_id" text,
	"volunteer_id" uuid,
	CONSTRAINT "volunteer_assignments_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "volunteer_assignment_slot_user" UNIQUE("tenant_id","slot_id","user_id"),
	CONSTRAINT "volunteer_assignment_slot_volunteer" UNIQUE("tenant_id","slot_id","volunteer_id"),
	CONSTRAINT "volunteer_assignment_person" CHECK (num_nonnulls("volunteer_assignments"."user_id", "volunteer_assignments"."volunteer_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "volunteer_availability" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"unavailable_date" date NOT NULL,
	CONSTRAINT "volunteer_availability_tenant_id_user_id_unavailable_date_pk" PRIMARY KEY("tenant_id","user_id","unavailable_date")
);
--> statement-breakpoint
CREATE TABLE "volunteer_requests" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"replacement_user_id" text,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_requests_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "volunteer_request_state" CHECK ("volunteer_requests"."state" in ('pending','approved','rejected','cancelled')),
	CONSTRAINT "volunteer_request_kind" CHECK ((("volunteer_requests"."kind" = 'swap' and "volunteer_requests"."replacement_user_id" <> "volunteer_requests"."user_id") or "volunteer_requests"."kind" = 'decline') and ("volunteer_requests"."kind" = 'swap') = ("volunteer_requests"."replacement_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "volunteer_roles" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"department" text,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "volunteer_roles_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "volunteer_role_name" CHECK (length(btrim("volunteer_roles"."name")) between 1 and 120 and length("volunteer_roles"."description") <= 2000),
	CONSTRAINT "volunteer_role_department" CHECK ("volunteer_roles"."department" in ('campaign_leadership', 'church_mobilization', 'evangelistic_outreach', 'prayer_intercession', 'marketing_media', 'logistics_equipment', 'finance_fundraising', 'volunteers', 'counseling', 'discipleship_follow_up', 'worship_production', 'security_medical', 'transportation_hospitality'))
);
--> statement-breakpoint
CREATE TABLE "volunteer_roster_grants" (
	"backend" integer PRIMARY KEY NOT NULL,
	"transaction" text NOT NULL,
	"tenant_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volunteer_slots" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"event_id" uuid,
	"title" text NOT NULL,
	"service_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"needed" integer NOT NULL,
	"open" boolean DEFAULT false NOT NULL,
	CONSTRAINT "volunteer_slots_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "volunteer_slot_role" UNIQUE("tenant_id","id","role_id"),
	CONSTRAINT "volunteer_slot_details" CHECK (length(btrim("volunteer_slots"."title")) between 1 and 120 and "volunteer_slots"."needed" between 1 and 500 and "volunteer_slots"."ends_at" > "volunteer_slots"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "volunteers" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"user_id" text,
	"contact_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date,
	"note" text,
	CONSTRAINT "volunteers_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "volunteers_role_identity" UNIQUE("tenant_id","id","role_id"),
	CONSTRAINT "volunteer_person" CHECK (num_nonnulls("volunteers"."user_id", "volunteers"."contact_id") = 1),
	CONSTRAINT "volunteer_dates" CHECK ("volunteers"."end_date" >= "volunteers"."start_date" and length("volunteers"."note") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "crm_notifications" DROP CONSTRAINT "crm_notification_kind";--> statement-breakpoint
ALTER TABLE "crm_notifications" DROP CONSTRAINT "crm_notification_due_at";--> statement-breakpoint
ALTER TABLE "crm_notifications" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD COLUMN "volunteer_slot_id" uuid;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_tenant_id_slot_id_role_id_volunteer_slots_tenant_id_id_role_id_fk" FOREIGN KEY ("tenant_id","slot_id","role_id") REFERENCES "public"."volunteer_slots"("tenant_id","id","role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_tenant_id_volunteer_id_role_id_volunteers_tenant_id_id_role_id_fk" FOREIGN KEY ("tenant_id","volunteer_id","role_id") REFERENCES "public"."volunteers"("tenant_id","id","role_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_tenant_id_user_id_workspace_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_availability" ADD CONSTRAINT "volunteer_availability_tenant_id_user_id_workspace_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_requests" ADD CONSTRAINT "volunteer_requests_tenant_id_slot_id_volunteer_slots_tenant_id_id_fk" FOREIGN KEY ("tenant_id","slot_id") REFERENCES "public"."volunteer_slots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_requests" ADD CONSTRAINT "volunteer_requests_tenant_id_user_id_workspace_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_requests" ADD CONSTRAINT "volunteer_requests_tenant_id_replacement_user_id_workspace_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","replacement_user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_roles" ADD CONSTRAINT "volunteer_roles_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_slots" ADD CONSTRAINT "volunteer_slots_tenant_id_role_id_volunteer_roles_tenant_id_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."volunteer_roles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_slots" ADD CONSTRAINT "volunteer_slots_tenant_id_event_id_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_tenant_id_role_id_volunteer_roles_tenant_id_id_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."volunteer_roles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_tenant_id_user_id_workspace_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_request_pending" ON "volunteer_requests" USING btree ("tenant_id","slot_id","user_id") WHERE "volunteer_requests"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "volunteer_slot_date" ON "volunteer_slots" USING btree ("tenant_id","service_date","id");--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notifications_tenant_id_volunteer_slot_id_volunteer_slots_tenant_id_id_fk" FOREIGN KEY ("tenant_id","volunteer_slot_id") REFERENCES "public"."volunteer_slots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_notification_volunteer_reminder" ON "crm_notifications" USING btree ("tenant_id","volunteer_slot_id","recipient_user_id","due_at") WHERE "crm_notifications"."kind" = 'volunteer_reminder';--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notification_volunteer_target" CHECK (num_nonnulls("crm_notifications"."task_id", "crm_notifications"."volunteer_slot_id") = 1 and ("crm_notifications"."volunteer_slot_id" is not null) = ("crm_notifications"."kind" in ('volunteer_assigned','volunteer_changed','volunteer_reminder')));--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notification_kind" CHECK ("crm_notifications"."kind" in ('task_assigned', 'task_due', 'task_overdue', 'volunteer_assigned', 'volunteer_changed', 'volunteer_reminder'));--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notification_due_at" CHECK (("crm_notifications"."kind" in ('task_assigned','volunteer_assigned','volunteer_changed')) = ("crm_notifications"."due_at" is null));--> statement-breakpoint
CREATE FUNCTION public.volunteer_role(p_tenant uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.access_role(tenant_id,user_id,'owner_admin',role_id) FROM public.workspace_members
  WHERE tenant_id = p_tenant AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = nullif(current_setting('app.user_id', true), '')
$$;
REVOKE ALL ON FUNCTION public.volunteer_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.volunteer_role(uuid) TO harvest_app;
--> statement-breakpoint
ALTER TABLE public.volunteer_roster_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.volunteer_roster_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.volunteer_roster_grants FROM PUBLIC, harvest_app;
DO $$
DECLARE tbl text;
DECLARE staff text := 'public.volunteer_role(tenant_id) IN (''owner'',''admin'')';
DECLARE scope text := 'tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid
  AND EXISTS (SELECT FROM public.volunteer_roster_grants g WHERE g.backend = pg_backend_pid()
    AND g.transaction = pg_current_xact_id_if_assigned()::text)';
BEGIN
  EXECUTE format($p$CREATE POLICY volunteer_grant ON public.volunteer_roster_grants TO %I
    USING (backend = pg_backend_pid() AND transaction = pg_current_xact_id_if_assigned()::text
      AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, current_user);
  FOREACH tbl IN ARRAY ARRAY['volunteer_roles','volunteers','volunteer_slots','volunteer_assignments','volunteer_availability','volunteer_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', tbl);
    EXECUTE format('GRANT SELECT ON public.%I TO harvest_app', tbl);
    EXECUTE format('CREATE POLICY volunteer_staff ON public.%I TO harvest_app USING (%s) WITH CHECK (%s)', tbl, staff, staff);
    EXECUTE format('CREATE POLICY volunteer_scoped_definer ON public.%I TO %I USING (%s) WITH CHECK (%s)', tbl, current_user, scope, scope);
  END LOOP;
  EXECUTE format('CREATE POLICY volunteer_notice_insert ON public.crm_notifications FOR INSERT TO %I
    WITH CHECK (%s AND kind IN (''volunteer_assigned'',''volunteer_changed'',''volunteer_reminder''))', current_user, scope);
  EXECUTE format('CREATE POLICY volunteer_notice_reminder ON public.crm_notifications FOR SELECT TO %I
    USING (%s AND kind = ''volunteer_reminder'')', current_user, scope);
END $$;
GRANT INSERT, UPDATE ON public.volunteer_roles, public.volunteers, public.volunteer_slots TO harvest_app;
GRANT INSERT, DELETE ON public.volunteer_availability TO harvest_app;
CREATE POLICY volunteer_roles_read ON public.volunteer_roles FOR SELECT TO harvest_app
  USING (public.volunteer_role(tenant_id) = 'member' AND NOT archived);
CREATE POLICY volunteer_slots_read ON public.volunteer_slots FOR SELECT TO harvest_app
  USING (public.volunteer_role(tenant_id) = 'member' AND EXISTS (SELECT FROM public.volunteer_roles r
    WHERE r.tenant_id = volunteer_slots.tenant_id AND r.id = volunteer_slots.role_id AND NOT r.archived));
CREATE POLICY volunteer_assignments_read ON public.volunteer_assignments FOR SELECT TO harvest_app
  USING (public.volunteer_role(tenant_id) = 'member' AND user_id = nullif(current_setting('app.user_id', true), ''));
CREATE POLICY volunteer_requests_read ON public.volunteer_requests FOR SELECT TO harvest_app
  USING (public.volunteer_role(tenant_id) = 'member' AND user_id = nullif(current_setting('app.user_id', true), ''));
CREATE POLICY volunteer_availability_own ON public.volunteer_availability TO harvest_app
  USING (public.volunteer_role(tenant_id) = 'member' AND user_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (public.volunteer_role(tenant_id) = 'member' AND user_id = nullif(current_setting('app.user_id', true), ''));
--> statement-breakpoint
CREATE FUNCTION public.volunteer_notice_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.volunteer_slot_id IS NOT NULL AND (to_jsonb(NEW) - 'read_at') = (to_jsonb(OLD) - 'read_at') THEN RETURN NEW; END IF;
    IF NEW.volunteer_slot_id IS NOT NULL OR OLD.volunteer_slot_id IS NOT NULL THEN RAISE insufficient_privilege; END IF;
  ELSIF NEW.volunteer_slot_id IS NOT NULL THEN
    IF current_user = 'harvest_app' THEN RAISE insufficient_privilege; END IF;
    IF NOT EXISTS (SELECT FROM public.volunteer_roster_grants g WHERE g.backend = pg_backend_pid()
      AND g.tenant_id = NEW.tenant_id AND g.transaction = pg_current_xact_id_if_assigned()::text) THEN RAISE insufficient_privilege; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.volunteer_notice_guard() FROM PUBLIC;
CREATE TRIGGER volunteer_notice_guard BEFORE INSERT OR UPDATE ON public.crm_notifications
  FOR EACH ROW EXECUTE FUNCTION public.volunteer_notice_guard();
--> statement-breakpoint
CREATE FUNCTION public.volunteer_change(p_tenant uuid, p_action text, p_slot uuid, p_target text, p_id uuid, p_due timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id',true),'');
DECLARE prior jsonb;
DECLARE role text;
DECLARE is_staff boolean;
DECLARE slot public.volunteer_slots;
DECLARE request public.volunteer_requests;
DECLARE person text;
DECLARE volunteer uuid;
DECLARE result jsonb := '{"outcome":"ok"}';
DECLARE warnings text[] := ARRAY[]::text[];
BEGIN
  IF actor IS NULL OR p_tenant IS NULL THEN RETURN '{"outcome":"missing"}'; END IF;
  prior := public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.user_id', actor, true);
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  PERFORM set_config('app.access_tenant', p_tenant::text, true);
  SELECT public.access_role(m.tenant_id,m.user_id,'owner_admin',m.role_id) INTO role FROM public.workspace_members m WHERE m.tenant_id = p_tenant AND m.user_id = actor;
  IF role IS NULL OR role NOT IN ('owner','admin','member') THEN
    PERFORM public.blog_scope_restore(prior);
    RETURN '{"outcome":"missing"}';
  END IF;
  is_staff := role IN ('owner','admin');
  IF p_action <> 'counts' THEN PERFORM pg_advisory_xact_lock(hashtextextended('volunteer:' || p_tenant::text, 0)); END IF;
  INSERT INTO public.volunteer_roster_grants VALUES (pg_backend_pid(), pg_current_xact_id()::text, p_tenant);

  <<operation>>
  BEGIN
    IF p_action = 'counts' THEN
      SELECT jsonb_build_object('outcome','ok','counts',coalesce(jsonb_object_agg(id, filled),'{}')) INTO result
      FROM (SELECT s.id, count(a.id) AS filled FROM public.volunteer_slots s
        JOIN public.volunteer_roles r ON r.tenant_id = s.tenant_id AND r.id = s.role_id
        LEFT JOIN public.volunteer_assignments a ON a.tenant_id = s.tenant_id AND a.slot_id = s.id
        WHERE s.tenant_id = p_tenant AND (is_staff OR NOT r.archived)
        GROUP BY s.id) tally;
      EXIT operation;
    END IF;
    IF p_action IN ('approve','reject','withdraw') THEN
      SELECT * INTO request FROM public.volunteer_requests WHERE tenant_id = p_tenant AND id = p_id;
      IF request.id IS NULL OR (p_action = 'withdraw' AND request.user_id <> actor) OR (p_action <> 'withdraw' AND NOT is_staff) THEN
        result := '{"outcome":"missing"}'; EXIT operation;
      END IF;
      IF request.state <> 'pending' THEN result := '{"outcome":"conflict"}'; EXIT operation; END IF;
      p_slot := request.slot_id;
      IF p_action IN ('reject','withdraw') THEN
        UPDATE public.volunteer_requests SET state = CASE WHEN p_action = 'reject' THEN 'rejected' ELSE 'cancelled' END
          WHERE tenant_id = p_tenant AND id = request.id;
        IF p_action = 'reject' THEN
          INSERT INTO public.crm_notifications(tenant_id, recipient_user_id, actor_user_id, kind, volunteer_slot_id)
          VALUES (p_tenant, request.user_id, actor, 'volunteer_changed', p_slot);
        END IF;
        EXIT operation;
      END IF;
    END IF;
    SELECT * INTO slot FROM public.volunteer_slots WHERE tenant_id = p_tenant AND id = p_slot;
    IF slot.id IS NULL THEN result := '{"outcome":"missing"}'; EXIT operation; END IF;

    IF p_action IN ('swap','decline') THEN
      IF NOT EXISTS (SELECT FROM public.volunteer_assignments WHERE tenant_id = p_tenant AND slot_id = slot.id AND user_id = actor) OR
        (p_action = 'swap' AND (p_target IS NULL OR p_target = actor OR NOT EXISTS (
          SELECT FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = p_target AND public.access_role(tenant_id,user_id,'owner_admin',role_id) IN ('owner','admin','member')))) THEN
        result := '{"outcome":"missing"}'; EXIT operation;
      END IF;
      INSERT INTO public.volunteer_requests (tenant_id, slot_id, user_id, replacement_user_id, kind)
      VALUES (p_tenant, slot.id, actor, CASE WHEN p_action = 'swap' THEN p_target END, p_action)
      ON CONFLICT (tenant_id,slot_id,user_id) WHERE state = 'pending' DO NOTHING RETURNING * INTO request;
      result := CASE WHEN request.id IS NULL THEN '{"outcome":"conflict"}' ELSE jsonb_build_object('outcome','ok','id',request.id) END;
      EXIT operation;
    END IF;
    IF p_action = 'announce' AND is_staff THEN
      INSERT INTO public.crm_notifications(tenant_id, recipient_user_id, actor_user_id, kind, volunteer_slot_id)
      SELECT p_tenant, a.user_id, actor, 'volunteer_changed', slot.id FROM public.volunteer_assignments a
        WHERE a.tenant_id = p_tenant AND a.slot_id = slot.id AND a.user_id IS NOT NULL;
      EXIT operation;
    END IF;
    IF p_action = 'reminder' AND is_staff AND p_due IS NOT NULL AND p_due > clock_timestamp() AND p_due < slot.starts_at THEN
      INSERT INTO public.crm_notifications(tenant_id, recipient_user_id, actor_user_id, kind, volunteer_slot_id, due_at)
      SELECT p_tenant, a.user_id, actor, 'volunteer_reminder', slot.id, p_due FROM public.volunteer_assignments a
        WHERE a.tenant_id = p_tenant AND a.slot_id = slot.id AND a.user_id IS NOT NULL
      ON CONFLICT (tenant_id,volunteer_slot_id,recipient_user_id,due_at) WHERE kind = 'volunteer_reminder' DO NOTHING;
      EXIT operation;
    END IF;
    IF p_action = 'remove' AND is_staff THEN
      DELETE FROM public.volunteer_assignments WHERE tenant_id = p_tenant AND slot_id = slot.id AND id = p_id RETURNING user_id INTO person;
      IF NOT FOUND THEN result := '{"outcome":"missing"}'; EXIT operation; END IF;
      IF person IS NOT NULL THEN
        UPDATE public.volunteer_requests SET state = 'cancelled' WHERE tenant_id = p_tenant AND slot_id = slot.id AND user_id = person AND state = 'pending';
        INSERT INTO public.crm_notifications(tenant_id, recipient_user_id, actor_user_id, kind, volunteer_slot_id)
          VALUES (p_tenant, person, actor, 'volunteer_changed', slot.id);
      END IF;
      EXIT operation;
    END IF;

    IF p_action = 'signup' AND slot.open AND slot.starts_at > clock_timestamp() THEN person := actor;
    ELSIF p_action = 'assign' AND is_staff THEN
      IF p_id IS NULL THEN person := p_target;
      ELSE
        SELECT v.id, v.user_id INTO volunteer, person FROM public.volunteers v WHERE v.tenant_id = p_tenant AND v.id = p_id
          AND v.role_id = slot.role_id AND v.start_date <= slot.service_date AND (v.end_date IS NULL OR v.end_date >= slot.service_date);
        IF person IS NOT NULL THEN volunteer := NULL; END IF;
      END IF;
    ELSIF p_action = 'approve' AND is_staff THEN
      IF NOT EXISTS (SELECT FROM public.volunteer_assignments WHERE tenant_id = p_tenant AND slot_id = slot.id AND user_id = request.user_id) THEN
        result := '{"outcome":"conflict"}'; EXIT operation;
      END IF;
      person := request.replacement_user_id;
    ELSE result := '{"outcome":"missing"}'; EXIT operation;
    END IF;

    IF person IS NULL AND volunteer IS NULL AND p_action <> 'approve' THEN result := '{"outcome":"missing"}'; EXIT operation; END IF;
    IF person IS NOT NULL OR volunteer IS NOT NULL THEN
      IF NOT EXISTS (SELECT FROM public.volunteer_roles WHERE tenant_id = p_tenant AND id = slot.role_id AND NOT archived) OR
        (person IS NOT NULL AND NOT EXISTS (
          SELECT FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = person AND public.access_role(tenant_id,user_id,'owner_admin',role_id) IN ('owner','admin','member'))) THEN
        result := '{"outcome":"missing"}'; EXIT operation;
      END IF;
      IF (SELECT count(*) FROM public.volunteer_assignments WHERE tenant_id = p_tenant AND slot_id = slot.id) >= slot.needed AND p_action <> 'approve' THEN
        result := '{"outcome":"full"}'; EXIT operation;
      END IF;
      IF EXISTS (SELECT FROM public.volunteer_assignments WHERE tenant_id = p_tenant AND slot_id = slot.id
        AND (user_id = person OR volunteer_id = volunteer)) THEN result := '{"outcome":"conflict"}'; EXIT operation; END IF;

      IF EXISTS (SELECT FROM public.volunteer_availability WHERE tenant_id = p_tenant AND user_id = person AND unavailable_date = slot.service_date) THEN
        warnings := array_append(warnings,'unavailable');
      END IF;
      IF EXISTS (SELECT FROM public.volunteer_assignments a JOIN public.volunteer_slots s ON s.tenant_id = a.tenant_id AND s.id = a.slot_id
        WHERE a.tenant_id = p_tenant AND (a.user_id = person OR a.volunteer_id = volunteer) AND s.id <> slot.id
          AND s.starts_at < slot.ends_at AND s.ends_at > slot.starts_at) THEN
        warnings := array_append(warnings,'double_booked');
      END IF;
    END IF;
    IF p_action = 'approve' THEN
      DELETE FROM public.volunteer_assignments WHERE tenant_id = p_tenant AND slot_id = slot.id AND user_id = request.user_id;
      UPDATE public.volunteer_requests SET state = 'approved' WHERE tenant_id = p_tenant AND id = request.id;
      INSERT INTO public.crm_notifications(tenant_id, recipient_user_id, actor_user_id, kind, volunteer_slot_id)
        VALUES (p_tenant, request.user_id, actor, 'volunteer_changed', slot.id);
    END IF;
    IF person IS NOT NULL OR volunteer IS NOT NULL THEN
      INSERT INTO public.volunteer_assignments (tenant_id,slot_id,role_id,user_id,volunteer_id)
      VALUES (p_tenant,slot.id,slot.role_id,person,volunteer) RETURNING id INTO p_id;
      IF person IS NOT NULL THEN
        INSERT INTO public.crm_notifications(tenant_id,recipient_user_id,actor_user_id,kind,volunteer_slot_id)
          VALUES (p_tenant,person,actor,'volunteer_assigned',slot.id);
      END IF;
    END IF;
    result := jsonb_build_object('outcome','ok','warnings',to_jsonb(warnings),'id',CASE WHEN p_action = 'approve' THEN request.id ELSE p_id END);
  END operation;
  DELETE FROM public.volunteer_roster_grants WHERE backend = pg_backend_pid();
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.volunteer_change(uuid,text,uuid,text,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.volunteer_change(uuid,text,uuid,text,uuid,timestamptz) TO harvest_app;
