-- CW-10 Ways to give: the ministry's own giving accounts (founder decision 26 Nov). Harvest processes no payment, calls no provider and fetches nothing.
-- IBAN check digits (ISO 13616 mod 97), repeated by the server. Pure, used by the table's check constraint.
CREATE FUNCTION public.giving_iban_valid(p_iban text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
DECLARE moved text; digits text; rest integer := 0; i integer; j integer;
BEGIN
  IF p_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' THEN RETURN false; END IF;
  moved := substr(p_iban, 5) || substr(p_iban, 1, 4);
  FOR i IN 1..length(moved) LOOP
    digits := CASE WHEN substr(moved, i, 1) ~ '[A-Z]' THEN (ascii(substr(moved, i, 1)) - 55)::text ELSE substr(moved, i, 1) END;
    FOR j IN 1..length(digits) LOOP rest := (rest * 10 + substr(digits, j, 1)::integer) % 97; END LOOP;
  END LOOP;
  RETURN rest = 1;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giving_iban_valid(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giving_iban_valid(text) TO harvest_app;--> statement-breakpoint
CREATE TABLE "giving_methods" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"handle" text,
	"iban" text,
	"bic" text,
	"account_holder" text,
	"note" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giving_methods_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "giving_methods_kind" CHECK ("giving_methods"."kind" in ('paypal','wise','venmo','zelle','revolut','cash_app','bank_transfer','gofundme','donorbox','givebutter','tithely','pushpay','planning_center','subsplash','givelify','zeffy','every_org','justgiving','patreon','ko_fi','buy_me_a_coffee')),
	CONSTRAINT "giving_methods_label" CHECK (length(btrim("giving_methods"."label")) between 1 and 60 and "giving_methods"."label" = btrim("giving_methods"."label")),
	CONSTRAINT "giving_methods_position" CHECK ("giving_methods"."position" between 0 and 1000),
	CONSTRAINT "giving_methods_url" CHECK ("giving_methods"."url" is null or ("giving_methods"."url" ~ '^https://[^/@:\s]+(/[^\s]*)?$' and length("giving_methods"."url") <= 2048)),
	CONSTRAINT "giving_methods_lengths" CHECK (coalesce(length("giving_methods"."handle"), 0) <= 64 and coalesce(length("giving_methods"."account_holder"), 0) <= 100 and coalesce(length("giving_methods"."note"), 0) <= 140),
	CONSTRAINT "giving_methods_iban" CHECK ("giving_methods"."iban" is null or public.giving_iban_valid("giving_methods"."iban")),
	CONSTRAINT "giving_methods_bic" CHECK ("giving_methods"."bic" is null or "giving_methods"."bic" ~ '^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
	CONSTRAINT "giving_methods_shape" CHECK (case
    when "giving_methods"."kind" = 'bank_transfer' then "giving_methods"."iban" is not null and "giving_methods"."account_holder" is not null and "giving_methods"."url" is null and "giving_methods"."handle" is null
    when "giving_methods"."kind" = 'zelle' then "giving_methods"."handle" is not null and "giving_methods"."url" is null and "giving_methods"."iban" is null and "giving_methods"."bic" is null and "giving_methods"."account_holder" is null
    when "giving_methods"."kind" in ('venmo','revolut','cash_app') then ("giving_methods"."url" is null) <> ("giving_methods"."handle" is null) and "giving_methods"."iban" is null and "giving_methods"."bic" is null and "giving_methods"."account_holder" is null
    else "giving_methods"."url" is not null and "giving_methods"."handle" is null and "giving_methods"."iban" is null and "giving_methods"."bic" is null and "giving_methods"."account_holder" is null end)
);
--> statement-breakpoint
CREATE TABLE "giving_report_quotas" (
	"scope" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "giving_report_quotas_scope_minute_pk" PRIMARY KEY("scope","minute")
);
--> statement-breakpoint
CREATE TABLE "giving_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page" text NOT NULL,
	"ref" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giving_reports_page" CHECK ("giving_reports"."page" in ('bio')),
	CONSTRAINT "giving_reports_ref" CHECK (length("giving_reports"."ref") between 1 and 64),
	CONSTRAINT "giving_reports_reason" CHECK ("giving_reports"."reason" in ('impersonation','scam','wrong_details','inappropriate','other')),
	CONSTRAINT "giving_reports_note" CHECK ("giving_reports"."note" is null or length("giving_reports"."note") between 1 and 500),
	CONSTRAINT "giving_reports_status" CHECK ("giving_reports"."status" in ('open','reviewed','dismissed') and (("giving_reports"."status" = 'open') = ("giving_reports"."resolved_at" is null)))
);
--> statement-breakpoint
CREATE TABLE "giving_standing" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"hidden" boolean NOT NULL,
	"reason" text,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giving_standing_reason" CHECK ("giving_standing"."reason" is null or length("giving_standing"."reason") between 1 and 500),
	CONSTRAINT "giving_standing_hidden_reason" CHECK (not "giving_standing"."hidden" or "giving_standing"."reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "giving_methods" ADD CONSTRAINT "giving_methods_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_methods" ADD CONSTRAINT "giving_methods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_reports" ADD CONSTRAINT "giving_reports_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_reports" ADD CONSTRAINT "giving_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_standing" ADD CONSTRAINT "giving_standing_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_standing" ADD CONSTRAINT "giving_standing_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "giving_methods_order_idx" ON "giving_methods" USING btree ("tenant_id","position","id");--> statement-breakpoint
CREATE INDEX "giving_report_quota_expiry_idx" ON "giving_report_quotas" USING btree ("minute");--> statement-breakpoint
CREATE INDEX "giving_reports_open_idx" ON "giving_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "giving_reports_tenant_idx" ON "giving_reports" USING btree ("tenant_id","created_at");--> statement-breakpoint
-- Owners and admins manage (a collaborator with Giving at manage reads as admin through access_role). Members, viewers and guests see nothing.
ALTER TABLE public.giving_methods ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.giving_methods FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.giving_methods FROM PUBLIC, harvest_app;--> statement-breakpoint
DO $$
DECLARE manager text := $s$tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id = giving_methods.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND public.access_role(m.tenant_id, m.user_id, 'giving', m.role_id) IN ('owner', 'admin'))$s$;
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN EXECUTE 'REVOKE ALL ON public.giving_methods FROM harvest_worker'; END IF;
  EXECUTE 'CREATE POLICY giving_manage_read ON public.giving_methods FOR SELECT TO harvest_app USING (' || manager || ')';
  EXECUTE 'CREATE POLICY giving_manage_insert ON public.giving_methods FOR INSERT TO harvest_app WITH CHECK (created_by = nullif(current_setting(''app.user_id'', true), '''') AND ' || manager || ')';
  EXECUTE 'CREATE POLICY giving_manage_update ON public.giving_methods FOR UPDATE TO harvest_app USING (' || manager || ') WITH CHECK (' || manager || ')';
  EXECUTE 'CREATE POLICY giving_manage_delete ON public.giving_methods FOR DELETE TO harvest_app USING (' || manager || ')';
  -- The public definers below run as the migration owner and read one ministry's enabled rows through a transaction-local setting only they set.
  EXECUTE format($p$CREATE POLICY giving_public_definer ON public.giving_methods FOR SELECT TO %I
    USING (enabled AND tenant_id = nullif(current_setting('app.giving_public_tenant', true), '')::uuid)$p$, current_user);
END $$;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.giving_methods TO harvest_app;--> statement-breakpoint
GRANT UPDATE (position, kind, label, url, handle, iban, bic, account_holder, note, enabled, version, updated_at) ON public.giving_methods TO harvest_app;--> statement-breakpoint
-- Staff takedown, reports and report buckets: no app grant except what is listed. Owners and admins read their own standing (to see that staff hid their
-- details); every other access is through the definers below, which set a transaction-local flag only they set and clear it again.
DO $$
DECLARE rel text;
  manager text := $s$tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id = giving_standing.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND public.access_role(m.tenant_id, m.user_id, 'giving', m.role_id) IN ('owner', 'admin'))$s$;
BEGIN
  FOREACH rel IN ARRAY ARRAY['giving_standing','giving_reports','giving_report_quotas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', rel);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN EXECUTE format('REVOKE ALL ON public.%I FROM harvest_worker', rel); END IF;
    EXECUTE format($p$CREATE POLICY giving_definer ON public.%I TO %I USING (current_setting('app.giving_definer', true) = 'on') WITH CHECK (current_setting('app.giving_definer', true) = 'on')$p$, rel, current_user);
  END LOOP;
  EXECUTE 'CREATE POLICY giving_standing_manage_read ON public.giving_standing FOR SELECT TO harvest_app USING (' || manager || ')';
  -- The staff definers read the reported ministry's name (and check it exists); only while they set the flag, never as harvest_app.
  EXECUTE format($p$CREATE POLICY giving_definer_ministry ON public.workspaces FOR SELECT TO %I USING (current_setting('app.giving_definer', true) = 'on')$p$, current_user);
END $$;--> statement-breakpoint
GRANT SELECT ON public.giving_standing TO harvest_app;--> statement-breakpoint
-- Internal helpers (not granted): whether staff hid a ministry's giving details, and a minute bucket that returns true while within its limit.
CREATE FUNCTION public.giving_hidden(p_tenant uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := coalesce(current_setting('app.giving_definer', true), ''); result boolean;
BEGIN
  PERFORM set_config('app.giving_definer', 'on', true);
  SELECT coalesce((SELECT s.hidden FROM public.giving_standing s WHERE s.tenant_id = p_tenant), false) INTO result;
  PERFORM set_config('app.giving_definer', prior, true);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giving_hidden(uuid) FROM PUBLIC, harvest_app;--> statement-breakpoint
CREATE FUNCTION public.giving_report_record(p_tenant uuid, p_page text, p_ref text, p_reason text, p_note text, p_visitor text) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := coalesce(current_setting('app.giving_definer', true), ''); minute_start timestamptz := date_trunc('minute', clock_timestamp()); used integer; exceeded boolean := false;
  bucket text; cap integer;
BEGIN
  IF p_visitor !~ '^[a-f0-9]{64}$' OR p_reason NOT IN ('impersonation','scam','wrong_details','inappropriate','other') THEN RETURN 'invalid'; END IF;
  PERFORM set_config('app.giving_definer', 'on', true);
  DELETE FROM public.giving_report_quotas WHERE minute < minute_start - interval '2 minutes';
  -- Three reports a minute per visitor and ministry, thirty a minute per ministry.
  FOR bucket, cap IN SELECT * FROM (VALUES ('report:' || p_visitor || ':' || p_tenant, 3), ('report:' || p_tenant, 30)) v LOOP
    INSERT INTO public.giving_report_quotas AS q (scope, minute, attempts) VALUES (bucket, minute_start, 1)
      ON CONFLICT (scope, minute) DO UPDATE SET attempts = least(q.attempts + 1, 1000) RETURNING q.attempts INTO used;
    IF used > cap THEN exceeded := true; END IF;
  END LOOP;
  IF NOT exceeded THEN
    INSERT INTO public.giving_reports (tenant_id, page, ref, reason, note) VALUES (p_tenant, p_page, p_ref, p_reason, nullif(btrim(coalesce(p_note, '')), ''));
  END IF;
  PERFORM set_config('app.giving_definer', prior, true);
  RETURN CASE WHEN exceeded THEN 'limited' ELSE 'ok' END;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giving_report_record(uuid, text, text, text, text, text) FROM PUBLIC, harvest_app;--> statement-breakpoint
-- A visitor reports the Ways to give block of a published link-in-bio page. Same answer for a missing page and a page without the block.
CREATE FUNCTION public.bio_report_giving(p_handle text, p_reason text, p_note text, p_visitor text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(false); page public.bio_pages; result text := 'not_found';
BEGIN
  IF public.valid_bio_handle(p_handle) IS TRUE AND length(coalesce(p_note, '')) <= 500 THEN
    PERFORM set_config('app.bio_handle', p_handle, true);
    SELECT * INTO page FROM public.bio_pages WHERE handle = p_handle AND status = 'published';
    IF FOUND AND EXISTS (SELECT FROM jsonb_array_elements(page.published->'blocks') b WHERE b->>'type' = 'giving' AND public.bio_block_shown(page.published, b)) THEN
      result := public.giving_report_record(page.tenant_id, 'bio', p_handle, p_reason, p_note, p_visitor);
    END IF;
  END IF;
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bio_report_giving(text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.bio_report_giving(text, text, text, text) TO harvest_app;--> statement-breakpoint
-- Harvest staff (platform_staff, the role Discover review uses): list reports, resolve them, hide or restore a ministry's public giving details at once.
-- Each re-checks the active staff role of the signed-in user and writes a platform_staff_audit row. Reports carry no visitor identity.
CREATE FUNCTION public.platform_giving_reports(p_status text, p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); prior text := coalesce(current_setting('app.giving_definer', true), ''); result jsonb;
BEGIN
  IF public.platform_staff_role(actor) IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('open','reviewed','dismissed') THEN RAISE EXCEPTION 'invalid report status' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.giving_definer', 'on', true);
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'createdAt' DESC, x->>'id' DESC), '[]'::jsonb) INTO result FROM (
    SELECT jsonb_build_object('id', r.id, 'tenantId', r.tenant_id, 'ministry', w.name, 'page', r.page, 'ref', r.ref, 'reason', r.reason, 'note', r.note, 'status', r.status,
      'createdAt', r.created_at, 'hidden', coalesce(s.hidden, false)) x
    FROM public.giving_reports r JOIN public.workspaces w ON w.tenant_id = r.tenant_id LEFT JOIN public.giving_standing s ON s.tenant_id = r.tenant_id
    WHERE r.status = p_status ORDER BY r.created_at DESC, r.id DESC LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)) q;
  PERFORM set_config('app.giving_definer', prior, true);
  PERFORM public.platform_staff_log(actor, 'giving.reports', 'queue', p_status, NULL);
  RETURN result;
END $$;--> statement-breakpoint
CREATE FUNCTION public.platform_giving_resolve_report(p_id uuid, p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); prior text := coalesce(current_setting('app.giving_definer', true), ''); tenant uuid;
BEGIN
  IF public.platform_staff_role(actor) IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('reviewed','dismissed') THEN RAISE EXCEPTION 'invalid report status' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.giving_definer', 'on', true);
  UPDATE public.giving_reports SET status = p_status, resolved_by = actor, resolved_at = now() WHERE id = p_id AND status = 'open' RETURNING tenant_id INTO tenant;
  PERFORM set_config('app.giving_definer', prior, true);
  IF tenant IS NULL THEN RETURN false; END IF;
  PERFORM public.platform_staff_log(actor, 'giving.report.' || p_status, 'giving_report', p_id::text, tenant);
  RETURN true;
END $$;--> statement-breakpoint
CREATE FUNCTION public.platform_giving_standing(p_tenant uuid, p_hidden boolean, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); prior text := coalesce(current_setting('app.giving_definer', true), '');
BEGIN
  IF public.platform_staff_role(actor) IS NULL THEN RAISE EXCEPTION 'not staff' USING ERRCODE = 'P0001'; END IF;
  IF p_hidden IS NULL OR (p_hidden AND nullif(btrim(coalesce(p_reason, '')), '') IS NULL) THEN RAISE EXCEPTION 'a reason is required to hide' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.giving_definer', 'on', true);
  IF NOT EXISTS (SELECT FROM public.workspaces w WHERE w.tenant_id = p_tenant) THEN PERFORM set_config('app.giving_definer', prior, true); RETURN false; END IF;
  INSERT INTO public.giving_standing (tenant_id, hidden, reason, changed_by, changed_at) VALUES (p_tenant, p_hidden, CASE WHEN p_hidden THEN left(btrim(p_reason), 500) END, actor, now())
    ON CONFLICT (tenant_id) DO UPDATE SET hidden = EXCLUDED.hidden, reason = EXCLUDED.reason, changed_by = EXCLUDED.changed_by, changed_at = EXCLUDED.changed_at;
  PERFORM set_config('app.giving_definer', prior, true);
  PERFORM public.platform_staff_log(actor, CASE WHEN p_hidden THEN 'giving.standing.hide' ELSE 'giving.standing.restore' END, 'ministry', p_tenant::text, p_tenant);
  RETURN true;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.platform_giving_reports(text, integer), public.platform_giving_resolve_report(uuid, text), public.platform_giving_standing(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.platform_giving_reports(text, integer), public.platform_giving_resolve_report(uuid, text), public.platform_giving_standing(uuid, boolean, text) TO harvest_app;--> statement-breakpoint
-- Enabled methods of one ministry, in order, as a visitor may see them (explicit allow-list: no creator, no dates, no position). Enabled means public: the
-- server calls this only for a ministry whose public page (link in bio, a published campaign) is being shown.
CREATE FUNCTION public.giving_public_methods(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := coalesce(current_setting('app.giving_public_tenant', true), ''); result jsonb;
BEGIN
  IF p_tenant IS NULL OR public.giving_hidden(p_tenant) THEN RETURN '[]'::jsonb; END IF;
  PERFORM set_config('app.giving_public_tenant', p_tenant::text, true);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'label', g.label, 'url', g.url, 'handle', g.handle, 'iban', g.iban, 'bic', g.bic,
      'accountHolder', g.account_holder, 'note', g.note) ORDER BY g.position, g.id), '[]'::jsonb)
    INTO result FROM (SELECT * FROM public.giving_methods m WHERE m.tenant_id = p_tenant AND m.enabled ORDER BY m.position, m.id LIMIT 20) g;
  PERFORM set_config('app.giving_public_tenant', prior, true);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giving_public_methods(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giving_public_methods(uuid) TO harvest_app;--> statement-breakpoint
-- The "Ways to give" block of a published link-in-bio page: the methods only while the page is published with that block shown; NULL otherwise.
CREATE FUNCTION public.bio_public_giving(p_handle text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(false); page public.bio_pages; result jsonb;
BEGIN
  IF public.valid_bio_handle(p_handle) IS TRUE THEN
    PERFORM set_config('app.bio_handle', p_handle, true);
    SELECT * INTO page FROM public.bio_pages WHERE handle = p_handle AND status = 'published';
    IF FOUND AND EXISTS (SELECT FROM jsonb_array_elements(page.published->'blocks') b WHERE b->>'type' = 'giving' AND public.bio_block_shown(page.published, b)) THEN
      result := public.giving_public_methods(page.tenant_id);
    END IF;
  END IF;
  PERFORM public.bio_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bio_public_giving(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.bio_public_giving(text) TO harvest_app;
