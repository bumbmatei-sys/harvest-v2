CREATE TABLE "campaign_response_link_codes" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "campaign_response_link_codes_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "campaign_response_link_code_kind" CHECK (("campaign_response_link_codes"."kind" = 'qr' and "campaign_response_link_codes"."code" ~ '^[a-f0-9]{32}$') or ("campaign_response_link_codes"."kind" = 'short' and "campaign_response_link_codes"."code" ~ '^[0-9A-HJKMNP-TV-Z]{12}$')),
	CONSTRAINT "campaign_response_link_code_retired" CHECK ("campaign_response_link_codes"."retired_at" is null or "campaign_response_link_codes"."retired_at" >= "campaign_response_link_codes"."issued_at")
);
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD COLUMN "short_code" text;
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD COLUMN "label" text;
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD COLUMN "public_title" text;
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD COLUMN "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD COLUMN "published_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD COLUMN "published_by" text;
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD COLUMN "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD COLUMN "code_generation" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD COLUMN "rotated_at" timestamp with time zone;
--> statement-breakpoint
-- HC-03 (Harvest Connect: campaign QR/short-URL admin and lifecycle). The DDL above and the
-- constraints below are generated from src/db/schema.ts; everything else is hand-written and
-- chained onto 0026. Contract: docs/acceptance/hc-03.md. 0026 is not edited.

-- 1) Code generators. Codes come from the database's strong random source (gen_random_uuid uses
-- pg_strong_random): 32 hex = 128 bits for the QR code, 12 Crockford base32 = 60 bits for the
-- short code. Only the random nibbles of each UUID are used (version and variant are dropped).
CREATE FUNCTION public.connect_random_hex(p_length integer) RETURNS text
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  SELECT left(string_agg(substr(u, 1, 12) || substr(u, 14, 3) || substr(u, 18, 15), ''), p_length)
  FROM (SELECT replace(gen_random_uuid()::text, '-', '') AS u FROM generate_series(1, (p_length + 29) / 30)) AS s
$$;
CREATE FUNCTION public.connect_short_code() RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE value bigint := ('x' || lpad(public.connect_random_hex(15), 16, '0'))::bit(64)::bigint;
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; result text := '';
BEGIN
  FOR i IN REVERSE 11..0 LOOP result := result || substr(alphabet, ((value >> (5 * i)) & 31)::integer + 1, 1); END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.connect_random_hex(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.connect_short_code() FROM PUBLIC;
-- The insert guard runs with the inserting role's rights.
GRANT EXECUTE ON FUNCTION public.connect_random_hex(integer) TO harvest_app;
GRANT EXECUTE ON FUNCTION public.connect_short_code() TO harvest_app;

--> statement-breakpoint
-- 2) Backfill links created under 0026 (FORCE RLS applies to the table owner, so a temporary
-- owner-only policy is used and dropped, as in 0008): a short code, lifecycle times and the
-- registry rows for both current codes.
DO $$ BEGIN
  EXECUTE format('CREATE POLICY hc03_backfill ON public.campaign_response_links TO %I USING (true) WITH CHECK (true)', current_user);
END $$;
UPDATE public.campaign_response_links SET short_code = public.connect_short_code(),
  published_at = CASE WHEN status IN ('published', 'disabled') THEN updated_at END,
  archived_at = CASE WHEN status = 'archived' THEN updated_at END;
INSERT INTO public.campaign_response_link_codes (tenant_id, link_id, kind, code, issued_at, retired_at)
  SELECT tenant_id, id, 'qr', public_code, created_at, CASE WHEN status = 'archived' THEN updated_at END FROM public.campaign_response_links
  UNION ALL
  SELECT tenant_id, id, 'short', short_code, created_at, CASE WHEN status = 'archived' THEN updated_at END FROM public.campaign_response_links;
DROP POLICY hc03_backfill ON public.campaign_response_links;
ALTER TABLE public.campaign_response_links ALTER COLUMN short_code SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaign_response_link_codes" ADD CONSTRAINT "campaign_response_link_codes_tenant_id_link_id_campaign_response_links_tenant_id_id_fk" FOREIGN KEY ("tenant_id","link_id") REFERENCES "public"."campaign_response_links"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_response_link_codes_code_idx" ON "campaign_response_link_codes" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "campaign_response_link_codes_link_idx" ON "campaign_response_link_codes" USING btree ("tenant_id","link_id","issued_at");
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD CONSTRAINT "campaign_response_links_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_response_links_short_code_idx" ON "campaign_response_links" USING btree ("short_code");
--> statement-breakpoint
CREATE INDEX "campaign_response_links_campaign_idx" ON "campaign_response_links" USING btree ("tenant_id","campaign_id","created_at");
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD CONSTRAINT "campaign_response_link_short_code" CHECK ("campaign_response_links"."short_code" ~ '^[0-9A-HJKMNP-TV-Z]{12}$');
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD CONSTRAINT "campaign_response_link_label" CHECK ("campaign_response_links"."label" is null or (length(btrim("campaign_response_links"."label")) between 1 and 80 and "campaign_response_links"."label" = btrim("campaign_response_links"."label")));
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD CONSTRAINT "campaign_response_link_title" CHECK ("campaign_response_links"."public_title" is null or (length(btrim("campaign_response_links"."public_title")) between 1 and 120 and "campaign_response_links"."public_title" = btrim("campaign_response_links"."public_title")));
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD CONSTRAINT "campaign_response_link_generation" CHECK ("campaign_response_links"."code_generation" >= 1);
--> statement-breakpoint
ALTER TABLE "campaign_response_links" ADD CONSTRAINT "campaign_response_link_lifecycle" CHECK (("campaign_response_links"."status" = 'draft' and "campaign_response_links"."published_at" is null and "campaign_response_links"."published_by" is null and "campaign_response_links"."archived_at" is null)
    or ("campaign_response_links"."status" in ('published', 'disabled') and "campaign_response_links"."published_at" is not null and "campaign_response_links"."archived_at" is null)
    or ("campaign_response_links"."status" = 'archived' and "campaign_response_links"."archived_at" is not null));
--> statement-breakpoint
-- 3) Row-level security. The registry is FORCE RLS; members read their workspace's history and
-- nothing writes it except the link definers. harvest_app's link grants are unchanged (SELECT,
-- INSERT draft-only from 0026): publishing, disabling, rotation and archiving have no table grant.
ALTER TABLE campaign_response_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_response_link_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY campaign_response_link_codes_read ON campaign_response_link_codes FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_response_link_codes.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')));
GRANT SELECT ON campaign_response_link_codes TO harvest_app;

-- The migration role owns the link definers and obeys FORCE RLS without BYPASSRLS. It gets only
-- tenant-scoped policies for the lifecycle definer and code-scoped ones for the public resolver:
-- app.connect_resolve_code / app.connect_resolve_tenant are set (and cleared) only inside
-- resolve_connect_link, and no harvest_app policy reads them.
DO $$ BEGIN
  EXECUTE format($policy$CREATE POLICY connect_link_definer ON public.campaign_response_links TO %I
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, current_user);
  EXECUTE format($policy$CREATE POLICY connect_link_resolve ON public.campaign_response_links FOR SELECT TO %I
    USING (public_code = nullif(current_setting('app.connect_resolve_code', true), '')
      OR short_code = nullif(current_setting('app.connect_resolve_code', true), ''))$policy$, current_user);
  EXECUTE format($policy$CREATE POLICY connect_link_codes_definer ON public.campaign_response_link_codes TO %I
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, current_user);
  EXECUTE format($policy$CREATE POLICY connect_definer_campaign_read ON public.campaigns FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      OR tenant_id = nullif(current_setting('app.connect_resolve_tenant', true), '')::uuid)$policy$, current_user);
  EXECUTE format($policy$CREATE POLICY connect_definer_resolve_read ON public.form_versions FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.connect_resolve_tenant', true), '')::uuid)$policy$, current_user);
END $$;

--> statement-breakpoint
-- 4) Lifecycle definer: owner/admin only, live membership locked, one link at a time.
-- Returns an outcome code; it never raises on an ordinary business refusal.
CREATE FUNCTION public.connect_link_transition(p_tenant uuid, p_link uuid, p_action text, p_expires_at timestamptz, p_expected_code text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); link record; campaign_archived timestamptz; campaign_found boolean;
  version_status text; next_qr text; next_short text; attempt integer := 0;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'link access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'link access denied' USING ERRCODE = '42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('publish', 'disable', 'archive', 'rotate') THEN RETURN 'invalid_action'; END IF;
  SELECT * INTO link FROM public.campaign_response_links WHERE tenant_id = p_tenant AND id = p_link FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF link.status = 'archived' THEN RETURN CASE WHEN p_action = 'archive' THEN 'unchanged' ELSE 'link_archived' END; END IF;
  -- The caller names the code it is looking at; a concurrent rotation makes the request stale.
  IF (p_action = 'rotate' AND p_expected_code IS NULL) OR (p_expected_code IS NOT NULL AND p_expected_code IS DISTINCT FROM link.public_code) THEN
    RETURN 'stale';
  END IF;
  -- Plain reads (no FOR SHARE): the owner's campaign/form policies are read-only, and the resolver
  -- re-checks campaign liveness on every request anyway.
  SELECT archived_at INTO campaign_archived FROM public.campaigns WHERE tenant_id = p_tenant AND id = link.campaign_id;
  campaign_found := FOUND;
  IF p_action = 'publish' THEN
    IF NOT campaign_found OR campaign_archived IS NOT NULL THEN RETURN 'campaign_archived'; END IF;
    IF link.form_version_id IS NOT NULL THEN
      SELECT status INTO version_status FROM public.form_versions WHERE tenant_id = p_tenant AND id = link.form_version_id;
      IF version_status IS DISTINCT FROM 'published' THEN RETURN 'form_not_published'; END IF;
    END IF;
    IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN RETURN 'expiry_in_past'; END IF;
    IF link.status = 'published' AND link.expires_at IS NOT DISTINCT FROM p_expires_at
      AND (link.expires_at IS NULL OR link.expires_at > now()) THEN RETURN 'unchanged'; END IF;
    UPDATE public.campaign_response_links SET status = 'published', expires_at = p_expires_at, published_by = actor
      WHERE tenant_id = p_tenant AND id = p_link;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
      VALUES (p_tenant, actor, 'connect.link.publish', p_link::text, jsonb_build_object('from', link.status));
    RETURN 'published';
  ELSIF p_action = 'disable' THEN
    IF link.status = 'disabled' THEN RETURN 'unchanged'; END IF;
    IF link.status <> 'published' THEN RETURN 'invalid_transition'; END IF;
    UPDATE public.campaign_response_links SET status = 'disabled' WHERE tenant_id = p_tenant AND id = p_link;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (p_tenant, actor, 'connect.link.disable', p_link::text);
    RETURN 'disabled';
  ELSIF p_action = 'archive' THEN
    UPDATE public.campaign_response_links SET status = 'archived' WHERE tenant_id = p_tenant AND id = p_link;
    UPDATE public.campaign_response_link_codes SET retired_at = now() WHERE tenant_id = p_tenant AND link_id = p_link AND retired_at IS NULL;
    INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
      VALUES (p_tenant, actor, 'connect.link.archive', p_link::text, jsonb_build_object('from', link.status));
    RETURN 'archived';
  END IF;
  -- Rotation: new codes are registered first (globally unique, never reissued), then the old
  -- ones retire. The link keeps its status; the old codes stop resolving at commit.
  LOOP
    attempt := attempt + 1;
    next_qr := public.connect_random_hex(32); next_short := public.connect_short_code();
    BEGIN
      INSERT INTO public.campaign_response_link_codes (tenant_id, link_id, kind, code) VALUES
        (p_tenant, p_link, 'qr', next_qr), (p_tenant, p_link, 'short', next_short);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
  UPDATE public.campaign_response_link_codes SET retired_at = now()
    WHERE tenant_id = p_tenant AND link_id = p_link AND retired_at IS NULL AND code IN (link.public_code, link.short_code);
  UPDATE public.campaign_response_links SET public_code = next_qr, short_code = next_short, code_generation = link.code_generation + 1
    WHERE tenant_id = p_tenant AND id = p_link;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'connect.link.rotate', p_link::text, jsonb_build_object('generation', (link.code_generation + 1)::text));
  RETURN 'rotated';
END $$;
REVOKE ALL ON FUNCTION public.connect_link_transition(uuid, uuid, text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_link_transition(uuid, uuid, text, timestamptz, text) TO harvest_app;

-- Registers both codes of a newly inserted draft (definer: harvest_app has no registry write grant).
CREATE FUNCTION public.connect_register_link_codes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.campaign_response_link_codes (tenant_id, link_id, kind, code, issued_at)
    VALUES (NEW.tenant_id, NEW.id, 'qr', NEW.public_code, NEW.created_at), (NEW.tenant_id, NEW.id, 'short', NEW.short_code, NEW.created_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.connect_register_link_codes() FROM PUBLIC;

-- Privileged writers: the owners of the link definers (and so the migration role).
CREATE FUNCTION public.connect_link_writer() RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN current_user IN (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid IN (
    'public.connect_link_transition(uuid,uuid,text,timestamptz,text)'::regprocedure,
    'public.connect_register_link_codes()'::regprocedure));
END $$;

--> statement-breakpoint
-- 5) Public resolver: the only path from an opaque code to anything public. The tenant comes from
-- the code, never the caller. It returns only the allowlisted locale and organizer-entered public
-- title, and only for a published, unexpired link of a non-archived campaign. Unknown, draft,
-- disabled, expired, rotated-away and archived codes all return no row. It writes nothing.
CREATE FUNCTION public.resolve_connect_link(p_kind text, p_code text) RETURNS TABLE (locale text, public_title text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE found_link record; link_found boolean; campaign_live boolean;
BEGIN
  -- coalesce: a NULL kind or code must return early, not fall through as SQL NULL.
  IF NOT coalesce((p_kind = 'qr' AND p_code ~ '^[a-f0-9]{32}$') OR (p_kind = 'short' AND p_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'), false) THEN
    RETURN;
  END IF;
  PERFORM set_config('app.connect_resolve_code', p_code, true);
  SELECT l.tenant_id, l.campaign_id, l.locale, l.public_title INTO found_link FROM public.campaign_response_links l
    WHERE (CASE WHEN p_kind = 'qr' THEN l.public_code = p_code ELSE l.short_code = p_code END)
      AND l.status = 'published' AND (l.expires_at IS NULL OR l.expires_at > now());
  link_found := FOUND;
  PERFORM set_config('app.connect_resolve_code', '', true);
  IF NOT link_found THEN RETURN; END IF;
  PERFORM set_config('app.connect_resolve_tenant', found_link.tenant_id::text, true);
  SELECT c.archived_at IS NULL INTO campaign_live FROM public.campaigns c WHERE c.tenant_id = found_link.tenant_id AND c.id = found_link.campaign_id;
  PERFORM set_config('app.connect_resolve_tenant', '', true);
  IF campaign_live IS NOT TRUE THEN RETURN; END IF;
  locale := found_link.locale; public_title := found_link.public_title;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.resolve_connect_link(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_connect_link(text, text) TO harvest_app;

--> statement-breakpoint
-- 6) Guards. Links: codes and lifecycle fields are server-controlled at insert; afterwards only the
-- link definers change a link, archived is terminal, and publishing re-checks its preconditions
-- even for owner DML. Replaces 0026's guard (identity immutability is kept).
CREATE OR REPLACE FUNCTION public.guard_campaign_response_link() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); version_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'response links are archived, not deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    -- Like the notice hash in 0026: a caller-supplied code is overwritten, never trusted.
    NEW.public_code := public.connect_random_hex(32);
    NEW.short_code := public.connect_short_code();
    NEW.published_at := NULL; NEW.published_by := NULL; NEW.archived_at := NULL; NEW.expires_at := NULL;
    NEW.code_generation := 1; NEW.rotated_at := NULL;
    NEW.created_at := now(); NEW.updated_at := now();
    IF EXISTS (SELECT 1 FROM public.campaigns c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.campaign_id AND c.archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'archived campaigns cannot add response links';
    END IF;
    IF NEW.form_version_id IS NOT NULL THEN
      SELECT v.status INTO version_status FROM public.form_versions v WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.form_version_id;
      IF version_status = 'retired' THEN RAISE EXCEPTION 'retired form versions cannot be attached'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT public.connect_link_writer() THEN
    RAISE EXCEPTION 'response links change only through the link lifecycle';
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.campaign_id, NEW.created_by, NEW.created_at, NEW.form_version_id, NEW.locale, NEW.label, NEW.public_title)
    IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.campaign_id, OLD.created_by, OLD.created_at, OLD.form_version_id, OLD.locale, OLD.label, OLD.public_title) THEN
    RAISE EXCEPTION 'response link identity is immutable';
  END IF;
  IF OLD.status = 'archived' THEN RAISE EXCEPTION 'archived response links are final'; END IF;
  IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN RAISE EXCEPTION 'response links cannot return to draft'; END IF;
  IF NEW.status = 'published' AND (OLD.status <> 'published' OR NEW.expires_at IS DISTINCT FROM OLD.expires_at) THEN
    IF EXISTS (SELECT 1 FROM public.campaigns c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.campaign_id AND c.archived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'archived campaigns cannot publish';
    END IF;
    IF NEW.form_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.form_versions v
        WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.form_version_id AND v.status = 'published') THEN
      RAISE EXCEPTION 'only a published form version can be published';
    END IF;
    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() THEN RAISE EXCEPTION 'expiry must be in the future'; END IF;
  END IF;
  IF NEW.status = 'published' AND OLD.status <> 'published' THEN
    IF OLD.status = 'draft' THEN NEW.published_at := now(); END IF;
    NEW.published_by := coalesce(actor, NEW.published_by);
  END IF;
  IF NEW.status = 'archived' THEN NEW.archived_at := now(); END IF;
  IF (NEW.public_code, NEW.short_code) IS DISTINCT FROM (OLD.public_code, OLD.short_code) THEN
    IF NEW.code_generation <> OLD.code_generation + 1 THEN RAISE EXCEPTION 'rotation must advance the code generation'; END IF;
    NEW.rotated_at := now();
  ELSIF NEW.code_generation IS DISTINCT FROM OLD.code_generation OR NEW.rotated_at IS DISTINCT FROM OLD.rotated_at THEN
    RAISE EXCEPTION 'rotation fields change only with the codes';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER campaign_response_link_guard ON public.campaign_response_links;
CREATE TRIGGER campaign_response_link_guard BEFORE INSERT OR UPDATE OR DELETE ON public.campaign_response_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_response_link();
CREATE TRIGGER campaign_response_link_register_codes AFTER INSERT ON public.campaign_response_links
  FOR EACH ROW EXECUTE FUNCTION public.connect_register_link_codes();

CREATE FUNCTION public.guard_campaign_response_link_code() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT public.connect_link_writer() THEN RAISE EXCEPTION 'link codes change only through the link lifecycle'; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'issued link codes are kept so they are never reissued'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.retired_at IS NOT NULL AND NEW.retired_at < NEW.issued_at THEN RAISE EXCEPTION 'invalid retirement'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.id, NEW.link_id, NEW.kind, NEW.code, NEW.issued_at) IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.link_id, OLD.kind, OLD.code, OLD.issued_at)
    OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL THEN
    RAISE EXCEPTION 'link codes only retire, once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER campaign_response_link_code_guard BEFORE INSERT OR UPDATE OR DELETE ON public.campaign_response_link_codes
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_response_link_code();

--> statement-breakpoint
-- 7) 0026's response guard, plus HC-03 expiry: an expired link accepts no response either.
-- Only the marked line differs from 0026.
CREATE OR REPLACE FUNCTION public.guard_campaign_response() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE link_status text; version_status text; retention integer; campaign_archived timestamptz; link_expires timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'responses are erased, not deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.contact_id IS NOT NULL OR NEW.associated_at IS NOT NULL OR NEW.erased_at IS NOT NULL THEN
      RAISE EXCEPTION 'responses start pending and unassociated';
    END IF;
    SELECT l.status, v.status, v.pending_retention_days, c.archived_at, l.expires_at INTO link_status, version_status, retention, campaign_archived, link_expires
      FROM public.campaign_response_links l
      JOIN public.form_versions v ON v.tenant_id = l.tenant_id AND v.id = l.form_version_id
      JOIN public.campaigns c ON c.tenant_id = l.tenant_id AND c.id = l.campaign_id
      WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.link_id AND l.campaign_id = NEW.campaign_id AND l.form_version_id = NEW.form_version_id
      FOR SHARE OF l, v;
    IF NOT FOUND OR link_status <> 'published' OR version_status <> 'published' OR campaign_archived IS NOT NULL
      OR link_expires <= now() THEN -- HC-03
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
