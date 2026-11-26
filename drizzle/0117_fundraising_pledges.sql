CREATE TABLE "fundraising_campaigns" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"title" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"goal_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fundraising_campaigns_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "fundraising_campaigns_currency_key" UNIQUE("tenant_id","id","currency"),
	CONSTRAINT "fundraising_title" CHECK (length(btrim("fundraising_campaigns"."title")) between 1 and 200 and "fundraising_campaigns"."title" = btrim("fundraising_campaigns"."title")),
	CONSTRAINT "fundraising_summary" CHECK (length("fundraising_campaigns"."summary") <= 2000),
	CONSTRAINT "fundraising_status" CHECK ("fundraising_campaigns"."status" in ('draft', 'published', 'closed', 'archived')),
	CONSTRAINT "fundraising_goal" CHECK ("fundraising_campaigns"."goal_cents" between 1 and 1000000000000),
	CONSTRAINT "fundraising_currency" CHECK ("fundraising_campaigns"."currency" in ('USD','EUR','GBP','CAD','AUD','NZD','CHF','ZAR','BRL','MXN','INR','PHP','KES','NGN','GHS')),
	CONSTRAINT "fundraising_version" CHECK ("fundraising_campaigns"."version" >= 1),
	CONSTRAINT "fundraising_idempotency_key" CHECK (length("fundraising_campaigns"."idempotency_key") between 1 and 200 and "fundraising_campaigns"."idempotency_key" ~ '^[A-Za-z0-9._:-]+$')
);
--> statement-breakpoint
CREATE TABLE "fundraising_pledges" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"fundraising_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"contact_id" uuid,
	"supporter_name" text,
	"supporter_contact" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expected_on" date,
	"source" text DEFAULT 'staff' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fundraising_pledges_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "fundraising_pledges_campaign_key" UNIQUE("tenant_id","id","fundraising_id"),
	CONSTRAINT "fundraising_pledge_amount" CHECK ("fundraising_pledges"."amount_cents" between 1 and 1000000000000),
	CONSTRAINT "fundraising_pledge_status" CHECK ("fundraising_pledges"."status" in ('pending', 'accepted', 'cancelled')),
	CONSTRAINT "fundraising_pledge_source" CHECK ("fundraising_pledges"."source" in ('staff')),
	CONSTRAINT "fundraising_pledge_name" CHECK (length(btrim("fundraising_pledges"."supporter_name")) between 1 and 120),
	CONSTRAINT "fundraising_pledge_contact" CHECK (length(btrim("fundraising_pledges"."supporter_contact")) between 1 and 200),
	CONSTRAINT "fundraising_pledge_version" CHECK ("fundraising_pledges"."version" >= 1),
	CONSTRAINT "fundraising_pledge_idempotency_key" CHECK (length("fundraising_pledges"."idempotency_key") between 1 and 200 and "fundraising_pledges"."idempotency_key" ~ '^[A-Za-z0-9._:-]+$')
);
--> statement-breakpoint
CREATE TABLE "giving_contact_links" (
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"contact_id" uuid,
	"supporter_name" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giving_contact_links_tenant_id_entry_id_pk" PRIMARY KEY("tenant_id","entry_id"),
	CONSTRAINT "giving_contact_link_name" CHECK (length(btrim("giving_contact_links"."supporter_name")) between 1 and 120),
	CONSTRAINT "giving_contact_link_some" CHECK ("giving_contact_links"."contact_id" is not null or "giving_contact_links"."supporter_name" is not null)
);
--> statement-breakpoint
CREATE TABLE "giving_ledger_entries" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"fundraising_id" uuid NOT NULL,
	"pledge_id" uuid,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"kind" text NOT NULL,
	"correction_of" uuid,
	"reason" text,
	"gift_date" date NOT NULL,
	"method_label" text,
	"reference" text,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "giving_ledger_entries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "giving_ledger_kind" CHECK ("giving_ledger_entries"."kind" in ('gift', 'reversal')),
	CONSTRAINT "giving_ledger_amount" CHECK (("giving_ledger_entries"."kind" = 'gift' and "giving_ledger_entries"."amount_cents" between 1 and 1000000000000) or ("giving_ledger_entries"."kind" = 'reversal' and "giving_ledger_entries"."amount_cents" between -1000000000000 and -1)),
	CONSTRAINT "giving_ledger_correction" CHECK (("giving_ledger_entries"."kind" = 'reversal') = ("giving_ledger_entries"."reason" is not null) and ("giving_ledger_entries"."kind" = 'gift' or "giving_ledger_entries"."correction_of" is not null)),
	CONSTRAINT "giving_ledger_reason" CHECK ("giving_ledger_entries"."reason" in ('entered_in_error', 'wrong_amount', 'wrong_campaign', 'other')),
	CONSTRAINT "giving_ledger_method" CHECK (length(btrim("giving_ledger_entries"."method_label")) between 1 and 80),
	CONSTRAINT "giving_ledger_reference" CHECK (length(btrim("giving_ledger_entries"."reference")) between 1 and 120),
	CONSTRAINT "giving_ledger_idempotency_key" CHECK (length("giving_ledger_entries"."idempotency_key") between 1 and 200 and "giving_ledger_entries"."idempotency_key" ~ '^[A-Za-z0-9._:-]+$')
);
--> statement-breakpoint
ALTER TABLE "fundraising_campaigns" ADD CONSTRAINT "fundraising_campaigns_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_campaigns" ADD CONSTRAINT "fundraising_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_campaigns" ADD CONSTRAINT "fundraising_campaigns_tenant_id_campaign_id_campaigns_tenant_id_id_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_pledges" ADD CONSTRAINT "fundraising_pledges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_pledges" ADD CONSTRAINT "fundraising_pledges_tenant_id_fundraising_id_currency_fundraising_campaigns_tenant_id_id_currency_fk" FOREIGN KEY ("tenant_id","fundraising_id","currency") REFERENCES "public"."fundraising_campaigns"("tenant_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_pledges" ADD CONSTRAINT "fundraising_pledges_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_contact_links" ADD CONSTRAINT "giving_contact_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_contact_links" ADD CONSTRAINT "giving_contact_links_tenant_id_entry_id_giving_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."giving_ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_contact_links" ADD CONSTRAINT "giving_contact_links_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_ledger_entries" ADD CONSTRAINT "giving_ledger_entries_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_ledger_entries" ADD CONSTRAINT "giving_ledger_entries_tenant_id_fundraising_id_currency_fundraising_campaigns_tenant_id_id_currency_fk" FOREIGN KEY ("tenant_id","fundraising_id","currency") REFERENCES "public"."fundraising_campaigns"("tenant_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_ledger_entries" ADD CONSTRAINT "giving_ledger_entries_tenant_id_pledge_id_fundraising_id_fundraising_pledges_tenant_id_id_fundraising_id_fk" FOREIGN KEY ("tenant_id","pledge_id","fundraising_id") REFERENCES "public"."fundraising_pledges"("tenant_id","id","fundraising_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giving_ledger_entries" ADD CONSTRAINT "giving_ledger_entries_tenant_id_correction_of_giving_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","correction_of") REFERENCES "public"."giving_ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fundraising_campaigns_idempotency_idx" ON "fundraising_campaigns" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "fundraising_campaigns_created_idx" ON "fundraising_campaigns" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fundraising_campaigns_campaign_idx" ON "fundraising_campaigns" USING btree ("tenant_id","campaign_id") WHERE "fundraising_campaigns"."campaign_id" is not null and "fundraising_campaigns"."status" <> 'archived';--> statement-breakpoint
CREATE UNIQUE INDEX "fundraising_pledges_idempotency_idx" ON "fundraising_pledges" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "fundraising_pledges_campaign_idx" ON "fundraising_pledges" USING btree ("tenant_id","fundraising_id","created_at","id");--> statement-breakpoint
CREATE INDEX "giving_contact_links_contact_idx" ON "giving_contact_links" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "giving_ledger_idempotency_idx" ON "giving_ledger_entries" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "giving_ledger_one_reversal_idx" ON "giving_ledger_entries" USING btree ("tenant_id","correction_of") WHERE "giving_ledger_entries"."kind" = 'reversal';--> statement-breakpoint
CREATE UNIQUE INDEX "giving_ledger_one_replacement_idx" ON "giving_ledger_entries" USING btree ("tenant_id","correction_of") WHERE "giving_ledger_entries"."kind" = 'gift' and "giving_ledger_entries"."correction_of" is not null;--> statement-breakpoint
CREATE INDEX "giving_ledger_campaign_idx" ON "giving_ledger_entries" USING btree ("tenant_id","fundraising_id","confirmed_at","id");--> statement-breakpoint
CREATE INDEX "giving_ledger_pledge_idx" ON "giving_ledger_entries" USING btree ("tenant_id","pledge_id");--> statement-breakpoint
-- Fundraising pledge campaigns (record keeping only; Harvest moves no money). Campaign rows belong to the Giving area; pledges, gifts and supporter
-- links are owner/admin only whatever an area grant says (owner_admin is never grantable, so a collaborator reads as guest there).
CREATE FUNCTION public.giving_can(p_tenant uuid, p_area text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND public.access_role(m.tenant_id, m.user_id, p_area, m.role_id) IN ('owner', 'admin'))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giving_can(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giving_can(uuid, text) TO harvest_app;--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fundraising_campaigns', 'fundraising_pledges', 'giving_ledger_entries', 'giving_contact_links'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', t);
  END LOOP;
END $$;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.fundraising_campaigns TO harvest_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.fundraising_pledges TO harvest_app;--> statement-breakpoint
-- The ledger is append-only: no UPDATE or DELETE grant, and the trigger below refuses them for every role.
GRANT SELECT, INSERT ON public.giving_ledger_entries TO harvest_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.giving_contact_links TO harvest_app;--> statement-breakpoint
CREATE POLICY fundraising_staff ON public.fundraising_campaigns TO harvest_app
  USING (public.giving_can(tenant_id, 'giving')) WITH CHECK (public.giving_can(tenant_id, 'giving'));--> statement-breakpoint
CREATE POLICY fundraising_pledges_staff ON public.fundraising_pledges TO harvest_app
  USING (public.giving_can(tenant_id, 'owner_admin')) WITH CHECK (public.giving_can(tenant_id, 'owner_admin'));--> statement-breakpoint
CREATE POLICY giving_ledger_read ON public.giving_ledger_entries FOR SELECT TO harvest_app USING (public.giving_can(tenant_id, 'owner_admin'));--> statement-breakpoint
CREATE POLICY giving_ledger_confirm ON public.giving_ledger_entries FOR INSERT TO harvest_app
  WITH CHECK (public.giving_can(tenant_id, 'owner_admin') AND confirmed_by = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY giving_contact_links_staff ON public.giving_contact_links TO harvest_app
  USING (public.giving_can(tenant_id, 'owner_admin')) WITH CHECK (public.giving_can(tenant_id, 'owner_admin'));--> statement-breakpoint
CREATE FUNCTION public.reject_giving_ledger_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'giving_ledger_entries are append-only' USING ERRCODE = '42501'; END $$;--> statement-breakpoint
CREATE TRIGGER giving_ledger_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.giving_ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_giving_ledger_mutation();--> statement-breakpoint
-- A correction is an exact reversal of a gift (same campaign, currency and pledge, opposite amount), optionally followed in the same chain by one
-- replacement gift. A reversal of a reversal, a replacement before its reversal, and new gifts on an archived campaign are refused.
CREATE FUNCTION public.guard_giving_ledger_entry() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE o public.giving_ledger_entries%ROWTYPE; campaign_status text;
BEGIN
  SELECT f.status INTO campaign_status FROM public.fundraising_campaigns f WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.fundraising_id;
  IF NEW.correction_of IS NULL THEN
    IF campaign_status IS DISTINCT FROM 'draft' AND campaign_status IS DISTINCT FROM 'published' AND campaign_status IS DISTINCT FROM 'closed' THEN
      RAISE EXCEPTION 'campaign does not accept gifts' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO o FROM public.giving_ledger_entries e WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.correction_of;
  IF NOT FOUND OR o.kind <> 'gift' OR o.fundraising_id <> NEW.fundraising_id OR o.currency <> NEW.currency
    OR o.pledge_id IS DISTINCT FROM NEW.pledge_id THEN
    RAISE EXCEPTION 'invalid correction' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'reversal' AND NEW.amount_cents <> -o.amount_cents THEN RAISE EXCEPTION 'invalid correction' USING ERRCODE = '23514'; END IF;
  IF NEW.kind = 'gift' AND NOT EXISTS (SELECT 1 FROM public.giving_ledger_entries r WHERE r.tenant_id = NEW.tenant_id AND r.correction_of = o.id AND r.kind = 'reversal') THEN
    RAISE EXCEPTION 'invalid correction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER giving_ledger_guard BEFORE INSERT ON public.giving_ledger_entries FOR EACH ROW EXECUTE FUNCTION public.guard_giving_ledger_entry();--> statement-breakpoint
-- Lifecycle: draft -> published (open) -> closed -> archived, or draft -> archived. No reopening. The version always moves forward by one.
CREATE FUNCTION public.guard_fundraising_campaign() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_by <> OLD.created_by OR NEW.idempotency_key <> OLD.idempotency_key
    OR NEW.created_at <> OLD.created_at OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid fundraising update' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('draft', 'published'), ('draft', 'archived'), ('published', 'closed'), ('closed', 'archived'))) THEN
    RAISE EXCEPTION 'invalid fundraising transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER fundraising_campaign_guard BEFORE UPDATE ON public.fundraising_campaigns FOR EACH ROW EXECUTE FUNCTION public.guard_fundraising_campaign();--> statement-breakpoint
CREATE FUNCTION public.guard_fundraising_pledge() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.fundraising_id <> OLD.fundraising_id OR NEW.amount_cents <> OLD.amount_cents
    OR NEW.currency <> OLD.currency OR NEW.created_by <> OLD.created_by OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid pledge update' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('pending', 'accepted'), ('pending', 'cancelled'), ('accepted', 'cancelled'))) THEN
    RAISE EXCEPTION 'invalid pledge transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER fundraising_pledge_guard BEFORE UPDATE ON public.fundraising_pledges FOR EACH ROW EXECUTE FUNCTION public.guard_fundraising_pledge();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.reject_giving_ledger_mutation(), public.guard_giving_ledger_entry(), public.guard_fundraising_campaign(), public.guard_fundraising_pledge() FROM PUBLIC;
