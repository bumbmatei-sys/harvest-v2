CREATE TABLE "social_drafts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"document" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"review_hash" text,
	"review_by" text,
	"review_expires" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_drafts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_draft_shape" CHECK ("social_drafts"."status" in ('draft', 'submitted', 'cancelled') and "social_drafts"."version" > 0
    and jsonb_typeof("social_drafts"."document") = 'object' and octet_length("social_drafts"."document"::text) <= 1100000
    and (("social_drafts"."review_hash" is null and "social_drafts"."review_by" is null and "social_drafts"."review_expires" is null)
      or ("social_drafts"."status" = 'draft' and "social_drafts"."review_hash" ~ '^[0-9a-f]{64}$' and "social_drafts"."review_hash" is not null and "social_drafts"."review_by" is not null and "social_drafts"."review_expires" is not null)))
);
--> statement-breakpoint
CREATE TABLE "social_schedules" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"platform" text,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"slots" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_schedules_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_schedule_platform" CHECK ("social_schedules"."platform" in ('twitter', 'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'reddit', 'bluesky', 'threads', 'googlebusiness', 'telegram', 'snapchat', 'whatsapp', 'discord', 'slack', 'wordpress', 'shopify', 'wix', 'webflow', 'rcs', 'imessage', 'line', 'wechat', 'sms')),
	CONSTRAINT "social_schedule_shape" CHECK (length("social_schedules"."name") between 1 and 120 and length("social_schedules"."timezone") between 1 and 80
    and jsonb_typeof("social_schedules"."slots") = 'array' and jsonb_array_length("social_schedules"."slots") between 1 and 84 and "social_schedules"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_size";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_mime";--> statement-breakpoint
ALTER TABLE "social_connections" DROP CONSTRAINT "social_connection_platform";--> statement-breakpoint
ALTER TABLE "social_posts" DROP CONSTRAINT "social_post_status";--> statement-breakpoint
ALTER TABLE "social_posts" DROP CONSTRAINT "social_post_content";--> statement-breakpoint
ALTER TABLE "social_posts" DROP CONSTRAINT "social_post_error";--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "size" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "social_upload" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "media_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "multipart_id" text;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "draft_id" uuid;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "display_timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "delivery" jsonb;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "repeat_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_drafts" ADD CONSTRAINT "social_drafts_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_drafts" ADD CONSTRAINT "social_drafts_review_by_users_id_fk" FOREIGN KEY ("review_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_drafts" ADD CONSTRAINT "social_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_schedules" ADD CONSTRAINT "social_schedules_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_schedules" ADD CONSTRAINT "social_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_drafts_planner_idx" ON "social_drafts" USING btree ("tenant_id","status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_schedule_scope_idx" ON "social_schedules" USING btree ("tenant_id",coalesce("platform", '')) WHERE "social_schedules"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_tenant_id_draft_id_social_drafts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","draft_id") REFERENCES "public"."social_drafts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_tenant_id_schedule_id_social_schedules_tenant_id_id_fk" FOREIGN KEY ("tenant_id","schedule_id") REFERENCES "public"."social_schedules"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_draft_destination_idx" ON "social_posts" USING btree ("tenant_id","draft_id","connection_id","repeat_number");--> statement-breakpoint
CREATE INDEX "social_posts_schedule_queue_idx" ON "social_posts" USING btree ("tenant_id","schedule_id","scheduled_for");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_social_upload_shape" CHECK ((not "files"."social_upload" and "files"."media_metadata" is null and "files"."multipart_id" is null)
    or ("files"."social_upload" and "files"."visibility" = 'private' and ("files"."status" <> 'ready' or (jsonb_typeof("files"."media_metadata") = 'object' and "files"."media_metadata" is not null))
       and ("files"."multipart_id" is null or length("files"."multipart_id") between 1 and 2048)));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_size" CHECK ("files"."size" BETWEEN 1 AND (case when "files"."social_upload" then 274877906944 else 10485760 end));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_mime" CHECK (("files"."social_upload" and "files"."mime" IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-ms-wmv', 'video/x-flv', 'video/3gpp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'text/plain', 'application/x-subrip', 'text/vtt'))
    or (not "files"."social_upload" and "files"."mime" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain')));--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connection_platform" CHECK ("social_connections"."platform" in ('twitter', 'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'reddit', 'bluesky', 'threads', 'googlebusiness', 'telegram', 'snapchat', 'whatsapp', 'discord', 'slack', 'wordpress', 'shopify', 'wix', 'webflow', 'rcs', 'imessage', 'line', 'wechat', 'sms'));--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_post_delivery" CHECK (("social_posts"."draft_id" is null and "social_posts"."delivery" is null and "social_posts"."schedule_id" is null and "social_posts"."repeat_number" = 0)
    or ("social_posts"."draft_id" is not null and "social_posts"."delivery" is not null and jsonb_typeof("social_posts"."delivery") = 'object'
      and octet_length("social_posts"."delivery"::text) <= 70000 and "social_posts"."media" = '[]'::jsonb and "social_posts"."repeat_number" between 0 and 52));--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_post_status" CHECK ("social_posts"."status" in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled', 'unknown'));--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_post_content" CHECK ((("social_posts"."draft_id" is null and length("social_posts"."content") between 1 and 10000) or ("social_posts"."draft_id" is not null and length("social_posts"."content") <= 100000)) and jsonb_typeof("social_posts"."media") = 'array' and jsonb_array_length("social_posts"."media") <= 10 and octet_length("social_posts"."media"::text) <= 8192);--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_post_error" CHECK ("social_posts"."last_error_code" is null or "social_posts"."last_error_code" in ('PROVIDER_AUTH', 'PROVIDER_REJECTED', 'PROVIDER_CONFLICT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'MAX_ATTEMPTS', 'IDEMPOTENCY_WINDOW_EXPIRED', 'CONNECTION_UNAVAILABLE', 'PARTIAL_PUBLISH', 'DISABLED', 'CREDENTIAL_UNAVAILABLE', 'UNCONFIRMED', 'MEDIA_UNAVAILABLE', 'MEDIA_URL_EXPIRED'));
--> statement-breakpoint
ALTER TABLE public.social_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.social_drafts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.social_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.social_schedules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.social_drafts, public.social_schedules FROM PUBLIC, harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.social_drafts, public.social_schedules TO harvest_app;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['social_drafts', 'social_schedules'] LOOP
    EXECUTE format($p$CREATE POLICY social_publish_admin ON public.%1$I TO harvest_app USING (
      tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = %1$I.tenant_id
        AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin'))
    )$p$, table_name);
  END LOOP;
  EXECUTE format($p$CREATE POLICY social_publish_owner ON public.social_drafts TO %I
    USING (current_setting('app.social_definer', true) = 'on')$p$, current_user);
  EXECUTE format($p$CREATE POLICY social_publish_file_release ON public.files FOR SELECT TO %I
    USING (status = 'ready' AND tenant_id = nullif(current_setting('app.social_media_tenant', true), '')::uuid)$p$, current_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.guard_social_publish_record() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN
      RAISE EXCEPTION 'invalid social publish record creator';
    END IF;
    IF TG_TABLE_NAME = 'social_drafts' THEN
      IF NEW.status <> 'draft' OR NEW.review_hash IS NOT NULL THEN RAISE EXCEPTION 'invalid initial draft'; END IF;
    ELSIF NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'invalid initial schedule';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.created_by, OLD.created_at) OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid social publish version';
  END IF;
  IF TG_TABLE_NAME = 'social_drafts' THEN
    IF OLD.status = 'cancelled' OR (OLD.status = 'submitted' AND NEW.status = 'draft')
      OR (OLD.status <> 'draft' AND NEW.document IS DISTINCT FROM OLD.document)
      OR (NEW.document IS DISTINCT FROM OLD.document AND NEW.review_hash IS NOT NULL) THEN
      RAISE EXCEPTION 'invalid draft transition';
    END IF;
  ELSIF OLD.archived_at IS NOT NULL OR NEW.platform IS DISTINCT FROM OLD.platform THEN
    RAISE EXCEPTION 'invalid schedule transition';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_draft_guard BEFORE INSERT OR UPDATE ON public.social_drafts
  FOR EACH ROW EXECUTE FUNCTION public.guard_social_publish_record();
--> statement-breakpoint
CREATE TRIGGER social_schedule_guard BEFORE INSERT OR UPDATE ON public.social_schedules
  FOR EACH ROW EXECUTE FUNCTION public.guard_social_publish_record();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_social_post() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'scheduled') OR NEW.attempts <> 0 OR NEW.provider_post_ref IS NOT NULL OR NEW.published_at IS NOT NULL
      OR NEW.last_error_code IS NOT NULL OR NEW.first_attempt_at IS NOT NULL THEN
      RAISE EXCEPTION 'social post must start as a draft or scheduled';
    END IF;
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '')
      AND NOT (NEW.repeat_number > 0 AND current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID))) THEN RAISE EXCEPTION 'social post belongs to the signed-in person'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.social_connections c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.connection_id AND c.status = 'active') THEN
      RAISE EXCEPTION 'social post needs an active connection';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.connection_id, NEW.idempotency_key, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.connection_id, OLD.idempotency_key, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'social post identity is immutable';
  END IF;
  IF (NEW.draft_id, NEW.delivery, NEW.repeat_number) IS DISTINCT FROM (OLD.draft_id, OLD.delivery, OLD.repeat_number)
    OR (OLD.draft_id IS NOT NULL AND NEW.version <> OLD.version + 1)
    OR (OLD.first_attempt_at IS NOT NULL AND (NEW.schedule_id, NEW.display_timezone) IS DISTINCT FROM (OLD.schedule_id, OLD.display_timezone)) THEN
    RAISE EXCEPTION 'invalid social delivery change';
  END IF;
  IF OLD.status IN ('published', 'cancelled') THEN RAISE EXCEPTION 'social post is % and cannot change', OLD.status; END IF;
  -- A failed post is retried only when no earlier attempt can have gone out unseen: the outcome must not be ambiguous and the provider
  -- must still remember the idempotency key (23 hours from the first attempt). Otherwise a person makes a new post.
  IF OLD.status = 'failed' AND NEW.status = 'scheduled' AND (OLD.last_error_code IN ('IDEMPOTENCY_WINDOW_EXPIRED', 'UNCONFIRMED')
    OR OLD.first_attempt_at <= now() - interval '23 hours') THEN
    RAISE EXCEPTION 'this failed post cannot be retried safely';
  END IF;
  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('draft', 'scheduled', 'cancelled'))
    OR (OLD.status = 'scheduled' AND NEW.status IN ('draft', 'scheduled', 'publishing', 'failed', 'cancelled'))
    OR (OLD.status = 'publishing' AND NEW.status IN ('published', 'failed', 'scheduled')
      OR OLD.status = 'publishing' AND NEW.status = 'publishing' AND (OLD.provider_post_ref IS NOT NULL OR NEW.provider_post_ref IS NOT NULL))
    OR (OLD.status = 'failed' AND NEW.status IN ('scheduled', 'cancelled'))
    OR (OLD.status = 'publishing' AND NEW.status = 'unknown' AND OLD.draft_id IS NOT NULL)
    OR (OLD.status = 'unknown' AND NEW.status IN ('published', 'failed') AND NEW.provider_post_ref IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'social post cannot move from % to %', OLD.status, NEW.status;
  END IF;
  -- Once any attempt has been made the provider may hold the post under its idempotency key, so its time, content and draft/scheduled
  -- state are frozen (no reschedule, no draft round-trip): a person cancels it and creates a new post. Cancelling, failing and the
  -- worker's own moves are unaffected.
  IF OLD.first_attempt_at IS NOT NULL AND OLD.status IN ('draft', 'scheduled') AND NEW.status IN ('draft', 'scheduled')
    AND (NEW.status, NEW.scheduled_for, NEW.content, NEW.media) IS DISTINCT FROM (OLD.status, OLD.scheduled_for, OLD.content, OLD.media) THEN
    RAISE EXCEPTION 'a post that has had an attempt cannot be moved or edited; create a new post';
  END IF;
  IF (NEW.content, NEW.media) IS DISTINCT FROM (OLD.content, OLD.media) AND NOT (OLD.status IN ('draft', 'scheduled') AND NEW.status IN ('draft', 'scheduled')) THEN
    RAISE EXCEPTION 'social post content is frozen once it leaves draft or scheduled';
  END IF;
  IF OLD.provider_post_ref IS NOT NULL AND NEW.provider_post_ref IS DISTINCT FROM OLD.provider_post_ref THEN RAISE EXCEPTION 'provider reference is immutable'; END IF;
  IF NEW.provider_post_ref IS NOT NULL AND NEW.status NOT IN ('publishing', 'published', 'failed', 'unknown') THEN RAISE EXCEPTION 'provider reference only on a submitted post'; END IF;
  IF NEW.attempts < OLD.attempts AND NOT (OLD.status = 'failed' AND NEW.status = 'scheduled') THEN RAISE EXCEPTION 'attempts only go up'; END IF;
  -- The 23-hour idempotency rule rests on this column: once set it never changes or clears (the claim only ever sets it from NULL).
  IF OLD.first_attempt_at IS NOT NULL AND NEW.first_attempt_at IS DISTINCT FROM OLD.first_attempt_at THEN RAISE EXCEPTION 'first attempt time is immutable'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.social_publish_claim(p_limit integer, p_lease_seconds integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r record; out jsonb := '[]'::jsonb; tok uuid; lease interval;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN RAISE EXCEPTION 'invalid claim bounds'; END IF;
  PERFORM set_config('app.social_definer', 'on', true);
  lease := make_interval(secs => p_lease_seconds);
  -- Accepted posts the provider never confirmed within 72 hours.
  UPDATE public.social_posts SET status = CASE WHEN draft_id IS NULL THEN 'failed' ELSE 'unknown' END, last_error_code = 'UNCONFIRMED', lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
    WHERE status = 'publishing' AND provider_post_ref IS NOT NULL AND first_attempt_at < now() - interval '72 hours' AND (lock_token IS NULL OR locked_at < now() - lease);
  -- A lost claim for a grouped delivery may have sent a request. Never blindly republish it.
  UPDATE public.social_posts SET status = 'unknown', last_error_code = 'UNCONFIRMED', lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
    WHERE draft_id IS NOT NULL AND status = 'publishing' AND provider_post_ref IS NULL AND locked_at < now() - lease;
  -- Expired lease with no provider reference: the send may or may not have happened.
  UPDATE public.social_posts SET status = 'failed', last_error_code = 'IDEMPOTENCY_WINDOW_EXPIRED', lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
    WHERE status = 'publishing' AND provider_post_ref IS NULL AND locked_at < now() - lease AND first_attempt_at <= now() - interval '23 hours';
  UPDATE public.social_posts SET status = 'failed', last_error_code = 'MAX_ATTEMPTS', lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
    WHERE status = 'publishing' AND provider_post_ref IS NULL AND locked_at < now() - lease AND attempts >= max_attempts;
  UPDATE public.social_posts SET status = 'scheduled', next_attempt_at = now(), lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
    WHERE status = 'publishing' AND provider_post_ref IS NULL AND locked_at < now() - lease;
  -- An expired reconciliation lease just releases the lock; it is picked up again below.
  UPDATE public.social_posts SET lock_token = NULL, locked_at = NULL, next_attempt_at = now(), updated_at = now(), version = version + 1
    WHERE status = 'publishing' AND provider_post_ref IS NOT NULL AND locked_at < now() - lease;
  -- A scheduled post that has had an attempt (a retry waiting out its backoff, or a manual retry) is never sent again once the provider
  -- may have forgotten its idempotency key: it fails for a person, exactly like an expired lease. No worker outage can resend it.
  UPDATE public.social_posts SET status = 'failed', last_error_code = 'IDEMPOTENCY_WINDOW_EXPIRED', updated_at = now(), version = version + 1
    WHERE status = 'scheduled' AND first_attempt_at IS NOT NULL AND first_attempt_at <= now() - interval '23 hours';
  UPDATE public.social_posts p SET status = 'failed', last_error_code = 'CONNECTION_UNAVAILABLE', updated_at = now(), version = p.version + 1
    FROM public.social_connections c WHERE c.tenant_id = p.tenant_id AND c.id = p.connection_id AND (c.status <> 'active' OR (p.draft_id IS NOT NULL AND c.health = 'failing'))
      AND p.status = 'scheduled' AND p.next_attempt_at <= now() AND p.scheduled_for <= now();
  FOR r IN
    SELECT p.tenant_id, p.id, p.status, p.provider_post_ref, p.content, p.media, p.delivery, p.idempotency_key, p.attempts, p.max_attempts, p.connection_id,
      c.provider, c.platform, c.external_account_ref, c.credential_envelope
    FROM public.social_posts p JOIN public.social_connections c ON c.tenant_id = p.tenant_id AND c.id = p.connection_id
    WHERE c.status = 'active' AND (p.draft_id IS NULL OR c.health <> 'failing') AND p.next_attempt_at <= now()
      AND ((p.status = 'scheduled' AND p.scheduled_for <= now() AND p.attempts < p.max_attempts AND (p.first_attempt_at IS NULL OR p.first_attempt_at > now() - interval '23 hours'))
        OR (p.status = 'publishing' AND p.lock_token IS NULL AND p.provider_post_ref IS NOT NULL))
    ORDER BY p.next_attempt_at, p.id LIMIT p_limit FOR UPDATE OF p SKIP LOCKED
  LOOP
    tok := gen_random_uuid();
    IF r.status = 'scheduled' THEN
      UPDATE public.social_posts SET status = 'publishing', attempts = attempts + 1, lock_token = tok, locked_at = now(), first_attempt_at = coalesce(first_attempt_at, now()),
        updated_at = now(), version = version + 1 WHERE tenant_id = r.tenant_id AND id = r.id;
    ELSE
      UPDATE public.social_posts SET lock_token = tok, locked_at = now(), updated_at = now(), version = version + 1 WHERE tenant_id = r.tenant_id AND id = r.id;
    END IF;
    out := out || jsonb_build_array(jsonb_build_object(
      'action', CASE WHEN r.status = 'scheduled' THEN 'publish' ELSE 'reconcile' END,
      'tenantId', r.tenant_id, 'postId', r.id, 'lockToken', tok, 'connectionId', r.connection_id, 'provider', r.provider, 'platform', r.platform,
      'accountRef', r.external_account_ref, 'content', r.content, 'media', r.media, 'delivery', r.delivery, 'idempotencyKey', r.idempotency_key, 'providerPostRef', r.provider_post_ref,
      'attempts', r.attempts + CASE WHEN r.status = 'scheduled' THEN 1 ELSE 0 END, 'maxAttempts', r.max_attempts, 'envelope', r.credential_envelope));
  END LOOP;
  PERFORM set_config('app.social_definer', '', true);
  RETURN out;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.social_publish_complete(p_tenant uuid, p_post uuid, p_lock uuid, p_outcome text, p_ref text, p_error text, p_delay_seconds integer) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r public.social_posts%ROWTYPE; v_status text; delay interval := make_interval(secs => least(greatest(coalesce(p_delay_seconds, 60), 1), 86400));
BEGIN
  IF p_tenant IS NULL OR p_post IS NULL OR p_lock IS NULL THEN RAISE EXCEPTION 'invalid completion'; END IF;
  PERFORM set_config('app.social_definer', 'on', true);
  SELECT * INTO r FROM public.social_posts WHERE tenant_id = p_tenant AND id = p_post AND status = 'publishing' AND lock_token = p_lock FOR UPDATE;
  IF NOT FOUND THEN PERFORM set_config('app.social_definer', '', true); RETURN 'stale'; END IF;
  IF p_outcome = 'published' THEN
    IF p_ref IS NULL AND r.provider_post_ref IS NULL THEN RAISE EXCEPTION 'a published post needs a provider reference'; END IF;
    UPDATE public.social_posts SET status = 'published', provider_post_ref = coalesce(r.provider_post_ref, p_ref), published_at = now(), last_error_code = NULL,
      lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1 WHERE tenant_id = p_tenant AND id = p_post;
  ELSIF p_outcome = 'accepted' THEN
    IF p_ref IS NULL AND r.provider_post_ref IS NULL THEN RAISE EXCEPTION 'an accepted post needs a provider reference'; END IF;
    UPDATE public.social_posts SET provider_post_ref = coalesce(r.provider_post_ref, p_ref), next_attempt_at = now() + delay, last_error_code = NULL,
      lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1 WHERE tenant_id = p_tenant AND id = p_post;
  ELSIF p_outcome = 'retry' THEN
    IF r.provider_post_ref IS NOT NULL THEN RAISE EXCEPTION 'an accepted post is reconciled, not retried'; END IF;
    IF r.attempts >= r.max_attempts THEN
      UPDATE public.social_posts SET status = 'failed', last_error_code = CASE WHEN r.draft_id IS NULL THEN 'MAX_ATTEMPTS' ELSE p_error END, lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
        WHERE tenant_id = p_tenant AND id = p_post;
    ELSE
      UPDATE public.social_posts SET status = 'scheduled', last_error_code = p_error, next_attempt_at = now() + delay, lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
        WHERE tenant_id = p_tenant AND id = p_post;
    END IF;
  ELSIF p_outcome = 'unknown' AND r.draft_id IS NOT NULL THEN
    UPDATE public.social_posts SET status = 'unknown', last_error_code = 'UNCONFIRMED', lock_token = NULL, locked_at = NULL,
      updated_at = now(), version = version + 1 WHERE tenant_id = p_tenant AND id = p_post;
  ELSIF p_outcome = 'failed' THEN
    UPDATE public.social_posts SET status = 'failed', last_error_code = p_error, lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
      WHERE tenant_id = p_tenant AND id = p_post;
  ELSE RAISE EXCEPTION 'unknown outcome';
  END IF;
  SELECT status INTO v_status FROM public.social_posts WHERE tenant_id = p_tenant AND id = p_post;
  PERFORM set_config('app.social_definer', '', true);
  RETURN v_status;
END $$;--> statement-breakpoint

-- The worker can release only ready attachments for a currently held delivery lease.
CREATE FUNCTION public.social_publish_media(p_tenant uuid, p_post uuid, p_lock uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE payload jsonb; result jsonb;
BEGIN
  PERFORM set_config('app.social_definer', 'on', true);
  SELECT p.delivery INTO payload FROM public.social_posts p
    JOIN public.social_connections c ON c.tenant_id = p.tenant_id AND c.id = p.connection_id
    WHERE p.tenant_id = p_tenant AND p.id = p_post AND p.lock_token = p_lock AND p.status = 'publishing'
      AND p.locked_at > now() - interval '1 hour' AND c.status = 'active' AND c.health <> 'failing';
  PERFORM set_config('app.social_definer', '', true);
  IF payload IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.social_media_tenant', p_tenant::text, true);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'key', f.key, 'name', f.name, 'mime', f.mime,
    'size', f.size, 'metadata', f.media_metadata)), '[]'::jsonb) INTO result
    FROM public.files f WHERE f.tenant_id = p_tenant AND f.status = 'ready' AND (
      EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'media') item WHERE item->>'fileId' = f.id::text)
      OR payload->'options'->>'coverFileId' = f.id::text
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'options'->'subtitles') track WHERE track->>'fileId' = f.id::text)
    );
  PERFORM set_config('app.social_media_tenant', '', true);
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.social_publish_media(uuid, uuid, uuid) FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.social_publish_media(uuid, uuid, uuid) TO harvest_worker;
  END IF;
END $$;
--> statement-breakpoint
-- Reposts use the same delivery table and are created only after a confirmed publish. One future copy per destination.
CREATE FUNCTION public.social_publish_repeat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE rule jsonb; next_at timestamptz; group_status text; prior_context text := current_setting('app.social_definer', true);
BEGIN
  rule := NEW.delivery->'options'->'repost';
  IF rule IS NULL OR NEW.repeat_number >= 52 THEN RETURN NEW; END IF;
  next_at := NEW.published_at + make_interval(days => (rule->>'intervalDays')::integer);
  IF (rule->'stop'->>'kind' = 'count' AND NEW.repeat_number >= (rule->'stop'->>'copies')::integer)
    OR (rule->'stop'->>'kind' = 'date' AND next_at > (rule->'stop'->>'until')::timestamptz) THEN RETURN NEW; END IF;
  PERFORM set_config('app.social_definer', 'on', true);
  SELECT status INTO group_status FROM public.social_drafts WHERE tenant_id = NEW.tenant_id AND id = NEW.draft_id;
  IF group_status = 'submitted' AND EXISTS (SELECT 1 FROM public.social_connections
    WHERE tenant_id = NEW.tenant_id AND id = NEW.connection_id AND status = 'active' AND health <> 'failing') THEN
    INSERT INTO public.social_posts (tenant_id, connection_id, draft_id, repeat_number, status, content, delivery,
      display_timezone, scheduled_for, next_attempt_at, idempotency_key, created_by)
    VALUES (NEW.tenant_id, NEW.connection_id, NEW.draft_id, NEW.repeat_number + 1, 'scheduled', NEW.content, NEW.delivery,
      NEW.display_timezone, next_at, next_at, gen_random_uuid()::text, NEW.created_by)
    ON CONFLICT (tenant_id, draft_id, connection_id, repeat_number) DO NOTHING;
  END IF;
  PERFORM set_config('app.social_definer', coalesce(prior_context, ''), true);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.social_publish_repeat() FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE TRIGGER social_post_repeat AFTER UPDATE OF status ON public.social_posts
  FOR EACH ROW WHEN (NEW.status = 'published' AND OLD.status <> 'published' AND NEW.draft_id IS NOT NULL)
  EXECUTE FUNCTION public.social_publish_repeat();
--> statement-breakpoint
-- The shared files table keeps its established policy for ordinary uploads. Social uploads
-- require the Publish role even when accessed through a different application query.
CREATE POLICY social_file_admin ON public.files AS RESTRICTIVE TO harvest_app
  USING (NOT social_upload OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = files.tenant_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')))
  WITH CHECK (NOT social_upload OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = files.tenant_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
