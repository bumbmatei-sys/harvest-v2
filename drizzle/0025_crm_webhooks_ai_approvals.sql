CREATE TABLE "ai_tool_approvals" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tool" text NOT NULL,
	"args_hash" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_tool_approvals_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ai_tool_approval_tool" CHECK ("ai_tool_approvals"."tool" ~ '^crm_[a-z_]{1,60}$'),
	CONSTRAINT "ai_tool_approval_hash" CHECK ("ai_tool_approvals"."args_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "ai_tool_approval_status" CHECK ("ai_tool_approvals"."status" in ('pending', 'approved', 'rejected', 'consumed')),
	CONSTRAINT "ai_tool_approval_expiry" CHECK ("ai_tool_approvals"."expires_at" > "ai_tool_approvals"."created_at" and "ai_tool_approvals"."expires_at" <= "ai_tool_approvals"."created_at" + interval '1 hour')
);
--> statement-breakpoint
CREATE TABLE "crm_webhook_deliveries" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_token" uuid,
	"last_status_code" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_webhook_deliveries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_webhook_delivery_status" CHECK ("crm_webhook_deliveries"."status" in ('pending', 'in_flight', 'succeeded', 'dead', 'cancelled')),
	CONSTRAINT "crm_webhook_delivery_attempts" CHECK ("crm_webhook_deliveries"."attempts" >= 0 and "crm_webhook_deliveries"."max_attempts" between 1 and 20 and "crm_webhook_deliveries"."attempts" <= "crm_webhook_deliveries"."max_attempts"),
	CONSTRAINT "crm_webhook_delivery_error" CHECK ("crm_webhook_deliveries"."last_error" is null or "crm_webhook_deliveries"."last_error" in ('TIMEOUT', 'NETWORK', 'BLOCKED_DESTINATION', 'INVALID_DESTINATION', 'HTTP_STATUS', 'REDIRECT', 'ENDPOINT_INACTIVE', 'EVENT_UNAVAILABLE', 'LEASE_EXPIRED')),
	CONSTRAINT "crm_webhook_delivery_status_code" CHECK ("crm_webhook_deliveries"."last_status_code" is null or "crm_webhook_deliveries"."last_status_code" between 100 and 599),
	CONSTRAINT "crm_webhook_delivery_type" CHECK (length("crm_webhook_deliveries"."event_type") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "crm_webhook_endpoints" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"event_types" text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_webhook_endpoints_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_webhook_endpoint_url" CHECK (length("crm_webhook_endpoints"."url") between 12 and 2000 and "crm_webhook_endpoints"."url" like 'https://%'),
	CONSTRAINT "crm_webhook_endpoint_events" CHECK (cardinality("crm_webhook_endpoints"."event_types") between 1 and 50),
	CONSTRAINT "crm_webhook_endpoint_status" CHECK ("crm_webhook_endpoints"."status" in ('active', 'disabled')),
	CONSTRAINT "crm_webhook_endpoint_versions" CHECK ("crm_webhook_endpoints"."secret_version" >= 1 and "crm_webhook_endpoints"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "ai_tool_approvals" ADD CONSTRAINT "ai_tool_approvals_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_approvals" ADD CONSTRAINT "ai_tool_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_webhook_deliveries" ADD CONSTRAINT "crm_webhook_deliveries_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_webhook_deliveries" ADD CONSTRAINT "crm_webhook_deliveries_tenant_id_endpoint_id_crm_webhook_endpoints_tenant_id_id_fk" FOREIGN KEY ("tenant_id","endpoint_id") REFERENCES "public"."crm_webhook_endpoints"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_webhook_deliveries" ADD CONSTRAINT "crm_webhook_deliveries_tenant_id_event_id_outbox_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."outbox_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_webhook_endpoints" ADD CONSTRAINT "crm_webhook_endpoints_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_webhook_endpoints" ADD CONSTRAINT "crm_webhook_endpoints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_tool_approvals_requester_idx" ON "ai_tool_approvals" USING btree ("tenant_id","requested_by","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_webhook_deliveries_event_idx" ON "crm_webhook_deliveries" USING btree ("tenant_id","endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "crm_webhook_deliveries_due_idx" ON "crm_webhook_deliveries" USING btree ("tenant_id","status","next_attempt_at");--> statement-breakpoint
-- CRM-08 (hand-written, chained onto 0024). Row-level security for the three new tables: harvest_app
-- only, tenant from the verified transaction context. FORCE so even the owner role is filtered.
ALTER TABLE crm_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_webhook_endpoints_tenant ON crm_webhook_endpoints TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_webhook_endpoints TO harvest_app;
ALTER TABLE crm_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY crm_webhook_deliveries_tenant ON crm_webhook_deliveries TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- Deliveries are never deleted by the app; they go only with their endpoint (ON DELETE CASCADE).
GRANT SELECT, INSERT, UPDATE ON crm_webhook_deliveries TO harvest_app;
ALTER TABLE ai_tool_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_tool_approvals_tenant ON ai_tool_approvals TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- No DELETE: approvals are an audit trail.
GRANT SELECT, INSERT, UPDATE ON ai_tool_approvals TO harvest_app;
--> statement-breakpoint
-- Approval guard, enforced in SQL as well as in the service. An approval belongs to the person it was
-- requested for: only they can create, decide or use it, its tool/arguments/expiry never change, it moves
-- only pending -> approved|rejected -> (approved only) consumed, and nothing happens after it expires.
CREATE FUNCTION public.guard_ai_tool_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF actor IS NULL OR NEW.requested_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'approval belongs to another person'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.decided_at IS NOT NULL OR NEW.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'approval must start pending'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.tool, NEW.args_hash, NEW.requested_by, NEW.expires_at, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.tool, OLD.args_hash, OLD.requested_by, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'approval identity is immutable';
  END IF;
  IF now() >= OLD.expires_at THEN RAISE EXCEPTION 'approval has expired'; END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') AND NEW.decided_at IS NOT NULL AND NEW.consumed_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'approved' AND NEW.status = 'consumed' AND NEW.consumed_at IS NOT NULL AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'approval cannot change from % to %', OLD.status, NEW.status;
END $$;
CREATE TRIGGER ai_tool_approval_guard BEFORE INSERT OR UPDATE ON public.ai_tool_approvals
  FOR EACH ROW EXECUTE FUNCTION public.guard_ai_tool_approval();
