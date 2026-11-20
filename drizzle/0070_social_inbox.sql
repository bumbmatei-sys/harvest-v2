CREATE TABLE "social_inbox_hours" (
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"timezone" text NOT NULL,
	"hours" jsonb NOT NULL,
	"away_template" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "social_inbox_hours_tenant_id_connection_id_pk" PRIMARY KEY("tenant_id","connection_id"),
	CONSTRAINT "social_inbox_hours_shape" CHECK (length("social_inbox_hours"."timezone") between 1 and 80 and jsonb_typeof("social_inbox_hours"."hours") = 'array' and jsonb_array_length("social_inbox_hours"."hours") <= 28 and length("social_inbox_hours"."hours"::text) <= 2400 and ("social_inbox_hours"."away_template" is null or length("social_inbox_hours"."away_template") between 1 and 5000) and "social_inbox_hours"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "social_inbox_item_labels" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "social_inbox_item_labels_tenant_id_item_id_label_id_pk" PRIMARY KEY("tenant_id","item_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "social_inbox_items" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"kind" text NOT NULL,
	"activity_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" text,
	"starred" boolean DEFAULT false NOT NULL,
	"snoozed_until" timestamp with time zone,
	"contact_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "social_inbox_items_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_inbox_item_shape" CHECK ("social_inbox_items"."kind" in ('dm','comment','mention','story') and "social_inbox_items"."status" in ('open','done') and length("social_inbox_items"."provider_ref") between 1 and 200 and "social_inbox_items"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "social_inbox_labels" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "social_inbox_labels_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_inbox_label_shape" CHECK (length(trim("social_inbox_labels"."name")) between 1 and 80 and "social_inbox_labels"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "social_inbox_notes" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"author_id" text NOT NULL,
	"note" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_inbox_notes_tenant_id_item_id_id_pk" PRIMARY KEY("tenant_id","item_id","id"),
	CONSTRAINT "social_inbox_note_shape" CHECK (length(trim("social_inbox_notes"."note")) between 1 and 5000 and "social_inbox_notes"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "social_inbox_reads" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"reader_id" text NOT NULL,
	"read_through" timestamp with time zone NOT NULL,
	CONSTRAINT "social_inbox_reads_tenant_id_item_id_reader_id_pk" PRIMARY KEY("tenant_id","item_id","reader_id")
);
--> statement-breakpoint
CREATE TABLE "social_inbox_replies" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"connection_version" integer NOT NULL,
	"mode" text NOT NULL,
	"fingerprint" text NOT NULL,
	"target_ref" text,
	"file_id" uuid,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reconcile_attempts" integer DEFAULT 0 NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_id" uuid,
	"provider_delivery_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "social_inbox_replies_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_inbox_reply_shape" CHECK ("social_inbox_replies"."mode" in ('message','comment','private','mention') and "social_inbox_replies"."state" in ('queued','leased','dispatching','unknown','confirmed','failed','cancelled') and "social_inbox_replies"."fingerprint" ~ '^[a-zA-Z0-9_.:-]{1,100}:[a-f0-9]{64}$' and "social_inbox_replies"."attempts" between 0 and 3 and "social_inbox_replies"."reconcile_attempts" between 0 and 3 and "social_inbox_replies"."version" > 0 and (("social_inbox_replies"."lease_id" is null) = ("social_inbox_replies"."lease_until" is null)) and (("social_inbox_replies"."attempts" = 0) = ("social_inbox_replies"."first_attempt_at" is null)) and (("social_inbox_replies"."state" = 'confirmed') = ("social_inbox_replies"."provider_delivery_ref" is not null)) and ("social_inbox_replies"."target_ref" is null or length("social_inbox_replies"."target_ref") between 1 and 200) and ("social_inbox_replies"."provider_delivery_ref" is null or length("social_inbox_replies"."provider_delivery_ref") between 1 and 200))
);
--> statement-breakpoint
CREATE TABLE "social_inbox_saved_replies" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "social_inbox_saved_replies_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_inbox_saved_reply_shape" CHECK (length(trim("social_inbox_saved_replies"."name")) between 1 and 80 and length(trim("social_inbox_saved_replies"."template")) between 1 and 5000 and "social_inbox_saved_replies"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "social_inbox_scan_items" (
	"tenant_id" uuid NOT NULL,
	"reader_id" text NOT NULL,
	"scan_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"first_page" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "social_inbox_scan_items_tenant_id_reader_id_scan_id_item_id_pk" PRIMARY KEY("tenant_id","reader_id","scan_id","item_id"),
	CONSTRAINT "social_inbox_scan_page" CHECK ("social_inbox_scan_items"."first_page" >= 0)
);
--> statement-breakpoint
CREATE TABLE "social_post_media_grants" (
	"tenant_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claim_id" uuid NOT NULL,
	CONSTRAINT "social_post_media_grants_tenant_id_post_id_pk" PRIMARY KEY("tenant_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_size";--> statement-breakpoint
ALTER TABLE "social_posts" DROP CONSTRAINT "social_post_error";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "social_retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "social_confirm_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_inbox_hours" ADD CONSTRAINT "social_inbox_hours_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_item_labels" ADD CONSTRAINT "social_inbox_item_label_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."social_inbox_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_item_labels" ADD CONSTRAINT "social_inbox_item_label_label_fk" FOREIGN KEY ("tenant_id","label_id") REFERENCES "public"."social_inbox_labels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_items" ADD CONSTRAINT "social_inbox_item_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_items" ADD CONSTRAINT "social_inbox_item_assignee_fk" FOREIGN KEY ("tenant_id","assignee_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE SET NULL ("assignee_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_items" ADD CONSTRAINT "social_inbox_item_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE SET NULL ("contact_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_labels" ADD CONSTRAINT "social_inbox_labels_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_notes" ADD CONSTRAINT "social_inbox_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_notes" ADD CONSTRAINT "social_inbox_note_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."social_inbox_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_reads" ADD CONSTRAINT "social_inbox_read_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."social_inbox_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_reads" ADD CONSTRAINT "social_inbox_read_reader_fk" FOREIGN KEY ("tenant_id","reader_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_replies" ADD CONSTRAINT "social_inbox_replies_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_replies" ADD CONSTRAINT "social_inbox_reply_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."social_inbox_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_replies" ADD CONSTRAINT "social_inbox_reply_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_saved_replies" ADD CONSTRAINT "social_inbox_saved_replies_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_scan_items" ADD CONSTRAINT "social_inbox_scan_reader_fk" FOREIGN KEY ("tenant_id","reader_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_inbox_scan_items" ADD CONSTRAINT "social_inbox_scan_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."social_inbox_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_media_grants" ADD CONSTRAINT "social_post_media_grant_delivery_fk" FOREIGN KEY ("tenant_id","post_id") REFERENCES "public"."social_posts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_inbox_item_identity" ON "social_inbox_items" USING btree ("tenant_id","connection_id","kind","provider_ref");--> statement-breakpoint
CREATE INDEX "social_inbox_item_activity_idx" ON "social_inbox_items" USING btree ("tenant_id","activity_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_inbox_label_name_idx" ON "social_inbox_labels" USING btree ("tenant_id",lower("name")) WHERE not "social_inbox_labels"."archived";--> statement-breakpoint
CREATE UNIQUE INDEX "social_inbox_private_reply_once" ON "social_inbox_replies" USING btree ("tenant_id","item_id","target_ref") WHERE "social_inbox_replies"."mode" = 'private' and "social_inbox_replies"."state" in ('queued','leased','dispatching','unknown','confirmed');--> statement-breakpoint
CREATE INDEX "social_inbox_reply_due_idx" ON "social_inbox_replies" USING btree ("state","next_at","id");--> statement-breakpoint
CREATE INDEX "social_inbox_scan_expiry_idx" ON "social_inbox_scan_items" USING btree ("tenant_id","reader_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_post_media_grant_id_idx" ON "social_post_media_grants" USING btree ("id");--> statement-breakpoint
CREATE INDEX "social_upload_cleanup_idx" ON "files" USING btree ("created_at","id") WHERE "files"."social_upload" and "files"."status" in ('pending','uploaded');--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_social_operation_scope" CHECK ("files"."social_upload" or ("files"."social_retired_at" is null and "files"."social_confirm_until" is null));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_size" CHECK ("files"."size" BETWEEN 1 AND (case when "files"."social_upload" then 4000000000 else 10485760 end));--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_post_error" CHECK ("social_posts"."last_error_code" is null or "social_posts"."last_error_code" in ('PROVIDER_AUTH', 'PROVIDER_REJECTED', 'PROVIDER_CONFLICT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'MAX_ATTEMPTS', 'IDEMPOTENCY_WINDOW_EXPIRED', 'CONNECTION_UNAVAILABLE', 'PARTIAL_PUBLISH', 'DISABLED', 'CREDENTIAL_UNAVAILABLE', 'UNCONFIRMED', 'MEDIA_UNAVAILABLE', 'MEDIA_URL_EXPIRED', 'MEDIA_FETCH_FAILED'));
--> statement-breakpoint
CREATE FUNCTION public.social_inbox_can(p_tenant uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND p_permission IN ('social:inbox', 'social:reply', 'social:assign', 'social:saved_replies')
    AND EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.tenant_id = p_tenant AND m.user_id = nullif(current_setting('app.user_id', true), '')
        AND m.role_id IN ('owner', 'admin')
    )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.social_inbox_can(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.social_inbox_can(uuid, text) TO harvest_app;
--> statement-breakpoint
DO $$
DECLARE t text; capability text;
BEGIN
  FOR t, capability IN SELECT * FROM (VALUES
    ('items', 'social:inbox'), ('scan_items', 'social:inbox'), ('reads', 'social:inbox'), ('item_labels', 'social:inbox'),
    ('labels', 'social:inbox'), ('notes', 'social:inbox'), ('hours', 'social:inbox'),
    ('saved_replies', 'social:saved_replies'), ('replies', 'social:reply')
  ) AS access(name, permission)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', 'social_inbox_' || t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', 'social_inbox_' || t);
    EXECUTE format('CREATE POLICY inbox_access ON public.%I TO harvest_app USING (public.social_inbox_can(tenant_id, %L))', 'social_inbox_' || t, capability);
  END LOOP;
  ALTER POLICY inbox_access ON public.social_inbox_scan_items TO harvest_app
    USING (public.social_inbox_can(tenant_id, 'social:inbox') AND reader_id = nullif(current_setting('app.user_id', true), ''));
  EXECUTE format('CREATE POLICY inbox_worker_cleanup ON public.social_inbox_scan_items TO %I USING (current_setting(''app.social_inbox_worker'', true) = ''on'' AND expires_at <= now()) WITH CHECK (false)', current_user);
  ALTER POLICY inbox_access ON public.social_inbox_reads TO harvest_app
    USING (public.social_inbox_can(tenant_id, 'social:inbox') AND reader_id = nullif(current_setting('app.user_id', true), ''));
  CREATE POLICY inbox_note_insert ON public.social_inbox_notes AS RESTRICTIVE FOR INSERT TO harvest_app
    WITH CHECK (public.social_inbox_can(tenant_id, 'social:inbox') AND author_id = nullif(current_setting('app.user_id', true), ''));
  CREATE POLICY inbox_reply_insert ON public.social_inbox_replies AS RESTRICTIVE FOR INSERT TO harvest_app
    WITH CHECK (public.social_inbox_can(tenant_id, 'social:reply') AND actor_id = nullif(current_setting('app.user_id', true), ''));
  -- FORCE RLS also applies to the migration owner used by the narrowly granted worker functions.
  EXECUTE format('CREATE POLICY inbox_worker ON public.social_inbox_replies TO %I USING (current_setting(''app.social_inbox_worker'', true) = ''on'')', current_user);
  FOREACH t IN ARRAY ARRAY['social_inbox_items', 'workspace_members', 'files']
  LOOP
    EXECUTE format('CREATE POLICY inbox_worker_read ON public.%I FOR SELECT TO %I USING (current_setting(''app.social_inbox_worker'', true) = ''on'')', t, current_user);
  END LOOP;
  -- Row locks need UPDATE visibility under FORCE RLS. These policies permit the lock, never an UPDATE.
  FOREACH t IN ARRAY ARRAY['workspace_members', 'files']
  LOOP
    EXECUTE format('CREATE POLICY inbox_worker_lock ON public.%I FOR UPDATE TO %I USING (current_setting(''app.social_inbox_worker'', true) = ''on'') WITH CHECK (false)', t, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT ON public.social_inbox_items, public.social_inbox_reads, public.social_inbox_labels,
  public.social_inbox_item_labels, public.social_inbox_notes, public.social_inbox_saved_replies,
  public.social_inbox_hours, public.social_inbox_replies TO harvest_app;
--> statement-breakpoint
GRANT INSERT (tenant_id, connection_id, kind, provider_ref, activity_at) ON public.social_inbox_items TO harvest_app;
--> statement-breakpoint
GRANT UPDATE (activity_at, status, assignee_id, starred, snoozed_until, contact_id, version) ON public.social_inbox_items TO harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.social_inbox_scan_items TO harvest_app;
--> statement-breakpoint
GRANT INSERT, UPDATE, DELETE ON public.social_inbox_reads, public.social_inbox_item_labels TO harvest_app;
--> statement-breakpoint
GRANT INSERT, UPDATE ON public.social_inbox_labels, public.social_inbox_saved_replies, public.social_inbox_hours TO harvest_app;
--> statement-breakpoint
GRANT UPDATE (note, version) ON public.social_inbox_notes TO harvest_app;
--> statement-breakpoint
GRANT INSERT (tenant_id, item_id, author_id, note) ON public.social_inbox_notes TO harvest_app;
--> statement-breakpoint
GRANT INSERT (tenant_id, id, item_id, actor_id, connection_version, mode, fingerprint, target_ref, file_id) ON public.social_inbox_replies TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.social_inbox_guard_metadata() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN RAISE EXCEPTION 'invalid inbox starting version'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'social_inbox_items' THEN
    IF (NEW.tenant_id, NEW.id, NEW.connection_id, NEW.kind, NEW.provider_ref)
        IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.connection_id, OLD.kind, OLD.provider_ref)
      OR (OLD.activity_at IS NOT NULL AND (NEW.activity_at IS NULL OR NEW.activity_at < OLD.activity_at)) THEN
      RAISE EXCEPTION 'invalid inbox identity or activity';
    END IF;
    -- Composite FK actions clear expired CRM links or departed assignees without blocking deletion.
    IF pg_trigger_depth() > 1 AND NEW.version = OLD.version AND
        ((OLD.assignee_id IS NOT NULL AND NEW.assignee_id IS NULL) OR (OLD.contact_id IS NOT NULL AND NEW.contact_id IS NULL)) THEN
      NEW.version := OLD.version + 1;
    END IF;
    IF pg_trigger_depth() = 1 AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
        AND NOT coalesce(public.social_inbox_can(NEW.tenant_id, 'social:assign'), false) THEN
      RAISE EXCEPTION 'assignment permission required';
    END IF;
  ELSIF TG_TABLE_NAME = 'social_inbox_hours' THEN
    IF (NEW.tenant_id, NEW.connection_id) IS DISTINCT FROM (OLD.tenant_id, OLD.connection_id) THEN
      RAISE EXCEPTION 'invalid inbox hours identity';
    END IF;
  ELSIF (NEW.tenant_id, NEW.id) IS DISTINCT FROM (OLD.tenant_id, OLD.id) THEN
    RAISE EXCEPTION 'invalid inbox metadata identity';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'invalid inbox version'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['items', 'labels', 'notes', 'hours', 'saved_replies']
  LOOP
    EXECUTE format('CREATE TRIGGER social_inbox_metadata_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.social_inbox_guard_metadata()', 'social_inbox_' || t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_inbox_guard_reply() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.social_inbox_items i JOIN public.social_connections c
        ON (i.tenant_id,i.connection_id) = (c.tenant_id,c.id)
      WHERE (i.tenant_id,i.id) = (NEW.tenant_id,NEW.item_id)
        AND c.status = 'active' AND c.version = NEW.connection_version
        AND ((i.kind IN ('dm','story') AND NEW.mode = 'message')
          OR (i.kind = 'comment' AND NEW.mode IN ('comment','private')) OR (i.kind = 'mention' AND NEW.mode = 'mention'))
    ) THEN RAISE EXCEPTION 'inbox connection changed'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['state','attempts','reconcile_attempts','first_attempt_at','next_at','lease_until','lease_id','provider_delivery_ref','version'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','attempts','reconcile_attempts','first_attempt_at','next_at','lease_until','lease_id','provider_delivery_ref','version'])
    OR NEW.version <> OLD.version + 1
    OR (OLD.first_attempt_at IS NOT NULL AND OLD.first_attempt_at IS DISTINCT FROM NEW.first_attempt_at)
    OR NEW.attempts <> OLD.attempts + (CASE WHEN NEW.state = 'dispatching' THEN 1 ELSE 0 END)
    OR NEW.reconcile_attempts NOT BETWEEN OLD.reconcile_attempts AND OLD.reconcile_attempts + 1
    OR NOT (
      (OLD.state = 'queued' AND NEW.state IN ('leased','cancelled','failed'))
      OR (OLD.state = 'leased' AND NEW.state IN ('queued','dispatching','cancelled','failed'))
      OR (OLD.state = 'dispatching' AND NEW.state IN ('queued','confirmed','failed','unknown','cancelled'))
      OR (OLD.state = 'unknown' AND NEW.state IN ('unknown','confirmed','failed'))
    ) THEN RAISE EXCEPTION 'invalid inbox reply transition'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_inbox_reply_guard BEFORE INSERT OR UPDATE ON public.social_inbox_replies
  FOR EACH ROW EXECUTE FUNCTION public.social_inbox_guard_reply();
--> statement-breakpoint
CREATE FUNCTION public.social_inbox_cancel_undispatched() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.social_inbox_worker', 'on', true);
  PERFORM set_config('app.social_definer', 'on', true);
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    UPDATE public.social_inbox_replies r SET state = 'cancelled', lease_id = NULL, lease_until = NULL, version = r.version + 1
    FROM public.social_inbox_items i
    WHERE (r.tenant_id,r.item_id) = (i.tenant_id,i.id) AND (i.tenant_id,i.connection_id) = (NEW.tenant_id,NEW.id)
      AND r.state IN ('queued','leased');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_inbox_cancel_on_disconnect AFTER UPDATE OF status ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.social_inbox_cancel_undispatched();
--> statement-breakpoint
CREATE FUNCTION public.social_inbox_claim(p_available text[], p_limit int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM set_config('app.social_inbox_worker', 'on', true);
  PERFORM set_config('app.social_definer', 'on', true);
  IF p_available IS NULL OR cardinality(p_available) > 512 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid inbox claim bounds';
  END IF;
  WITH expired AS (
    SELECT tenant_id,reader_id,scan_id,item_id FROM public.social_inbox_scan_items
    WHERE expires_at <= now() LIMIT 1000 FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.social_inbox_scan_items s USING expired e
    WHERE (s.tenant_id,s.reader_id,s.scan_id,s.item_id) = (e.tenant_id,e.reader_id,e.scan_id,e.item_id);
  UPDATE public.social_inbox_replies SET state = 'unknown', lease_id = NULL, lease_until = NULL,
    next_at = now(), version = version + 1 WHERE state = 'dispatching' AND lease_until <= now();
  UPDATE public.social_inbox_replies SET state = 'queued', lease_id = NULL, lease_until = NULL,
    version = version + 1 WHERE state = 'leased' AND lease_until <= now();
  UPDATE public.social_inbox_replies SET state = 'failed', version = version + 1
    WHERE state = 'queued' AND created_at < now() - interval '15 minutes';
  WITH due AS (
    SELECT r.tenant_id,r.id,i.kind,i.provider_ref,c.id AS connection_id,c.provider,c.platform,c.external_account_ref,c.credential_envelope
    FROM public.social_inbox_replies r JOIN public.social_inbox_items i ON (r.tenant_id,r.item_id) = (i.tenant_id,i.id)
    JOIN public.social_connections c ON (i.tenant_id,i.connection_id) = (c.tenant_id,c.id)
    WHERE r.next_at <= now() AND (r.lease_id IS NULL OR r.lease_until <= now()) AND c.status = 'active'
      AND ((r.state = 'queued' AND r.tenant_id::text || ':' || r.id::text = ANY(p_available))
        OR (r.state = 'unknown' AND r.reconcile_attempts < 3))
    ORDER BY r.next_at, r.id LIMIT p_limit FOR UPDATE OF r SKIP LOCKED
  ), leased AS (
    UPDATE public.social_inbox_replies r SET state = CASE WHEN r.state = 'queued' THEN 'leased' ELSE 'unknown' END,
      lease_id = gen_random_uuid(), lease_until = now() + interval '60 seconds', version = r.version + 1,
      reconcile_attempts = r.reconcile_attempts + CASE WHEN r.state = 'unknown' THEN 1 ELSE 0 END
    FROM due d WHERE (r.tenant_id,r.id) = (d.tenant_id,d.id)
    RETURNING jsonb_build_object('tenantId',r.tenant_id,'id',r.id,'state',r.state,'leaseId',r.lease_id,
      'itemId',r.item_id,'mode',r.mode,'targetRef',r.target_ref,'fingerprint',r.fingerprint,'attempts',r.attempts,
      'kind',d.kind,'providerRef',d.provider_ref,'connectionId',d.connection_id,'provider',d.provider,'platform',d.platform,
      'accountRef',d.external_account_ref,'envelope',d.credential_envelope) AS value
  )
  SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO result FROM leased;
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_inbox_reply_file(p_tenant uuid, p_reply uuid, p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM set_config('app.social_inbox_worker', 'on', true);
  PERFORM set_config('app.social_definer', 'on', true);
  SELECT CASE WHEN r.file_id IS NULL THEN '{}'::jsonb ELSE
    jsonb_build_object('id',f.id,'key',f.key,'name',f.name,'mime',f.mime,'size',f.size) END INTO result
  FROM public.social_inbox_replies r LEFT JOIN public.files f
    ON (r.tenant_id,r.file_id) = (f.tenant_id,f.id) AND f.status = 'ready' AND f.social_upload AND f.social_retired_at IS NULL
  WHERE (r.tenant_id,r.id,r.lease_id) = (p_tenant,p_reply,p_lease) AND r.state = 'leased' AND r.lease_until > now()
    AND (r.file_id IS NULL OR f.id IS NOT NULL);
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_inbox_begin_reply(p_tenant uuid, p_reply uuid, p_lease uuid, p_window timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r record; c record;
BEGIN
  PERFORM set_config('app.social_inbox_worker', 'on', true);
  PERFORM set_config('app.social_definer', 'on', true);
  SELECT q.*, i.connection_id INTO r FROM public.social_inbox_replies q JOIN public.social_inbox_items i
    ON (q.tenant_id,q.item_id) = (i.tenant_id,i.id)
    WHERE (q.tenant_id,q.id,q.lease_id) = (p_tenant,p_reply,p_lease) AND q.state = 'leased';
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT status, health, version INTO c FROM public.social_connections WHERE (tenant_id,id) = (p_tenant,r.connection_id) FOR SHARE;
  IF NOT FOUND OR c.status <> 'active' OR c.health NOT IN ('healthy','unknown') OR c.version <> r.connection_version
    OR (p_window IS NOT NULL AND p_window <= clock_timestamp()) THEN RETURN false; END IF;
  PERFORM 1 FROM public.workspace_members WHERE (tenant_id,user_id) = (p_tenant,r.actor_id) AND role_id IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF r.file_id IS NOT NULL THEN
    PERFORM 1 FROM public.files WHERE (tenant_id,id) = (p_tenant,r.file_id) AND status = 'ready' AND social_upload AND social_retired_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  UPDATE public.social_inbox_replies SET state = 'dispatching', attempts = attempts + 1,
    first_attempt_at = coalesce(first_attempt_at, clock_timestamp()), version = version + 1
  WHERE (tenant_id,id,lease_id) = (p_tenant,p_reply,p_lease) AND state = 'leased' AND attempts < 3
    AND lease_until > clock_timestamp() AND created_at > clock_timestamp() - interval '15 minutes';
  RETURN FOUND;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_inbox_complete_reply(p_tenant uuid, p_reply uuid, p_lease uuid, p_outcome text, p_ref text, p_delay int) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r record; result text;
BEGIN
  PERFORM set_config('app.social_inbox_worker', 'on', true);
  PERFORM set_config('app.social_definer', 'on', true);
  SELECT q.*, c.status AS connection_status, c.version AS current_version INTO r
  FROM public.social_inbox_replies q JOIN public.social_inbox_items i ON (q.tenant_id,q.item_id) = (i.tenant_id,i.id)
  JOIN public.social_connections c ON (i.tenant_id,i.connection_id) = (c.tenant_id,c.id)
  WHERE (q.tenant_id,q.id,q.lease_id) = (p_tenant,p_reply,p_lease) AND q.lease_until > clock_timestamp() FOR UPDATE OF q;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  IF NOT coalesce(
    (r.state = 'leased' AND p_outcome IN ('cancelled','failed','retry')) OR
    (r.state = 'dispatching' AND p_outcome IN ('confirmed','failed','unknown','retry')) OR
    (r.state = 'unknown' AND p_outcome IN ('unknown','confirmed','failed')), false) THEN
    RAISE EXCEPTION 'invalid inbox completion';
  END IF;
  result := CASE WHEN p_outcome <> 'retry' THEN p_outcome
    WHEN r.attempts >= 3 OR p_delay > 900 THEN 'failed'
    WHEN (r.connection_status <> 'active' OR r.connection_version <> r.current_version) THEN 'cancelled'
    ELSE 'queued' END;
  UPDATE public.social_inbox_replies SET state = result, provider_delivery_ref = CASE WHEN result = 'confirmed' THEN p_ref END,
    lease_id = NULL, lease_until = NULL, version = version + 1,
    next_at = now() + make_interval(secs => greatest(coalesce(p_delay, 0), 0))
  WHERE (tenant_id,id) = (p_tenant,p_reply);
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.social_inbox_claim(text[],int), public.social_inbox_reply_file(uuid,uuid,uuid),
  public.social_inbox_begin_reply(uuid,uuid,uuid,timestamptz), public.social_inbox_complete_reply(uuid,uuid,uuid,text,text,int),
  public.social_inbox_cancel_undispatched() FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit))
        OR EXISTS (SELECT FROM pg_auth_members WHERE member = 'harvest_worker'::regrole)
    THEN RAISE EXCEPTION 'harvest_worker must be unprivileged'; END IF;
    GRANT EXECUTE ON FUNCTION public.social_inbox_claim(text[],int), public.social_inbox_reply_file(uuid,uuid,uuid),
      public.social_inbox_begin_reply(uuid,uuid,uuid,timestamptz), public.social_inbox_complete_reply(uuid,uuid,uuid,text,text,int) TO harvest_worker;
  END IF;
END $$;

--> statement-breakpoint
GRANT DELETE ON public.social_inbox_notes TO harvest_app;
--> statement-breakpoint
CREATE POLICY inbox_note_update_author ON public.social_inbox_notes AS RESTRICTIVE FOR UPDATE TO harvest_app
  USING (author_id = nullif(current_setting('app.user_id', true), ''));
--> statement-breakpoint
CREATE POLICY inbox_note_delete_author ON public.social_inbox_notes AS RESTRICTIVE FOR DELETE TO harvest_app
  USING (author_id = nullif(current_setting('app.user_id', true), ''));

--> statement-breakpoint
-- Keep these trigger arguments in sync with src/lib/social/upload-limits.ts.
CREATE FUNCTION public.guard_social_upload_limits() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE unfinished int; bytes bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_user = 'harvest_app' AND (OLD.social_upload OR NEW.social_upload) AND
       (NEW.tenant_id,NEW.id,NEW.key,NEW.size,NEW.mime,NEW.checksum,NEW.social_upload,NEW.created_at,NEW.social_retired_at)
       IS DISTINCT FROM
       (OLD.tenant_id,OLD.id,OLD.key,OLD.size,OLD.mime,OLD.checksum,OLD.social_upload,OLD.created_at,OLD.social_retired_at) THEN
      RAISE EXCEPTION 'social upload identity is immutable';
    END IF;
    IF OLD.social_retired_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'social upload is retired'; END IF;
    RETURN NEW;
  END IF;
  IF NOT NEW.social_upload THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('social-upload:' || NEW.tenant_id::text, 0));
  SELECT count(*) FILTER (WHERE status IN ('pending','uploaded') AND social_retired_at IS NULL), coalesce(sum(size),0)
    INTO unfinished, bytes FROM public.files WHERE tenant_id = NEW.tenant_id AND social_upload;
  IF NEW.status IN ('pending','uploaded') AND unfinished >= TG_ARGV[0]::int THEN
    RAISE EXCEPTION 'SOCIAL_UPLOAD_UNFINISHED_LIMIT' USING ERRCODE = '23514'; END IF;
  IF bytes + NEW.size > TG_ARGV[1]::bigint THEN
    RAISE EXCEPTION 'SOCIAL_UPLOAD_MINISTRY_LIMIT' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_upload_limits BEFORE INSERT OR UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.guard_social_upload_limits('5','25000000000');
--> statement-breakpoint
ALTER TABLE public.social_post_media_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.social_post_media_grants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('CREATE POLICY post_media_grant_owner ON public.social_post_media_grants TO %I USING (current_setting(''app.social_definer'', true) = ''on'')', current_user);
  EXECUTE format('CREATE POLICY social_upload_cleanup_owner ON public.files TO %I USING (current_setting(''app.social_upload_cleanup'', true) = ''on'' AND social_upload AND status IN (''pending'',''uploaded''))', current_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_upload_in_use(p_tenant uuid, p_file uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.social_drafts d
      WHERE d.tenant_id = p_tenant AND d.status <> 'cancelled'
        AND (jsonb_path_exists(d.document, '$.**.fileId ? (@ == $id)', jsonb_build_object('id',p_file::text))
          OR jsonb_path_exists(d.document, '$.variants.*.options.coverFileId ? (@ == $id)', jsonb_build_object('id',p_file::text))))
    OR EXISTS (SELECT 1 FROM public.social_posts p WHERE p.tenant_id = p_tenant AND p.status IN ('draft','scheduled','publishing','unknown')
      AND (jsonb_path_exists(p.delivery, '$.**.fileId ? (@ == $id)', jsonb_build_object('id',p_file::text))
        OR p.delivery->'options'->>'coverFileId' = p_file::text))
    OR EXISTS (SELECT 1 FROM public.social_inbox_replies r WHERE r.tenant_id = p_tenant AND r.file_id = p_file)
$$;
--> statement-breakpoint
CREATE FUNCTION public.social_upload_cleanup_claim(p_skip uuid[]) RETURNS TABLE (id uuid, tenant_id uuid, object_key text, multipart_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE candidate record;
BEGIN
  IF p_skip IS NULL OR cardinality(p_skip) > 50 THEN RAISE EXCEPTION 'invalid upload cleanup bounds'; END IF;
  PERFORM set_config('app.social_upload_cleanup', 'on', true);
  PERFORM set_config('app.social_definer', 'on', true);
  PERFORM set_config('app.social_inbox_worker', 'on', true);
  SELECT f.id,f.tenant_id,f.key,f.multipart_id,f.social_retired_at INTO candidate FROM public.files f
  WHERE f.social_upload AND f.status IN ('pending','uploaded') AND NOT (f.id = ANY(p_skip))
    AND f.created_at <= now() - interval '12 hours' AND coalesce(f.social_confirm_until, '-infinity') <= now()
    AND NOT public.social_upload_in_use(f.tenant_id,f.id)
  ORDER BY f.created_at,f.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  IF candidate.social_retired_at IS NULL THEN
    UPDATE public.files f SET social_retired_at = now() WHERE (f.tenant_id,f.id) = (candidate.tenant_id,candidate.id);
  END IF;
  RETURN QUERY SELECT candidate.id,candidate.tenant_id,candidate.key,candidate.multipart_id;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_upload_cleanup_finish(p_tenant uuid,p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.social_upload_cleanup', 'on', true);
  PERFORM set_config('app.social_definer', 'on', true);
  PERFORM set_config('app.social_inbox_worker', 'on', true);
  DELETE FROM public.files f WHERE (f.tenant_id,f.id) = (p_tenant,p_id) AND f.social_upload AND f.social_retired_at IS NOT NULL
    AND f.status IN ('pending','uploaded') AND NOT public.social_upload_in_use(p_tenant,p_id);
  RETURN FOUND;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_upload_cleanup_pending() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.social_upload_cleanup', 'on', true);
  PERFORM set_config('app.social_definer', 'on', true);
  PERFORM set_config('app.social_inbox_worker', 'on', true);
  RETURN EXISTS (SELECT 1 FROM public.files f WHERE f.social_upload AND f.status IN ('pending','uploaded')
    AND f.created_at <= now() - interval '12 hours' AND coalesce(f.social_confirm_until, '-infinity') <= now()
    AND NOT public.social_upload_in_use(f.tenant_id,f.id));
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_post_media_grant(p_tenant uuid,p_post uuid,p_lock uuid,p_seconds int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE grant_id uuid; deadline timestamptz;
BEGIN
  IF p_seconds IS NULL OR p_seconds NOT BETWEEN 1 AND 7200 THEN RAISE EXCEPTION 'invalid posting media lifetime'; END IF;
  PERFORM set_config('app.social_definer', 'on', true);
  PERFORM 1 FROM public.social_posts p JOIN public.social_drafts d ON (d.tenant_id,d.id) = (p.tenant_id,p.draft_id)
    JOIN public.social_connections c ON (c.tenant_id,c.id) = (p.tenant_id,p.connection_id)
    WHERE (p.tenant_id,p.id,p.lock_token) = (p_tenant,p_post,p_lock) AND p.status = 'publishing' AND d.status = 'submitted'
      AND p.locked_at > now() - interval '1 hour' AND c.status = 'active' AND c.health <> 'failing' FOR SHARE OF p,d,c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.social_post_media_grants (tenant_id,post_id,expires_at,claim_id)
    VALUES (p_tenant,p_post,date_trunc('second',now()) + make_interval(secs => p_seconds),p_lock)
  ON CONFLICT (tenant_id,post_id) DO UPDATE SET id = gen_random_uuid(), expires_at = EXCLUDED.expires_at, claim_id = EXCLUDED.claim_id
  RETURNING id, expires_at INTO grant_id, deadline;
  RETURN jsonb_build_object('id',grant_id,'expiresAt',deadline);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_post_media_read(p_grant uuid,p_file uuid) RETURNS TABLE (object_key text,mime text,size bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE g public.social_post_media_grants%ROWTYPE;
BEGIN
  PERFORM set_config('app.social_definer', 'on', true);
  SELECT * INTO g FROM public.social_post_media_grants WHERE id = p_grant AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.social_media_tenant', g.tenant_id::text, true);
  RETURN QUERY SELECT f.key,f.mime,f.size FROM public.files f
    JOIN public.social_posts p ON (p.tenant_id,p.id) = (g.tenant_id,g.post_id)
    JOIN public.social_drafts d ON (d.tenant_id,d.id) = (p.tenant_id,p.draft_id)
    JOIN public.social_connections c ON (c.tenant_id,c.id) = (p.tenant_id,p.connection_id)
  WHERE (f.tenant_id,f.id) = (g.tenant_id,p_file) AND f.status = 'ready' AND f.social_upload AND f.social_retired_at IS NULL
    AND d.status = 'submitted' AND p.status IN ('publishing','published') AND c.status = 'active'
    AND (p.provider_post_ref IS NOT NULL OR p.lock_token = g.claim_id)
    AND (jsonb_path_exists(p.delivery, '$.**.fileId ? (@ == $id)', jsonb_build_object('id',p_file::text))
      OR p.delivery->'options'->>'coverFileId' = p_file::text);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.social_upload_in_use(uuid,uuid), public.social_upload_cleanup_claim(uuid[]),
  public.social_upload_cleanup_finish(uuid,uuid), public.social_upload_cleanup_pending(),
  public.social_post_media_grant(uuid,uuid,uuid,int), public.social_post_media_read(uuid,uuid) FROM PUBLIC, harvest_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.social_post_media_read(uuid,uuid) TO harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.social_upload_cleanup_claim(uuid[]), public.social_upload_cleanup_finish(uuid,uuid),
      public.social_upload_cleanup_pending(), public.social_post_media_grant(uuid,uuid,uuid,int) TO harvest_worker;
  END IF;
END $$;
