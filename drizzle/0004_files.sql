CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"checksum" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_size" CHECK ("files"."size" BETWEEN 1 AND 10485760),
	CONSTRAINT "files_checksum" CHECK ("files"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "files_status" CHECK ("files"."status" IN ('pending', 'uploaded', 'quarantined', 'ready')),
	CONSTRAINT "files_visibility" CHECK ("files"."visibility" IN ('private', 'public')),
	CONSTRAINT "files_mime" CHECK ("files"."mime" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain')),
	CONSTRAINT "files_key_scope" CHECK ("files"."key" = 'workspaces/' || "files"."tenant_id"::text || '/files/' || "files"."id"::text),
	CONSTRAINT "files_name" CHECK (length("files"."name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_owner_id_workspace_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","owner_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "files_key_idx" ON "files" USING btree ("key");--> statement-breakpoint
CREATE INDEX "files_tenant_created_idx" ON "files" USING btree ("tenant_id","created_at");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON files TO harvest_app;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY files_tenant ON files TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- Anonymous delivery gets one explicit public row, never a tenant context.
-- This SELECT-only policy cannot authorize writes or expose private/pending rows.
CREATE POLICY files_public_delivery ON files FOR SELECT TO harvest_app
  USING (
    nullif(current_setting('app.tenant_id', true), '') IS NULL AND
    nullif(current_setting('app.user_id', true), '') IS NULL AND
    id = nullif(current_setting('app.public_file_id', true), '')::uuid AND
    tenant_id = nullif(current_setting('app.public_file_tenant_id', true), '')::uuid AND
    visibility = 'public' AND status = 'ready'
  );
