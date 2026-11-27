CREATE TABLE "workspace_ownership_grants" (
	"token" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_ownership_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"from_revision" uuid NOT NULL,
	"to_revision" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_ownership_distinct_members" CHECK ("workspace_ownership_offers"."from_user_id" <> "workspace_ownership_offers"."to_user_id"),
	CONSTRAINT "workspace_ownership_offer_status" CHECK ("workspace_ownership_offers"."status" in ('pending','accepted','cancelled','declined','expired','membership_changed'))
);
--> statement-breakpoint
ALTER TABLE "crm_notifications" DROP CONSTRAINT "crm_notification_kind";--> statement-breakpoint
ALTER TABLE "crm_notifications" DROP CONSTRAINT "crm_notification_due_at";--> statement-breakpoint
ALTER TABLE "crm_notifications" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD COLUMN "ownership_offer_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "revision" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_ownership_offers" ADD CONSTRAINT "workspace_ownership_offers_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_ownership_offers" ADD CONSTRAINT "workspace_ownership_offers_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_ownership_offers" ADD CONSTRAINT "workspace_ownership_offers_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_ownership_one_offer" ON "workspace_ownership_offers" USING btree ("tenant_id") WHERE "workspace_ownership_offers"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notifications_ownership_offer_id_workspace_ownership_offers_id_fk" FOREIGN KEY ("ownership_offer_id") REFERENCES "public"."workspace_ownership_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notification_target" CHECK (num_nonnulls("crm_notifications"."task_id", "crm_notifications"."ownership_offer_id") = 1 and ("crm_notifications"."kind" = 'ownership_transfer') = ("crm_notifications"."ownership_offer_id" is not null));--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notification_kind" CHECK ("crm_notifications"."kind" in ('task_assigned', 'task_due', 'task_overdue', 'ownership_transfer'));--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notification_due_at" CHECK (("crm_notifications"."kind" in ('task_assigned', 'ownership_transfer')) = ("crm_notifications"."due_at" is null));
--> statement-breakpoint
-- Each write replaces the revision, even when a membership returns to its former role.
CREATE FUNCTION public.workspace_members_revise() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW.revision := pg_catalog.gen_random_uuid();
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_members_revise BEFORE INSERT OR UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.workspace_members_revise();
REVOKE ALL ON FUNCTION public.workspace_members_revise() FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE public.workspace_ownership_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_ownership_offers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_ownership_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_ownership_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_ownership_offers, public.workspace_ownership_grants FROM PUBLIC, harvest_app;
--> statement-breakpoint
-- Reuse the existing access flag names, with a random transaction-bound grant for the new policies.
DO $$
DECLARE grant_match text := $p$ (tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid
  AND EXISTS (SELECT 1 FROM public.workspace_ownership_grants g
    WHERE g.token::text = current_setting('app.access_token', true)
      AND g.actor_id = nullif(current_setting('app.user_id', true), '')
      AND g.tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid
      AND g.issued_at = pg_catalog.now())) $p$;
BEGIN
  EXECUTE format($p$CREATE POLICY workspace_ownership_grant ON public.workspace_ownership_grants TO %I
    USING (token::text = current_setting('app.access_token', true) AND issued_at = pg_catalog.now()
      AND actor_id = nullif(current_setting('app.user_id', true), '')
      AND tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format('CREATE POLICY workspace_ownership_offer ON public.workspace_ownership_offers TO %I USING (%s) WITH CHECK (%s)',
    current_user, grant_match, grant_match);
  EXECUTE format($p$CREATE POLICY workspace_ownership_audit ON public.audit_logs FOR INSERT TO %I
    WITH CHECK (tenant_id = nullif(current_setting('app.access_tenant',true),'')::uuid
      AND action = 'ministry.ownership_transfer')$p$, current_user);
  EXECUTE format($p$CREATE POLICY workspace_ownership_notification ON public.crm_notifications FOR INSERT TO %I
    WITH CHECK (tenant_id = nullif(current_setting('app.access_tenant',true),'')::uuid
      AND kind = 'ownership_transfer')$p$, current_user);
END $$;
ALTER POLICY crm_notifications_insert ON public.crm_notifications
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND kind <> 'ownership_transfer');
--> statement-breakpoint
-- Verify the grant only for ownership writes. Existing audit and notification definers can keep their
-- restricted table privileges, even when their owners share these tables and their owner-role policies.
CREATE FUNCTION public.workspace_ownership_guard_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'audit_logs' THEN
    IF NEW.action <> 'ministry.ownership_transfer' THEN RETURN NEW; END IF;
  ELSE
    IF NEW.kind <> 'ownership_transfer' THEN RETURN NEW; END IF;
  END IF;
  IF current_user = 'harvest_app' THEN
    RAISE EXCEPTION 'ownership event requires a live grant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT FROM public.workspace_ownership_grants g
    WHERE g.token::text = current_setting('app.access_token',true) AND g.tenant_id = NEW.tenant_id
      AND g.actor_id = nullif(current_setting('app.user_id',true),'') AND g.issued_at = pg_catalog.now()) THEN
    RAISE EXCEPTION 'ownership event requires a live grant' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workspace_ownership_guard_event() FROM PUBLIC;
CREATE TRIGGER workspace_ownership_guard_audit BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.workspace_ownership_guard_event();
CREATE TRIGGER workspace_ownership_guard_notification BEFORE INSERT ON public.crm_notifications
  FOR EACH ROW EXECUTE FUNCTION public.workspace_ownership_guard_event();
--> statement-breakpoint
CREATE FUNCTION public.workspace_ownership_transfer(p_tenant uuid, p_action text, p_recipient text, p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
  key uuid := pg_catalog.gen_random_uuid();
  recipient text;
  outcome text := 'not_found';
  offer public.workspace_ownership_offers%ROWTYPE;
  sender public.workspace_members%ROWTYPE;
  invited public.workspace_members%ROWTYPE;
  event_id uuid;
  result jsonb;
BEGIN
  -- blog_scope_clear() blanks app.tenant_id. The caller uses its own transaction for this function.
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  IF actor IS NULL OR p_tenant IS NULL OR p_action IS NULL
    OR p_action NOT IN ('offer', 'accept', 'cancel', 'decline', 'status')
    OR (p_action = 'offer' AND (p_offer IS NOT NULL OR p_recipient IS NULL))
    OR (p_action IN ('accept', 'cancel', 'decline') AND p_offer IS NULL) THEN
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;
  PERFORM set_config('app.user_id', actor, true);
  PERFORM set_config('app.access_tenant', p_tenant::text, true);
  PERFORM set_config('app.access_token', key::text, true);
  -- Serialize offer/expiry/decision, including a first offer when no row exists.
  IF p_action <> 'status' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('workspace-ownership:' || p_tenant::text, 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor) THEN
    PERFORM public.account_self_reset();
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;
  INSERT INTO public.workspace_ownership_grants (token, tenant_id, actor_id) VALUES (key, p_tenant, actor);

  SELECT * INTO offer FROM public.workspace_ownership_offers
    WHERE tenant_id = p_tenant AND id = coalesce(p_offer, id)
      AND (p_offer IS NOT NULL OR status = 'pending');
  event_id := offer.id;

  IF p_action = 'status' THEN
    IF offer.from_user_id = actor OR offer.to_user_id = actor THEN
      outcome := CASE WHEN offer.status = 'pending' AND offer.expires_at <= clock_timestamp() THEN 'expired' ELSE offer.status END;
    END IF;
  ELSIF p_action = 'offer' THEN
    recipient := p_recipient;
    PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id IN (actor, recipient) ORDER BY user_id FOR UPDATE;
    SELECT * INTO sender FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor;
    SELECT * INTO invited FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = recipient;
    IF public.access_role(p_tenant, sender.user_id, 'owner_admin', sender.role_id) IS DISTINCT FROM 'owner' THEN
      outcome := 'forbidden';
    ELSIF recipient = actor OR public.access_role(p_tenant, invited.user_id, 'owner_admin', invited.role_id) IS DISTINCT FROM 'admin' THEN
      outcome := 'ineligible_recipient';
    ELSIF offer.id IS NOT NULL AND offer.expires_at > clock_timestamp() THEN
      outcome := 'pending_exists';
    ELSE
      IF offer.id IS NOT NULL THEN
        UPDATE public.workspace_ownership_offers SET status = 'expired' WHERE id = offer.id;
        INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
          VALUES (p_tenant, actor, 'ministry.ownership_transfer', offer.id::text, jsonb_build_object('outcome', 'expired'));
      END IF;
      INSERT INTO public.workspace_ownership_offers (tenant_id, from_user_id, to_user_id, from_revision, to_revision, expires_at)
        VALUES (p_tenant, actor, recipient, sender.revision, invited.revision, clock_timestamp() + interval '14 days')
        RETURNING * INTO offer;
      event_id := offer.id;
      outcome := 'offered';
    END IF;
  ELSIF p_offer IS NOT NULL AND offer.id IS NOT NULL THEN
    IF actor IS DISTINCT FROM (CASE WHEN p_action = 'cancel' THEN offer.from_user_id ELSE offer.to_user_id END) THEN
      outcome := 'not_found';
      event_id := NULL;
    ELSIF offer.status <> 'pending' THEN
      outcome := 'already_closed';
    ELSIF offer.expires_at <= clock_timestamp() THEN
      outcome := 'expired';
    ELSIF p_action = 'cancel' THEN
      outcome := 'cancelled';
    ELSIF p_action = 'decline' THEN
      outcome := 'declined';
    ELSE
      PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id IN (offer.from_user_id, offer.to_user_id) ORDER BY user_id FOR UPDATE;
      SELECT * INTO sender FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = offer.from_user_id;
      SELECT * INTO invited FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = offer.to_user_id;
      IF offer.expires_at <= clock_timestamp() THEN
        outcome := 'expired';
      ELSIF sender.revision IS DISTINCT FROM offer.from_revision OR invited.revision IS DISTINCT FROM offer.to_revision
        OR public.access_role(p_tenant, sender.user_id, 'owner_admin', sender.role_id) IS DISTINCT FROM 'owner' OR public.access_role(p_tenant, invited.user_id, 'owner_admin', invited.role_id) IS DISTINCT FROM 'admin' THEN
        outcome := 'membership_changed';
      ELSE
        UPDATE public.workspace_members SET role_id = 'owner', can_manage_admins = false WHERE tenant_id = p_tenant AND user_id = offer.to_user_id;
        UPDATE public.workspace_members SET role_id = 'admin', can_manage_admins = false WHERE tenant_id = p_tenant AND user_id = offer.from_user_id;
        outcome := 'accepted';
      END IF;
    END IF;
    IF outcome IN ('expired', 'cancelled', 'declined', 'membership_changed', 'accepted') THEN
      UPDATE public.workspace_ownership_offers SET status = outcome WHERE id = offer.id;
    END IF;
  END IF;

  IF p_action <> 'status' THEN
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
      VALUES (p_tenant, actor, 'ministry.ownership_transfer', coalesce(event_id::text, p_tenant::text), jsonb_build_object('outcome', outcome));
    IF outcome IN ('offered', 'accepted', 'cancelled', 'declined') THEN
      -- Membership may have changed at cancel or decline. Skip a notice to someone who no longer has ministry access.
      INSERT INTO public.crm_notifications (tenant_id, recipient_user_id, actor_user_id, kind, ownership_offer_id)
        SELECT p_tenant, user_id, actor, 'ownership_transfer', offer.id
        FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id IN (offer.from_user_id, offer.to_user_id);
    END IF;
  END IF;
  result := jsonb_build_object('outcome', outcome);
  IF (p_action = 'status' AND outcome <> 'not_found') OR outcome = 'offered' THEN
    result := result || jsonb_build_object('id', offer.id, 'fromUserId', offer.from_user_id, 'toUserId', offer.to_user_id, 'expiresAt', offer.expires_at);
  END IF;
  DELETE FROM public.workspace_ownership_grants WHERE token = key;
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.user_id', actor, true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.workspace_ownership_transfer(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspace_ownership_transfer(uuid, text, text, uuid) TO harvest_app;
