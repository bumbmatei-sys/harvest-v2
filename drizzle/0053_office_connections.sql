CREATE TABLE "office_connections" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"external_account_ref" text NOT NULL,
	"credential_envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_connections_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "office_connection_kind" CHECK ("office_connections"."kind" in ('mail', 'calendar', 'files')),
	CONSTRAINT "office_connection_provider" CHECK ("office_connections"."provider" in ('fake', 'zernio')),
	CONSTRAINT "office_connection_ref" CHECK (length("office_connections"."external_account_ref") between 1 and 200),
	CONSTRAINT "office_connection_envelope" CHECK (jsonb_typeof("office_connections"."credential_envelope") = 'object' and "office_connections"."credential_envelope" ?& array['version','keyId','binding','iv','tag','ciphertext'] and not ("office_connections"."credential_envelope" ?| array['secret','token','apiKey','accessToken']) and octet_length("office_connections"."credential_envelope"::text) <= 4096)
);
--> statement-breakpoint
ALTER TABLE "office_connections" ADD CONSTRAINT "office_connections_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_connections" ADD CONSTRAINT "office_connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "office_connection_account_idx" ON "office_connections" USING btree ("tenant_id","owner_user_id","kind","provider","external_account_ref");--> statement-breakpoint
ALTER TABLE public.office_connections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.office_connections FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.office_connections FROM PUBLIC, harvest_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.office_connections TO harvest_app;--> statement-breakpoint
-- No update, reassignment, delete or definer path. An admin only sees their own connections.
CREATE POLICY office_connections_personal ON public.office_connections TO harvest_app
USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND owner_user_id = nullif(current_setting('app.user_id', true), '')
  AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = office_connections.tenant_id AND m.user_id = office_connections.owner_user_id AND m.role_id IN ('owner','admin')))
WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND owner_user_id = nullif(current_setting('app.user_id', true), '')
  AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = office_connections.tenant_id AND m.user_id = office_connections.owner_user_id AND m.role_id IN ('owner','admin')));
