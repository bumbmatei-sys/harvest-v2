CREATE TABLE "fundraising_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fundraising_id" uuid NOT NULL,
	"uploader_id" text,
	"key" text NOT NULL,
	"kind" text DEFAULT 'cover' NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"checksum" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fundraising_files_key_unique" UNIQUE("key"),
	CONSTRAINT "fundraising_file_kind" CHECK ("fundraising_files"."kind" = 'cover'),
	CONSTRAINT "fundraising_file_mime" CHECK ("fundraising_files"."mime" in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "fundraising_file_name" CHECK (length(btrim("fundraising_files"."name")) between 1 and 200),
	CONSTRAINT "fundraising_file_size" CHECK ("fundraising_files"."size" between 1 and 10485760),
	CONSTRAINT "fundraising_file_checksum" CHECK ("fundraising_files"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "fundraising_file_status" CHECK ("fundraising_files"."status" in ('pending','uploaded','quarantined','ready')),
	CONSTRAINT "fundraising_file_key" CHECK ("fundraising_files"."key" = 'workspaces/' || "fundraising_files"."tenant_id"::text || '/fundraising/' || "fundraising_files"."fundraising_id"::text || '/files/' || "fundraising_files"."id"::text)
);
--> statement-breakpoint
CREATE TABLE "fundraising_pages" (
	"tenant_id" uuid NOT NULL,
	"fundraising_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"cover_file_id" uuid,
	"show_amount" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fundraising_pages_tenant_id_fundraising_id_pk" PRIMARY KEY("tenant_id","fundraising_id"),
	CONSTRAINT "fundraising_page_slug" CHECK ("fundraising_pages"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$' and "fundraising_pages"."slug" not in ('new', 'create', 'edit', 'settings', 'admin', 'api', 'account', 'give', 'giving', 'donate', 'report', 'cover', 'search', 'discover', 'harvest', 'login', 'signup', 'help', 'support', 'about', 'terms', 'privacy', 'official', 'staff', 'null', 'undefined')),
	CONSTRAINT "fundraising_page_description" CHECK ("fundraising_pages"."description" is null or (length("fundraising_pages"."description") between 1 and 5000 and "fundraising_pages"."description" = btrim("fundraising_pages"."description") and "fundraising_pages"."description" !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')),
	CONSTRAINT "fundraising_page_version" CHECK ("fundraising_pages"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "giving_reports" DROP CONSTRAINT "giving_reports_page";--> statement-breakpoint
ALTER TABLE "fundraising_files" ADD CONSTRAINT "fundraising_files_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_files" ADD CONSTRAINT "fundraising_files_tenant_id_fundraising_id_fundraising_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","fundraising_id") REFERENCES "public"."fundraising_campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_pages" ADD CONSTRAINT "fundraising_pages_cover_file_id_fundraising_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."fundraising_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_pages" ADD CONSTRAINT "fundraising_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_pages" ADD CONSTRAINT "fundraising_pages_tenant_id_fundraising_id_fundraising_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","fundraising_id") REFERENCES "public"."fundraising_campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fundraising_files_parent_idx" ON "fundraising_files" USING btree ("tenant_id","fundraising_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fundraising_pages_slug_idx" ON "fundraising_pages" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "giving_reports" ADD CONSTRAINT "giving_reports_page" CHECK ("giving_reports"."page" in ('bio', 'give'));--> statement-breakpoint
-- Public fundraising page (/give/<slug>, founder decisions 26 Nov). Record keeping only: Harvest processes no payment and calls no provider.
-- Owners and admins (a collaborator with Giving at manage reads as admin through public.access_role, 0113) set the slug, description, cover and the
-- show-amount switch of a fundraiser's page. FORCE RLS; no anonymous grant. Visitors read only through the SECURITY DEFINER functions below, which answer
-- for a published fundraiser of a ministry whose giving details Harvest staff have not hidden, with an allow-listed jsonb and never a name, pledge or gift row.
ALTER TABLE public.fundraising_pages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.fundraising_pages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.fundraising_files ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.fundraising_files FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.fundraising_pages, public.fundraising_files FROM PUBLIC, harvest_app;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN EXECUTE 'REVOKE ALL ON public.fundraising_pages, public.fundraising_files FROM harvest_worker'; END IF;
END $$;--> statement-breakpoint
GRANT SELECT, INSERT ON public.fundraising_pages TO harvest_app;--> statement-breakpoint
GRANT UPDATE (slug, description, cover_file_id, show_amount, version, updated_at) ON public.fundraising_pages TO harvest_app;--> statement-breakpoint
GRANT SELECT, INSERT ON public.fundraising_files TO harvest_app;--> statement-breakpoint
GRANT UPDATE (status, retired_at) ON public.fundraising_files TO harvest_app;--> statement-breakpoint
CREATE POLICY fundraising_pages_read ON public.fundraising_pages FOR SELECT TO harvest_app USING (public.giving_can(tenant_id, 'giving'));--> statement-breakpoint
CREATE POLICY fundraising_pages_create ON public.fundraising_pages FOR INSERT TO harvest_app
  WITH CHECK (public.giving_can(tenant_id, 'giving') AND created_by = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY fundraising_pages_update ON public.fundraising_pages FOR UPDATE TO harvest_app
  USING (public.giving_can(tenant_id, 'giving')) WITH CHECK (public.giving_can(tenant_id, 'giving'));--> statement-breakpoint
CREATE POLICY fundraising_files_read ON public.fundraising_files FOR SELECT TO harvest_app USING (public.giving_can(tenant_id, 'giving'));--> statement-breakpoint
CREATE POLICY fundraising_files_create ON public.fundraising_files FOR INSERT TO harvest_app
  WITH CHECK (public.giving_can(tenant_id, 'giving') AND uploader_id = nullif(current_setting('app.user_id', true), '') AND status = 'pending' AND retired_at IS NULL);--> statement-breakpoint
CREATE POLICY fundraising_files_update ON public.fundraising_files FOR UPDATE TO harvest_app
  USING (public.giving_can(tenant_id, 'giving') AND retired_at IS NULL) WITH CHECK (public.giving_can(tenant_id, 'giving'));--> statement-breakpoint
-- A file's scan state only moves forward and only its uploader moves it; a retired file never changes again (the campaign cover rule).
CREATE FUNCTION public.fundraising_files_guard_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.retired_at IS NOT NULL THEN RAISE EXCEPTION 'a retired file does not change' USING ERRCODE = '42501'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    OLD.uploader_id IS NOT DISTINCT FROM nullif(pg_catalog.current_setting('app.user_id', true), '')
    AND ((OLD.status = 'pending' AND NEW.status IN ('uploaded', 'quarantined')) OR (OLD.status = 'uploaded' AND NEW.status IN ('ready', 'quarantined')))) THEN
    RAISE EXCEPTION 'file state cannot change that way' USING ERRCODE = '23514';
  END IF;
  IF NEW.retired_at IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'retiring a file does not change its state' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fundraising_files_guard_update() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER fundraising_files_guard_update BEFORE UPDATE ON public.fundraising_files FOR EACH ROW EXECUTE FUNCTION public.fundraising_files_guard_update();--> statement-breakpoint
-- The page: the key, ministry, fundraiser and creator never change; the version moves forward by one; the slug is fixed once the fundraiser has left draft
-- (published, closed or archived); the cover is a ready, unretired file of the same fundraiser.
CREATE FUNCTION public.fundraising_pages_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE campaign_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id <> OLD.tenant_id OR NEW.fundraising_id <> OLD.fundraising_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
      OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'invalid fundraising page update' USING ERRCODE = '23514';
    END IF;
    IF NEW.slug <> OLD.slug THEN
      SELECT f.status INTO campaign_status FROM public.fundraising_campaigns f WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.fundraising_id;
      IF campaign_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'the page address is fixed once published' USING ERRCODE = '23514'; END IF;
    END IF;
  ELSIF NEW.version <> 1 THEN
    RAISE EXCEPTION 'invalid fundraising page' USING ERRCODE = '23514';
  END IF;
  IF NEW.cover_file_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.cover_file_id IS DISTINCT FROM OLD.cover_file_id) AND NOT EXISTS (SELECT FROM public.fundraising_files f
    WHERE f.id = NEW.cover_file_id AND f.tenant_id = NEW.tenant_id AND f.fundraising_id = NEW.fundraising_id AND f.status = 'ready' AND f.retired_at IS NULL) THEN
    RAISE EXCEPTION 'cover does not belong to this fundraiser or is unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fundraising_pages_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER fundraising_pages_guard BEFORE INSERT OR UPDATE ON public.fundraising_pages FOR EACH ROW EXECUTE FUNCTION public.fundraising_pages_guard();--> statement-breakpoint
-- Owner-role policies for the public definers: each one reads only what the transaction-local flags it set itself name (one slug, then that page's ministry
-- and fundraiser). The entry functions clear the app.* settings first and restore them after (the 0119/0120 reset pattern), so a value the app set
-- beforehand never reaches them.
DO $$
DECLARE scope text := $s$tenant_id = nullif(current_setting('app.give_public_tenant', true), '')::uuid$s$;
  fundraiser text := $f$fundraising_id = nullif(current_setting('app.give_public_fundraising', true), '')::uuid$f$;
BEGIN
  EXECUTE format($p$CREATE POLICY give_public_definer ON public.fundraising_pages FOR SELECT TO %I USING (slug = nullif(current_setting('app.give_public_slug', true), ''))$p$, current_user);
  EXECUTE format($p$CREATE POLICY give_public_definer ON public.fundraising_campaigns FOR SELECT TO %I USING (%s AND id = nullif(current_setting('app.give_public_fundraising', true), '')::uuid)$p$, current_user, scope);
  EXECUTE format('CREATE POLICY give_public_definer ON public.fundraising_files FOR SELECT TO %I USING (%s AND %s)', current_user, scope, fundraiser);
  EXECUTE format('CREATE POLICY give_public_definer ON public.giving_ledger_entries FOR SELECT TO %I USING (%s AND %s)', current_user, scope, fundraiser);
  EXECUTE format('CREATE POLICY give_public_definer ON public.fundraising_pledges FOR SELECT TO %I USING (%s AND %s)', current_user, scope, fundraiser);
  EXECUTE format($p$CREATE POLICY give_public_definer ON public.giving_contact_links FOR SELECT TO %I USING (%s AND EXISTS (SELECT 1 FROM public.giving_ledger_entries e
    WHERE e.tenant_id = giving_contact_links.tenant_id AND e.id = giving_contact_links.entry_id AND e.%s))$p$, current_user, scope, fundraiser);
  EXECUTE format('CREATE POLICY give_public_definer ON public.workspaces FOR SELECT TO %I USING (%s)', current_user, scope);
END $$;--> statement-breakpoint
-- Internal (not granted): save and clear the app.* settings any owner-role policy reads (an explicit list: custom settings are not reliably listed in
-- pg_settings), and put them back afterwards (clearing this file's own flags first).
CREATE FUNCTION public.give_scope_clear() RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := '{}'::jsonb; key text;
BEGIN
  FOREACH key IN ARRAY ARRAY['app.give_public_slug','app.give_public_tenant','app.give_public_fundraising','app.tenant_id','app.user_id','app.bio_handle','app.bio_tenant',
      'app.community_definer_tenant','app.community_resolve_slug','app.community_resolve_ids','app.community_resolve_invite','app.community_resolve_email','app.discover_read',
      'app.community_resolve_user','app.community_purge','app.community_email_worker','app.crm_forms_slug','app.giving_definer','app.giving_definer_tenant',
      'app.giving_public_tenant','app.campaign_budget_tenant','app.events_tenant'] LOOP
    prior := prior || pg_catalog.jsonb_build_object(key, coalesce(pg_catalog.current_setting(key, true), ''));
    PERFORM pg_catalog.set_config(key, '', true);
  END LOOP;
  RETURN prior;
END $$;--> statement-breakpoint
CREATE FUNCTION public.give_scope_restore(p_prior jsonb) RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE entry record;
BEGIN
  PERFORM pg_catalog.set_config(name, '', true) FROM pg_catalog.unnest(ARRAY['app.give_public_slug', 'app.give_public_tenant', 'app.give_public_fundraising']) AS name;
  FOR entry IN SELECT key, value FROM pg_catalog.jsonb_each_text(coalesce(p_prior, '{}'::jsonb)) LOOP PERFORM pg_catalog.set_config(entry.key, entry.value, true); END LOOP;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.give_scope_clear(), public.give_scope_restore(jsonb) FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Internal (not granted): the page behind a slug while it is public (fundraiser published, staff have not hidden the ministry's giving details), or NULL.
-- Leaves the page's ministry and fundraiser in the flags for the caller's next reads. Same answer for unknown, draft, closed, archived and hidden.
CREATE FUNCTION public.give_page_scoped(p_slug text) RETURNS public.fundraising_pages LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE page public.fundraising_pages;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$' THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.give_public_slug', p_slug, true);
  SELECT * INTO page FROM public.fundraising_pages p WHERE p.slug = p_slug;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.give_public_tenant', page.tenant_id::text, true);
  PERFORM pg_catalog.set_config('app.give_public_fundraising', page.fundraising_id::text, true);
  IF NOT EXISTS (SELECT FROM public.fundraising_campaigns f WHERE f.tenant_id = page.tenant_id AND f.id = page.fundraising_id AND f.status = 'published') THEN RETURN NULL; END IF;
  IF public.giving_hidden(page.tenant_id) THEN RETURN NULL; END IF;
  RETURN page;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.give_page_scoped(text) FROM PUBLIC, harvest_app;--> statement-breakpoint
-- Raised as a visitor may see it, in cents as text, or NULL while suppressed. Raised is the sum of live gifts the ministry recorded as confirmed (a reversed
-- gift is not live, its replacement is), which equals the ledger net of reversals. Small-group suppression (spec section 105): released only when no gift is
-- live (0) or when at least five distinct identified supporters (a CRM contact through the gift's link or its pledge) gave; gifts without a known supporter
-- never count toward that cohort. SECURITY INVOKER: the public definer runs it under its own flags, the owner preview under ordinary row security.
CREATE FUNCTION public.give_released_raised(p_tenant uuid, p_fundraising uuid) RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE raised bigint; gifts integer; supporters integer;
BEGIN
  -- Through the app (the owner preview) only owners and admins get a figure; anyone else would see '0' because row security hides the gifts.
  IF current_user = 'harvest_app' AND NOT public.giving_can(p_tenant, 'owner_admin') THEN RETURN NULL; END IF;
  SELECT coalesce(sum(l.amount_cents), 0), count(*)::integer, count(DISTINCT l.who)::integer INTO raised, gifts, supporters FROM (
    SELECT e.amount_cents, coalesce(k.contact_id, p.contact_id) AS who FROM public.giving_ledger_entries e
      LEFT JOIN public.giving_contact_links k ON k.tenant_id = e.tenant_id AND k.entry_id = e.id
      LEFT JOIN public.fundraising_pledges p ON p.tenant_id = e.tenant_id AND p.id = e.pledge_id
    WHERE e.tenant_id = p_tenant AND e.fundraising_id = p_fundraising AND e.kind = 'gift'
      AND NOT EXISTS (SELECT 1 FROM public.giving_ledger_entries r WHERE r.tenant_id = e.tenant_id AND r.correction_of = e.id AND r.kind = 'reversal')) l;
  RETURN CASE WHEN gifts = 0 THEN '0' WHEN supporters >= (SELECT small_group_min FROM public.connect_retention_policy()) THEN raised::text END;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.give_released_raised(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.give_released_raised(uuid, uuid) TO harvest_app;--> statement-breakpoint
-- The page a visitor sees (allow-listed). With the amount switched off, no goal, raised or currency is returned at all; while suppressed, raisedCents is null
-- and the app shows no percentage either.
CREATE FUNCTION public.give_public_page(p_slug text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.give_scope_clear(); page public.fundraising_pages; campaign public.fundraising_campaigns; ministry text; has_cover boolean;
  released text; amount jsonb; result jsonb;
BEGIN
  page := public.give_page_scoped(p_slug);
  IF page.tenant_id IS NOT NULL THEN
    SELECT * INTO campaign FROM public.fundraising_campaigns f WHERE f.tenant_id = page.tenant_id AND f.id = page.fundraising_id;
    SELECT w.name INTO ministry FROM public.workspaces w WHERE w.tenant_id = page.tenant_id;
    has_cover := page.cover_file_id IS NOT NULL AND EXISTS (SELECT FROM public.fundraising_files f WHERE f.tenant_id = page.tenant_id AND f.fundraising_id = page.fundraising_id
      AND f.id = page.cover_file_id AND f.status = 'ready' AND f.retired_at IS NULL);
    IF page.show_amount THEN
      released := public.give_released_raised(page.tenant_id, page.fundraising_id);
      amount := pg_catalog.jsonb_build_object('currency', campaign.currency, 'goalCents', campaign.goal_cents::text, 'raisedCents', released);
    END IF;
    result := pg_catalog.jsonb_build_object('slug', page.slug, 'title', campaign.title, 'description', page.description, 'ministry', coalesce(ministry, ''),
      'hasCover', has_cover, 'amount', amount);
  END IF;
  PERFORM public.give_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
-- The ministry's enabled giving methods for a public give page (the way bio_public_giving does for link in bio); NULL when the page is not public.
CREATE FUNCTION public.give_public_giving(p_slug text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.give_scope_clear(); page public.fundraising_pages; result jsonb;
BEGIN
  page := public.give_page_scoped(p_slug);
  IF page.tenant_id IS NOT NULL THEN result := public.giving_public_methods(page.tenant_id); END IF;
  PERFORM public.give_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
-- The public page's cover file (storage key, name, type) for the short signed redirect; NULL otherwise.
CREATE FUNCTION public.give_public_cover(p_slug text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.give_scope_clear(); page public.fundraising_pages; result jsonb;
BEGIN
  page := public.give_page_scoped(p_slug);
  IF page.tenant_id IS NOT NULL AND page.cover_file_id IS NOT NULL THEN
    SELECT pg_catalog.jsonb_build_object('key', f.key, 'name', f.name, 'mime', f.mime) INTO result FROM public.fundraising_files f
      WHERE f.tenant_id = page.tenant_id AND f.fundraising_id = page.fundraising_id AND f.id = page.cover_file_id AND f.status = 'ready' AND f.retired_at IS NULL;
  END IF;
  PERFORM public.give_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
-- A visitor reports a public give page (its Ways to give block). The same reports table, reasons and per-visitor/per-ministry minute limits as link in bio
-- (giving_report_record); page 'give', ref = the slug. Same answer for a missing and a non-public page.
CREATE FUNCTION public.give_report_giving(p_slug text, p_reason text, p_note text, p_visitor text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.give_scope_clear(); page public.fundraising_pages; result text := 'not_found';
BEGIN
  IF length(coalesce(p_note, '')) <= 500 THEN
    page := public.give_page_scoped(p_slug);
    IF page.tenant_id IS NOT NULL THEN result := public.giving_report_record(page.tenant_id, 'give', page.slug, p_reason, p_note, p_visitor); END IF;
  END IF;
  PERFORM public.give_scope_restore(prior);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.give_public_page(text), public.give_public_giving(text), public.give_public_cover(text), public.give_report_giving(text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.give_public_page(text), public.give_public_giving(text), public.give_public_cover(text), public.give_report_giving(text, text, text, text) TO harvest_app;
--> statement-breakpoint
-- Entry resets (review of d3fb918): the give_public_definer policies are keyed on app.give_public_*, so every owner definer that clears app.* flags on
-- entry now clears these three as well. Bodies are those of 0119 with the three flags added.
CREATE OR REPLACE FUNCTION public.bio_scope_clear(p_keep_user boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := '{}'::jsonb; key text;
BEGIN
  FOREACH key IN ARRAY ARRAY['app.bio_handle','app.bio_tenant','app.tenant_id','app.community_definer_tenant','app.crm_forms_slug','app.user_id',
      'app.giving_definer','app.giving_definer_tenant','app.giving_public_tenant','app.give_public_slug','app.give_public_tenant','app.give_public_fundraising'] LOOP
    prior := prior || jsonb_build_object(key, coalesce(current_setting(key, true), ''));
    IF key <> 'app.user_id' OR NOT p_keep_user THEN PERFORM set_config(key, '', true); END IF;
  END LOOP;
  RETURN prior;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_definer_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT set_config(name, '', true) FROM unnest(ARRAY['app.community_resolve_slug','app.community_definer_tenant','app.community_resolve_ids',
    'app.community_resolve_invite','app.community_resolve_email','app.discover_read','app.community_resolve_user','app.community_purge',
    'app.community_email_worker','app.giving_definer','app.giving_definer_tenant','app.giving_public_tenant',
    'app.give_public_slug','app.give_public_tenant','app.give_public_fundraising']) AS name;
$$;--> statement-breakpoint
-- campaign_budget_totals (0120) blanked app.* by listing pg_settings, which does not list custom settings (confirmed on PostgreSQL 18.6), so it cleared
-- nothing. Same body with an explicit list: every app.* flag an owner-role policy reads (app.tenant_id and app.user_id stay, as before).
CREATE OR REPLACE FUNCTION public.campaign_budget_totals(p_tenant uuid, p_campaign uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := '{}'::jsonb; flag text; entry record; result jsonb;
BEGIN
  FOREACH flag IN ARRAY ARRAY['app.campaign_budget_tenant','app.give_public_slug','app.give_public_tenant','app.give_public_fundraising','app.bio_handle','app.bio_tenant',
      'app.community_definer_tenant','app.community_resolve_slug','app.community_resolve_ids','app.community_resolve_invite','app.community_resolve_email',
      'app.discover_read','app.community_resolve_user','app.community_purge','app.community_email_worker','app.crm_forms_slug','app.giving_definer',
      'app.giving_definer_tenant','app.giving_public_tenant','app.events_tenant'] LOOP
    prior := prior || pg_catalog.jsonb_build_object(flag, coalesce(pg_catalog.current_setting(flag, true), ''));
    PERFORM pg_catalog.set_config(flag, '', true);
  END LOOP;
  PERFORM pg_catalog.set_config('app.campaign_budget_tenant', coalesce(p_tenant::text, ''), true);
  result := public.campaign_budget_totals_scoped(p_tenant, p_campaign);
  PERFORM pg_catalog.set_config('app.campaign_budget_tenant', '', true);
  FOR entry IN SELECT key, value FROM pg_catalog.jsonb_each_text(prior) LOOP PERFORM pg_catalog.set_config(entry.key, entry.value, true); END LOOP;
  RETURN result;
END $$;
