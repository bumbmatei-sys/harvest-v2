-- The original table permitted membership removal without deleting an Office row.
-- The new FK applies to all writes and cascades future membership removals. Existing orphaned rows are invisible under RLS.
ALTER TABLE "office_connections" ADD CONSTRAINT "office_connection_owner_key" UNIQUE("tenant_id","owner_user_id","id");--> statement-breakpoint
CREATE TABLE "office_connect_attempts" (
	"tenant_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"platform" text NOT NULL,
	"connection_id" uuid,
	"provider" text NOT NULL,
	"profile_ref" text NOT NULL,
	"handoff_ref" text NOT NULL,
	"notice_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "office_connect_attempts_tenant_id_owner_user_id_kind_pk" PRIMARY KEY("tenant_id","owner_user_id","kind"),
	CONSTRAINT "office_attempt_shape" CHECK ("office_connect_attempts"."kind" in ('mail','calendar','files') and "office_connect_attempts"."platform" in ('google','microsoft') and "office_connect_attempts"."provider" in ('fake','zernio')
    and length("office_connect_attempts"."profile_ref") between 1 and 200 and length("office_connect_attempts"."handoff_ref") between 1 and 200 and "office_connect_attempts"."notice_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "office_contact_references" (
	"tenant_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"item_ref" text NOT NULL,
	"name" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	CONSTRAINT "office_contact_references_tenant_id_owner_user_id_connection_id_contact_id_kind_item_ref_pk" PRIMARY KEY("tenant_id","owner_user_id","connection_id","contact_id","kind","item_ref"),
	CONSTRAINT "office_reference_shape" CHECK (length("office_contact_references"."item_ref") between 1 and 200 and
    (("office_contact_references"."kind" = 'file' and "office_contact_references"."name" is not null and length("office_contact_references"."name") between 1 and 500 and "office_contact_references"."starts_at" is null and "office_contact_references"."ends_at" is null)
    or ("office_contact_references"."kind" = 'event' and "office_contact_references"."name" is null and "office_contact_references"."starts_at" is not null and "office_contact_references"."ends_at" is not null and "office_contact_references"."starts_at" < "office_contact_references"."ends_at")))
);
--> statement-breakpoint
CREATE TABLE "office_thread_markers" (
	"tenant_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"thread_ref" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"contact_id" uuid,
	CONSTRAINT "office_thread_markers_tenant_id_owner_user_id_connection_id_thread_ref_pk" PRIMARY KEY("tenant_id","owner_user_id","connection_id","thread_ref"),
	CONSTRAINT "office_marker_ref" CHECK (length("office_thread_markers"."thread_ref") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "office_connections" DROP CONSTRAINT "office_connection_envelope";--> statement-breakpoint
ALTER TABLE "office_connections" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "office_connections" ADD COLUMN "profile_ref" text;--> statement-breakpoint
ALTER TABLE "office_connections" ADD COLUMN "health" text DEFAULT 'reconnect_needed' NOT NULL;--> statement-breakpoint
ALTER TABLE "office_connections" ADD COLUMN "grants" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "office_connections" ADD COLUMN "notice_version" integer;--> statement-breakpoint
ALTER TABLE "office_connect_attempts" ADD CONSTRAINT "office_attempt_member_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_connect_attempts" ADD CONSTRAINT "office_attempt_connection_fk" FOREIGN KEY ("tenant_id","owner_user_id","connection_id") REFERENCES "public"."office_connections"("tenant_id","owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_contact_references" ADD CONSTRAINT "office_reference_connection_fk" FOREIGN KEY ("tenant_id","owner_user_id","connection_id") REFERENCES "public"."office_connections"("tenant_id","owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_contact_references" ADD CONSTRAINT "office_reference_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_thread_markers" ADD CONSTRAINT "office_marker_connection_fk" FOREIGN KEY ("tenant_id","owner_user_id","connection_id") REFERENCES "public"."office_connections"("tenant_id","owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_thread_markers" ADD CONSTRAINT "office_marker_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_connections" ADD CONSTRAINT "office_connection_member_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE UNIQUE INDEX "office_connection_personal_kind_idx" ON "office_connections" USING btree ("tenant_id","owner_user_id","kind") WHERE "office_connections"."platform" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "office_connection_provider_account_idx" ON "office_connections" USING btree ("provider","external_account_ref") WHERE "office_connections"."platform" is not null;--> statement-breakpoint
ALTER TABLE "office_connections" DROP COLUMN "credential_envelope";--> statement-breakpoint
ALTER TABLE "office_connections" ADD CONSTRAINT "office_connection_grant_shape" CHECK ("office_connections"."health" in ('healthy','unavailable','reconnect_needed')
    and ("office_connections"."grants" = 0 or ("office_connections"."kind" = 'mail' and "office_connections"."grants" = 1) or ("office_connections"."kind" = 'calendar' and "office_connections"."grants" = 2) or ("office_connections"."kind" = 'files' and "office_connections"."grants" = 4))
    and (("office_connections"."platform" is null and "office_connections"."profile_ref" is null and "office_connections"."notice_version" is null and "office_connections"."grants" = 0 and "office_connections"."health" = 'reconnect_needed')
      or ("office_connections"."platform" is not null and "office_connections"."platform" in ('google','microsoft') and "office_connections"."profile_ref" is not null and length("office_connections"."profile_ref") between 1 and 200 and "office_connections"."notice_version" is not null and "office_connections"."notice_version" > 0))
    and ("office_connections"."health" <> 'healthy' or "office_connections"."grants" <> 0));
--> statement-breakpoint
CREATE FUNCTION public.office_can(p_tenant uuid, p_owner text, p_capability text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND p_owner = nullif(current_setting('app.user_id', true), '')
    AND p_capability IN ('office:connect','office:mail','office:calendar','office:files')
    AND EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.tenant_id = p_tenant AND m.user_id = p_owner AND m.role_id IN ('owner','admin')
    )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.office_can(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.office_can(uuid, text, text) TO harvest_app;
--> statement-breakpoint
DROP POLICY office_connections_personal ON public.office_connections;
--> statement-breakpoint
CREATE POLICY office_connections_personal ON public.office_connections TO harvest_app
  USING (public.office_can(tenant_id, owner_user_id, 'office:connect'))
  WITH CHECK (public.office_can(tenant_id, owner_user_id, 'office:connect'));
--> statement-breakpoint
GRANT UPDATE (health, grants, notice_version), DELETE ON public.office_connections TO harvest_app;

--> statement-breakpoint
ALTER TABLE public.office_connect_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.office_connect_attempts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.office_connect_attempts FROM PUBLIC, harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.office_connect_attempts TO harvest_app;
--> statement-breakpoint
CREATE POLICY office_connect_attempts_personal ON public.office_connect_attempts TO harvest_app
  USING (public.office_can(tenant_id, owner_user_id, 'office:connect'))
  WITH CHECK (public.office_can(tenant_id, owner_user_id, 'office:connect'));

--> statement-breakpoint
ALTER TABLE public.office_thread_markers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.office_thread_markers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.office_thread_markers FROM PUBLIC, harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.office_thread_markers TO harvest_app;
--> statement-breakpoint
GRANT UPDATE ("read", starred, contact_id) ON public.office_thread_markers TO harvest_app;
--> statement-breakpoint
CREATE POLICY office_thread_markers_personal ON public.office_thread_markers TO harvest_app
  USING (public.office_can(tenant_id, owner_user_id, 'office:mail')
    AND EXISTS (SELECT 1 FROM public.office_connections c WHERE c.tenant_id = office_thread_markers.tenant_id AND c.owner_user_id = office_thread_markers.owner_user_id AND c.id = office_thread_markers.connection_id AND c.kind = 'mail'))
  WITH CHECK (public.office_can(tenant_id, owner_user_id, 'office:mail')
    AND EXISTS (SELECT 1 FROM public.office_connections c WHERE c.tenant_id = office_thread_markers.tenant_id AND c.owner_user_id = office_thread_markers.owner_user_id AND c.id = office_thread_markers.connection_id AND c.kind = 'mail'));

--> statement-breakpoint
ALTER TABLE public.office_contact_references ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.office_contact_references FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.office_contact_references FROM PUBLIC, harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.office_contact_references TO harvest_app;
--> statement-breakpoint
GRANT UPDATE (name, starts_at, ends_at) ON public.office_contact_references TO harvest_app;
--> statement-breakpoint
CREATE POLICY office_contact_references_personal ON public.office_contact_references TO harvest_app
  USING (public.office_can(tenant_id, owner_user_id, 'office:' || CASE kind WHEN 'file' THEN 'files' ELSE 'calendar' END)
    AND EXISTS (SELECT 1 FROM public.office_connections c WHERE c.tenant_id = office_contact_references.tenant_id AND c.owner_user_id = office_contact_references.owner_user_id AND c.id = office_contact_references.connection_id AND c.kind = CASE office_contact_references.kind WHEN 'file' THEN 'files' ELSE 'calendar' END))
  WITH CHECK (public.office_can(tenant_id, owner_user_id, 'office:' || CASE kind WHEN 'file' THEN 'files' ELSE 'calendar' END)
    AND EXISTS (SELECT 1 FROM public.office_connections c WHERE c.tenant_id = office_contact_references.tenant_id AND c.owner_user_id = office_contact_references.owner_user_id AND c.id = office_contact_references.connection_id AND c.kind = CASE office_contact_references.kind WHEN 'file' THEN 'files' ELSE 'calendar' END));
--> statement-breakpoint
CREATE POLICY office_audit_personal ON public.audit_logs AS RESTRICTIVE FOR SELECT TO harvest_app
  USING (action NOT LIKE 'office.%' OR public.office_can(tenant_id, actor_id, 'office:connect'));
--> statement-breakpoint
CREATE POLICY office_audit_metadata_only ON public.audit_logs AS RESTRICTIVE FOR INSERT TO harvest_app
  WITH CHECK (action NOT LIKE 'office.%' OR (
    public.office_can(tenant_id, actor_id, 'office:connect')
    AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND metadata = jsonb_build_object('outcome', metadata->>'outcome')
    AND metadata->>'outcome' IN ('started','failed','healthy','unavailable','reconnect_needed','temporarily_unavailable','disabled','disconnected','available')
  ));

--> statement-breakpoint
-- The erasure trigger is the only path that needs to reach personal Office rows
-- across owners. The application role keeps its existing personal policies.
DO $$
DECLARE scoped_contact text := $scope$
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND contact_id = nullif(current_setting('app.office_erasure_contact', true), '')::uuid
$scope$;
BEGIN
  EXECUTE format('CREATE POLICY office_reference_erasure_read ON public.office_contact_references FOR SELECT TO %I USING (%s)', current_user, scoped_contact);
  EXECUTE format('CREATE POLICY office_reference_erasure_delete ON public.office_contact_references FOR DELETE TO %I USING (%s)', current_user, scoped_contact);
  -- PostgreSQL checks SELECT visibility both before and after a filtered UPDATE.
  EXECUTE format($policy$CREATE POLICY office_marker_erasure_read ON public.office_thread_markers FOR SELECT TO %I USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND nullif(current_setting('app.office_erasure_contact', true), '') IS NOT NULL
    AND (contact_id IS NULL OR contact_id = nullif(current_setting('app.office_erasure_contact', true), '')::uuid)
  )$policy$, current_user);
  EXECUTE format($policy$CREATE POLICY office_marker_erasure_unlink ON public.office_thread_markers FOR UPDATE TO %I
    USING (%s)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND contact_id IS NULL)$policy$,
    current_user, scoped_contact);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.office_contact_before_rekey() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior_contact text := current_setting('app.office_erasure_contact', true);
BEGIN
  -- CRM has already authorized the operation and locked the contact. A merge
  -- uses the same re-key for its source, so its private links are dropped too.
  PERFORM set_config('app.office_erasure_contact', OLD.id::text, true);
  DELETE FROM public.office_contact_references WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id;
  UPDATE public.office_thread_markers SET contact_id = NULL WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id;
  PERFORM set_config('app.office_erasure_contact', coalesce(prior_contact, ''), true);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.office_contact_before_rekey() FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE TRIGGER office_contact_before_rekey BEFORE UPDATE OF id ON public.contacts
  FOR EACH ROW WHEN (OLD.id IS DISTINCT FROM NEW.id AND NEW.erased_at IS NOT NULL)
  EXECUTE FUNCTION public.office_contact_before_rekey();
