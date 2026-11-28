CREATE TABLE "ministry_donation_receipts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ledger_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"donor_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"legal_name" text NOT NULL,
	"personal_support" boolean NOT NULL,
	"cadence" text NOT NULL,
	CONSTRAINT "ministry_donation_receipts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ministry_donation_receipt_charge" UNIQUE("tenant_id","ledger_id")
);
--> statement-breakpoint
CREATE TABLE "ministry_payment_accounts" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"legal_name" text NOT NULL,
	"currency" text NOT NULL,
	"country" text NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"requirements_due" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"disconnected_at" timestamp with time zone,
	"status_reported_at" timestamp with time zone,
	CONSTRAINT "ministry_payment_accounts_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "ministry_payment_account_tenant_identity" UNIQUE("tenant_id","account_id"),
	CONSTRAINT "ministry_payment_account_name" CHECK (length(btrim("ministry_payment_accounts"."legal_name")) between 1 and 200),
	CONSTRAINT "ministry_payment_account_geo" CHECK ("ministry_payment_accounts"."currency" ~ '^[A-Z]{3}$' and "ministry_payment_accounts"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "ministry_payment_account_provider" CHECK ("ministry_payment_accounts"."provider" in ('fake','stripe_connect'))
);
--> statement-breakpoint
CREATE TABLE "ministry_payment_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"account_id" text NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "ministry_payment_events_provider_event_id_pk" PRIMARY KEY("provider","event_id"),
	CONSTRAINT "ministry_payment_event_outcome" CHECK ("ministry_payment_events"."outcome" in ('recorded','ignored'))
);
--> statement-breakpoint
CREATE TABLE "ministry_payment_grants" (
	"backend" integer PRIMARY KEY NOT NULL,
	"transaction" text NOT NULL,
	"mode" text NOT NULL,
	"account_id" text,
	"provider" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ministry_payment_intents" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"payer_id" text,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"cadence" text NOT NULL,
	"item_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"legal_name" text NOT NULL,
	"personal_support" boolean DEFAULT false NOT NULL,
	"request_key" text NOT NULL,
	"subscription_ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ministry_payment_intents_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ministry_payment_intent_request" UNIQUE("tenant_id","payer_id","request_key"),
	CONSTRAINT "ministry_payment_intent_money" CHECK ("ministry_payment_intents"."currency" ~ '^[A-Z]{3}$' and "ministry_payment_intents"."amount_minor" between 1 and 1000000000000),
	CONSTRAINT "ministry_payment_intent_kind" CHECK (("ministry_payment_intents"."kind" = 'donation' and "ministry_payment_intents"."item_id" is null and "ministry_payment_intents"."cadence" in ('once','monthly'))
    or ("ministry_payment_intents"."kind" = 'sale' and "ministry_payment_intents"."item_id" is not null and "ministry_payment_intents"."cadence" = 'once'))
);
--> statement-breakpoint
CREATE TABLE "ministry_payment_ledger" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"intent_id" uuid,
	"payment_ref" text,
	"object_ref" text NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ministry_payment_ledger_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ministry_payment_ledger_provider_object" UNIQUE("tenant_id","account_id","kind","object_ref"),
	CONSTRAINT "ministry_payment_ledger_money" CHECK ("ministry_payment_ledger"."currency" ~ '^[A-Z]{3}$' and "ministry_payment_ledger"."amount_minor" between 0 and 1000000000000),
	CONSTRAINT "ministry_payment_ledger_kind" CHECK ("ministry_payment_ledger"."kind" in ('charge','application_fee','refund','dispute_opened','dispute_won','dispute_lost','payout'))
);
--> statement-breakpoint
CREATE TABLE "ministry_payment_onboarding" (
	"tenant_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "ministry_payment_onboarding_tenant_id_request_key_pk" PRIMARY KEY("tenant_id","request_key")
);
--> statement-breakpoint
CREATE TABLE "ministry_payment_prices" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "ministry_payment_prices_tenant_id_item_id_pk" PRIMARY KEY("tenant_id","item_id"),
	CONSTRAINT "ministry_payment_price_money" CHECK ("ministry_payment_prices"."currency" ~ '^[A-Z]{3}$' and "ministry_payment_prices"."amount_minor" between 1 and 1000000000000)
);
--> statement-breakpoint
ALTER TABLE "ministry_donation_receipts" ADD CONSTRAINT "ministry_donation_receipts_donor_id_users_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_donation_receipts" ADD CONSTRAINT "ministry_donation_receipts_tenant_id_ledger_id_ministry_payment_ledger_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ledger_id") REFERENCES "public"."ministry_payment_ledger"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_donation_receipts" ADD CONSTRAINT "ministry_donation_receipts_tenant_id_intent_id_ministry_payment_intents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","intent_id") REFERENCES "public"."ministry_payment_intents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_payment_accounts" ADD CONSTRAINT "ministry_payment_accounts_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_payment_intents" ADD CONSTRAINT "ministry_payment_intents_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_payment_intents" ADD CONSTRAINT "ministry_payment_intents_tenant_id_account_id_ministry_payment_accounts_tenant_id_account_id_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ministry_payment_accounts"("tenant_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_payment_intents" ADD CONSTRAINT "ministry_payment_intents_tenant_id_item_id_catalog_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_payment_ledger" ADD CONSTRAINT "ministry_payment_ledger_tenant_id_account_id_ministry_payment_accounts_tenant_id_account_id_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ministry_payment_accounts"("tenant_id","account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_payment_ledger" ADD CONSTRAINT "ministry_payment_ledger_tenant_id_intent_id_ministry_payment_intents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","intent_id") REFERENCES "public"."ministry_payment_intents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_payment_onboarding" ADD CONSTRAINT "ministry_payment_onboarding_tenant_id_ministry_payment_accounts_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."ministry_payment_accounts"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ministry_payment_prices" ADD CONSTRAINT "ministry_payment_prices_tenant_id_item_id_catalog_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."catalog_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ministry_donation_receipt_donor" ON "ministry_donation_receipts" USING btree ("donor_id","paid_at","id");--> statement-breakpoint
CREATE INDEX "ministry_payment_ledger_tenant_date" ON "ministry_payment_ledger" USING btree ("tenant_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "ministry_payment_ledger_related_charge" ON "ministry_payment_ledger" USING btree ("tenant_id","account_id","payment_ref");--> statement-breakpoint
CREATE FUNCTION public.ministry_payment_staff(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id = p_tenant
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND public.access_role(m.tenant_id,m.user_id,'owner_admin',m.role_id) IN ('owner','admin'))
$$;
REVOKE ALL ON FUNCTION public.ministry_payment_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ministry_payment_staff(uuid) TO harvest_app;
--> statement-breakpoint
ALTER TABLE public.ministry_payment_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ministry_payment_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ministry_payment_grants FROM PUBLIC, harvest_app;
DO $$
DECLARE tbl text;
DECLARE scoped text := 'tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid';
BEGIN
  EXECUTE format($p$CREATE POLICY payment_grant ON public.ministry_payment_grants TO %I
    USING (backend = pg_backend_pid() AND transaction = pg_current_xact_id_if_assigned()::text
      AND (mode IN ('checkout','account')) = (nullif(current_setting('app.user_id',true),'') IS NOT NULL))$p$, current_user);
  FOREACH tbl IN ARRAY ARRAY['ministry_payment_accounts','ministry_payment_prices','ministry_payment_intents',
    'ministry_payment_ledger','ministry_donation_receipts','ministry_payment_events','ministry_payment_onboarding'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', tbl);
    IF tbl <> 'ministry_payment_events' THEN
      EXECUTE format('GRANT SELECT ON public.%I TO harvest_app', tbl);
      EXECUTE format('CREATE POLICY payment_staff_read ON public.%I FOR SELECT TO harvest_app
        USING (public.ministry_payment_staff(tenant_id))', tbl);
    END IF;
  END LOOP;
  -- Payout accounts and onboarding requests change only through ministry_payment_account_change (owner only) and
  -- ministry_payment_record_event (verified provider facts). Prices: the app may set amount and currency, never the keys.
  GRANT INSERT (tenant_id, item_id, currency, amount_minor), UPDATE (currency, amount_minor) ON public.ministry_payment_prices TO harvest_app;
  CREATE POLICY payment_staff_create ON public.ministry_payment_prices FOR INSERT TO harvest_app
    WITH CHECK (public.ministry_payment_staff(tenant_id));
  CREATE POLICY payment_staff_update ON public.ministry_payment_prices FOR UPDATE TO harvest_app
    USING (public.ministry_payment_staff(tenant_id)) WITH CHECK (public.ministry_payment_staff(tenant_id));
  EXECUTE format($p$CREATE POLICY payment_account_change_read ON public.ministry_payment_accounts FOR SELECT TO %I USING (
    %s AND EXISTS (SELECT FROM public.ministry_payment_grants g WHERE g.mode = 'account'))$p$, current_user, scoped);
  EXECUTE format($p$CREATE POLICY payment_account_change_create ON public.ministry_payment_accounts FOR INSERT TO %I WITH CHECK (
    %s AND EXISTS (SELECT FROM public.ministry_payment_grants g WHERE g.mode = 'account'
      AND g.provider = ministry_payment_accounts.provider AND g.account_id = ministry_payment_accounts.account_id))$p$, current_user, scoped);
  EXECUTE format($p$CREATE POLICY payment_account_change_update ON public.ministry_payment_accounts FOR UPDATE TO %I USING (
    %s AND EXISTS (SELECT FROM public.ministry_payment_grants g WHERE g.mode = 'account'
      AND g.provider = ministry_payment_accounts.provider AND g.account_id = ministry_payment_accounts.account_id))$p$, current_user, scoped);
  EXECUTE format($p$CREATE POLICY payment_onboarding_change ON public.ministry_payment_onboarding TO %I USING (
    %s AND EXISTS (SELECT FROM public.ministry_payment_grants g WHERE g.mode = 'account'))$p$, current_user, scoped);
  EXECUTE format($p$CREATE POLICY payment_account_member ON public.workspace_members FOR SELECT TO %I USING (
    %s AND EXISTS (SELECT FROM public.ministry_payment_grants g WHERE g.mode = 'account'))$p$, current_user, scoped);
  EXECUTE format($p$CREATE POLICY payment_account_definer ON public.ministry_payment_accounts FOR SELECT TO %I USING (
    EXISTS (SELECT FROM public.ministry_payment_grants g WHERE g.provider = ministry_payment_accounts.provider
      AND ((g.mode = 'event' AND g.account_id = ministry_payment_accounts.account_id)
        OR (g.mode = 'checkout' AND ministry_payment_accounts.tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid))))$p$, current_user);
  EXECUTE format($p$CREATE POLICY payment_account_event ON public.ministry_payment_accounts FOR UPDATE TO %I USING (
    tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.ministry_payment_grants g
      WHERE g.mode = 'event' AND g.provider = ministry_payment_accounts.provider AND g.account_id = ministry_payment_accounts.account_id))$p$, current_user);
  FOREACH tbl IN ARRAY ARRAY['ministry_payment_intents','ministry_payment_ledger','ministry_donation_receipts','ministry_payment_prices'] LOOP
    EXECUTE format('CREATE POLICY payment_scoped_owner ON public.%I TO %I USING (%s AND EXISTS (SELECT FROM public.ministry_payment_grants))
      WITH CHECK (%s AND EXISTS (SELECT FROM public.ministry_payment_grants))', tbl, current_user, scoped, scoped);
  END LOOP;
  EXECUTE format('CREATE POLICY payment_catalog_owner ON public.catalog_items FOR SELECT TO %I USING (
    %s AND state = ''published'' AND visibility IN (''listed'',''unlisted'')
    AND EXISTS (SELECT FROM public.ministry_payment_grants g WHERE g.mode = ''checkout''))', current_user, scoped);
  EXECUTE format('CREATE POLICY payment_workspace_owner ON public.workspaces FOR SELECT TO %I USING (
    %s AND EXISTS (SELECT FROM public.ministry_payment_grants g WHERE g.mode = ''checkout''))', current_user, scoped);
  -- Only the authenticated webhook path inserts event facts. It runs without a session actor and holds a transaction grant.
  EXECUTE format($p$CREATE POLICY payment_event_definer ON public.ministry_payment_events TO %I USING (
    nullif(current_setting('app.user_id',true),'') IS NULL AND
    EXISTS (SELECT FROM public.ministry_payment_grants g WHERE g.mode = 'event' AND g.provider = ministry_payment_events.provider
      AND g.account_id = ministry_payment_events.account_id)) WITH CHECK (
    nullif(current_setting('app.user_id',true),'') IS NULL AND
    EXISTS (SELECT FROM public.ministry_payment_grants g WHERE g.mode = 'event' AND g.provider = ministry_payment_events.provider
      AND g.account_id = ministry_payment_events.account_id))$p$, current_user);
END $$;
CREATE POLICY payment_own_receipt ON public.ministry_donation_receipts FOR SELECT TO harvest_app
  USING (donor_id = nullif(current_setting('app.user_id', true), '') AND donor_id IS NOT NULL);
--> statement-breakpoint
CREATE FUNCTION public.ministry_payment_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'ministry payment ledger is append-only' USING ERRCODE = '42501'; END $$;
REVOKE ALL ON FUNCTION public.ministry_payment_append_only() FROM PUBLIC;
CREATE TRIGGER ministry_payment_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.ministry_payment_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.ministry_payment_append_only();
--> statement-breakpoint
-- Keys never move: a payout account keeps its tenant, provider and account ID, and a price keeps its tenant and item.
CREATE FUNCTION public.ministry_payment_keys_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'ministry_payment_accounts' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.provider IS DISTINCT FROM OLD.provider THEN
      RAISE EXCEPTION 'ministry payment account identity is immutable' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    RAISE EXCEPTION 'ministry payment price identity is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ministry_payment_keys_fixed() FROM PUBLIC;
CREATE TRIGGER ministry_payment_account_keys BEFORE UPDATE ON public.ministry_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.ministry_payment_keys_fixed();
CREATE TRIGGER ministry_payment_price_keys BEFORE UPDATE ON public.ministry_payment_prices
  FOR EACH ROW EXECUTE FUNCTION public.ministry_payment_keys_fixed();
--> statement-breakpoint
-- Founder decision 27 Nov: only the ministry owner connects, syncs or disconnects the payout account. The app passes the
-- provider's answer; the account ID and provider are fixed at creation. Status from the app is accepted only for the
-- synthetic provider; a live provider's status arrives only as a verified event through ministry_payment_record_event.
CREATE FUNCTION public.ministry_payment_account_change(p_tenant uuid,p_action text,p_provider text,p_account text,
  p_request text,p_fingerprint text,p_legal text,p_country text,p_currency text,p_charges boolean,p_payouts boolean,p_due text[])
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id',true),'');
DECLARE prior jsonb;
DECLARE merchant public.ministry_payment_accounts;
DECLARE seen text;
DECLARE result text := 'missing';
BEGIN
  IF actor IS NULL OR p_tenant IS NULL OR p_action IS NULL OR p_action NOT IN ('connect','sync','disconnect')
    OR p_provider IS NULL OR p_provider NOT IN ('fake','stripe_connect')
    OR p_account IS NULL OR p_account !~ '^[A-Za-z0-9_:-]{1,120}$' THEN
    RETURN result;
  END IF;
  prior := public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.user_id', actor, true);
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('ministry-payments:' || p_tenant::text,0));
  INSERT INTO public.ministry_payment_grants VALUES (pg_backend_pid(), pg_current_xact_id()::text,'account',p_account,p_provider);
  IF EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = p_tenant AND m.user_id = actor AND m.role_id = 'owner') THEN
    SELECT * INTO merchant FROM public.ministry_payment_accounts WHERE tenant_id = p_tenant;
    IF merchant.tenant_id IS NOT NULL AND (merchant.provider <> p_provider OR merchant.account_id <> p_account) THEN
      result := CASE WHEN p_action = 'connect' THEN 'account_changed' ELSE 'missing' END;
    ELSIF p_action = 'connect' THEN
      IF p_request IS NOT NULL AND p_request ~ '^[A-Za-z0-9._:-]{1,200}$' AND p_fingerprint ~ '^[0-9a-f]{64}$' THEN
        SELECT fingerprint INTO seen FROM public.ministry_payment_onboarding WHERE tenant_id = p_tenant AND request_key = p_request;
        IF seen IS NOT NULL THEN
          result := CASE WHEN seen = p_fingerprint THEN 'replay' ELSE 'key_conflict' END;
        ELSIF merchant.tenant_id IS NULL THEN
          INSERT INTO public.ministry_payment_accounts (tenant_id,account_id,provider,legal_name,country,currency,status_reported_at)
            VALUES (p_tenant,p_account,p_provider,p_legal,p_country,p_currency,now());
          INSERT INTO public.ministry_payment_onboarding VALUES (p_tenant,p_request,p_fingerprint);
          result := 'ok';
        ELSE
          UPDATE public.ministry_payment_accounts SET legal_name = p_legal, country = p_country, currency = p_currency,
            disconnected_at = NULL, status_reported_at = now(), charges_enabled = false, payouts_enabled = false,
            requirements_due = ARRAY[]::text[] WHERE tenant_id = p_tenant;
          INSERT INTO public.ministry_payment_onboarding VALUES (p_tenant,p_request,p_fingerprint);
          result := 'ok';
        END IF;
      END IF;
    ELSIF merchant.tenant_id IS NOT NULL AND p_action = 'disconnect' THEN
      IF merchant.disconnected_at IS NULL THEN
        UPDATE public.ministry_payment_accounts SET charges_enabled = false, payouts_enabled = false,
          requirements_due = ARRAY[]::text[], disconnected_at = now(), status_reported_at = now() WHERE tenant_id = p_tenant;
      END IF;
      result := 'ok';
    ELSIF merchant.tenant_id IS NOT NULL AND p_action = 'sync' AND merchant.disconnected_at IS NULL AND p_provider = 'fake'
      AND p_charges IS NOT NULL AND p_payouts IS NOT NULL AND p_due IS NOT NULL AND cardinality(p_due) <= 80 THEN
      UPDATE public.ministry_payment_accounts SET charges_enabled = p_charges, payouts_enabled = p_payouts,
        requirements_due = p_due, status_reported_at = now() WHERE tenant_id = p_tenant;
      result := 'ok';
    END IF;
  END IF;
  DELETE FROM public.ministry_payment_grants WHERE backend = pg_backend_pid();
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ministry_payment_account_change(uuid,text,text,text,text,text,text,text,text,boolean,boolean,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ministry_payment_account_change(uuid,text,text,text,text,text,text,text,text,boolean,boolean,text[]) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.ministry_fake_checkout(p_tenant uuid,p_request text,p_kind text,p_cadence text,p_item uuid,p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id',true),'');
DECLARE prior jsonb;
DECLARE merchant public.ministry_payment_accounts;
DECLARE intent public.ministry_payment_intents;
DECLARE price public.ministry_payment_prices;
DECLARE personal_support boolean;
DECLARE result jsonb := '{"outcome":"missing"}';
BEGIN
  IF actor IS NULL OR p_tenant IS NULL OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{1,200}$'
    OR p_kind IS NULL OR p_cadence IS NULL
    OR ((p_kind = 'donation' AND p_item IS NULL AND p_cadence IN ('once','monthly') AND p_amount BETWEEN 1 AND 1000000000000)
      OR (p_kind = 'sale' AND p_item IS NOT NULL AND p_cadence = 'once' AND p_amount IS NULL)) IS NOT TRUE THEN
    RETURN result;
  END IF;
  prior := public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM set_config('app.user_id', actor, true);
  PERFORM set_config('app.tenant_id', p_tenant::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('ministry-payments:' || p_tenant::text,0));
  INSERT INTO public.ministry_payment_grants VALUES (pg_backend_pid(), pg_current_xact_id()::text,'checkout',NULL,'fake');
  SELECT * INTO merchant FROM public.ministry_payment_accounts WHERE tenant_id = p_tenant AND provider = 'fake'
    AND disconnected_at IS NULL AND charges_enabled AND payouts_enabled AND cardinality(requirements_due) = 0;
  IF merchant.tenant_id IS NOT NULL THEN
    SELECT * INTO intent FROM public.ministry_payment_intents WHERE tenant_id = p_tenant AND payer_id = actor AND request_key = p_request;
    IF intent.id IS NOT NULL THEN
      IF intent.kind <> p_kind OR intent.cadence <> p_cadence OR intent.item_id IS DISTINCT FROM p_item
        OR (p_kind = 'donation' AND intent.amount_minor <> p_amount) THEN
        result := '{"outcome":"key_conflict"}';
      END IF;
    ELSE
      IF p_kind = 'sale' THEN
        SELECT p.* INTO price FROM public.ministry_payment_prices p JOIN public.catalog_items i ON i.tenant_id = p.tenant_id AND i.id = p.item_id
          WHERE p.tenant_id = p_tenant AND p.item_id = p_item AND i.state = 'published' AND i.visibility IN ('listed','unlisted');
      ELSE
        price.amount_minor := p_amount;
        price.currency := merchant.currency;
      END IF;
      IF price.amount_minor IS NOT NULL AND price.currency = merchant.currency THEN
        SELECT audience = 'evangelist_missionary' INTO personal_support FROM public.workspaces WHERE tenant_id = p_tenant;
        INSERT INTO public.ministry_payment_intents (tenant_id,payer_id,account_id,kind,cadence,item_id,amount_minor,currency,legal_name,personal_support,request_key)
          VALUES (p_tenant,actor,merchant.account_id,p_kind,p_cadence,p_item,price.amount_minor,price.currency,merchant.legal_name,coalesce(personal_support,false),p_request)
          RETURNING * INTO intent;
      END IF;
    END IF;
    IF intent.id IS NOT NULL AND result->>'outcome' <> 'key_conflict' THEN
      result := jsonb_build_object('outcome','ok','id',intent.id,'accountId',intent.account_id,'amountMinor',intent.amount_minor::text,
        'currency',intent.currency,'kind',intent.kind,'cadence',intent.cadence,'personalSupport',intent.personal_support);
    END IF;
  END IF;
  DELETE FROM public.ministry_payment_grants WHERE backend = pg_backend_pid();
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ministry_fake_checkout(uuid,text,text,text,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ministry_fake_checkout(uuid,text,text,text,uuid,bigint) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.ministry_payment_record_event(p_provider text,p_event text,p_account text,p_kind text,p_object text,p_payment text,
  p_intent uuid,p_amount bigint,p_currency text,p_time timestamptz,p_charges boolean,p_payouts boolean,p_due text[])
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb;
DECLARE merchant public.ministry_payment_accounts;
DECLARE intent public.ministry_payment_intents;
DECLARE ledger_id uuid;
DECLARE result text := 'ignored';
BEGIN
  IF session_user IS DISTINCT FROM 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  -- The worker can exercise only the fake provider until the activation slice.
  IF p_provider IS DISTINCT FROM 'fake' OR p_event IS NULL OR p_event !~ '^[A-Za-z0-9_:-]{1,120}$'
    OR p_account IS NULL OR p_account !~ '^[A-Za-z0-9_:-]{1,120}$' THEN RETURN result; END IF;
  prior := public.blog_scope_clear();
  PERFORM public.account_self_reset();
  INSERT INTO public.ministry_payment_grants VALUES (pg_backend_pid(), pg_current_xact_id()::text,'event',p_account,p_provider);
  INSERT INTO public.ministry_payment_events (provider,event_id,account_id,outcome)
    VALUES(p_provider,p_event,p_account,'ignored') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    DELETE FROM public.ministry_payment_grants WHERE backend = pg_backend_pid();
    PERFORM public.blog_scope_restore(prior);
    RETURN 'duplicate';
  END IF;
  SELECT * INTO merchant FROM public.ministry_payment_accounts WHERE account_id = p_account AND provider = p_provider;
  IF merchant.tenant_id IS NOT NULL AND p_time IS NOT NULL THEN
    PERFORM set_config('app.tenant_id', merchant.tenant_id::text, true);
    PERFORM pg_advisory_xact_lock(hashtextextended('ministry-payments:' || merchant.tenant_id::text,0));
    IF p_kind IN ('account_status','account_disconnected') THEN
      IF (p_kind = 'account_disconnected' OR (p_charges IS NOT NULL AND p_payouts IS NOT NULL AND p_due IS NOT NULL)) THEN
        UPDATE public.ministry_payment_accounts
          SET status_reported_at = p_time,
            charges_enabled = CASE WHEN p_kind = 'account_disconnected' THEN false ELSE p_charges END,
            payouts_enabled = CASE WHEN p_kind = 'account_disconnected' THEN false ELSE p_payouts END,
            requirements_due = CASE WHEN p_kind = 'account_disconnected' THEN ARRAY[]::text[] ELSE p_due END,
            disconnected_at = CASE WHEN p_kind = 'account_disconnected' THEN p_time ELSE disconnected_at END
          WHERE tenant_id = merchant.tenant_id AND disconnected_at IS NULL AND (status_reported_at IS NULL OR status_reported_at < p_time);
        IF FOUND THEN result := 'recorded'; END IF;
      END IF;
    ELSE
      IF p_intent IS NOT NULL THEN
        SELECT * INTO intent FROM public.ministry_payment_intents WHERE tenant_id = merchant.tenant_id AND id = p_intent AND account_id = p_account;
      END IF;
      IF p_kind = 'subscription_ended' AND intent.cadence = 'monthly' THEN
        UPDATE public.ministry_payment_intents SET subscription_ended_at = p_time WHERE tenant_id = merchant.tenant_id AND id = intent.id
          AND (subscription_ended_at IS NULL OR subscription_ended_at > p_time);
        IF FOUND THEN result := 'recorded'; END IF;
      ELSIF p_kind IN ('charge','application_fee','refund','dispute_opened','dispute_won','dispute_lost','payout')
        AND p_object ~ '^[A-Za-z0-9_:-]{1,120}$' AND p_amount BETWEEN 0 AND 1000000000000 AND p_currency ~ '^[A-Z]{3}$'
        AND (p_kind = 'payout' OR p_payment ~ '^[A-Za-z0-9_:-]{1,120}$')
        AND (p_kind <> 'charge' OR (p_amount > 0 AND NOT EXISTS (SELECT FROM public.ministry_payment_ledger
          WHERE tenant_id = merchant.tenant_id AND account_id = p_account AND kind = 'charge' AND payment_ref = p_payment)
          AND (p_intent IS NULL OR
          (intent.id IS NOT NULL AND intent.amount_minor = p_amount AND intent.currency = p_currency AND
            (intent.cadence = 'monthly' OR NOT EXISTS (SELECT FROM public.ministry_payment_ledger
              WHERE tenant_id = merchant.tenant_id AND intent_id = intent.id AND kind = 'charge')))))) THEN
        INSERT INTO public.ministry_payment_ledger (tenant_id,account_id,intent_id,payment_ref,object_ref,kind,amount_minor,currency,occurred_at)
          VALUES (merchant.tenant_id,p_account,intent.id,p_payment,p_object,p_kind,p_amount,p_currency,p_time)
          ON CONFLICT DO NOTHING RETURNING id INTO ledger_id;
        IF ledger_id IS NOT NULL THEN
          result := 'recorded';
          IF p_kind = 'charge' AND intent.kind = 'donation' THEN
            INSERT INTO public.ministry_donation_receipts (tenant_id,ledger_id,intent_id,donor_id,amount_minor,currency,paid_at,legal_name,personal_support,cadence)
              VALUES (merchant.tenant_id,ledger_id,intent.id,intent.payer_id,p_amount,p_currency,p_time,intent.legal_name,intent.personal_support,intent.cadence);
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  UPDATE public.ministry_payment_events SET outcome = result WHERE provider = p_provider AND event_id = p_event;
  DELETE FROM public.ministry_payment_grants WHERE backend = pg_backend_pid();
  PERFORM public.blog_scope_restore(prior);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ministry_payment_record_event(text,text,text,text,text,text,uuid,bigint,text,timestamptz,boolean,boolean,text[])
  FROM PUBLIC, harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.ministry_payment_record_event(text,text,text,text,text,text,uuid,bigint,text,timestamptz,boolean,boolean,text[])
      TO harvest_worker;
  END IF;
END $$;
