CREATE TABLE "campaign_draft_invitations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"department" text NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"email" text,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '14 days' NOT NULL,
	"responded_at" timestamp with time zone,
	"accepted_by" text,
	CONSTRAINT "campaign_draft_invitations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_draft_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "campaign_invitation_role" CHECK ("campaign_draft_invitations"."role" in ('leader', 'member')),
	CONSTRAINT "campaign_invitation_department" CHECK ("campaign_draft_invitations"."department" in ('campaign_leadership', 'church_mobilization', 'evangelistic_outreach', 'prayer_intercession', 'marketing_media', 'logistics_equipment', 'finance_fundraising', 'volunteers', 'counseling', 'discipleship_follow_up', 'worship_production', 'security_medical', 'transportation_hospitality')),
	CONSTRAINT "campaign_invitation_target" CHECK (("campaign_draft_invitations"."kind" = 'member' and "campaign_draft_invitations"."user_id" is not null and "campaign_draft_invitations"."email" is null) or ("campaign_draft_invitations"."kind" = 'email' and "campaign_draft_invitations"."user_id" is null and "campaign_draft_invitations"."email" is not null and "campaign_draft_invitations"."email" = lower(btrim("campaign_draft_invitations"."email")) and length("campaign_draft_invitations"."email") between 3 and 254 and "campaign_draft_invitations"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
	CONSTRAINT "campaign_invitation_status" CHECK ("campaign_draft_invitations"."status" in ('pending', 'accepted', 'revoked') and (("campaign_draft_invitations"."status" = 'pending') = ("campaign_draft_invitations"."responded_at" is null)) and (("campaign_draft_invitations"."status" = 'accepted') = ("campaign_draft_invitations"."accepted_by" is not null))),
	CONSTRAINT "campaign_invitation_token" CHECK ("campaign_draft_invitations"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "campaign_invitation_expiry" CHECK ("campaign_draft_invitations"."expires_at" = "campaign_draft_invitations"."created_at" + interval '14 days')
);
--> statement-breakpoint
ALTER TABLE "campaign_draft_invitations" ADD CONSTRAINT "campaign_draft_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_draft_invitations" ADD CONSTRAINT "campaign_draft_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_draft_invitations" ADD CONSTRAINT "campaign_draft_invitations_tenant_id_draft_id_campaign_drafts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","draft_id") REFERENCES "public"."campaign_drafts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_draft_invitations" ADD CONSTRAINT "campaign_draft_invitations_tenant_id_user_id_workspace_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."workspace_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_draft_invitations_open_idx" ON "campaign_draft_invitations" USING btree ("tenant_id","draft_id","department",coalesce("user_id", "email")) WHERE "campaign_draft_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "campaign_draft_invitations_draft_idx" ON "campaign_draft_invitations" USING btree ("tenant_id","draft_id","status");
--> statement-breakpoint
-- CW-05 invitations (founder decision Q2). FORCE RLS. The runtime role reads, creates and revokes invitations for an open draft through ordinary
-- policies; ACCEPTING one is the only thing that lets a person who is not yet a member change anything, so it runs in one SECURITY DEFINER function with a
-- fixed search_path, executable by the runtime role alone. It checks the signed-in user against the invitation (the invited member, or the account
-- whose email the invitation names), the 14-day expiry and that the draft is not discarded, then adds the person to the ministry (the inert
-- campaign_guest role: it has no permission anywhere until a campaign-scoped screen grants one) and to the department, and records who accepted.
-- Delivery is not part of the database: no message is sent from here.
INSERT INTO public.roles (id) VALUES ('campaign_guest') ON CONFLICT DO NOTHING;
ALTER TABLE public.campaign_draft_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_draft_invitations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_draft_invitations FROM PUBLIC, harvest_app;
GRANT SELECT, INSERT ON public.campaign_draft_invitations TO harvest_app;
GRANT UPDATE (status, responded_at) ON public.campaign_draft_invitations TO harvest_app;
--> statement-breakpoint
CREATE POLICY campaign_invitations_read ON public.campaign_draft_invitations FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.workspace_members m
    WHERE m.tenant_id = campaign_draft_invitations.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND m.role_id IN ('owner', 'admin', 'member')));
CREATE POLICY campaign_invitations_create ON public.campaign_draft_invitations FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND created_by = nullif(current_setting('app.user_id', true), '')
    AND status = 'pending' AND responded_at IS NULL AND accepted_by IS NULL
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_draft_invitations.tenant_id AND m.user_id = created_by
      AND m.role_id IN ('owner', 'admin', 'member'))
    AND EXISTS (SELECT 1 FROM public.campaign_drafts d WHERE d.tenant_id = campaign_draft_invitations.tenant_id AND d.id = campaign_draft_invitations.draft_id
      AND d.status = 'draft' AND campaign_draft_invitations.department = ANY (d.departments)));
-- A pending invitation can be withdrawn by anyone who can edit the draft; nothing else about it changes.
CREATE POLICY campaign_invitations_revoke ON public.campaign_draft_invitations FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND status = 'pending'
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_draft_invitations.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin', 'member')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND status = 'revoked' AND responded_at IS NOT NULL);
--> statement-breakpoint
-- Policies for the definer's owner role (whichever role owns the function: the migration runner here, another on Neon). The app role never matches.
CREATE POLICY campaign_invitations_definer ON public.campaign_draft_invitations TO PUBLIC
  USING (current_user <> 'harvest_app' AND (tenant_id = nullif(current_setting('app.campaign_invite_tenant', true), '')::uuid
    OR token_hash = nullif(current_setting('app.campaign_invite_token', true), '')))
  WITH CHECK (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.campaign_invite_tenant', true), '')::uuid);
CREATE POLICY campaign_invitations_definer_drafts ON public.campaign_drafts FOR SELECT TO PUBLIC
  USING (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.campaign_invite_tenant', true), '')::uuid);
CREATE POLICY campaign_invitations_definer_assignments ON public.campaign_draft_assignments FOR ALL TO PUBLIC
  USING (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.campaign_invite_tenant', true), '')::uuid)
  WITH CHECK (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.campaign_invite_tenant', true), '')::uuid);
CREATE POLICY campaign_invitations_definer_members ON public.workspace_members FOR SELECT TO PUBLIC
  USING (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.campaign_invite_tenant', true), '')::uuid);
CREATE POLICY campaign_invitations_definer_join ON public.workspace_members FOR INSERT TO PUBLIC
  WITH CHECK (current_user <> 'harvest_app' AND role_id = 'campaign_guest' AND tenant_id = nullif(current_setting('app.campaign_invite_tenant', true), '')::uuid);
CREATE POLICY campaign_invitations_definer_audit ON public.audit_logs FOR INSERT TO PUBLIC
  WITH CHECK (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.campaign_invite_tenant', true), '')::uuid);
--> statement-breakpoint
CREATE FUNCTION public.campaign_invitation_accept(p_token_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); actor_email text; inv public.campaign_draft_invitations; draft public.campaign_drafts;
  previous_token text := coalesce(current_setting('app.campaign_invite_token', true), ''); previous_tenant text := coalesce(current_setting('app.campaign_invite_tenant', true), '');
  joined boolean := false; result jsonb;
BEGIN
  IF actor IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN '{"outcome":"not_found"}'::jsonb; END IF;
  SELECT lower(btrim(u.email)) INTO actor_email FROM public.users u WHERE u.id = actor;
  PERFORM set_config('app.campaign_invite_token', p_token_hash, true);
  SELECT * INTO inv FROM public.campaign_draft_invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM set_config('app.campaign_invite_token', previous_token, true);
    RETURN '{"outcome":"not_found"}'::jsonb;
  END IF;
  PERFORM set_config('app.campaign_invite_tenant', inv.tenant_id::text, true);
  -- The link works for the one account it was made for; anyone else learns nothing about it.
  IF (inv.kind = 'member' AND inv.user_id IS DISTINCT FROM actor) OR (inv.kind = 'email' AND inv.email IS DISTINCT FROM actor_email) THEN
    result := '{"outcome":"not_found"}'::jsonb;
  ELSIF inv.status = 'accepted' THEN
    result := jsonb_build_object('outcome', 'ok', 'data', jsonb_build_object('tenantId', inv.tenant_id, 'draftId', inv.draft_id, 'department', inv.department, 'role', inv.role, 'joined', false));
  ELSIF inv.status <> 'pending' THEN
    result := '{"outcome":"closed"}'::jsonb;
  ELSIF inv.expires_at <= clock_timestamp() THEN
    result := '{"outcome":"expired"}'::jsonb;
  ELSE
    SELECT * INTO draft FROM public.campaign_drafts d WHERE d.tenant_id = inv.tenant_id AND d.id = inv.draft_id FOR SHARE;
    IF NOT FOUND OR draft.status = 'discarded' OR NOT (inv.department = ANY (draft.departments)) THEN
      result := '{"outcome":"closed"}'::jsonb;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = inv.tenant_id AND m.user_id = actor) THEN
        INSERT INTO public.workspace_members (tenant_id, user_id, role_id) VALUES (inv.tenant_id, actor, 'campaign_guest');
        joined := true;
      END IF;
      INSERT INTO public.campaign_draft_assignments (tenant_id, draft_id, user_id, department, role)
        VALUES (inv.tenant_id, inv.draft_id, actor, inv.department, inv.role) ON CONFLICT DO NOTHING;
      UPDATE public.campaign_draft_invitations SET status = 'accepted', responded_at = clock_timestamp(), accepted_by = actor WHERE tenant_id = inv.tenant_id AND id = inv.id;
      INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
        VALUES (inv.tenant_id, actor, 'campaign.invitation.accept', inv.draft_id::text, jsonb_build_object('department', inv.department, 'role', inv.role, 'joined', joined::text));
      result := jsonb_build_object('outcome', 'ok', 'data', jsonb_build_object('tenantId', inv.tenant_id, 'draftId', inv.draft_id, 'department', inv.department, 'role', inv.role, 'joined', joined));
    END IF;
  END IF;
  PERFORM set_config('app.campaign_invite_token', previous_token, true);
  PERFORM set_config('app.campaign_invite_tenant', previous_tenant, true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.campaign_invitation_accept(text) FROM PUBLIC, harvest_app;
GRANT EXECUTE ON FUNCTION public.campaign_invitation_accept(text) TO harvest_app;
