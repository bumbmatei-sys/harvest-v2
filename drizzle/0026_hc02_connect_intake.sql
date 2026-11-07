CREATE TABLE "campaign_response_consents" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"channel" text,
	"form_version_id" uuid NOT NULL,
	"notice_version_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"recorded_by" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "campaign_response_consents_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_response_consent_purpose" CHECK ("campaign_response_consents"."purpose" in ('account_communications', 'outreach_follow_up', 'newsletter')),
	CONSTRAINT "campaign_response_consent_status" CHECK ("campaign_response_consents"."status" in ('granted', 'withdrawn')),
	CONSTRAINT "campaign_response_consent_channel" CHECK ("campaign_response_consents"."channel" in ('email', 'sms')),
	CONSTRAINT "campaign_response_consent_actor" CHECK (("campaign_response_consents"."actor_kind" = 'subject' and "campaign_response_consents"."recorded_by" is null)
    or ("campaign_response_consents"."actor_kind" = 'staff' and ("campaign_response_consents"."recorded_by" is not null or "campaign_response_consents"."redacted_at" is not null))),
	CONSTRAINT "campaign_response_consent_grantor" CHECK ("campaign_response_consents"."status" = 'withdrawn' or "campaign_response_consents"."actor_kind" = 'subject'),
	CONSTRAINT "campaign_response_consent_occurrence" CHECK ("campaign_response_consents"."occurred_at" <= "campaign_response_consents"."recorded_at" + interval '5 minutes'),
	CONSTRAINT "campaign_response_consent_redaction" CHECK ("campaign_response_consents"."redacted_at" is null or ("campaign_response_consents"."channel" is null and "campaign_response_consents"."recorded_by" is null))
);
--> statement-breakpoint
CREATE TABLE "campaign_response_contact_methods" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_response_contact_methods_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_response_contact_kind" CHECK ("campaign_response_contact_methods"."kind" in ('email', 'phone')),
	CONSTRAINT "campaign_response_contact_value" CHECK (length("campaign_response_contact_methods"."value") between 1 and 254 and length("campaign_response_contact_methods"."normalized_value") between 1 and 254)
);
--> statement-breakpoint
CREATE TABLE "campaign_response_links" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"form_version_id" uuid,
	"public_code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"locale" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_response_links_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_response_links_parent_key" UNIQUE("tenant_id","campaign_id","id","form_version_id"),
	CONSTRAINT "campaign_response_link_code" CHECK ("campaign_response_links"."public_code" ~ '^[a-f0-9]{32}$'),
	CONSTRAINT "campaign_response_link_status" CHECK ("campaign_response_links"."status" in ('draft', 'published', 'disabled', 'archived')),
	CONSTRAINT "campaign_response_link_locale" CHECK ("campaign_response_links"."locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' and length("campaign_response_links"."locale") <= 35)
);
--> statement-breakpoint
CREATE TABLE "campaign_responses" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"public_submission_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"preferred_name" text,
	"locale" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"contact_id" uuid,
	"associated_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	CONSTRAINT "campaign_responses_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_response_status" CHECK ("campaign_responses"."status" in ('pending', 'associated', 'erased')),
	CONSTRAINT "campaign_response_name" CHECK ("campaign_responses"."preferred_name" is null or (length(btrim("campaign_responses"."preferred_name")) between 1 and 100 and "campaign_responses"."preferred_name" = btrim("campaign_responses"."preferred_name"))),
	CONSTRAINT "campaign_response_locale" CHECK ("campaign_responses"."locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' and length("campaign_responses"."locale") <= 35),
	CONSTRAINT "campaign_response_state" CHECK (("campaign_responses"."status" = 'pending' and "campaign_responses"."expires_at" is not null and "campaign_responses"."contact_id" is null and "campaign_responses"."associated_at" is null and "campaign_responses"."erased_at" is null)
    or ("campaign_responses"."status" = 'associated' and "campaign_responses"."contact_id" is not null and "campaign_responses"."associated_at" is not null and "campaign_responses"."erased_at" is null)
    or ("campaign_responses"."status" = 'erased' and "campaign_responses"."erased_at" is not null and "campaign_responses"."expires_at" is null and "campaign_responses"."contact_id" is null and "campaign_responses"."associated_at" is null
      and "campaign_responses"."preferred_name" is null and "campaign_responses"."locale" is null))
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"offered_purposes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"notice_version_id" uuid,
	"pending_retention_days" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"retired_at" timestamp with time zone,
	CONSTRAINT "form_versions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "form_version_number" CHECK ("form_versions"."version" >= 1),
	CONSTRAINT "form_version_status" CHECK ("form_versions"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "form_version_definition" CHECK (jsonb_typeof("form_versions"."definition") = 'object' and octet_length("form_versions"."definition"::text) <= 65536),
	CONSTRAINT "form_version_purposes" CHECK ("form_versions"."offered_purposes" <@ ARRAY['account_communications', 'outreach_follow_up', 'newsletter']::text[] and array_position("form_versions"."offered_purposes", null) is null),
	CONSTRAINT "form_version_retention" CHECK ("form_versions"."pending_retention_days" between 1 and 36500),
	CONSTRAINT "form_version_publication" CHECK (("form_versions"."status" = 'draft' and "form_versions"."published_at" is null and "form_versions"."published_by" is null and "form_versions"."retired_at" is null)
    or ("form_versions"."status" in ('published', 'retired') and "form_versions"."notice_version_id" is not null and "form_versions"."pending_retention_days" is not null
      and cardinality("form_versions"."offered_purposes") >= 1 and "form_versions"."published_at" is not null and "form_versions"."published_by" is not null
      and ("form_versions"."status" = 'retired') = ("form_versions"."retired_at" is not null)))
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "forms_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "form_name" CHECK (length(btrim("forms"."name")) between 1 and 200 and "forms"."name" = btrim("forms"."name"))
);
--> statement-breakpoint
CREATE TABLE "privacy_notice_versions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"notice_key" text NOT NULL,
	"version" integer NOT NULL,
	"locale" text NOT NULL,
	"body" text NOT NULL,
	"body_sha256" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_notice_versions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "privacy_notice_key" CHECK ("privacy_notice_versions"."notice_key" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
	CONSTRAINT "privacy_notice_version" CHECK ("privacy_notice_versions"."version" >= 1),
	CONSTRAINT "privacy_notice_locale" CHECK ("privacy_notice_versions"."locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' and length("privacy_notice_versions"."locale") <= 35),
	CONSTRAINT "privacy_notice_body" CHECK (length(btrim("privacy_notice_versions"."body")) between 1 and 20000),
	CONSTRAINT "privacy_notice_hash" CHECK ("privacy_notice_versions"."body_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "campaign_response_consents" ADD CONSTRAINT "campaign_response_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_response_consents" ADD CONSTRAINT "campaign_response_consents_tenant_id_response_id_campaign_responses_tenant_id_id_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."campaign_responses"("tenant_id","id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "campaign_response_consents" ADD CONSTRAINT "campaign_response_consents_tenant_id_form_version_id_form_versions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","form_version_id") REFERENCES "public"."form_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_response_consents" ADD CONSTRAINT "campaign_response_consents_tenant_id_notice_version_id_privacy_notice_versions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","notice_version_id") REFERENCES "public"."privacy_notice_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_response_contact_methods" ADD CONSTRAINT "campaign_response_contact_methods_tenant_id_response_id_campaign_responses_tenant_id_id_fk" FOREIGN KEY ("tenant_id","response_id") REFERENCES "public"."campaign_responses"("tenant_id","id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD CONSTRAINT "campaign_response_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD CONSTRAINT "campaign_response_links_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD CONSTRAINT "campaign_response_links_tenant_id_form_version_id_form_versions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","form_version_id") REFERENCES "public"."form_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_tenant_id_form_version_id_form_versions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","form_version_id") REFERENCES "public"."form_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_link_fk" FOREIGN KEY ("tenant_id","campaign_id","link_id","form_version_id") REFERENCES "public"."campaign_response_links"("tenant_id","campaign_id","id","form_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_tenant_id_form_id_forms_tenant_id_id_fk" FOREIGN KEY ("tenant_id","form_id") REFERENCES "public"."forms"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_tenant_id_notice_version_id_privacy_notice_versions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","notice_version_id") REFERENCES "public"."privacy_notice_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notice_versions" ADD CONSTRAINT "privacy_notice_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_response_consents_grant_idx" ON "campaign_response_consents" USING btree ("tenant_id","response_id","purpose") WHERE "campaign_response_consents"."status" = 'granted';--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_response_consents_withdrawal_idx" ON "campaign_response_consents" USING btree ("tenant_id","response_id","purpose") WHERE "campaign_response_consents"."status" = 'withdrawn';--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_response_contact_kind_idx" ON "campaign_response_contact_methods" USING btree ("tenant_id","response_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_response_links_code_idx" ON "campaign_response_links" USING btree ("public_code");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_responses_submission_idx" ON "campaign_responses" USING btree ("tenant_id","campaign_id","public_submission_id");--> statement-breakpoint
CREATE INDEX "campaign_responses_campaign_idx" ON "campaign_responses" USING btree ("tenant_id","campaign_id","submitted_at");--> statement-breakpoint
CREATE INDEX "campaign_responses_expiry_idx" ON "campaign_responses" USING btree ("tenant_id","expires_at") WHERE "campaign_responses"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "campaign_responses_contact_idx" ON "campaign_responses" USING btree ("tenant_id","contact_id") WHERE "campaign_responses"."contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_form_version_idx" ON "form_versions" USING btree ("tenant_id","form_id","version");--> statement-breakpoint
CREATE INDEX "forms_tenant_created_idx" ON "forms" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_notice_versions_key_idx" ON "privacy_notice_versions" USING btree ("tenant_id","notice_key","locale","version");
--> statement-breakpoint
-- HC-02 (Harvest Connect data foundation). The DDL above is generated from src/db/schema.ts;
-- everything below is hand-written and chained onto 0025. Contract: docs/acceptance/hc-02.md.
-- No public role, no intake path and no association path is added here: HC-05 adds the constrained
-- public intake definer, HC-06 the verified CRM association, HC-03 link publishing.

-- 1) Privileged writers: the controlled erasure definers. Guards below admit changes only from them.
CREATE FUNCTION public.connect_erasure_writer() RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN current_user IN (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid IN (
    'public.erase_contact(uuid,uuid)'::regprocedure,
    'public.erase_connect_response(uuid,uuid)'::regprocedure,
    'public.purge_expired_connect_responses(uuid)'::regprocedure));
END $$;

--> statement-breakpoint
-- 2) Row-level security. Every table is FORCE RLS for harvest_app with the tenant taken from the
-- verified transaction context and membership re-checked in SQL.
ALTER TABLE privacy_notice_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_notice_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY privacy_notice_versions_read ON privacy_notice_versions FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = privacy_notice_versions.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')));
CREATE POLICY privacy_notice_versions_create ON privacy_notice_versions FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND created_by = nullif(current_setting('app.user_id', true), '')
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = privacy_notice_versions.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
-- Immutable: no UPDATE or DELETE grant, and the guard rejects owner DML too.
GRANT SELECT, INSERT ON privacy_notice_versions TO harvest_app;

ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms FORCE ROW LEVEL SECURITY;
CREATE POLICY forms_read ON forms FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = forms.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')));
CREATE POLICY forms_create ON forms FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND created_by = nullif(current_setting('app.user_id', true), '') AND archived_at IS NULL
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = forms.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
GRANT SELECT, INSERT ON forms TO harvest_app;

ALTER TABLE form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY form_versions_read ON form_versions FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = form_versions.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')));
CREATE POLICY form_versions_create ON form_versions FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND created_by = nullif(current_setting('app.user_id', true), '') AND status = 'draft'
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = form_versions.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
CREATE POLICY form_versions_update ON form_versions FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = form_versions.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND (status = 'draft' OR published_by = nullif(current_setting('app.user_id', true), '') OR status = 'retired')
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = form_versions.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
GRANT SELECT, INSERT, UPDATE ON form_versions TO harvest_app;

ALTER TABLE campaign_response_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_response_links FORCE ROW LEVEL SECURITY;
CREATE POLICY campaign_response_links_read ON campaign_response_links FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_response_links.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')));
-- Draft only. Publishing, disabling and rotation are HC-03 and have no grant here.
CREATE POLICY campaign_response_links_create ON campaign_response_links FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND created_by = nullif(current_setting('app.user_id', true), '') AND status = 'draft'
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_response_links.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin', 'member')));
GRANT SELECT, INSERT ON campaign_response_links TO harvest_app;

-- Restricted pending data: only workspace owners/admins (privacy administrators) see response
-- metadata, never the preferred name, submission key, locale or contact link (column grants).
-- No INSERT/UPDATE/DELETE grant: intake (HC-05) and association (HC-06) arrive as definers.
ALTER TABLE campaign_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY campaign_responses_restricted_read ON campaign_responses FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_responses.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
GRANT SELECT (tenant_id, id, campaign_id, link_id, form_version_id, status, submitted_at, expires_at, associated_at, erased_at)
  ON campaign_responses TO harvest_app;

-- Contact methods awaiting verification: no harvest_app grant at all.
ALTER TABLE campaign_response_contact_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_response_contact_methods FORCE ROW LEVEL SECURITY;
REVOKE ALL ON campaign_response_contact_methods FROM harvest_app;

ALTER TABLE campaign_response_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_response_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY campaign_response_consents_restricted_read ON campaign_response_consents FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_response_consents.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
GRANT SELECT ON campaign_response_consents TO harvest_app;

-- The migration role owns the erasure definers; under FORCE RLS it gets the same tenant-scoped
-- policy it has on the CRM tables (0020/0024), on the tables those definers change.
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['campaign_responses', 'campaign_response_contact_methods', 'campaign_response_consents'] LOOP
    EXECUTE format($policy$CREATE POLICY erasure_owner_tenant ON public.%I TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, relation_name, current_user);
  END LOOP;
  -- The withdrawal definer's evidence guard joins the response to its form version: read-only,
  -- same tenant, so a definer owner without BYPASSRLS can validate provenance (review B2).
  EXECUTE format($policy$CREATE POLICY connect_definer_read ON public.form_versions FOR SELECT TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, current_user);
END $$;

--> statement-breakpoint
-- 3) Guards. Notices are immutable; published form versions are immutable except retirement.
CREATE FUNCTION public.guard_privacy_notice_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.body_sha256 := encode(sha256(convert_to(NEW.body, 'UTF8')), 'hex');
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'privacy notice versions are immutable';
END $$;
CREATE TRIGGER privacy_notice_version_guard BEFORE INSERT OR UPDATE OR DELETE ON public.privacy_notice_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_privacy_notice_version();

CREATE FUNCTION public.guard_form_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'published form versions are immutable'; END IF;
    RETURN OLD;
  END IF;
  IF cardinality(NEW.offered_purposes) <> (SELECT count(DISTINCT p) FROM unnest(NEW.offered_purposes) AS p) THEN
    RAISE EXCEPTION 'each purpose is offered once';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'form versions start as drafts'; END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.form_id, NEW.version, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.form_id, OLD.version, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'form version identity is immutable';
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status = 'retired' THEN RAISE EXCEPTION 'only a published form version can be retired'; END IF;
    IF NEW.status = 'published' THEN
      IF NEW.published_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'invalid publication provenance'; END IF;
      IF EXISTS (SELECT 1 FROM public.forms f WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.form_id AND f.archived_at IS NOT NULL) THEN
        RAISE EXCEPTION 'archived forms cannot publish';
      END IF;
      NEW.published_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'published' AND NEW.status = 'retired'
    AND (NEW.definition, NEW.offered_purposes, NEW.notice_version_id, NEW.pending_retention_days, NEW.published_at, NEW.published_by)
      IS NOT DISTINCT FROM (OLD.definition, OLD.offered_purposes, OLD.notice_version_id, OLD.pending_retention_days, OLD.published_at, OLD.published_by) THEN
    NEW.retired_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'published form versions are immutable';
END $$;
CREATE TRIGGER form_version_guard BEFORE INSERT OR UPDATE OR DELETE ON public.form_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_form_version();

CREATE FUNCTION public.guard_campaign_response_link() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now(); NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.campaign_id, NEW.created_by, NEW.created_at)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.campaign_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'response link identity is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_response_link_guard BEFORE INSERT OR UPDATE ON public.campaign_response_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_response_link();

-- A response is accepted only from a published link whose published form version it records,
-- under a live campaign. It starts pending and unassociated; time and expiry are server-set.
CREATE FUNCTION public.guard_campaign_response() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE link_status text; version_status text; retention integer; campaign_archived timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'responses are erased, not deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.contact_id IS NOT NULL OR NEW.associated_at IS NOT NULL OR NEW.erased_at IS NOT NULL THEN
      RAISE EXCEPTION 'responses start pending and unassociated';
    END IF;
    SELECT l.status, v.status, v.pending_retention_days, c.archived_at INTO link_status, version_status, retention, campaign_archived
      FROM public.campaign_response_links l
      JOIN public.form_versions v ON v.tenant_id = l.tenant_id AND v.id = l.form_version_id
      JOIN public.campaigns c ON c.tenant_id = l.tenant_id AND c.id = l.campaign_id
      WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.link_id AND l.campaign_id = NEW.campaign_id AND l.form_version_id = NEW.form_version_id
      FOR SHARE OF l, v;
    IF NOT FOUND OR link_status <> 'published' OR version_status <> 'published' OR campaign_archived IS NOT NULL THEN
      RAISE EXCEPTION 'response source is not accepting responses';
    END IF;
    NEW.submitted_at := now();
    NEW.expires_at := now() + make_interval(days => retention);
    RETURN NEW;
  END IF;
  IF NOT public.connect_erasure_writer() THEN
    RAISE EXCEPTION 'pending responses change only through controlled erasure';
  END IF;
  IF (NEW.tenant_id, NEW.campaign_id, NEW.link_id, NEW.form_version_id)
    IS DISTINCT FROM (OLD.tenant_id, OLD.campaign_id, OLD.link_id, OLD.form_version_id) THEN
    RAISE EXCEPTION 'response identity is immutable';
  END IF;
  -- Association is HC-06's verified-claim path; nothing in HC-02 may set or change it.
  IF NEW.contact_id IS NOT NULL AND NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    RAISE EXCEPTION 'response association requires a verified claim';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id AND NEW.status <> 'erased' THEN
    RAISE EXCEPTION 'response identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_response_guard BEFORE INSERT OR UPDATE OR DELETE ON public.campaign_responses
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_response();

CREATE FUNCTION public.guard_campaign_response_contact_method() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM public.campaign_responses r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.response_id AND r.status = 'pending' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'response is not pending'; END IF;
    -- Verification is HC-07's claim flow; a submitted address is never pre-verified.
    IF NEW.verified_at IS NOT NULL THEN RAISE EXCEPTION 'contact methods start unverified'; END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF NOT public.connect_erasure_writer() THEN
    RAISE EXCEPTION 'pending contact methods change only through controlled erasure';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_response_contact_method_guard BEFORE INSERT OR UPDATE OR DELETE ON public.campaign_response_contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_response_contact_method();

-- Evidence: what the person chose, against the exact form and notice presented. Grants come only
-- from the person, only for a purpose that form offered; a withdrawal needs a prior grant.
CREATE FUNCTION public.guard_campaign_response_consent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE response_status text; response_version uuid; version_notice uuid; offered text[];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'consent evidence is append-only'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT r.status, r.form_version_id, v.notice_version_id, v.offered_purposes INTO response_status, response_version, version_notice, offered
      FROM public.campaign_responses r JOIN public.form_versions v ON v.tenant_id = r.tenant_id AND v.id = r.form_version_id
      WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.response_id FOR UPDATE OF r;
    IF NOT FOUND OR response_status <> 'pending' THEN RAISE EXCEPTION 'response is not pending'; END IF;
    IF NEW.form_version_id IS DISTINCT FROM response_version OR NEW.notice_version_id IS DISTINCT FROM version_notice THEN
      RAISE EXCEPTION 'evidence must reference the presented form and notice';
    END IF;
    IF NEW.redacted_at IS NOT NULL THEN RAISE EXCEPTION 'evidence starts unredacted'; END IF;
    NEW.recorded_at := now();
    IF NEW.status = 'granted' THEN
      IF NOT (NEW.purpose = ANY(offered)) THEN RAISE EXCEPTION 'purpose was not offered by this form'; END IF;
      IF NEW.channel IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.campaign_response_contact_methods m
          WHERE m.tenant_id = NEW.tenant_id AND m.response_id = NEW.response_id AND m.kind = CASE NEW.channel WHEN 'sms' THEN 'phone' ELSE 'email' END) THEN
        RAISE EXCEPTION 'channel has no contact method';
      END IF;
      IF EXISTS (SELECT 1 FROM public.campaign_response_consents w WHERE w.tenant_id = NEW.tenant_id AND w.response_id = NEW.response_id
          AND w.purpose = NEW.purpose AND w.status = 'withdrawn') THEN
        RAISE EXCEPTION 'purpose was withdrawn';
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.campaign_response_consents g WHERE g.tenant_id = NEW.tenant_id AND g.response_id = NEW.response_id
          AND g.purpose = NEW.purpose AND g.status = 'granted') THEN
        RAISE EXCEPTION 'nothing to withdraw';
      END IF;
      IF NEW.actor_kind = 'staff' AND NEW.recorded_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '') THEN
        RAISE EXCEPTION 'invalid withdrawal provenance';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT public.connect_erasure_writer() THEN RAISE EXCEPTION 'consent evidence is append-only'; END IF;
  -- Erasure re-keys redacted evidence (as erase_contact re-keys CRM consent events); nothing else may.
  IF NEW.id IS DISTINCT FROM OLD.id AND NEW.redacted_at IS NULL THEN RAISE EXCEPTION 'consent evidence is append-only'; END IF;
  IF (NEW.tenant_id, NEW.purpose, NEW.status, NEW.form_version_id, NEW.notice_version_id, NEW.actor_kind)
    IS DISTINCT FROM (OLD.tenant_id, OLD.purpose, OLD.status, OLD.form_version_id, OLD.notice_version_id, OLD.actor_kind) THEN
    RAISE EXCEPTION 'consent evidence is append-only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_response_consent_guard BEFORE INSERT OR UPDATE OR DELETE ON public.campaign_response_consents
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_response_consent();

--> statement-breakpoint
-- 4) Scrub: one pending response loses its contact methods, evidence detail, durable payload
-- references and audit link, then becomes a re-keyed tombstone (campaign, link, form version, day).
-- Every surviving app-readable key is new: response id, submission key and evidence ids.
-- Invoker rights and no EXECUTE for harvest_app: only the erasure definers call it.
CREATE FUNCTION public.connect_scrub_response(p_tenant uuid, p_response uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  DELETE FROM public.campaign_response_contact_methods WHERE tenant_id = p_tenant AND response_id = p_response;
  UPDATE public.campaign_response_consents SET id = gen_random_uuid(), channel = NULL, recorded_by = NULL,
    recorded_at = date_trunc('day', recorded_at, 'UTC'),
    occurred_at = least(date_trunc('day', occurred_at, 'UTC'), date_trunc('day', recorded_at, 'UTC')),
    redacted_at = date_trunc('day', now(), 'UTC')
    WHERE tenant_id = p_tenant AND response_id = p_response;
  -- Connect producers (HC-05+) keep responseId top level, as CRM events keep contactId (CRM-08).
  UPDATE public.outbox_events SET payload = jsonb_set(payload, '{responseId}', 'null'::jsonb)
    WHERE tenant_id = p_tenant AND payload->>'responseId' = p_response::text;
  UPDATE public.jobs SET payload = jsonb_set(payload, '{responseId}', 'null'::jsonb), updated_at = now()
    WHERE tenant_id = p_tenant AND payload->>'responseId' = p_response::text;
  UPDATE public.campaign_responses SET status = 'erased', preferred_name = NULL, locale = NULL, contact_id = NULL,
    associated_at = NULL, expires_at = NULL, erased_at = date_trunc('day', now(), 'UTC'),
    submitted_at = date_trunc('day', submitted_at, 'UTC'), public_submission_id = gen_random_uuid()
    WHERE tenant_id = p_tenant AND id = p_response;
  UPDATE public.audit_logs SET target_id = NULL
    WHERE tenant_id = p_tenant AND action LIKE 'connect.response.%' AND target_id = p_response::text;
  UPDATE public.campaign_responses SET id = gen_random_uuid() WHERE tenant_id = p_tenant AND id = p_response;
END $$;
REVOKE ALL ON FUNCTION public.connect_scrub_response(uuid, uuid) FROM PUBLIC;

--> statement-breakpoint
-- 5) Rights hooks for pending (unclaimed) responses. Owners/admins act on a verified request;
-- the guest self-service path needs HC-07's verified claim and HC-14's DSAR flow.
CREATE FUNCTION public.erase_connect_response(p_tenant uuid, p_response uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.campaign_responses WHERE tenant_id = p_tenant AND id = p_response AND status <> 'erased' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.connect_scrub_response(p_tenant, p_response);
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (p_tenant, actor, 'connect.response.erase', NULL);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.erase_connect_response(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_connect_response(uuid, uuid) TO harvest_app;

-- Withdrawal is per purpose and does not erase: the other purposes and the response remain.
CREATE FUNCTION public.withdraw_connect_response_purpose(p_tenant uuid, p_response uuid, p_purpose text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); response_status text; grant_row record;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'withdrawal access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal access denied' USING ERRCODE = '42501'; END IF;
  SELECT status INTO response_status FROM public.campaign_responses WHERE tenant_id = p_tenant AND id = p_response AND status <> 'erased' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  -- Once associated, the CRM consent ledger owns the person's choices (HC-06 / HC-14).
  IF response_status <> 'pending' THEN RETURN 'not_pending'; END IF;
  SELECT form_version_id, notice_version_id INTO grant_row FROM public.campaign_response_consents
    WHERE tenant_id = p_tenant AND response_id = p_response AND purpose = p_purpose AND status = 'granted';
  IF NOT FOUND THEN RETURN 'not_granted'; END IF;
  IF EXISTS (SELECT 1 FROM public.campaign_response_consents WHERE tenant_id = p_tenant AND response_id = p_response
      AND purpose = p_purpose AND status = 'withdrawn') THEN RETURN 'already_withdrawn'; END IF;
  INSERT INTO public.campaign_response_consents (tenant_id, response_id, purpose, status, form_version_id, notice_version_id, actor_kind, recorded_by)
    VALUES (p_tenant, p_response, p_purpose, 'withdrawn', grant_row.form_version_id, grant_row.notice_version_id, 'staff', actor);
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'connect.response.withdraw', p_response::text, jsonb_build_object('purpose', p_purpose));
  RETURN 'withdrawn';
END $$;
REVOKE ALL ON FUNCTION public.withdraw_connect_response_purpose(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.withdraw_connect_response_purpose(uuid, uuid, text) TO harvest_app;

-- The recheck every future sender/assigner must make immediately before acting: pending, not
-- expired, granted for this purpose and not withdrawn. Returns only a boolean, and only to the
-- same owners/admins who may read the evidence (review B1). A future worker needs its own
-- separately constrained capability rather than a wider grant here.
CREATE FUNCTION public.connect_response_purpose_active(p_tenant uuid, p_response uuid, p_purpose text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'response access denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'response access denied' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.campaign_responses r JOIN public.campaign_response_consents g
      ON g.tenant_id = r.tenant_id AND g.response_id = r.id AND g.purpose = p_purpose AND g.status = 'granted' AND g.redacted_at IS NULL
    WHERE r.tenant_id = p_tenant AND r.id = p_response AND r.status = 'pending' AND r.expires_at > now()
      AND NOT EXISTS (SELECT 1 FROM public.campaign_response_consents w WHERE w.tenant_id = r.tenant_id AND w.response_id = r.id
        AND w.purpose = p_purpose AND w.status = 'withdrawn'));
END $$;
REVOKE ALL ON FUNCTION public.connect_response_purpose_active(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_response_purpose_active(uuid, uuid, text) TO harvest_app;

-- Retention: erase pending responses past the expiry their published form version set. No
-- duration is chosen here; scheduling the sweep is deferred (docs/acceptance/hc-02.md).
CREATE FUNCTION public.purge_expired_connect_responses(p_tenant uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); expired record; purged integer := 0;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501'; END IF;
  FOR expired IN SELECT id FROM public.campaign_responses WHERE tenant_id = p_tenant AND status = 'pending' AND expires_at <= now()
      ORDER BY id FOR UPDATE SKIP LOCKED LOOP
    PERFORM public.connect_scrub_response(p_tenant, expired.id);
    purged := purged + 1;
  END LOOP;
  IF purged > 0 THEN
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
      VALUES (p_tenant, actor, 'connect.response.purge', NULL, jsonb_build_object('count', purged::text));
  END IF;
  RETURN purged;
END $$;
REVOKE ALL ON FUNCTION public.purge_expired_connect_responses(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_connect_responses(uuid) TO harvest_app;

--> statement-breakpoint
-- 6) The audit ledger stays append-only. 0024's rule, with the Connect definers as privileged
-- writers and connect.response.* rows losing the erased response's id (marked "HC-02").
CREATE OR REPLACE FUNCTION public.guard_audit_contact_unlinking() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT public.connect_erasure_writer()
    OR (NEW.id, NEW.tenant_id, NEW.actor_id, NEW.action, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.actor_id, OLD.action, OLD.created_at) THEN
    RAISE EXCEPTION 'audit_logs are append-only except controlled contact unlinking';
  END IF;
  -- HC-02: connect.response.* rows lose the erased response's id; nothing else changes.
  IF OLD.action LIKE 'connect.response.%' THEN
    IF NEW.target_id IS NULL AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata AND EXISTS (
      SELECT 1 FROM public.campaign_responses r WHERE r.tenant_id = OLD.tenant_id AND r.status = 'erased'
        AND r.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND OLD.target_id = r.id::text
    ) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'audit_logs are append-only except controlled contact unlinking';
  END IF;
  IF OLD.action LIKE 'contact.%' OR OLD.action LIKE 'consent.%' THEN
    -- Unchanged from 0008.
    IF NEW.target_id IS NOT NULL OR NEW.metadata IS DISTINCT FROM '{}'::jsonb OR NOT EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.tenant_id = OLD.tenant_id AND c.erased_at IS NOT NULL
        AND c.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND (OLD.target_id = c.id::text OR OLD.metadata->>'contactId' = c.id::text OR EXISTS (
          SELECT 1 FROM public.contact_consents s WHERE s.tenant_id = c.tenant_id AND s.contact_id = c.id
            AND (OLD.target_id = s.id::text OR OLD.metadata->>'consentId' = s.id::text)
        ))
    ) THEN RAISE EXCEPTION 'audit_logs are append-only except controlled contact unlinking'; END IF;
    RETURN NEW;
  END IF;
  IF (OLD.action LIKE 'task.%' OR OLD.action LIKE 'note.%' OR OLD.action LIKE 'association.%')
    AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
    AND OLD.metadata ? 'contactId' AND NEW.metadata = OLD.metadata - 'contactId'
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.tenant_id = OLD.tenant_id AND c.erased_at IS NOT NULL
        AND c.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND OLD.metadata->>'contactId' = c.id::text
    ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs are append-only except controlled contact unlinking';
END $$;


--> statement-breakpoint
-- 7) Erasure: 0024's erase_contact plus the HC-02 Connect response hook (marked "HC-02").
CREATE OR REPLACE FUNCTION public.erase_contact(p_tenant uuid, p_contact uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); erased_time timestamptz; tombstone uuid := gen_random_uuid(); response record;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'erasure access denied' USING ERRCODE = '42501'; END IF;
  SELECT erased_at INTO erased_time FROM public.contacts WHERE tenant_id = p_tenant AND id = p_contact FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- HC-02: Connect responses associated with the person (HC-06 sets the link) are erased with
  -- them, before the person is re-keyed: contact methods, evidence detail, payload references.
  -- HC-06 must move a merge source's responses before merge_contacts reaches this point.
  FOR response IN SELECT id FROM public.campaign_responses WHERE tenant_id = p_tenant AND contact_id = p_contact ORDER BY id FOR UPDATE LOOP
    PERFORM public.connect_scrub_response(p_tenant, response.id);
  END LOOP;
  -- CRM-06: CSV import rows about the person (matched or created by an import, or
  -- carrying one of their identifiers) lose their cells, keys and link before the
  -- identifiers below are deleted; the row keeps only its number and outcome codes.
  UPDATE public.crm_import_rows r SET raw = '[]'::jsonb,
    match_keys = CASE WHEN r.contact_id = p_contact THEN '{}'::text[] ELSE ARRAY(
      SELECT key FROM unnest(r.match_keys) AS key WHERE NOT EXISTS (
        SELECT 1 FROM public.contact_identifiers i WHERE i.tenant_id = p_tenant AND i.contact_id = p_contact
          AND i.kind || ':' || i.normalized_value = key)) END,
    contact_id = CASE WHEN r.contact_id = p_contact THEN NULL ELSE r.contact_id END
    WHERE r.tenant_id = p_tenant AND (r.contact_id = p_contact OR EXISTS (
      SELECT 1 FROM public.contact_identifiers i
      WHERE i.tenant_id = p_tenant AND i.contact_id = p_contact AND (
        i.kind || ':' || i.normalized_value = ANY(r.match_keys) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(r.raw) AS cell(value)
          WHERE CASE WHEN i.kind = 'phone' THEN
            length(regexp_replace(i.normalized_value, '[^0-9]', '', 'g')) > 0 AND
            regexp_replace(i.normalized_value, '[^0-9]', '', 'g') = regexp_replace(cell.value, '[^0-9]', '', 'g')
          ELSE length(i.normalized_value) > 0 AND EXISTS (
            SELECT 1 FROM generate_series(1, length(cell.value) - length(i.normalized_value) + 1) AS pos(n)
            WHERE lower(substring(cell.value FROM pos.n FOR length(i.normalized_value))) = lower(i.normalized_value)
              -- A bare one-character handle in prose is indistinguishable from a word.
              AND (i.kind <> 'social' OR length(i.normalized_value) > 1
                OR lower(btrim(cell.value)) = lower(i.normalized_value)
                OR (pos.n > 1 AND substring(cell.value FROM pos.n - 1 FOR 1) = '@'))
              AND (pos.n = 1 OR substring(cell.value FROM pos.n - 1 FOR 1) !~ '[[:alnum:]_@.+:-]'
                OR (i.kind = 'social' AND substring(cell.value FROM pos.n - 1 FOR 1) = '@'
                  AND (pos.n = 2 OR substring(cell.value FROM pos.n - 2 FOR 1) !~ '[[:alnum:]_@.+:-]')))
              AND (pos.n + length(i.normalized_value) > length(cell.value)
                OR substring(cell.value FROM pos.n + length(i.normalized_value) FOR 1) !~ '[[:alnum:]_@.+:-]'
                OR (substring(cell.value FROM pos.n + length(i.normalized_value) FOR 1) = '.'
                  AND (pos.n + length(i.normalized_value) = length(cell.value)
                    OR substring(cell.value FROM pos.n + length(i.normalized_value) + 1 FOR 1) !~ '[[:alnum:]_]')))) END))));
  -- CRM-07: the person's association events go, and any other association whose text or raw
  -- payload contains their email (case-insensitive), phone (digits only) or handle is scrubbed. This runs
  -- before the identifiers below are deleted, because it matches on them.
  DELETE FROM public.crm_associations WHERE tenant_id = p_tenant AND contact_id = p_contact;
  UPDATE public.crm_associations a SET summary = '', payload = '{}'::jsonb, redacted_at = now()
    WHERE a.tenant_id = p_tenant AND EXISTS (
      SELECT 1 FROM public.contact_identifiers i WHERE i.tenant_id = p_tenant AND i.contact_id = p_contact AND (
        (i.kind = 'email' AND (strpos(lower(a.summary), lower(i.normalized_value)) > 0 OR strpos(lower(a.payload::text), lower(i.normalized_value)) > 0))
        OR (i.kind = 'phone' AND length(regexp_replace(i.normalized_value, '[^0-9]', '', 'g')) >= 7 AND (
          strpos(regexp_replace(a.summary, '[^0-9]', '', 'g'), regexp_replace(i.normalized_value, '[^0-9]', '', 'g')) > 0
          OR strpos(regexp_replace(a.payload::text, '[^0-9]', '', 'g'), regexp_replace(i.normalized_value, '[^0-9]', '', 'g')) > 0))
        -- Social handles, case-insensitive, as a whole token (optionally after "@"); a one-character
        -- handle only with its "@", since a bare letter in prose is indistinguishable from a word.
        OR (i.kind = 'social' AND length(i.normalized_value) > 0 AND (
          a.summary ~* ('(^|[^[:alnum:]_@.+:-])' || CASE WHEN length(i.normalized_value) > 1 THEN '@?' ELSE '@' END
            || regexp_replace(i.normalized_value, '([^[:alnum:]_])', '\\\1', 'g') || '($|[^[:alnum:]_@.+:-]|[.]($|[^[:alnum:]_]))')
          OR a.payload::text ~* ('(^|[^[:alnum:]_@.+:-])' || CASE WHEN length(i.normalized_value) > 1 THEN '@?' ELSE '@' END
            || regexp_replace(i.normalized_value, '([^[:alnum:]_])', '\\\1', 'g') || '($|[^[:alnum:]_@.+:-]|[.]($|[^[:alnum:]_]))')))));
  IF erased_time IS NULL THEN
    UPDATE public.contacts SET name = 'Erased contact', notes = '', erased_at = now(), updated_at = now() WHERE tenant_id = p_tenant AND id = p_contact;
    DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = p_contact;
  END IF;
  DELETE FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = p_contact;
  -- CRM-04: deals survive (they are the organisation's business records) but lose
  -- the person link before the re-key; the version bump makes open editors stale.
  UPDATE public.opportunities SET contact_id = NULL, version = version + 1, updated_at = now()
    WHERE tenant_id = p_tenant AND contact_id = p_contact;
  -- CRM-05: tasks are the organisation's work and survive without the person link;
  -- notes about the person are deleted with them (free text may hold personal data);
  -- task and note audit rows lose the person's id so no timeline can reach them.
  UPDATE public.crm_tasks SET contact_id = NULL, version = version + 1, updated_at = now()
    WHERE tenant_id = p_tenant AND contact_id = p_contact;
  DELETE FROM public.crm_notes WHERE tenant_id = p_tenant AND contact_id = p_contact;
  UPDATE public.audit_logs a SET metadata = a.metadata - 'contactId'
    WHERE a.tenant_id = p_tenant AND (a.action LIKE 'task.%' OR a.action LIKE 'note.%' OR a.action LIKE 'association.%') AND a.metadata->>'contactId' = p_contact::text;
  -- CRM-05 review (B1): CRM outbox events, and the jobs dispatched from them, carry the
  -- person's id in their payload. Null it in both, dispatched or not. Fingerprints are
  -- left as written: they guard idempotent producers, and a scrubbed event is never
  -- re-produced with the same key (task and note keys include the bumped version).
  UPDATE public.outbox_events SET payload = jsonb_set(payload, '{contactId}', 'null'::jsonb)
    WHERE tenant_id = p_tenant AND payload->>'contactId' = p_contact::text;
  UPDATE public.jobs SET payload = jsonb_set(payload, '{contactId}', 'null'::jsonb), updated_at = now()
    WHERE tenant_id = p_tenant AND payload->>'contactId' = p_contact::text;
  -- CRM-03: the person's own custom values, relation values pointing at them, and
  -- saved-view filters naming them all go; no surviving row may reference the person.
  DELETE FROM public.crm_field_values WHERE tenant_id = p_tenant AND (contact_id = p_contact OR relation_contact_id = p_contact);
  UPDATE public.crm_saved_views v SET state = jsonb_set(v.state, '{filters}', coalesce((
      SELECT jsonb_agg(f) FROM jsonb_array_elements(v.state->'filters') f WHERE position(p_contact::text in f::text) = 0), '[]'::jsonb))
    WHERE v.tenant_id = p_tenant AND jsonb_typeof(v.state->'filters') = 'array' AND position(p_contact::text in (v.state->'filters')::text) > 0;
  UPDATE public.audit_logs a SET target_id = NULL, metadata = '{}'::jsonb
    WHERE a.tenant_id = p_tenant AND (a.action LIKE 'contact.%' OR a.action LIKE 'consent.%')
      AND (a.target_id = p_contact::text OR a.metadata->>'contactId' = p_contact::text OR EXISTS (
        SELECT 1 FROM public.contact_consents s WHERE s.tenant_id = p_tenant AND s.contact_id = p_contact
          AND (a.target_id = s.id::text OR a.metadata->>'consentId' = s.id::text)
      ));
  SET CONSTRAINTS public.contact_consents_tenant_id_contact_id_contacts_tenant_id_id_fk DEFERRED;
  UPDATE public.contact_consents SET id = gen_random_uuid(), contact_id = tombstone, recorded_by = NULL,
    channel = NULL, source = NULL, evidence = NULL,
    recorded_at = date_trunc('day', recorded_at, 'UTC'),
    occurred_at = least(date_trunc('day', occurred_at, 'UTC'), date_trunc('day', recorded_at, 'UTC')),
    redacted_at = date_trunc('day', now(), 'UTC')
    WHERE tenant_id = p_tenant AND contact_id = p_contact;
  UPDATE public.contacts SET id = tombstone,
    created_at = date_trunc('day', created_at, 'UTC'), updated_at = date_trunc('day', updated_at, 'UTC'),
    erased_at = date_trunc('day', erased_at, 'UTC') WHERE tenant_id = p_tenant AND id = p_contact;
  SET CONSTRAINTS public.contact_consents_tenant_id_contact_id_contacts_tenant_id_id_fk IMMEDIATE;
  IF erased_time IS NOT NULL THEN RETURN true; END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id)
    VALUES (p_tenant, actor, 'contact.erase', NULL);
  RETURN true;
END $$;
