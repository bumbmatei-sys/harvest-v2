CREATE TABLE "community_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"questions_version" integer NOT NULL,
	"rules_version" integer NOT NULL,
	"adult_confirmed_at" timestamp with time zone NOT NULL,
	"info_request" text,
	"reviewer_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_application_status" CHECK ("community_applications"."status" in ('pending', 'info_requested', 'approved', 'declined', 'withdrawn')),
	CONSTRAINT "community_application_answers" CHECK (jsonb_typeof("community_applications"."answers") = 'object'),
	CONSTRAINT "community_application_info" CHECK ("community_applications"."info_request" is null or length("community_applications"."info_request") between 1 and 500),
	CONSTRAINT "community_application_note" CHECK ("community_applications"."reviewer_note" is null or length("community_applications"."reviewer_note") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "communities" DROP CONSTRAINT "community_rules";--> statement-breakpoint
ALTER TABLE "entitlements" DROP CONSTRAINT "entitlement_source";--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "rules_list" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "join_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "questions_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "join_answers" jsonb;--> statement-breakpoint
ALTER TABLE "community_applications" ADD CONSTRAINT "community_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_applications" ADD CONSTRAINT "community_applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_applications" ADD CONSTRAINT "community_applications_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_applications_open_idx" ON "community_applications" USING btree ("community_id","user_id") WHERE "community_applications"."status" in ('pending', 'info_requested');--> statement-breakpoint
CREATE INDEX "community_applications_queue_idx" ON "community_applications" USING btree ("tenant_id","community_id","status","created_at");--> statement-breakpoint
-- Carry existing free-text rules into the new list before the column goes. The owner obeys FORCE RLS, so a policy
-- that lives only inside this migration's transaction lets the copy see every row.
DO $$ BEGIN
  EXECUTE format('CREATE POLICY community_migration_0037 ON public.communities TO %I USING (true) WITH CHECK (true)', current_user);
END $$;--> statement-breakpoint
UPDATE "communities" SET "rules_list" = ARRAY["rules"] WHERE "rules" IS NOT NULL;--> statement-breakpoint
DROP POLICY community_migration_0037 ON public.communities;--> statement-breakpoint
ALTER TABLE "communities" DROP COLUMN "rules";--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_rules_list" CHECK (cardinality("communities"."rules_list") <= 20);--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_join_questions" CHECK (jsonb_typeof("communities"."join_questions") = 'array' and jsonb_array_length("communities"."join_questions") <= 10);--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_questions_version" CHECK ("communities"."questions_version" >= 0);--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlement_source" CHECK ("entitlements"."source" in ('community_free_join', 'admin_grant', 'invitation', 'application', 'product_purchase', 'bundle', 'subscription'));--> statement-breakpoint
-- PR 4a: applications are a staff-only tenant table. Applicants act only through the definers below.
ALTER TABLE public.community_applications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.community_applications FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.community_applications FROM PUBLIC, harvest_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.community_applications TO harvest_app;--> statement-breakpoint
CREATE POLICY community_applications_staff ON public.community_applications TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Owner-only policies keyed on settings the definers set and clear (0036 pattern).
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.community_applications TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid
      OR user_id = nullif(current_setting('app.community_resolve_user', true), ''))
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  -- No command restriction: Postgres requires a DELETE's rows to be visible to SELECT as well.
  EXECUTE format($p$CREATE POLICY community_definer_purge ON public.community_applications TO %I
    USING (current_setting('app.community_purge', true) = 'on' AND status IN ('declined', 'withdrawn'))$p$, current_user);
END $$;--> statement-breakpoint
-- harvest_app has no DELETE: staff never delete applications; only the purge definer (owner) does.
CREATE OR REPLACE FUNCTION public.community_definer_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT set_config(name, '', true) FROM unnest(ARRAY['app.community_resolve_slug','app.community_definer_tenant','app.community_resolve_ids',
    'app.community_resolve_invite','app.community_resolve_email','app.discover_read','app.community_resolve_user','app.community_purge']) AS name;
$$;--> statement-breakpoint
-- Backstop for src/lib/questions.ts validateAnswers: same limits, applied to the answers the server already cleaned.
CREATE FUNCTION public.community_answers_valid(p_questions jsonb, p_answers jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE q jsonb; v jsonb; t text; required boolean; max_length integer;
BEGIN
  IF jsonb_typeof(p_answers) IS DISTINCT FROM 'object' OR jsonb_typeof(p_questions) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_answers) k
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_questions) x WHERE x->>'id' = k)) THEN RETURN false; END IF;
  FOR q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    v := p_answers -> (q->>'id'); required := coalesce((q->>'required')::boolean, false);
    IF v IS NULL THEN IF required THEN RETURN false; END IF; CONTINUE; END IF;
    IF q->>'type' = 'checkboxes' THEN
      IF jsonb_typeof(v) <> 'array' OR (required AND jsonb_array_length(v) = 0) THEN RETURN false; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e) <> 'string' OR NOT (q->'options') ? (e #>> '{}')) THEN RETURN false; END IF;
      IF (SELECT count(*) <> count(DISTINCT e) FROM jsonb_array_elements_text(v) e) THEN RETURN false; END IF;
    ELSE
      IF jsonb_typeof(v) <> 'string' THEN RETURN false; END IF;
      t := v #>> '{}';
      IF btrim(t) = '' THEN RETURN false; END IF;
      IF q->>'type' = 'choice' AND NOT (q->'options') ? t THEN RETURN false; END IF;
      -- Computed first: PL/pgSQL ends an IF condition at the first THEN, including one inside CASE.
      max_length := CASE WHEN q->>'type' = 'paragraph' THEN 2000 ELSE 200 END;
      IF length(t) > max_length THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN true;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_public(p_slug text, p_invite_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c record; host text; invited boolean := false;
BEGIN
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT * INTO c FROM public.communities WHERE communities.slug = p_slug AND communities.status = 'published';
  IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN NULL; END IF;
  IF p_invite_hash IS NOT NULL THEN
    PERFORM set_config('app.community_resolve_invite', p_invite_hash, true);
    invited := EXISTS (SELECT 1 FROM public.community_invites i WHERE i.token_hash = p_invite_hash AND i.community_id = c.id AND i.tenant_id = c.tenant_id
      AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now());
  END IF;
  IF c.visibility = 'hidden' AND NOT invited THEN PERFORM public.community_definer_reset(); RETURN NULL; END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  SELECT w.name INTO host FROM public.workspaces w WHERE w.tenant_id = c.tenant_id;
  PERFORM public.community_definer_reset();
  RETURN jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'tagline', c.tagline, 'description', c.description, 'hostName', host,
    'pricing', c.pricing, 'visibility', c.visibility, 'allowOpen', c.allow_open, 'allowApply', c.allow_apply, 'allowInvite', c.allow_invite,
    'rulesList', to_jsonb(c.rules_list), 'rulesVersion', c.rules_version, 'joinQuestions', c.join_questions, 'questionsVersion', c.questions_version,
    'invited', invited);
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_my_invites() RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); mine text; ids text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  SELECT encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex') INTO mine FROM public.users u WHERE u.id = actor AND u.email_verified;
  IF mine IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.community_resolve_email', mine, true);
  SELECT string_agg(i.community_id::text, ',') INTO ids FROM public.community_invites i
    WHERE i.email_hash = mine AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now();
  PERFORM set_config('app.community_resolve_ids', coalesce(ids, ''), true);
  RETURN QUERY SELECT jsonb_build_object('inviteId', i.id, 'slug', c.slug, 'name', c.name, 'expiresAt', i.expires_at,
      'rulesList', to_jsonb(c.rules_list), 'rulesVersion', c.rules_version, 'joinQuestions', c.join_questions, 'questionsVersion', c.questions_version)
    FROM public.community_invites i JOIN public.communities c ON c.tenant_id = i.tenant_id AND c.id = i.community_id
    WHERE i.email_hash = mine AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() AND c.status = 'published'
    ORDER BY i.expires_at;
  PERFORM public.community_definer_reset();
END $$;--> statement-breakpoint
DROP FUNCTION public.community_enter(text, integer, boolean, text, uuid);--> statement-breakpoint
-- Join (open), apply (approval) or redeem an invitation. Every 0036 rule stands; answers to the current questions are
-- validated, and when approval is on a request becomes an application instead of a membership. Invitations skip the queue.
CREATE FUNCTION public.community_enter(p_slug text, p_rules_version integer, p_questions_version integer, p_answers jsonb, p_adult boolean,
  p_invite_hash text, p_invite_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); c record; m record; inv record; mine text; via_invite boolean;
  had_membership boolean; inviter text; invite_id uuid; answers jsonb := coalesce(p_answers, '{}'::jsonb);
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  via_invite := p_invite_hash IS NOT NULL OR p_invite_id IS NOT NULL;
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT * INTO c FROM public.communities WHERE communities.slug = p_slug AND communities.status = 'published';
  -- With an invitation, a missing community answers exactly like a bad invitation (review B1 on #59).
  IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN CASE WHEN via_invite THEN 'invite_invalid' ELSE 'not_found' END; END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  IF via_invite THEN
    SELECT encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex') INTO mine FROM public.users u WHERE u.id = actor AND u.email_verified;
    SELECT * INTO inv FROM public.community_invites i WHERE i.tenant_id = c.tenant_id AND i.community_id = c.id
      AND (i.token_hash = p_invite_hash OR i.id = p_invite_id) AND i.email_hash = mine
      AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() FOR UPDATE;
    IF NOT FOUND OR NOT c.allow_invite THEN PERFORM public.community_definer_reset(); RETURN 'invite_invalid'; END IF;
    inviter := inv.created_by; invite_id := inv.id;
  ELSE
    IF c.visibility = 'hidden' THEN PERFORM public.community_definer_reset(); RETURN 'not_found'; END IF;
    IF NOT (c.allow_open OR c.allow_apply) THEN PERFORM public.community_definer_reset(); RETURN 'not_allowed'; END IF;
  END IF;
  -- Free access only until the Commerce gate (C17).
  IF c.pricing <> 'free' THEN PERFORM public.community_definer_reset(); RETURN 'not_allowed'; END IF;
  IF NOT coalesce(p_adult, false) THEN PERFORM public.community_definer_reset(); RETURN 'adult_required'; END IF;
  IF p_rules_version IS DISTINCT FROM c.rules_version THEN PERFORM public.community_definer_reset(); RETURN 'rules_changed'; END IF;
  IF p_questions_version IS DISTINCT FROM c.questions_version THEN PERFORM public.community_definer_reset(); RETURN 'questions_changed'; END IF;
  IF NOT public.community_answers_valid(c.join_questions, answers) THEN PERFORM public.community_definer_reset(); RETURN 'answers_invalid'; END IF;
  SELECT * INTO m FROM public.community_memberships WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor FOR UPDATE;
  had_membership := FOUND;
  IF had_membership AND m.status = 'banned' THEN PERFORM public.community_definer_reset(); RETURN 'banned'; END IF;
  IF had_membership AND m.status = 'active' THEN
    IF via_invite THEN UPDATE public.community_invites SET redeemed_at = now(), redeemed_by = actor WHERE id = invite_id; END IF;
    PERFORM public.community_definer_reset(); RETURN 'already_member';
  END IF;
  -- Approval required (apply is on and the request is not an invitation): record an application, not a membership.
  IF NOT via_invite AND c.allow_apply THEN
    INSERT INTO public.community_applications (tenant_id, community_id, user_id, status, answers, questions_version, rules_version, adult_confirmed_at)
      VALUES (c.tenant_id, c.id, actor, 'pending', answers, c.questions_version, c.rules_version, now())
      ON CONFLICT (community_id, user_id) WHERE status IN ('pending', 'info_requested') DO NOTHING;
    IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN 'already_applied'; END IF;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (c.tenant_id, actor, 'community.apply', c.id::text);
    PERFORM public.community_definer_reset();
    RETURN 'applied';
  END IF;
  IF via_invite THEN UPDATE public.community_invites SET redeemed_at = now(), redeemed_by = actor WHERE id = invite_id; END IF;
  IF NOT had_membership THEN
    INSERT INTO public.community_memberships (tenant_id, community_id, user_id, role, status, joined_at, rules_version_accepted, adult_confirmed_at, join_answers)
      VALUES (c.tenant_id, c.id, actor, 'member', 'active', now(), c.rules_version, now(), answers)
      ON CONFLICT (tenant_id, community_id, user_id) DO NOTHING;
    IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN 'already_member'; END IF;
  ELSE
    -- Re-entry never restores a staff role (ADR 0013 §4a).
    UPDATE public.community_memberships SET status = 'active', role = 'member', joined_at = now(), updated_at = now(),
      rules_version_accepted = c.rules_version, adult_confirmed_at = now(), join_answers = answers
      WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor;
  END IF;
  INSERT INTO public.entitlements (tenant_id, user_id, resource_type, resource_id, source, granted_by)
    VALUES (c.tenant_id, actor, 'community', c.id, CASE WHEN via_invite THEN 'invitation' ELSE 'community_free_join' END, inviter);
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id)
    VALUES (c.tenant_id, actor, CASE WHEN via_invite THEN 'community.invite_redeem' ELSE 'community.join' END, c.id::text);
  PERFORM public.community_definer_reset();
  RETURN 'joined';
END $$;--> statement-breakpoint
-- The caller's own applications. Reviewer notes are never returned.
CREATE FUNCTION public.community_my_applications() RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); ids text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.community_resolve_user', actor, true);
  SELECT string_agg(a.community_id::text, ',') INTO ids FROM public.community_applications a
    WHERE a.user_id = actor AND a.status IN ('pending', 'info_requested', 'declined');
  PERFORM set_config('app.community_resolve_ids', coalesce(ids, ''), true);
  RETURN QUERY SELECT jsonb_build_object('id', a.id, 'slug', c.slug, 'name', c.name, 'status', a.status, 'infoRequest', a.info_request,
      'answers', a.answers, 'questionsVersion', a.questions_version, 'joinQuestions', c.join_questions, 'currentQuestionsVersion', c.questions_version,
      'updatedAt', a.updated_at)
    FROM public.community_applications a JOIN public.communities c ON c.tenant_id = a.tenant_id AND c.id = a.community_id
    WHERE a.user_id = actor AND a.status IN ('pending', 'info_requested', 'declined')
    ORDER BY a.updated_at DESC;
  PERFORM public.community_definer_reset();
END $$;--> statement-breakpoint
-- The applicant withdraws, or resubmits answers after the community asked for more information.
CREATE FUNCTION public.community_application_update(p_id uuid, p_action text, p_answers jsonb, p_questions_version integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); a record; c record;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.community_resolve_user', actor, true);
  SELECT * INTO a FROM public.community_applications WHERE id = p_id AND user_id = actor FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN 'not_found'; END IF;
  PERFORM set_config('app.community_definer_tenant', a.tenant_id::text, true);
  IF p_action = 'withdraw' THEN
    IF a.status NOT IN ('pending', 'info_requested') THEN PERFORM public.community_definer_reset(); RETURN 'invalid_state'; END IF;
    UPDATE public.community_applications SET status = 'withdrawn', decided_at = now(), updated_at = now() WHERE id = a.id;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (a.tenant_id, actor, 'community.application_withdraw', a.community_id::text);
  ELSIF p_action = 'resubmit' THEN
    IF a.status <> 'info_requested' THEN PERFORM public.community_definer_reset(); RETURN 'invalid_state'; END IF;
    SELECT * INTO c FROM public.communities WHERE tenant_id = a.tenant_id AND id = a.community_id;
    IF p_questions_version IS DISTINCT FROM c.questions_version THEN PERFORM public.community_definer_reset(); RETURN 'questions_changed'; END IF;
    IF NOT public.community_answers_valid(c.join_questions, coalesce(p_answers, '{}'::jsonb)) THEN PERFORM public.community_definer_reset(); RETURN 'answers_invalid'; END IF;
    UPDATE public.community_applications SET status = 'pending', answers = coalesce(p_answers, '{}'::jsonb), questions_version = c.questions_version,
      info_request = NULL, updated_at = now() WHERE id = a.id;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (a.tenant_id, actor, 'community.application_resubmit', a.community_id::text);
  ELSE
    PERFORM public.community_definer_reset(); RETURN 'invalid_action';
  END IF;
  PERFORM public.community_definer_reset();
  RETURN 'updated';
END $$;--> statement-breakpoint
-- Retention (founder, 11 Nov): declined and withdrawn applications are deleted 90 days after the decision.
CREATE FUNCTION public.community_purge_applications() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE removed integer;
BEGIN
  PERFORM set_config('app.community_purge', 'on', true);
  DELETE FROM public.community_applications WHERE status IN ('declined', 'withdrawn') AND decided_at < now() - interval '90 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM public.community_definer_reset();
  RETURN removed;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_answers_valid(jsonb, jsonb), public.community_enter(text, integer, integer, jsonb, boolean, text, uuid),
  public.community_my_applications(), public.community_application_update(uuid, text, jsonb, integer), public.community_purge_applications() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_enter(text, integer, integer, jsonb, boolean, text, uuid), public.community_my_applications(),
  public.community_application_update(uuid, text, jsonb, integer), public.community_purge_applications() TO harvest_app;
