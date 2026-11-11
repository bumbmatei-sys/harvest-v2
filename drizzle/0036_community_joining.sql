CREATE TABLE "community_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"email_hint" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "community_invite_hashes" CHECK ("community_invites"."email_hash" ~ '^[a-f0-9]{64}$' and "community_invites"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "community_invite_hint" CHECK (length("community_invites"."email_hint") between 3 and 320)
);
--> statement-breakpoint
CREATE TABLE "discover_listings" (
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"host_name" text NOT NULL,
	"pricing" text NOT NULL,
	"admission" text[] NOT NULL,
	"search_text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discover_listings_resource_type_resource_id_pk" PRIMARY KEY("resource_type","resource_id"),
	CONSTRAINT "discover_resource_type" CHECK ("discover_listings"."resource_type" in ('community'))
);
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "rules" text;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "rules_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "discover_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "rules_version_accepted" integer;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD COLUMN "adult_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_invites" ADD CONSTRAINT "community_invites_tenant_id_community_id_communities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discover_listings" ADD CONSTRAINT "discover_listings_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_invites_open_idx" ON "community_invites" USING btree ("community_id","email_hash") WHERE "community_invites"."redeemed_at" is null and "community_invites"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "community_invites_email_idx" ON "community_invites" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "discover_listings_order_idx" ON "discover_listings" USING btree ("resource_type","updated_at","resource_id");--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_description" CHECK ("communities"."description" is null or length("communities"."description") between 1 and 2000);--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_rules" CHECK ("communities"."rules" is null or length("communities"."rules") between 1 and 5000);--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_rules_version" CHECK ("communities"."rules_version" >= 0);
--> statement-breakpoint
-- PR 3: invites and the Discover projection are staff-only tenant tables. Members and visitors reach them only
-- through the definers below. Invites are revoked or redeemed, never deleted; listings are deleted when they stop qualifying.
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['community_invites','discover_listings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', relation_name);
  EXECUTE format($p$CREATE POLICY %I ON public.%I TO harvest_app
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, relation_name || '_staff', relation_name);
 END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.community_invites TO harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discover_listings TO harvest_app;
--> statement-breakpoint
-- The migration role owns the definers and obeys FORCE RLS without BYPASSRLS (HC-03 pattern). It gets only
-- policies keyed on settings the definers set and clear themselves; no harvest_app policy reads them.
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY community_definer_read ON public.communities FOR SELECT TO %I USING (
      slug = nullif(current_setting('app.community_resolve_slug', true), '')
      OR tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid
      OR id::text = ANY (string_to_array(nullif(current_setting('app.community_resolve_ids', true), ''), ',')))$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.community_memberships TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.entitlements TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.community_invites TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid
      OR token_hash = nullif(current_setting('app.community_resolve_invite', true), '')
      OR email_hash = nullif(current_setting('app.community_resolve_email', true), ''))
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_audit ON public.audit_logs FOR INSERT TO %I
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_host ON public.workspaces FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY discover_definer_read ON public.discover_listings FOR SELECT TO %I
    USING (current_setting('app.discover_read', true) = 'on')$p$, current_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.community_definer_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT set_config(name, '', true) FROM unnest(ARRAY['app.community_resolve_slug','app.community_definer_tenant','app.community_resolve_ids',
    'app.community_resolve_invite','app.community_resolve_email','app.discover_read']) AS name;
$$;
--> statement-breakpoint
-- Public page data. Draft/archived communities and hidden ones without a valid invite return null.
CREATE FUNCTION public.community_public(p_slug text, p_invite_hash text) RETURNS jsonb
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
    'rules', c.rules, 'rulesVersion', c.rules_version, 'invited', invited);
END $$;
--> statement-breakpoint
-- Join (open) or redeem (invite by token hash or by id). Returns an outcome; never raises on a business refusal.
CREATE FUNCTION public.community_enter(p_slug text, p_rules_version integer, p_adult boolean, p_invite_hash text, p_invite_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); c record; m record; inv record; mine text; via_invite boolean; had_membership boolean; inviter text; invite_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  via_invite := p_invite_hash IS NOT NULL OR p_invite_id IS NOT NULL;
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT * INTO c FROM public.communities WHERE communities.slug = p_slug AND communities.status = 'published';
  IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN 'not_found'; END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  IF via_invite THEN
    SELECT encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex') INTO mine FROM public.users u WHERE u.id = actor AND u.email_verified;
    SELECT * INTO inv FROM public.community_invites i WHERE i.tenant_id = c.tenant_id AND i.community_id = c.id
      AND (i.token_hash = p_invite_hash OR i.id = p_invite_id) AND i.email_hash = mine
      AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() FOR UPDATE;
    IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN 'invite_invalid'; END IF;
    inviter := inv.created_by; invite_id := inv.id;
  ELSE
    IF c.visibility = 'hidden' THEN PERFORM public.community_definer_reset(); RETURN 'not_found'; END IF;
    IF NOT c.allow_open THEN PERFORM public.community_definer_reset(); RETURN 'not_allowed'; END IF;
  END IF;
  IF NOT coalesce(p_adult, false) THEN PERFORM public.community_definer_reset(); RETURN 'adult_required'; END IF;
  IF p_rules_version IS DISTINCT FROM c.rules_version THEN PERFORM public.community_definer_reset(); RETURN 'rules_changed'; END IF;
  SELECT * INTO m FROM public.community_memberships WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor FOR UPDATE;
  had_membership := FOUND; -- captured now: FOUND changes after the next UPDATE
  IF had_membership AND m.status = 'banned' THEN PERFORM public.community_definer_reset(); RETURN 'banned'; END IF;
  IF via_invite THEN UPDATE public.community_invites SET redeemed_at = now(), redeemed_by = actor WHERE id = invite_id; END IF;
  IF had_membership AND m.status = 'active' THEN PERFORM public.community_definer_reset(); RETURN 'already_member'; END IF;
  IF NOT had_membership THEN
    INSERT INTO public.community_memberships (tenant_id, community_id, user_id, role, status, joined_at, rules_version_accepted, adult_confirmed_at)
      VALUES (c.tenant_id, c.id, actor, 'member', 'active', now(), c.rules_version, now());
  ELSE
    -- Re-entry never restores a staff role (ADR 0013 §4a).
    UPDATE public.community_memberships SET status = 'active', role = 'member', joined_at = now(), updated_at = now(),
      rules_version_accepted = c.rules_version, adult_confirmed_at = now()
      WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor;
  END IF;
  INSERT INTO public.entitlements (tenant_id, user_id, resource_type, resource_id, source, granted_by)
    VALUES (c.tenant_id, actor, 'community', c.id, CASE WHEN via_invite THEN 'invitation' ELSE 'community_free_join' END,
      inviter);
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id)
    VALUES (c.tenant_id, actor, CASE WHEN via_invite THEN 'community.invite_redeem' ELSE 'community.join' END, c.id::text);
  PERFORM public.community_definer_reset();
  RETURN 'joined';
END $$;
--> statement-breakpoint
CREATE FUNCTION public.discover_communities(p_query text, p_open_only boolean, p_after timestamptz, p_after_id uuid, p_limit integer) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.discover_read', 'on', true);
  RETURN QUERY SELECT jsonb_build_object('id', d.resource_id, 'slug', d.slug, 'name', d.name, 'tagline', d.tagline, 'hostName', d.host_name,
      'pricing', d.pricing, 'admission', to_jsonb(d.admission), 'updatedAt', d.updated_at)
    FROM public.discover_listings d
    WHERE d.resource_type = 'community'
      AND (coalesce(p_query, '') = '' OR d.search_text LIKE '%' || replace(replace(replace(lower(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
      AND (NOT coalesce(p_open_only, false) OR 'open' = ANY (d.admission))
      AND (p_after IS NULL OR (d.updated_at, d.resource_id) < (p_after, p_after_id))
    ORDER BY d.updated_at DESC, d.resource_id DESC
    LIMIT least(greatest(coalesce(p_limit, 24), 1), 48);
  PERFORM public.community_definer_reset();
END $$;
--> statement-breakpoint
CREATE FUNCTION public.community_my_invites() RETURNS SETOF jsonb
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
  RETURN QUERY SELECT jsonb_build_object('inviteId', i.id, 'slug', c.slug, 'name', c.name, 'expiresAt', i.expires_at)
    FROM public.community_invites i JOIN public.communities c ON c.tenant_id = i.tenant_id AND c.id = i.community_id
    WHERE i.email_hash = mine AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() AND c.status = 'published'
    ORDER BY i.expires_at;
  PERFORM public.community_definer_reset();
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_definer_reset(), public.community_public(text, text), public.community_enter(text, integer, boolean, text, uuid),
  public.discover_communities(text, boolean, timestamptz, uuid, integer), public.community_my_invites() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_public(text, text), public.community_enter(text, integer, boolean, text, uuid),
  public.discover_communities(text, boolean, timestamptz, uuid, integer), public.community_my_invites() TO harvest_app;
