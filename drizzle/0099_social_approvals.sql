CREATE TABLE "social_approval_notices" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" text NOT NULL,
	"approval_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_approval_notices_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_approval_notices_kind" CHECK ("social_approval_notices"."kind" in ('requested','approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "social_approval_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'off' NOT NULL,
	"self_approval" text DEFAULT 'owner_only' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_approval_settings_shape" CHECK ("social_approval_settings"."mode" in ('off','required') and "social_approval_settings"."self_approval" in ('never','owner_only','always') and "social_approval_settings"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "social_approvals" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid,
	"post_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"fingerprint" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "social_approvals_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_approvals_shape" CHECK (num_nonnulls("social_approvals"."draft_id", "social_approvals"."post_id") = 1 and "social_approvals"."status" in ('pending','approved','rejected','withdrawn','superseded') and "social_approvals"."fingerprint" ~ '^[0-9a-f]{64}$'
    and ("social_approvals"."note" is null or length("social_approvals"."note") <= 500) and "social_approvals"."version" >= 1 and ("social_approvals"."status" not in ('approved','rejected') or ("social_approvals"."decided_by" is not null and "social_approvals"."decided_at" is not null))
    and ("social_approvals"."status" <> 'rejected' or "social_approvals"."note" is not null))
);
--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "provider_post_url" text;--> statement-breakpoint
ALTER TABLE "social_approval_notices" ADD CONSTRAINT "social_approval_notices_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_approval_notices" ADD CONSTRAINT "social_approval_notices_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."social_approvals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_approval_settings" ADD CONSTRAINT "social_approval_settings_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_approval_settings" ADD CONSTRAINT "social_approval_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_approvals" ADD CONSTRAINT "social_approvals_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_approvals" ADD CONSTRAINT "social_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_approvals" ADD CONSTRAINT "social_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_approvals" ADD CONSTRAINT "social_approvals_draft_fk" FOREIGN KEY ("tenant_id","draft_id") REFERENCES "public"."social_drafts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_approvals" ADD CONSTRAINT "social_approvals_post_fk" FOREIGN KEY ("tenant_id","post_id") REFERENCES "public"."social_posts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_approval_notices_inbox_idx" ON "social_approval_notices" USING btree ("tenant_id","recipient_user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_approvals_pending_draft_idx" ON "social_approvals" USING btree ("tenant_id","draft_id") WHERE "social_approvals"."status" = 'pending' and "social_approvals"."draft_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "social_approvals_pending_post_idx" ON "social_approvals" USING btree ("tenant_id","post_id") WHERE "social_approvals"."status" = 'pending' and "social_approvals"."post_id" is not null;--> statement-breakpoint
CREATE INDEX "social_approvals_queue_idx" ON "social_approvals" USING btree ("tenant_id","status","requested_at");--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_post_url" CHECK ("social_posts"."provider_post_url" is null or ("social_posts"."provider_post_url" ~ '^https://' and length("social_posts"."provider_post_url") <= 2048));--> statement-breakpoint
CREATE FUNCTION public.social_approval_can(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner','admin'))
$$;
--> statement-breakpoint
CREATE FUNCTION public.social_approval_owner(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id = 'owner')
$$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['social_approval_settings','social_approvals','social_approval_notices'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    -- Only the SECURITY DEFINER functions below set this flag; the application role can never satisfy the guard.
    EXECUTE format('CREATE POLICY social_approval_definer ON public.%I FOR SELECT TO PUBLIC USING (current_user <> ''harvest_app'' AND current_setting(''app.social_approval_definer'', true) = ''on'')', t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE POLICY social_drafts_approval_definer ON public.social_drafts FOR SELECT TO PUBLIC
  USING (current_user <> 'harvest_app' AND current_setting('app.social_approval_definer', true) = 'on');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.social_approval_settings TO harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.social_approvals TO harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.social_approval_notices TO harvest_app;
--> statement-breakpoint
CREATE POLICY social_approval_settings_read ON public.social_approval_settings FOR SELECT TO harvest_app USING (public.social_approval_can(tenant_id));
--> statement-breakpoint
CREATE POLICY social_approval_settings_owner_insert ON public.social_approval_settings FOR INSERT TO harvest_app WITH CHECK (public.social_approval_owner(tenant_id));
--> statement-breakpoint
CREATE POLICY social_approval_settings_owner_update ON public.social_approval_settings FOR UPDATE TO harvest_app USING (public.social_approval_owner(tenant_id)) WITH CHECK (public.social_approval_owner(tenant_id));
--> statement-breakpoint
CREATE POLICY social_approvals_admin ON public.social_approvals TO harvest_app USING (public.social_approval_can(tenant_id)) WITH CHECK (public.social_approval_can(tenant_id));
--> statement-breakpoint
CREATE POLICY social_approval_notices_own ON public.social_approval_notices FOR SELECT TO harvest_app
  USING (public.social_approval_can(tenant_id) AND recipient_user_id = nullif(current_setting('app.user_id', true), ''));
--> statement-breakpoint
CREATE POLICY social_approval_notices_insert ON public.social_approval_notices FOR INSERT TO harvest_app WITH CHECK (public.social_approval_can(tenant_id));
--> statement-breakpoint
CREATE POLICY social_approval_notices_read ON public.social_approval_notices FOR UPDATE TO harvest_app
  USING (public.social_approval_can(tenant_id) AND recipient_user_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (public.social_approval_can(tenant_id) AND recipient_user_id = nullif(current_setting('app.user_id', true), ''));
--> statement-breakpoint
-- Fingerprint of exactly what an approver saw. A draft is its composer document (every delivery is derived from it and is frozen once submitted); a draft-less post is its own
-- content, media and account. Timing and status are deliberately not part of it: rescheduling does not invalidate an approval, an edit does.
CREATE FUNCTION public.social_subject_fingerprint(p_tenant uuid, p_draft uuid, p_post uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE fp text; prior_flag text := current_setting('app.social_approval_definer', true); prior_social text := current_setting('app.social_definer', true);
BEGIN
  PERFORM set_config('app.social_approval_definer','on',true);
  PERFORM set_config('app.social_definer','on',true);
  IF p_draft IS NOT NULL THEN
    SELECT encode(sha256(convert_to(d.document::text, 'UTF8')), 'hex') INTO fp FROM public.social_drafts d WHERE (d.tenant_id, d.id) = (p_tenant, p_draft);
  ELSE
    SELECT encode(sha256(convert_to(p.content || '|' || p.media::text || '|' || p.connection_id::text, 'UTF8')), 'hex') INTO fp FROM public.social_posts p WHERE (p.tenant_id, p.id) = (p_tenant, p_post);
  END IF;
  PERFORM set_config('app.social_approval_definer', coalesce(prior_flag,''), true);
  PERFORM set_config('app.social_definer', coalesce(prior_social,''), true);
  RETURN fp;
END $$;
--> statement-breakpoint
-- The caller-facing form: only for the ministry the session is acting in, only for an owner or admin.
CREATE FUNCTION public.social_approval_fingerprint(p_draft uuid, p_post uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE t uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF t IS NULL OR NOT public.social_approval_can(t) OR num_nonnulls(p_draft, p_post) <> 1 THEN RETURN NULL; END IF;
  RETURN public.social_subject_fingerprint(t, p_draft, p_post);
END $$;
--> statement-breakpoint
-- True when the ministry requires approval and this subject has no approved, still-matching request.
CREATE FUNCTION public.social_approval_blocks(p_tenant uuid, p_draft uuid, p_post uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE required boolean; fp text; ok boolean; prior_flag text := current_setting('app.social_approval_definer', true);
BEGIN
  PERFORM set_config('app.social_approval_definer','on',true);
  SELECT s.mode = 'required' INTO required FROM public.social_approval_settings s WHERE s.tenant_id = p_tenant;
  IF NOT coalesce(required, false) THEN PERFORM set_config('app.social_approval_definer', coalesce(prior_flag,''), true); RETURN false; END IF;
  fp := public.social_subject_fingerprint(p_tenant, p_draft, p_post);
  PERFORM set_config('app.social_approval_definer','on',true);
  SELECT EXISTS (SELECT 1 FROM public.social_approvals a WHERE a.tenant_id = p_tenant AND a.status = 'approved' AND a.fingerprint = fp
    AND ((p_draft IS NOT NULL AND a.draft_id = p_draft) OR (p_draft IS NULL AND a.post_id = p_post))) INTO ok;
  PERFORM set_config('app.social_approval_definer', coalesce(prior_flag,''), true);
  RETURN NOT coalesce(ok, false) OR fp IS NULL;
END $$;
--> statement-breakpoint
-- Defence in depth: whatever moves a post from scheduled to publishing, an unapproved subject cannot.
CREATE FUNCTION public.social_post_approval_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.status = 'scheduled' AND NEW.status = 'publishing' AND public.social_approval_blocks(NEW.tenant_id, NEW.draft_id, NEW.id) THEN
    RAISE EXCEPTION 'approval required before this post can publish' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_post_approval_gate BEFORE UPDATE OF status ON public.social_posts FOR EACH ROW EXECUTE FUNCTION public.social_post_approval_gate();
--> statement-breakpoint
-- Approval rules the application cannot skip. Runs as the caller (session settings carry the actor and the ministry).
CREATE FUNCTION public.social_approval_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); setting text; role_id text; fp text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.requested_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'an approval request starts pending and is filed by its requester'; END IF;
    fp := public.social_approval_fingerprint(NEW.draft_id, NEW.post_id);
    IF fp IS NULL OR fp <> NEW.fingerprint THEN RAISE EXCEPTION 'approval fingerprint does not match the subject'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.draft_id, NEW.post_id, NEW.fingerprint, NEW.requested_by, NEW.requested_at) IS DISTINCT FROM (OLD.tenant_id, OLD.draft_id, OLD.post_id, OLD.fingerprint, OLD.requested_by, OLD.requested_at) THEN
    RAISE EXCEPTION 'an approval request is immutable apart from its decision';
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (OLD.status = 'pending' AND NEW.status IN ('approved','rejected','withdrawn','superseded') OR OLD.status = 'approved' AND NEW.status IN ('withdrawn','superseded')) THEN
    RAISE EXCEPTION 'approval cannot move from % to %', OLD.status, NEW.status;
  END IF;
  IF NEW.status IN ('approved','rejected') THEN
    IF NEW.decided_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'a decision is filed by the person who makes it'; END IF;
  END IF;
  IF NEW.status = 'approved' THEN
    fp := public.social_approval_fingerprint(NEW.draft_id, NEW.post_id);
    IF fp IS DISTINCT FROM NEW.fingerprint THEN RAISE EXCEPTION 'the content changed since this request was filed' USING ERRCODE = 'check_violation'; END IF;
    IF NEW.decided_by = NEW.requested_by THEN
      SELECT s.self_approval INTO setting FROM public.social_approval_settings s WHERE s.tenant_id = NEW.tenant_id;
      setting := coalesce(setting, 'owner_only');
      SELECT m.role_id INTO role_id FROM public.workspace_members m WHERE m.tenant_id = NEW.tenant_id AND m.user_id = actor;
      IF setting = 'never' OR (setting = 'owner_only' AND role_id IS DISTINCT FROM 'owner') THEN RAISE EXCEPTION 'self approval is not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_approval_guard BEFORE INSERT OR UPDATE ON public.social_approvals FOR EACH ROW EXECUTE FUNCTION public.social_approval_guard();
--> statement-breakpoint
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
      AND ((p.status = 'scheduled' AND p.scheduled_for <= now() AND p.attempts < p.max_attempts AND (p.first_attempt_at IS NULL OR p.first_attempt_at > now() - interval '23 hours')
          AND NOT public.social_approval_blocks(p.tenant_id, p.draft_id, p.id))
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
END $$;
--> statement-breakpoint
-- The platform URL of a confirmed publish. The worker completes through this wrapper; a trigger copies the URL onto the row in the same statement that publishes it
-- (a published post can no longer change, and an update while publishing is not a legal move).
CREATE FUNCTION public.social_post_url_apply() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE u text := nullif(current_setting('app.social_post_url', true), '');
BEGIN
  IF u IS NOT NULL AND OLD.status = 'publishing' AND NEW.status = 'published' AND NEW.provider_post_url IS NULL AND u ~ '^https://' AND length(u) <= 2048 THEN NEW.provider_post_url := u; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_post_url_apply BEFORE UPDATE OF status ON public.social_posts FOR EACH ROW EXECUTE FUNCTION public.social_post_url_apply();
--> statement-breakpoint
CREATE FUNCTION public.social_publish_complete_url(p_tenant uuid, p_post uuid, p_lock uuid, p_outcome text, p_ref text, p_error text, p_delay_seconds integer, p_url text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result text;
BEGIN
  IF p_url IS NULL OR p_url !~ '^https://' OR length(p_url) > 2048 OR p_outcome <> 'published' THEN RETURN public.social_publish_complete(p_tenant, p_post, p_lock, p_outcome, p_ref, p_error, p_delay_seconds); END IF;
  PERFORM set_config('app.social_post_url', p_url, true);
  result := public.social_publish_complete(p_tenant, p_post, p_lock, p_outcome, p_ref, p_error, p_delay_seconds);
  PERFORM set_config('app.social_post_url', '', true);
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.social_subject_fingerprint(uuid,uuid,uuid), public.social_approval_blocks(uuid,uuid,uuid), public.social_post_approval_gate(), public.social_publish_complete_url(uuid,uuid,uuid,text,text,text,integer,text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.social_approval_fingerprint(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.social_approval_fingerprint(uuid,uuid) TO harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.social_publish_complete_url(uuid,uuid,uuid,text,text,text,integer,text) TO harvest_worker;
  END IF;
END $$;
