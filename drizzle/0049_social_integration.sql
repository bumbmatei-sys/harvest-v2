CREATE TABLE "social_connections" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"platform" text NOT NULL,
	"external_account_ref" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"health" text DEFAULT 'unknown' NOT NULL,
	"health_code" text,
	"health_checked_at" timestamp with time zone,
	"credential_envelope" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_connections_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_connection_provider" CHECK ("social_connections"."provider" in ('zernio', 'fake')),
	CONSTRAINT "social_connection_platform" CHECK ("social_connections"."platform" in ('facebook', 'instagram', 'threads', 'tiktok', 'youtube')),
	CONSTRAINT "social_connection_status" CHECK ("social_connections"."status" in ('active', 'disabled', 'revoked')),
	CONSTRAINT "social_connection_health" CHECK ("social_connections"."health" in ('unknown', 'healthy', 'degraded', 'failing') and ("social_connections"."health_code" is null or "social_connections"."health_code" ~ '^[a-z0-9_.-]{1,60}$')),
	CONSTRAINT "social_connection_fields" CHECK (length("social_connections"."external_account_ref") between 1 and 200 and ("social_connections"."display_name" is null or length("social_connections"."display_name") between 1 and 120)),
	CONSTRAINT "social_connection_envelope" CHECK (jsonb_typeof("social_connections"."credential_envelope") = 'object' and "social_connections"."credential_envelope" ?& array['version', 'keyId', 'binding', 'iv', 'tag', 'ciphertext'] and not ("social_connections"."credential_envelope" ?| array['secret', 'token', 'apiKey', 'accessToken']) and octet_length("social_connections"."credential_envelope"::text) <= 4096)
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" text NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"first_attempt_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"lock_token" uuid,
	"provider_post_ref" text,
	"published_at" timestamp with time zone,
	"last_error_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_posts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_post_status" CHECK ("social_posts"."status" in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')),
	CONSTRAINT "social_post_content" CHECK (length("social_posts"."content") between 1 and 10000 and jsonb_typeof("social_posts"."media") = 'array' and jsonb_array_length("social_posts"."media") <= 10 and octet_length("social_posts"."media"::text) <= 8192),
	CONSTRAINT "social_post_counters" CHECK ("social_posts"."attempts" >= 0 and "social_posts"."max_attempts" between 1 and 10 and "social_posts"."attempts" <= "social_posts"."max_attempts" and "social_posts"."version" >= 1),
	CONSTRAINT "social_post_key" CHECK (length("social_posts"."idempotency_key") between 8 and 100),
	CONSTRAINT "social_post_error" CHECK ("social_posts"."last_error_code" is null or "social_posts"."last_error_code" in ('PROVIDER_AUTH', 'PROVIDER_REJECTED', 'PROVIDER_CONFLICT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'MAX_ATTEMPTS', 'IDEMPOTENCY_WINDOW_EXPIRED', 'CONNECTION_UNAVAILABLE', 'PARTIAL_PUBLISH', 'DISABLED', 'CREDENTIAL_UNAVAILABLE', 'UNCONFIRMED')),
	CONSTRAINT "social_post_state_shape" CHECK (("social_posts"."status" <> 'scheduled' or ("social_posts"."scheduled_for" is not null and "social_posts"."next_attempt_at" is not null and "social_posts"."lock_token" is null and "social_posts"."locked_at" is null))
    and ("social_posts"."status" <> 'publishing' or ("social_posts"."first_attempt_at" is not null and (("social_posts"."lock_token" is not null and "social_posts"."locked_at" is not null) or ("social_posts"."lock_token" is null and "social_posts"."locked_at" is null and "social_posts"."provider_post_ref" is not null and "social_posts"."next_attempt_at" is not null))))
    and ("social_posts"."status" = 'publishing' or ("social_posts"."lock_token" is null and "social_posts"."locked_at" is null))
    and ("social_posts"."status" <> 'scheduled' or "social_posts"."provider_post_ref" is null)
    and ("social_posts"."status" <> 'published' or ("social_posts"."provider_post_ref" is not null and "social_posts"."published_at" is not null))
    and ("social_posts"."status" <> 'failed' or "social_posts"."last_error_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "social_webhook_events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"external_account_ref" text NOT NULL,
	"subject_ref" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "social_webhook_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "social_webhook_provider" CHECK ("social_webhook_events"."provider" in ('zernio', 'fake')),
	CONSTRAINT "social_webhook_fields" CHECK (length("social_webhook_events"."provider_event_id") between 1 and 200 and length("social_webhook_events"."event_type") between 1 and 100 and length("social_webhook_events"."external_account_ref") between 1 and 200 and ("social_webhook_events"."subject_ref" is null or length("social_webhook_events"."subject_ref") between 1 and 200)),
	CONSTRAINT "social_webhook_detail" CHECK (jsonb_typeof("social_webhook_events"."detail") = 'object' and octet_length("social_webhook_events"."detail"::text) <= 512 and not ("social_webhook_events"."detail" ?| array['text', 'message', 'body', 'sender', 'name', 'content'])),
	CONSTRAINT "social_webhook_body_hash" CHECK ("social_webhook_events"."body_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_tenant_id_connection_id_social_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_events" ADD CONSTRAINT "social_webhook_events_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_webhook_events" ADD CONSTRAINT "social_webhook_events_tenant_id_connection_id_social_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_connections_account_idx" ON "social_connections" USING btree ("provider","external_account_ref") WHERE "social_connections"."status" <> 'revoked';--> statement-breakpoint
CREATE INDEX "social_connections_tenant_idx" ON "social_connections" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_idempotency_idx" ON "social_posts" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "social_posts_due_idx" ON "social_posts" USING btree ("status","next_attempt_at") WHERE "social_posts"."status" in ('scheduled', 'publishing');--> statement-breakpoint
CREATE INDEX "social_posts_tenant_idx" ON "social_posts" USING btree ("tenant_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "social_posts_provider_ref_idx" ON "social_posts" USING btree ("tenant_id","connection_id","provider_post_ref") WHERE "social_posts"."provider_post_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "social_webhook_events_event_idx" ON "social_webhook_events" USING btree ("tenant_id","provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "social_webhook_events_received_idx" ON "social_webhook_events" USING btree ("tenant_id","received_at");--> statement-breakpoint
-- Social provider integration layer (hand-written, chained onto the generated DDL above). Nothing here can reach a provider.
-- Row-level security: FORCE on all three tables. Connections and posts are owner/admin only (re-checked in SQL, not just in the service).
-- Webhook events are tenant-keyed only because the signed webhook receiver has no signed-in user.
ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.social_connections FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.social_posts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.social_webhook_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.social_webhook_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.social_connections, public.social_posts, public.social_webhook_events FROM PUBLIC, harvest_app;--> statement-breakpoint
-- No DELETE anywhere: rows end in a terminal state instead.
GRANT SELECT, INSERT, UPDATE ON public.social_connections, public.social_posts, public.social_webhook_events TO harvest_app;--> statement-breakpoint
CREATE POLICY social_connections_admin ON public.social_connections TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = social_connections.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = social_connections.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));--> statement-breakpoint
CREATE POLICY social_posts_admin ON public.social_posts TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = social_posts.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = social_posts.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));--> statement-breakpoint
CREATE POLICY social_webhook_events_tenant ON public.social_webhook_events TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Definers (below) run as the table owner, which FORCE row security also filters. They set app.social_definer for their own
-- transaction; the policy is for the owner role only, so the application role can never use it.
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY social_connections_definer ON public.social_connections TO %I
    USING (current_setting('app.social_definer', true) = 'on') WITH CHECK (current_setting('app.social_definer', true) = 'on')$p$, current_user);
  EXECUTE format($p$CREATE POLICY social_posts_definer ON public.social_posts TO %I
    USING (current_setting('app.social_definer', true) = 'on') WITH CHECK (current_setting('app.social_definer', true) = 'on')$p$, current_user);
END $$;--> statement-breakpoint

-- Connections: identity is immutable, a revoked connection is terminal, and only the signed-in person who creates a row may be its creator.
CREATE FUNCTION public.guard_social_connection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' OR NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN
      RAISE EXCEPTION 'social connection must be created active by the signed-in person';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.provider, NEW.platform, NEW.external_account_ref, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.provider, OLD.platform, OLD.external_account_ref, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'social connection identity is immutable';
  END IF;
  IF OLD.status = 'revoked' THEN RAISE EXCEPTION 'a revoked social connection cannot change'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER social_connection_guard BEFORE INSERT OR UPDATE ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.guard_social_connection();--> statement-breakpoint

-- Posts: the state machine. Legal moves only; terminal states never change; identity and content are frozen once a post leaves
-- draft/scheduled; the provider reference never changes once set. `publishing` covers both an in-flight call (lock held) and an
-- accepted post awaiting the provider's final answer (lock released, provider reference set).
CREATE FUNCTION public.guard_social_post() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'scheduled') OR NEW.attempts <> 0 OR NEW.provider_post_ref IS NOT NULL OR NEW.published_at IS NOT NULL
      OR NEW.last_error_code IS NOT NULL OR NEW.first_attempt_at IS NOT NULL THEN
      RAISE EXCEPTION 'social post must start as a draft or scheduled';
    END IF;
    IF NEW.created_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN RAISE EXCEPTION 'social post belongs to the signed-in person'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.social_connections c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.connection_id AND c.status = 'active') THEN
      RAISE EXCEPTION 'social post needs an active connection';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.connection_id, NEW.idempotency_key, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.connection_id, OLD.idempotency_key, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'social post identity is immutable';
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
  ) THEN
    RAISE EXCEPTION 'social post cannot move from % to %', OLD.status, NEW.status;
  END IF;
  IF (NEW.content, NEW.media) IS DISTINCT FROM (OLD.content, OLD.media) AND NOT (OLD.status IN ('draft', 'scheduled') AND NEW.status IN ('draft', 'scheduled')) THEN
    RAISE EXCEPTION 'social post content is frozen once it leaves draft or scheduled';
  END IF;
  IF OLD.provider_post_ref IS NOT NULL AND NEW.provider_post_ref IS DISTINCT FROM OLD.provider_post_ref THEN RAISE EXCEPTION 'provider reference is immutable'; END IF;
  IF NEW.provider_post_ref IS NOT NULL AND NEW.status NOT IN ('publishing', 'published', 'failed') THEN RAISE EXCEPTION 'provider reference only on a submitted post'; END IF;
  IF NEW.attempts < OLD.attempts AND NOT (OLD.status = 'failed' AND NEW.status = 'scheduled') THEN RAISE EXCEPTION 'attempts only go up'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER social_post_guard BEFORE INSERT OR UPDATE ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_social_post();--> statement-breakpoint

-- Webhook events are append-only evidence: the only change is stamping processed_at once.
CREATE FUNCTION public.guard_social_webhook_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.processed_at IS NOT NULL THEN RAISE EXCEPTION 'webhook event starts unprocessed'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.processed_at IS NOT NULL OR NEW.processed_at IS NULL
    OR (NEW.tenant_id, NEW.id, NEW.connection_id, NEW.provider, NEW.provider_event_id, NEW.event_type, NEW.external_account_ref, NEW.subject_ref, NEW.detail, NEW.body_hash, NEW.occurred_at, NEW.received_at)
      IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.connection_id, OLD.provider, OLD.provider_event_id, OLD.event_type, OLD.external_account_ref, OLD.subject_ref, OLD.detail, OLD.body_hash, OLD.occurred_at, OLD.received_at) THEN
    RAISE EXCEPTION 'webhook events only gain a processed time, once';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER social_webhook_event_guard BEFORE INSERT OR UPDATE ON public.social_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_social_webhook_event();--> statement-breakpoint

-- Tenant resolution for a verified webhook: provider account -> (tenant, connection). Returns nothing for an unknown or revoked account.
-- It is the only cross-tenant read, returns two ids, and is callable by the application role only.
CREATE FUNCTION public.social_resolve_account(p_provider text, p_ref text) RETURNS TABLE (tenant_id uuid, connection_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_provider IS NULL OR p_ref IS NULL OR length(p_ref) NOT BETWEEN 1 AND 200 THEN RETURN; END IF;
  PERFORM set_config('app.social_definer', 'on', true);
  RETURN QUERY SELECT c.tenant_id, c.id FROM public.social_connections c WHERE c.provider = p_provider AND c.external_account_ref = p_ref AND c.status <> 'revoked' LIMIT 1;
  PERFORM set_config('app.social_definer', '', true);
END $$;--> statement-breakpoint

-- Worker claim. Reclaims expired leases (retry with the SAME idempotency key only inside 23 hours of the first attempt, because the
-- provider remembers a key for 24 hours; later the post fails for a person to look at, never resent blindly), fails posts whose
-- connection is no longer active, then leases due work: new publishes and reconciliations of accepted posts. Returns jsonb.
CREATE FUNCTION public.social_publish_claim(p_limit integer, p_lease_seconds integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r record; out jsonb := '[]'::jsonb; tok uuid; lease interval;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN RAISE EXCEPTION 'invalid claim bounds'; END IF;
  PERFORM set_config('app.social_definer', 'on', true);
  lease := make_interval(secs => p_lease_seconds);
  -- Accepted posts the provider never confirmed within 72 hours.
  UPDATE public.social_posts SET status = 'failed', last_error_code = 'UNCONFIRMED', lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
    WHERE status = 'publishing' AND provider_post_ref IS NOT NULL AND first_attempt_at < now() - interval '72 hours' AND (lock_token IS NULL OR locked_at < now() - lease);
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
  UPDATE public.social_posts p SET status = 'failed', last_error_code = 'CONNECTION_UNAVAILABLE', updated_at = now(), version = p.version + 1
    FROM public.social_connections c WHERE c.tenant_id = p.tenant_id AND c.id = p.connection_id AND c.status <> 'active'
      AND p.status = 'scheduled' AND p.next_attempt_at <= now() AND p.scheduled_for <= now();
  FOR r IN
    SELECT p.tenant_id, p.id, p.status, p.provider_post_ref, p.content, p.media, p.idempotency_key, p.attempts, p.max_attempts, p.connection_id,
      c.provider, c.platform, c.external_account_ref, c.credential_envelope
    FROM public.social_posts p JOIN public.social_connections c ON c.tenant_id = p.tenant_id AND c.id = p.connection_id
    WHERE c.status = 'active' AND p.next_attempt_at <= now()
      AND ((p.status = 'scheduled' AND p.scheduled_for <= now() AND p.attempts < p.max_attempts)
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
      'accountRef', r.external_account_ref, 'content', r.content, 'media', r.media, 'idempotencyKey', r.idempotency_key, 'providerPostRef', r.provider_post_ref,
      'attempts', r.attempts + CASE WHEN r.status = 'scheduled' THEN 1 ELSE 0 END, 'maxAttempts', r.max_attempts, 'envelope', r.credential_envelope));
  END LOOP;
  PERFORM set_config('app.social_definer', '', true);
  RETURN out;
END $$;--> statement-breakpoint

-- Records the result of one claimed call. The lock token must match, so an expired or reclaimed claim cannot act (returns 'stale').
-- outcome: published | accepted (provider has it, final answer pending) | retry | failed. Returns the post's new status.
CREATE FUNCTION public.social_publish_complete(p_tenant uuid, p_post uuid, p_lock uuid, p_outcome text, p_ref text, p_error text, p_delay_seconds integer) RETURNS text
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
      UPDATE public.social_posts SET status = 'failed', last_error_code = 'MAX_ATTEMPTS', lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
        WHERE tenant_id = p_tenant AND id = p_post;
    ELSE
      UPDATE public.social_posts SET status = 'scheduled', last_error_code = p_error, next_attempt_at = now() + delay, lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
        WHERE tenant_id = p_tenant AND id = p_post;
    END IF;
  ELSIF p_outcome = 'failed' THEN
    UPDATE public.social_posts SET status = 'failed', last_error_code = p_error, lock_token = NULL, locked_at = NULL, updated_at = now(), version = version + 1
      WHERE tenant_id = p_tenant AND id = p_post;
  ELSE RAISE EXCEPTION 'unknown outcome';
  END IF;
  SELECT status INTO v_status FROM public.social_posts WHERE tenant_id = p_tenant AND id = p_post;
  PERFORM set_config('app.social_definer', '', true);
  RETURN v_status;
END $$;--> statement-breakpoint

-- Web definer: callable by the application role only. Worker definers: harvest_worker only (the web role could otherwise read every
-- ministry's sealed credentials through the claim function), granted when the role exists, as migration 0044 does.
REVOKE ALL ON FUNCTION public.social_resolve_account(text, text), public.social_publish_claim(integer, integer),
  public.social_publish_complete(uuid, uuid, uuid, text, text, text, integer) FROM PUBLIC, harvest_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.social_resolve_account(text, text) TO harvest_app;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit))
      OR EXISTS (SELECT FROM pg_auth_members WHERE member = 'harvest_worker'::regrole)
    THEN RAISE EXCEPTION 'harvest_worker must be an unprivileged SQL-created role without inherited memberships';
    END IF;
    GRANT EXECUTE ON FUNCTION public.social_publish_claim(integer, integer), public.social_publish_complete(uuid, uuid, uuid, text, text, text, integer) TO harvest_worker;
  END IF;
END $$;
