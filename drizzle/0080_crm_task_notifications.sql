CREATE TABLE "crm_notification_preferences" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"due" boolean DEFAULT true NOT NULL,
	"overdue" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_notification_preferences_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "crm_notifications" DROP CONSTRAINT "crm_notification_kind";--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_notification_preferences" ADD CONSTRAINT "crm_notification_preferences_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notification_preferences" ADD CONSTRAINT "crm_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_notifications_due_unique" ON "crm_notifications" USING btree ("tenant_id","task_id","recipient_user_id","kind","due_at") WHERE "crm_notifications"."kind" in ('task_due', 'task_overdue');--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notification_due_at" CHECK (("crm_notifications"."kind" = 'task_assigned') = ("crm_notifications"."due_at" is null));--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notification_kind" CHECK ("crm_notifications"."kind" in ('task_assigned', 'task_due', 'task_overdue'));--> statement-breakpoint
-- Preferences: each person reads and writes only their own row, in their own ministry.
ALTER TABLE crm_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_notification_preferences_own ON crm_notification_preferences TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = nullif(current_setting('app.user_id', true), ''));
GRANT SELECT, INSERT ON crm_notification_preferences TO harvest_app;
GRANT UPDATE (due, overdue, updated_at) ON crm_notification_preferences TO harvest_app;
--> statement-breakpoint
-- Due and overdue notices are generated lazily for the signed-in assignee only: the
-- existing insert policy lets any member insert, so a member may only insert a due or
-- overdue row for themselves (actor = recipient, as the provenance guard requires). (Assignment notices keep their actor-to-assignee shape.)
CREATE FUNCTION public.guard_crm_due_notification() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.kind IN ('task_due', 'task_overdue') AND (NEW.recipient_user_id IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') OR NEW.actor_user_id IS DISTINCT FROM NEW.recipient_user_id) THEN
    RAISE EXCEPTION 'due notices are generated for the signed-in assignee only';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_crm_due_notification() FROM PUBLIC;
CREATE TRIGGER guard_crm_due_notification BEFORE INSERT ON public.crm_notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_due_notification();
