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
	CONSTRAINT "giving_methods_kind" CHECK ("giving_methods"."kind" in ('paypal','wise','venmo','zelle','revolut','cash_app','bank_transfer','other')),
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
ALTER TABLE "giving_methods" ADD CONSTRAINT "giving_methods_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_methods" ADD CONSTRAINT "giving_methods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "giving_methods_order_idx" ON "giving_methods" USING btree ("tenant_id","position","id");--> statement-breakpoint
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
-- Enabled methods of one ministry, in order, as a visitor may see them (explicit allow-list: no creator, no dates, no position). Enabled means public: the
-- server calls this only for a ministry whose public page (link in bio, a published campaign) is being shown.
CREATE FUNCTION public.giving_public_methods(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := coalesce(current_setting('app.giving_public_tenant', true), ''); result jsonb;
BEGIN
  IF p_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
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
