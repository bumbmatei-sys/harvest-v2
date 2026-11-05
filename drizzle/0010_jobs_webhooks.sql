CREATE TABLE "external_webhook_events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"raw_body" text NOT NULL,
	"body_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_webhook_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "webhooks_provider" CHECK ("external_webhook_events"."provider" = 'synthetic'),
	CONSTRAINT "webhooks_sequence" CHECK ("external_webhook_events"."sequence" >= 0),
	CONSTRAINT "webhooks_fields" CHECK (length("external_webhook_events"."connection_id") between 1 and 100 and length("external_webhook_events"."provider_event_id") between 1 and 100 and length("external_webhook_events"."resource_id") between 1 and 100 and octet_length("external_webhook_events"."raw_body") <= 65536),
	CONSTRAINT "webhooks_body_hash" CHECK ("external_webhook_events"."body_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"replay_count" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"lock_token" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "jobs_status" CHECK ("jobs"."status" in ('queued', 'running', 'succeeded', 'dead_letter')),
	CONSTRAINT "jobs_attempts" CHECK ("jobs"."attempts" >= "jobs"."run_attempts" and "jobs"."run_attempts" >= 0 and "jobs"."max_attempts" between 1 and 20 and "jobs"."replay_count" >= 0),
	CONSTRAINT "jobs_lock" CHECK (("jobs"."status" = 'running' and "jobs"."locked_at" is not null and "jobs"."locked_by" is not null and "jobs"."lock_token" is not null) or ("jobs"."status" <> 'running' and "jobs"."locked_at" is null and "jobs"."locked_by" is null and "jobs"."lock_token" is null)),
	CONSTRAINT "jobs_key" CHECK (length("jobs"."idempotency_key") between 1 and 200 and length("jobs"."kind") between 1 and 100),
	CONSTRAINT "jobs_fingerprint" CHECK ("jobs"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "jobs_payload" CHECK (jsonb_typeof("jobs"."payload") = 'object' and octet_length("jobs"."payload"::text) <= 65536),
	CONSTRAINT "jobs_error" CHECK ("jobs"."last_error" is null or "jobs"."last_error" in ('HANDLER_FAILED', 'INVALID_JOB_PAYLOAD', 'UNSUPPORTED_JOB_KIND', 'LEASE_EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payload" jsonb NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "outbox_key" CHECK (length("outbox_events"."idempotency_key") between 1 and 190 and length("outbox_events"."kind") between 1 and 100),
	CONSTRAINT "outbox_fingerprint" CHECK ("outbox_events"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "outbox_payload" CHECK (jsonb_typeof("outbox_events"."payload") = 'object' and octet_length("outbox_events"."payload"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "webhook_resource_states" (
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"connection_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_resource_states_tenant_id_provider_connection_id_resource_id_pk" PRIMARY KEY("tenant_id","provider","connection_id","resource_id"),
	CONSTRAINT "webhook_state_sequence" CHECK ("webhook_resource_states"."sequence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "external_webhook_events" ADD CONSTRAINT "external_webhook_events_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_resource_states" ADD CONSTRAINT "webhook_resource_states_tenant_id_event_id_external_webhook_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."external_webhook_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhooks_tenant_provider_event_idx" ON "external_webhook_events" USING btree ("tenant_id","provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhooks_tenant_created_idx" ON "external_webhook_events" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_tenant_idempotency_idx" ON "jobs" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_tenant_due_idx" ON "jobs" USING btree ("tenant_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "jobs_tenant_created_idx" ON "jobs" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_tenant_idempotency_idx" ON "outbox_events" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_tenant_dispatch_idx" ON "outbox_events" USING btree ("tenant_id","dispatched_at","created_at");--> statement-breakpoint
GRANT SELECT, INSERT ON jobs, outbox_events, external_webhook_events TO harvest_app;
GRANT UPDATE (status, attempts, run_attempts, replay_count, scheduled_for, locked_at, locked_by, lock_token, last_error, updated_at) ON jobs TO harvest_app;
GRANT UPDATE (dispatched_at) ON outbox_events TO harvest_app;
GRANT SELECT, INSERT, UPDATE ON webhook_resource_states TO harvest_app;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY jobs_tenant ON jobs TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_tenant ON outbox_events TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE external_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_webhook_events FORCE ROW LEVEL SECURITY;
CREATE POLICY webhooks_tenant ON external_webhook_events TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE webhook_resource_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_resource_states FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_states_tenant ON webhook_resource_states TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE FUNCTION reject_webhook_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'external_webhook_events are append-only'; END $$;
CREATE TRIGGER webhook_audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON external_webhook_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_webhook_audit_mutation();
