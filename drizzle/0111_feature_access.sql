CREATE TABLE "workspace_invitations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"grants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"can_manage_admins" boolean DEFAULT false NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '14 days' NOT NULL,
	"responded_at" timestamp with time zone,
	"accepted_by" text,
	CONSTRAINT "workspace_invitations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "workspace_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "workspace_invitation_role" CHECK ("workspace_invitations"."role" in ('admin','member','viewer','collaborator','guest')),
	CONSTRAINT "workspace_invitation_grants" CHECK (jsonb_typeof("workspace_invitations"."grants") = 'object' and ("workspace_invitations"."role" = 'collaborator' or "workspace_invitations"."grants" = '{}'::jsonb)),
	CONSTRAINT "workspace_invitation_admins_flag" CHECK ("workspace_invitations"."can_manage_admins" = false or "workspace_invitations"."role" = 'admin'),
	CONSTRAINT "workspace_invitation_email" CHECK ("workspace_invitations"."email" = lower(btrim("workspace_invitations"."email")) and length("workspace_invitations"."email") between 3 and 320),
	CONSTRAINT "workspace_invitation_token" CHECK ("workspace_invitations"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "workspace_invitation_status" CHECK ("workspace_invitations"."status" in ('pending','accepted','revoked') and (("workspace_invitations"."status" = 'pending') = ("workspace_invitations"."responded_at" is null)) and (("workspace_invitations"."status" = 'accepted') = ("workspace_invitations"."accepted_by" is not null))),
	CONSTRAINT "workspace_invitation_expiry" CHECK ("workspace_invitations"."expires_at" = "workspace_invitations"."created_at" + interval '14 days')
);
--> statement-breakpoint
CREATE TABLE "workspace_member_access" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"area" text NOT NULL,
	"level" text NOT NULL,
	"granted_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_access_tenant_id_user_id_area_pk" PRIMARY KEY("tenant_id","user_id","area"),
	CONSTRAINT "workspace_member_access_area" CHECK ("workspace_member_access"."area" in ('crm','giving','campaigns','communities','catalog','social','newsletter','website','office','connect','settings')),
	CONSTRAINT "workspace_member_access_level" CHECK ("workspace_member_access"."level" in ('view','manage'))
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "can_manage_admins" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_access" ADD CONSTRAINT "workspace_member_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_access" ADD CONSTRAINT "workspace_member_access_member_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_open_idx" ON "workspace_invitations" USING btree ("tenant_id","email") WHERE "workspace_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "workspace_invitations_tenant_idx" ON "workspace_invitations" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_member_admins_flag" CHECK ("workspace_members"."can_manage_admins" = false or "workspace_members"."role_id" = 'admin');--> statement-breakpoint
-- Per-feature access (founder decision, 25 Nov). Full account: docs/acceptance/feature-access-server.md.
--
-- 1. Roles. `collaborator` holds an explicit set of areas (workspace_member_access). `guest` holds none and reaches only items shared with them by name.
--    `campaign_guest` is the inert role of the campaign invitations (open PR #251); it is inserted here with ON CONFLICT DO NOTHING so either migration can land
--    first, and every rule below treats it like `guest`.
-- 2. ONE central function, public.access_role(tenant, user, area, role): it turns a stored role plus the person's grants into the role that every module check
--    already understands (`admin` for manage, `viewer` for view, `guest` for none). owner/admin/member/viewer pass through unchanged, so nothing existing changes.
-- 3. Every module helper and every policy that tested role_id now calls it (rewritten below from the live definitions, with an explicit table/function to area
--    list). New code must call access_role instead of testing role_id (tests/unit/access-guard.test.ts).
-- 4. Grants and invitations change only through SECURITY DEFINER functions that write the role, the grants and the audit row together. Only an owner can grant,
--    change or remove `owner`. An `admin` is granted, changed and removed by an owner or by an admin created with can_manage_admins (founder decision, 25 Nov);
--    a trigger enforces it for the application role as well.
INSERT INTO public.roles (id) VALUES ('collaborator'), ('guest'), ('campaign_guest') ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.workspace_member_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_member_access FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_member_access, public.workspace_invitations FROM PUBLIC, harvest_app;
GRANT SELECT ON public.workspace_member_access, public.workspace_invitations TO harvest_app;
--> statement-breakpoint
-- The application role reads its own grants (and owners/admins read everyone's); it never writes them.
CREATE POLICY member_access_read ON public.workspace_member_access FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND (user_id = nullif(current_setting('app.user_id', true), '')
      OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = workspace_member_access.tenant_id
        AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin'))));
CREATE POLICY invitations_read ON public.workspace_invitations FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = workspace_invitations.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
-- Policies for the definer's owner role (whichever role owns the functions: the migration runner here, another on Neon). The app role never matches.
-- access_role reads grants as that owner for every module check; the writing definers are tenant-scoped through a transaction-local setting only they set.
CREATE POLICY member_access_definer_read ON public.workspace_member_access FOR SELECT TO PUBLIC USING (current_user <> 'harvest_app');
CREATE POLICY member_access_definer_write ON public.workspace_member_access TO PUBLIC
  USING (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid)
  WITH CHECK (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid);
CREATE POLICY invitations_definer ON public.workspace_invitations TO PUBLIC
  USING (current_user <> 'harvest_app' AND (tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid
    OR token_hash = nullif(current_setting('app.access_token', true), '')))
  WITH CHECK (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid);
CREATE POLICY access_definer_members ON public.workspace_members TO PUBLIC
  USING (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid)
  WITH CHECK (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid);
CREATE POLICY access_definer_audit ON public.audit_logs FOR INSERT TO PUBLIC
  WITH CHECK (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.access_tenant', true), '')::uuid
    AND action IN ('member.access_change', 'invitation.create', 'invitation.accept', 'invitation.revoke'));
--> statement-breakpoint
CREATE FUNCTION public.access_role(p_tenant uuid, p_user text, p_area text, p_role text) RETURNS text
-- SECURITY INVOKER on purpose: grants are read under the caller's own row policy, so an ordinary member learns nothing about other people's areas (they
-- read as `guest`), owners/admins see everyone's, and a definer function reads them as its owner.
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_role IS DISTINCT FROM 'collaborator' THEN p_role
    ELSE coalesce((SELECT CASE a.level WHEN 'manage' THEN 'admin' ELSE 'viewer' END FROM public.workspace_member_access a
      WHERE a.tenant_id = p_tenant AND a.user_id = p_user AND a.area = p_area
        AND p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid), 'guest') END
$$;
REVOKE ALL ON FUNCTION public.access_role(uuid, text, text, text) FROM PUBLIC, harvest_app;
GRANT EXECUTE ON FUNCTION public.access_role(uuid, text, text, text) TO harvest_app;
--> statement-breakpoint
-- Policies: every policy of these tables that tested role_id now asks access_role for the area (owner_admin = never grantable).
DO $$
DECLARE r record; area text; q text; c text; stmt text; n integer := 0;
  areas jsonb := '{"bio_clicks":"website","bio_messages":"website","bio_pages":"website",
    "campaign_drafts":"campaigns","campaign_response_links":"campaigns","campaigns":"campaigns","campaign_responses":"owner_admin",
    "community_channel_members":"communities","community_channel_reads":"communities","community_channels":"communities","community_chat_state":"communities",
    "community_message_reactions":"communities","community_messages":"communities",
    "connect_landing_states":"connect","connect_landing_versions":"connect","followup_cases":"connect",
    "contact_first_sources":"crm","contact_form_sources":"crm","contact_source_events":"crm","crm_deal_stage_moves":"crm",
    "crm_form_addresses":"crm","crm_form_publications":"crm","crm_form_responses":"crm","forms":"crm","form_versions":"crm","privacy_notice_versions":"crm",
    "doc_attachments":"office","doc_comments":"office","doc_folders":"office","doc_links":"office","doc_notifications":"office","doc_page_shares":"office",
    "doc_page_versions":"office","doc_pages":"office","doc_shares":"office","doc_templates":"office","docs":"office",
    "files":"social","social_connections":"social","social_drafts":"social","social_posts":"social","social_schedules":"social",
    "newsletter_archived_counts":"newsletter","newsletter_audiences":"newsletter","newsletter_automation_log":"newsletter","newsletter_automation_runs":"newsletter",
    "newsletter_automations":"newsletter","newsletter_brand_kits":"newsletter","newsletter_campaign_lists":"newsletter","newsletter_campaign_revisions":"newsletter",
    "newsletter_campaign_segments":"newsletter","newsletter_campaigns":"newsletter","newsletter_connections":"newsletter","newsletter_deliveries":"newsletter",
    "newsletter_form_signups":"newsletter","newsletter_identities":"newsletter","newsletter_import_provenance":"newsletter","newsletter_lists":"newsletter",
    "newsletter_segments":"newsletter","newsletter_signup_forms":"newsletter","newsletter_subscribers":"newsletter","newsletter_subscriptions":"newsletter",
    "newsletter_suppressions":"newsletter","newsletter_template_revisions":"newsletter","newsletter_templates":"newsletter"}';
BEGIN
  FOR r IN SELECT p.tablename, p.policyname, p.qual, p.with_check FROM pg_policies p
    WHERE p.schemaname = 'public' AND (p.qual ~ 'role_id' OR p.with_check ~ 'role_id') ORDER BY p.tablename, p.policyname LOOP
    area := areas ->> r.tablename;
    IF area IS NULL THEN RAISE NOTICE 'access_role: policy % on % has no area and keeps its role check', r.policyname, r.tablename; CONTINUE; END IF;
    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF r.qual IS NOT NULL THEN
      q := regexp_replace(r.qual, '\m([A-Za-z_][A-Za-z0-9_]*)\.role_id\M', format('public.access_role(\1.tenant_id, \1.user_id, %L, \1.role_id)', area), 'g');
      q := regexp_replace(q, '(access_role\([^)]*\))\s*<>\s*''viewer''(::text)?', '\1 = ANY (ARRAY[''owner''::text, ''admin''::text, ''member''::text])', 'g');
      stmt := stmt || ' USING (' || q || ')';
    END IF;
    IF r.with_check IS NOT NULL THEN
      c := regexp_replace(r.with_check, '\m([A-Za-z_][A-Za-z0-9_]*)\.role_id\M', format('public.access_role(\1.tenant_id, \1.user_id, %L, \1.role_id)', area), 'g');
      c := regexp_replace(c, '(access_role\([^)]*\))\s*<>\s*''viewer''(::text)?', '\1 = ANY (ARRAY[''owner''::text, ''admin''::text, ''member''::text])', 'g');
      stmt := stmt || ' WITH CHECK (' || c || ')';
    END IF;
    EXECUTE stmt; n := n + 1;
  END LOOP;
  RAISE NOTICE 'access_role: % policies rewritten', n;
END $$;
--> statement-breakpoint
-- Functions: the same rewrite for every function body that tested role_id (qualified and bare column references).
DO $$
DECLARE r record; def text; area text; n integer := 0;
  areas jsonb := '{"ads_can":"social","apply_person_import_row":"crm","assign_followup_case":"connect","bio_photo_perform":"website","bio_purge_expired_scoped":"website",
    "bio_transition_scoped":"website","catalog_staff":"catalog","community_chat_role":"communities","community_dm_reviewers":"communities","community_live_can_manage":"communities",
    "community_live_manager_context":"communities","community_stats_can":"communities","connect_landing_write":"connect","connect_link_transition":"connect",
    "connect_response_purpose_active":"owner_admin","contact_connect_source_label":"crm","contact_source_created":"crm","contact_source_retained":"crm",
    "crm_form_purge_expired_scoped":"crm","crm_form_transition_scoped":"crm","crm_import_diagnostics":"crm","discover_can":"communities","docs_sharing_guard":"office",
    "erase_connect_response":"owner_admin","erase_contact":"owner_admin","events_cover_perform":"communities","events_perform":"communities","events_project":"communities",
    "followup_actor_role":"connect","followup_member_revoked":"connect","guard_followup_case":"connect","merge_contacts_before_crm_forms":"owner_admin",
    "merge_contacts_before_newsletter_sending":"owner_admin","merge_contacts_before_nl02":"owner_admin","merge_contacts_scoped":"owner_admin",
    "newsletter_address_block":"newsletter","newsletter_analytics_groups":"newsletter","newsletter_cancel_queued":"newsletter","newsletter_confirm_mailbox":"newsletter",
    "newsletter_current_eligibility":"newsletter","newsletter_delete_identity":"newsletter","newsletter_form_archive":"newsletter","newsletter_preference_issue":"newsletter",
    "newsletter_reissue_domain":"newsletter","newsletter_remove_domain":"newsletter","newsletter_verify_domain":"newsletter","office_can":"office",
    "purge_expired_connect_responses":"owner_admin","read_pending_response_metadata":"owner_admin","rollback_crm_import":"crm","social_approval_can":"social",
    "social_auto_dm_begin":"social","social_auto_dm_finish":"social","social_inbox_begin_reply":"social","social_inbox_can":"social","withdraw_connect_response_purpose":"owner_admin"}';
BEGIN
  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~ 'role_id' AND p.proname <> 'access_role' ORDER BY p.proname LOOP
    area := areas ->> r.proname;
    -- social_approval_guard and social_approval_owner only compare a stored role with 'owner'; a collaborator is never an owner.
    IF area IS NULL THEN RAISE NOTICE 'access_role: function % keeps its role check', r.proname; CONTINUE; END IF;
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '\m([A-Za-z_][A-Za-z0-9_]*)\.role_id\M', format('public.access_role(\1.tenant_id, \1.user_id, %L, \1.role_id)', area), 'g');
    def := regexp_replace(def, '(^|[^.[:alnum:]_])role_id\M', format('\1public.access_role(tenant_id, user_id, %L, role_id)', area), 'g');
    -- A role test that LETS a role through by exclusion (`<> 'viewer'`) would admit a guest or an area-less collaborator; make it a positive allow-list.
    def := regexp_replace(def, '(access_role\([^)]*\))\s*<>\s*''viewer''', '\1 IN (''owner'', ''admin'', ''member'')', 'g');
    EXECUTE def; n := n + 1;
  END LOOP;
  RAISE NOTICE 'access_role: % functions rewritten', n;
END $$;
--> statement-breakpoint
-- Guests (and a collaborator with no Office grant, who maps to `guest`) read a doc only through an explicit share, and only to view.
CREATE OR REPLACE FUNCTION public.docs_rank(p_role text, p_owner boolean, p_visibility text, p_ministry text, p_share text) RETURNS int
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE
    WHEN p_role IN ('guest','campaign_guest') THEN CASE WHEN p_share IN ('view','comment','edit') THEN 1 ELSE 0 END
    WHEN p_role IS NULL OR p_role NOT IN ('owner','admin','member','viewer') THEN 0
    WHEN p_role IN ('owner','admin') THEN 4
    WHEN p_owner AND p_role<>'viewer' THEN 4
    ELSE LEAST(CASE WHEN p_role='viewer' THEN 2 ELSE 3 END, GREATEST(
      CASE p_share WHEN 'edit' THEN 3 WHEN 'comment' THEN 2 WHEN 'view' THEN 1 ELSE 0 END,
      CASE WHEN p_visibility='ministry' THEN CASE p_ministry WHEN 'edit' THEN 3 WHEN 'comment' THEN 2 WHEN 'view' THEN 1 ELSE 0 END ELSE 0 END))
  END
$$;
--> statement-breakpoint
-- Who may change roles. Only an owner grants, changes or removes `admin`/`owner`; the last owner stays; the first owner of a new account is allowed.
-- Enforced for the application role (the definers below run as the owner role and check the same rules themselves).
CREATE FUNCTION public.workspace_member_role_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); actor_role text; actor_flag boolean; actor_admins boolean; t uuid := coalesce(NEW.tenant_id, OLD.tenant_id);
BEGIN
  IF current_user <> 'harvest_app' THEN RETURN coalesce(NEW, OLD); END IF;
  SELECT m.role_id, m.can_manage_admins INTO actor_role, actor_flag FROM public.workspace_members m WHERE m.tenant_id = t AND m.user_id = actor;
  actor_admins := actor_role = 'owner' OR (actor_role = 'admin' AND coalesce(actor_flag, false));
  IF TG_OP = 'INSERT' THEN
    IF NEW.role_id = 'owner' AND actor_role IS DISTINCT FROM 'owner'
      AND NOT (NEW.user_id = actor AND NOT EXISTS (SELECT 1 FROM public.workspace_members x WHERE x.tenant_id = t)) THEN
      RAISE EXCEPTION 'only an owner can grant owner' USING ERRCODE = '42501';
    END IF;
    IF NEW.role_id = 'admin' AND NOT actor_admins THEN RAISE EXCEPTION 'only an owner or an admin who manages admins can grant admin' USING ERRCODE = '42501'; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.role_id IS DISTINCT FROM NEW.role_id AND (OLD.role_id = 'owner' OR NEW.role_id = 'owner') AND actor_role IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'only an owner can change owner' USING ERRCODE = '42501';
    END IF;
    IF (OLD.role_id IS DISTINCT FROM NEW.role_id AND (OLD.role_id = 'admin' OR NEW.role_id = 'admin') OR OLD.can_manage_admins IS DISTINCT FROM NEW.can_manage_admins) AND NOT actor_admins THEN
      RAISE EXCEPTION 'only an owner or an admin who manages admins can change admin' USING ERRCODE = '42501';
    END IF;
    IF OLD.role_id IS DISTINCT FROM NEW.role_id AND OLD.role_id = 'owner' THEN
      IF TRUE AND NOT EXISTS (SELECT 1 FROM public.workspace_members x WHERE x.tenant_id = t AND x.role_id = 'owner' AND x.user_id <> OLD.user_id) THEN
        RAISE EXCEPTION 'the account must keep an owner' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    IF OLD.role_id = 'owner' THEN RAISE EXCEPTION 'transfer ownership before removing an owner' USING ERRCODE = '23514'; END IF;
    IF OLD.role_id = 'admin' AND NOT actor_admins THEN RAISE EXCEPTION 'only an owner or an admin who manages admins can remove an admin' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION public.workspace_member_role_guard() FROM PUBLIC;
CREATE TRIGGER workspace_member_role_guard BEFORE INSERT OR UPDATE OR DELETE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.workspace_member_role_guard();
--> statement-breakpoint
-- Validates a grants object: known areas, view|manage, and only for a collaborator. Returns a normalised "area:level,..." string or null when invalid.
CREATE FUNCTION public.access_grants_text(p_role text, p_grants jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE k text; v text; parts text[] := ARRAY[]::text[];
BEGIN
  IF p_grants IS NULL OR jsonb_typeof(p_grants) <> 'object' THEN RETURN NULL; END IF;
  IF p_role <> 'collaborator' THEN IF p_grants <> '{}'::jsonb THEN RETURN NULL; END IF; RETURN ''; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each_text(p_grants) ORDER BY key LOOP
    IF k NOT IN ('crm','giving','campaigns','communities','catalog','social','newsletter','website','office','connect','settings') OR v NOT IN ('view','manage') THEN RETURN NULL; END IF;
    parts := parts || (k || ':' || v);
  END LOOP;
  RETURN array_to_string(parts, ',');
END $$;
REVOKE ALL ON FUNCTION public.access_grants_text(text, jsonb) FROM PUBLIC;
--> statement-breakpoint
-- Change an existing member's role and areas (owner/admin only; admin/owner changes need an owner; nobody changes their own access).
-- Returns {"outcome": ok | forbidden | not_found | invalid | conflict}.
CREATE FUNCTION public.workspace_access_change(p_user text, p_role text, p_grants jsonb, p_can_manage_admins boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); t uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  actor_role text; actor_flag boolean; target_role text; areas text; previous text; k text; v text;
BEGIN
  IF actor IS NULL OR t IS NULL OR p_user IS NULL THEN RETURN '{"outcome":"forbidden"}'::jsonb; END IF;
  PERFORM set_config('app.access_tenant', t::text, true);
  SELECT role_id, can_manage_admins INTO actor_role, actor_flag FROM public.workspace_members WHERE tenant_id = t AND user_id = actor FOR SHARE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') OR actor = p_user THEN RETURN '{"outcome":"forbidden"}'::jsonb; END IF;
  IF coalesce(p_can_manage_admins, false) AND p_role <> 'admin' THEN RETURN '{"outcome":"invalid"}'::jsonb; END IF;
  IF p_role NOT IN ('owner', 'admin', 'member', 'viewer', 'collaborator', 'guest') THEN RETURN '{"outcome":"invalid"}'::jsonb; END IF;
  areas := public.access_grants_text(p_role, coalesce(p_grants, '{}'::jsonb));
  IF areas IS NULL THEN RETURN '{"outcome":"invalid"}'::jsonb; END IF;
  SELECT role_id INTO target_role FROM public.workspace_members WHERE tenant_id = t AND user_id = p_user FOR UPDATE;
  IF target_role IS NULL THEN RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  -- Owner/admin hold every area at manage, so "nobody grants more than they hold" reduces to: only an owner touches owner, and only an owner or an admin
  -- who manages admins touches admin (including the manages-admins permission itself, which nobody can give without holding it).
  IF (p_role = 'owner' OR target_role = 'owner') AND actor_role <> 'owner' THEN RETURN '{"outcome":"forbidden"}'::jsonb; END IF;
  IF (p_role = 'admin' OR target_role = 'admin') AND NOT (actor_role = 'owner' OR coalesce(actor_flag, false)) THEN RETURN '{"outcome":"forbidden"}'::jsonb; END IF;
  IF target_role = 'owner' AND p_role <> 'owner' AND NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE tenant_id = t AND role_id = 'owner' AND user_id <> p_user) THEN
    RETURN '{"outcome":"conflict"}'::jsonb;
  END IF;
  SELECT coalesce(string_agg(area || ':' || level, ',' ORDER BY area), '') INTO previous FROM public.workspace_member_access WHERE tenant_id = t AND user_id = p_user;
  -- Grants first, then the role: the follow-up revocation trigger on role_id reads the new areas (a collaborator who loses Connect, or becomes a guest, is revoked).
  DELETE FROM public.workspace_member_access WHERE tenant_id = t AND user_id = p_user;
  IF p_role = 'collaborator' THEN
    FOR k, v IN SELECT key, value FROM jsonb_each_text(p_grants) LOOP
      INSERT INTO public.workspace_member_access (tenant_id, user_id, area, level, granted_by) VALUES (t, p_user, k, v, actor);
    END LOOP;
  END IF;
  UPDATE public.workspace_members SET role_id = p_role, can_manage_admins = (p_role = 'admin' AND coalesce(p_can_manage_admins, false)) WHERE tenant_id = t AND user_id = p_user;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (t, actor, 'member.access_change', p_user, jsonb_build_object('role', p_role, 'previousRole', target_role, 'areas', areas, 'previousAreas', previous, 'manageAdmins', (p_role = 'admin' AND coalesce(p_can_manage_admins, false))::text));
  PERFORM set_config('app.access_tenant', '', true);
  RETURN jsonb_build_object('outcome', 'ok', 'role', p_role, 'areas', areas);
END $$;
REVOKE ALL ON FUNCTION public.workspace_access_change(text, text, jsonb, boolean) FROM PUBLIC, harvest_app;
GRANT EXECUTE ON FUNCTION public.workspace_access_change(text, text, jsonb, boolean) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.workspace_invitation_create(p_email text, p_role text, p_grants jsonb, p_token_hash text, p_can_manage_admins boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); t uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  actor_role text; actor_flag boolean; areas text; em text := lower(btrim(coalesce(p_email, ''))); new_id uuid;
BEGIN
  IF actor IS NULL OR t IS NULL THEN RETURN '{"outcome":"forbidden"}'::jsonb; END IF;
  PERFORM set_config('app.access_tenant', t::text, true);
  SELECT role_id, can_manage_admins INTO actor_role, actor_flag FROM public.workspace_members WHERE tenant_id = t AND user_id = actor FOR SHARE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN RETURN '{"outcome":"forbidden"}'::jsonb; END IF;
  IF coalesce(p_can_manage_admins, false) AND p_role <> 'admin' THEN RETURN '{"outcome":"invalid"}'::jsonb; END IF;
  IF p_role NOT IN ('admin', 'member', 'viewer', 'collaborator', 'guest') OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR length(em) NOT BETWEEN 3 AND 320 THEN RETURN '{"outcome":"invalid"}'::jsonb; END IF;
  areas := public.access_grants_text(p_role, coalesce(p_grants, '{}'::jsonb));
  IF areas IS NULL THEN RETURN '{"outcome":"invalid"}'::jsonb; END IF;
  IF p_role = 'admin' AND NOT (actor_role = 'owner' OR coalesce(actor_flag, false)) THEN RETURN '{"outcome":"forbidden"}'::jsonb; END IF;
  UPDATE public.workspace_invitations SET status = 'revoked', responded_at = clock_timestamp() WHERE tenant_id = t AND email = em AND status = 'pending';
  INSERT INTO public.workspace_invitations (tenant_id, email, role, grants, can_manage_admins, token_hash, created_by) VALUES (t, em, p_role, coalesce(p_grants, '{}'::jsonb), coalesce(p_can_manage_admins, false), p_token_hash, actor) RETURNING id INTO new_id;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata) VALUES (t, actor, 'invitation.create', new_id::text, jsonb_build_object('role', p_role, 'areas', areas, 'manageAdmins', coalesce(p_can_manage_admins, false)::text));
  PERFORM set_config('app.access_tenant', '', true);
  RETURN jsonb_build_object('outcome', 'ok', 'id', new_id);
END $$;
REVOKE ALL ON FUNCTION public.workspace_invitation_create(text, text, jsonb, text, boolean) FROM PUBLIC, harvest_app;
GRANT EXECUTE ON FUNCTION public.workspace_invitation_create(text, text, jsonb, text, boolean) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.workspace_invitation_revoke(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); t uuid := nullif(current_setting('app.tenant_id', true), '')::uuid; actor_role text; n integer;
BEGIN
  IF actor IS NULL OR t IS NULL THEN RETURN '{"outcome":"forbidden"}'::jsonb; END IF;
  PERFORM set_config('app.access_tenant', t::text, true);
  SELECT role_id INTO actor_role FROM public.workspace_members WHERE tenant_id = t AND user_id = actor FOR SHARE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN RETURN '{"outcome":"forbidden"}'::jsonb; END IF;
  UPDATE public.workspace_invitations SET status = 'revoked', responded_at = clock_timestamp() WHERE tenant_id = t AND id = p_id AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN PERFORM set_config('app.access_tenant', '', true); RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata) VALUES (t, actor, 'invitation.revoke', p_id::text, '{}'::jsonb);
  PERFORM set_config('app.access_tenant', '', true);
  RETURN '{"outcome":"ok"}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.workspace_invitation_revoke(uuid) FROM PUBLIC, harvest_app;
GRANT EXECUTE ON FUNCTION public.workspace_invitation_revoke(uuid) TO harvest_app;
--> statement-breakpoint
-- Accepting is the only way a person who is not yet a member (or whose access changes) takes an invitation. The signed-in account's e-mail must be the one the
-- invitation names; the inviter must still be allowed to grant it. Returns {"outcome": ok | not_found | closed | expired}.
CREATE FUNCTION public.workspace_invitation_accept(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); actor_email text; hash text; inv public.workspace_invitations; inviter_role text; inviter_flag boolean; prev_role text; areas text;
  k text; v text; joined boolean := false; result jsonb;
  previous_token text := coalesce(current_setting('app.access_token', true), ''); previous_tenant text := coalesce(current_setting('app.access_tenant', true), ''); previous_app_tenant text := coalesce(current_setting('app.tenant_id', true), '');
BEGIN
  IF actor IS NULL OR p_token IS NULL OR length(p_token) NOT BETWEEN 16 AND 200 THEN RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT lower(btrim(u.email)) INTO actor_email FROM public.users u WHERE u.id = actor;
  PERFORM set_config('app.access_token', hash, true);
  SELECT * INTO inv FROM public.workspace_invitations WHERE token_hash = hash FOR UPDATE;
  IF NOT FOUND THEN PERFORM set_config('app.access_token', previous_token, true); RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  PERFORM set_config('app.access_tenant', inv.tenant_id::text, true);
  IF inv.email IS DISTINCT FROM actor_email THEN result := '{"outcome":"not_found"}'::jsonb;
  ELSIF inv.status = 'accepted' THEN result := jsonb_build_object('outcome', 'ok', 'tenantId', inv.tenant_id, 'role', inv.role, 'joined', false);
  ELSIF inv.status <> 'pending' THEN result := '{"outcome":"closed"}'::jsonb;
  ELSIF inv.expires_at <= clock_timestamp() THEN result := '{"outcome":"expired"}'::jsonb;
  ELSE
    SELECT role_id, can_manage_admins INTO inviter_role, inviter_flag FROM public.workspace_members WHERE tenant_id = inv.tenant_id AND user_id = inv.created_by FOR SHARE;
    SELECT role_id INTO prev_role FROM public.workspace_members WHERE tenant_id = inv.tenant_id AND user_id = actor FOR UPDATE;
    IF inviter_role IS NULL OR inviter_role NOT IN ('owner', 'admin') OR ((inv.role = 'admin' OR prev_role = 'admin') AND NOT (inviter_role = 'owner' OR coalesce(inviter_flag, false)))
      OR prev_role = 'owner' THEN
      result := '{"outcome":"closed"}'::jsonb;
    ELSE
      areas := public.access_grants_text(inv.role, inv.grants);
      IF prev_role IS NULL THEN joined := true; INSERT INTO public.workspace_members (tenant_id, user_id, role_id, can_manage_admins) VALUES (inv.tenant_id, actor, inv.role, inv.can_manage_admins AND inv.role = 'admin'); END IF;
      DELETE FROM public.workspace_member_access WHERE tenant_id = inv.tenant_id AND user_id = actor;
      IF inv.role = 'collaborator' THEN
        FOR k, v IN SELECT key, value FROM jsonb_each_text(inv.grants) LOOP
          INSERT INTO public.workspace_member_access (tenant_id, user_id, area, level, granted_by) VALUES (inv.tenant_id, actor, k, v, inv.created_by);
        END LOOP;
      END IF;
      -- The tenant is set for the role-change trigger (follow-up revocation reads the new areas through access_role).
      IF prev_role IS NOT NULL THEN
        PERFORM set_config('app.tenant_id', inv.tenant_id::text, true);
        UPDATE public.workspace_members SET role_id = inv.role, can_manage_admins = (inv.can_manage_admins AND inv.role = 'admin') WHERE tenant_id = inv.tenant_id AND user_id = actor;
        PERFORM set_config('app.tenant_id', previous_app_tenant, true);
      END IF;
      UPDATE public.workspace_invitations SET status = 'accepted', responded_at = clock_timestamp(), accepted_by = actor WHERE tenant_id = inv.tenant_id AND id = inv.id;
      INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
        VALUES (inv.tenant_id, actor, 'invitation.accept', inv.id::text, jsonb_build_object('role', inv.role, 'areas', coalesce(areas, ''), 'joined', joined::text));
      result := jsonb_build_object('outcome', 'ok', 'tenantId', inv.tenant_id, 'role', inv.role, 'joined', joined);
    END IF;
  END IF;
  PERFORM set_config('app.access_token', previous_token, true);
  PERFORM set_config('app.access_tenant', previous_tenant, true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.workspace_invitation_accept(text) FROM PUBLIC, harvest_app;
GRANT EXECUTE ON FUNCTION public.workspace_invitation_accept(text) TO harvest_app;
--> statement-breakpoint
-- The seven SELECT policies that only asked "is this person a member" now also need the area that owns the data (or, for forms, either of the two). The privacy notice
-- versions stay readable by every member on purpose: consent screens must show the notice a person agreed to.
DO $$
DECLARE r record; q text; ar text; extra text; n integer := 0;
  rules jsonb := '{"campaign_response_links.campaign_response_links_read":["connect"],"campaign_response_link_codes.campaign_response_link_codes_read":["connect"],
    "catalog_items.catalog_metadata":["catalog"],"doc_templates.docs_template_read":["office"],"forms.forms_read":["crm","connect"],"form_versions.form_versions_read":["crm","connect"]}';
BEGIN
  FOR r IN SELECT p.tablename, p.policyname, p.qual FROM pg_policies p WHERE p.schemaname = 'public' AND (p.tablename || '.' || p.policyname) IN (SELECT jsonb_object_keys(rules)) LOOP
    extra := '';
    FOR ar IN SELECT jsonb_array_elements_text(rules -> (r.tablename || '.' || r.policyname)) LOOP
      extra := extra || CASE WHEN extra = '' THEN '' ELSE ' OR ' END
        || format('public.access_role(m2.tenant_id, m2.user_id, %L, m2.role_id) = ANY (ARRAY[''owner'', ''admin'', ''member'', ''viewer''])', ar);
    END LOOP;
    q := '(' || r.qual || ') AND EXISTS (SELECT 1 FROM public.workspace_members m2 WHERE m2.tenant_id = ' || r.tablename || '.tenant_id AND m2.user_id = nullif(current_setting(''app.user_id'', true), '''') AND (' || extra || '))';
    EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.policyname, r.tablename, q); n := n + 1;
  END LOOP;
  RAISE NOTICE 'access_role: % member-only read policies tightened', n;
END $$;
