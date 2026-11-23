CREATE TABLE "office_calendar_events" (
	"tenant_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"calendar_ref" text NOT NULL,
	"event_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_calendar_events_tenant_id_owner_user_id_connection_id_calendar_ref_event_ref_pk" PRIMARY KEY("tenant_id","owner_user_id","connection_id","calendar_ref","event_ref"),
	CONSTRAINT "office_calendar_event_ref" CHECK (length("office_calendar_events"."calendar_ref") between 1 and 200 and length("office_calendar_events"."event_ref") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "office_connections" DROP CONSTRAINT "office_connection_grant_shape";--> statement-breakpoint
ALTER TABLE "office_connections" ADD COLUMN "write_calendar_ref" text;--> statement-breakpoint
ALTER TABLE "office_calendar_events" ADD CONSTRAINT "office_calendar_event_connection_fk" FOREIGN KEY ("tenant_id","owner_user_id","connection_id") REFERENCES "public"."office_connections"("tenant_id","owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_connections" ADD CONSTRAINT "office_connection_write_calendar" CHECK ("office_connections"."write_calendar_ref" is null or length("office_connections"."write_calendar_ref") between 1 and 200);--> statement-breakpoint
ALTER TABLE "office_connections" ADD CONSTRAINT "office_connection_grant_shape" CHECK ("office_connections"."health" in ('healthy','unavailable','reconnect_needed')
    and ("office_connections"."grants" = 0 or ("office_connections"."kind" = 'mail' and "office_connections"."grants" = 1) or ("office_connections"."kind" = 'calendar' and "office_connections"."grants" in (2, 10)) or ("office_connections"."kind" = 'files' and "office_connections"."grants" = 4))
    and (("office_connections"."platform" is null and "office_connections"."profile_ref" is null and "office_connections"."notice_version" is null and "office_connections"."grants" = 0 and "office_connections"."health" = 'reconnect_needed')
      or ("office_connections"."platform" is not null and "office_connections"."platform" in ('google','microsoft') and "office_connections"."profile_ref" is not null and length("office_connections"."profile_ref") between 1 and 200 and "office_connections"."notice_version" is not null and "office_connections"."notice_version" > 0))
    and ("office_connections"."health" <> 'healthy' or "office_connections"."grants" <> 0));--> statement-breakpoint
ALTER TABLE public.office_calendar_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.office_calendar_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.office_calendar_events FROM PUBLIC, harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.office_calendar_events TO harvest_app;
--> statement-breakpoint
CREATE POLICY office_calendar_events_personal ON public.office_calendar_events TO harvest_app
  USING (public.office_can(tenant_id, owner_user_id, 'office:calendar')
    AND EXISTS (SELECT 1 FROM public.office_connections c WHERE c.tenant_id = office_calendar_events.tenant_id AND c.owner_user_id = office_calendar_events.owner_user_id AND c.id = office_calendar_events.connection_id AND c.kind = 'calendar'))
  WITH CHECK (public.office_can(tenant_id, owner_user_id, 'office:calendar')
    AND EXISTS (SELECT 1 FROM public.office_connections c WHERE c.tenant_id = office_calendar_events.tenant_id AND c.owner_user_id = office_calendar_events.owner_user_id AND c.id = office_calendar_events.connection_id AND c.kind = 'calendar'));
--> statement-breakpoint
GRANT UPDATE (write_calendar_ref) ON public.office_connections TO harvest_app;
--> statement-breakpoint
-- Audit rows keep the outcome and, for calendar writes only, the provider event reference. Never content.
DROP POLICY office_audit_metadata_only ON public.audit_logs;
--> statement-breakpoint
CREATE POLICY office_audit_metadata_only ON public.audit_logs AS RESTRICTIVE FOR INSERT TO harvest_app
  WITH CHECK (action NOT LIKE 'office.%' OR (
    public.office_can(tenant_id, actor_id, 'office:connect')
    AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND metadata->>'outcome' IN ('started','failed','healthy','unavailable','reconnect_needed','temporarily_unavailable','disabled','disconnected','available','conflict','write_access_needed')
    AND (metadata = jsonb_build_object('outcome', metadata->>'outcome')
      OR (action IN ('office.createEvent','office.updateEvent','office.deleteEvent')
        AND metadata = jsonb_build_object('outcome', metadata->>'outcome', 'eventRef', metadata->>'eventRef')
        AND length(metadata->>'eventRef') BETWEEN 1 AND 200))
  ));
