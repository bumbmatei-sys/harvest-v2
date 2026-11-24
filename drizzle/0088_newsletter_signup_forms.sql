CREATE TABLE "newsletter_form_signups" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"receipt" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"email_proof" text NOT NULL,
	"contact_id" uuid,
	"list_ids" uuid[] NOT NULL,
	"wording_version" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "newsletter_form_signups_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "newsletter_form_signup_token" UNIQUE("token_hash"),
	CONSTRAINT "newsletter_form_signup_receipt" UNIQUE("tenant_id","form_id","receipt"),
	CONSTRAINT "newsletter_form_signup_hashes" CHECK ("newsletter_form_signups"."token_hash" ~ '^[0-9a-f]{64}$' and "newsletter_form_signups"."email_proof" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "newsletter_form_signup_lists" CHECK (cardinality("newsletter_form_signups"."list_ids") between 1 and 10),
	CONSTRAINT "newsletter_form_signup_names" CHECK (length(coalesce("newsletter_form_signups"."first_name", '')) <= 100 and length(coalesce("newsletter_form_signups"."last_name", '')) <= 100 and ("newsletter_form_signups"."state" = 'pending' or ("newsletter_form_signups"."first_name" is null and "newsletter_form_signups"."last_name" is null))),
	CONSTRAINT "newsletter_form_signup_confirmed" CHECK (("newsletter_form_signups"."state" in ('confirmed', 'blocked')) = ("newsletter_form_signups"."confirmed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "newsletter_form_signups" ADD CONSTRAINT "newsletter_form_signup_publication_fk" FOREIGN KEY ("tenant_id","form_id","version_id") REFERENCES "public"."crm_form_publications"("tenant_id","form_id","version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_form_signups_form_idx" ON "newsletter_form_signups" USING btree ("tenant_id","form_id","state");--> statement-breakpoint
CREATE INDEX "newsletter_form_signups_expiry_idx" ON "newsletter_form_signups" USING btree ("expires_at") WHERE "newsletter_form_signups"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "newsletter_form_signups_contact_idx" ON "newsletter_form_signups" USING btree ("tenant_id","contact_id") WHERE "newsletter_form_signups"."contact_id" is not null;
--> statement-breakpoint
-- Hosted newsletter sign-ups. Row security is forced. Owners and admins read their own ministry's rows (counts for the form screen);
-- only the definer functions below write. The address is never stored: the confirmation link carries it and a digest binds it to the token.
ALTER TABLE public.newsletter_form_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_form_signups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_form_signups FROM PUBLIC, harvest_app;
GRANT SELECT (tenant_id, id, form_id, version_id, state, created_at, expires_at, confirmed_at, list_ids, wording_version) ON public.newsletter_form_signups TO harvest_app;
CREATE POLICY nl_form_signup_managers ON public.newsletter_form_signups FOR SELECT TO harvest_app USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = newsletter_form_signups.tenant_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format($p$CREATE POLICY nl_form_signup_private ON public.newsletter_form_signups TO %I
    USING (coalesce(current_setting('app.nl02_private', true), '') = 'on')
    WITH CHECK (coalesce(current_setting('app.nl02_private', true), '') = 'on')$p$, current_user);
  -- The start and confirm functions check that each list still exists and is live.
  EXECUTE format($p$CREATE POLICY nl_form_signup_lists ON public.newsletter_lists FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.nl02_tenant', true), '')::uuid)$p$, current_user);
  -- Archiving a sign-up form: only the definer below, scoped to one ministry.
  EXECUTE format($p$CREATE POLICY nl_form_archive_read ON public.forms FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.nl_forms_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY nl_form_archive_write ON public.forms FOR UPDATE TO %I
    USING (tenant_id = nullif(current_setting('app.nl_forms_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.nl_forms_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY nl_form_archive_address ON public.crm_form_addresses FOR UPDATE TO %I
    USING (tenant_id = nullif(current_setting('app.nl_forms_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.nl_forms_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY nl_form_archive_address_read ON public.crm_form_addresses FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.nl_forms_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY nl_form_archive_versions ON public.form_versions FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.nl_forms_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY nl_form_archive_audit ON public.audit_logs FOR INSERT TO %I
    WITH CHECK (tenant_id = nullif(current_setting('app.nl_forms_tenant', true), '')::uuid AND action = 'newsletter.signup_form.archive')$p$, current_user);
END $$;
--> statement-breakpoint
-- The shared grant step of NL-02's confirmation, so one-list and several-list sign-ups apply the identical rules: a withdrawal that is newer than
-- the request, a suppression, a bounce or a later unsubscribe all win, and only a verified confirmation writes the grant. Returns whether it granted.
CREATE FUNCTION public.nl02_grant_list(p_tenant uuid, p_list uuid, p_contact uuid, p_email text, p_created_at timestamptz, p_actor text, p_evidence text)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  subscriber public.newsletter_subscribers;
  current_subscription public.newsletter_subscriptions;
  grant_id uuid;
BEGIN
  IF public.nl02_has_withdrawal(p_tenant, p_contact, p_created_at, false)
    OR public.nl02_has_withdrawal(p_tenant, p_contact, NULL, true) THEN RETURN false; END IF;
  SELECT * INTO subscriber FROM public.newsletter_subscribers WHERE tenant_id = p_tenant AND contact_id = p_contact FOR UPDATE;
  IF subscriber.suppressed THEN RETURN false; END IF;
  SELECT * INTO current_subscription FROM public.newsletter_subscriptions
    WHERE tenant_id = p_tenant AND subscriber_id = subscriber.id AND list_id = p_list;
  IF current_subscription.state IN ('suppressed', 'bounced')
    OR (current_subscription.state = 'unsubscribed' AND current_subscription.updated_at >= p_created_at)
    OR (current_subscription.state = 'subscribed' AND public.newsletter_consent_allowed(p_tenant, p_contact, current_subscription.consent_id))
    THEN RETURN false; END IF;

  IF NOT public.newsletter_apply_verified_opt_in(p_tenant, p_list, p_email, p_created_at) THEN RETURN false; END IF;
  IF subscriber.id IS NULL THEN
    PERFORM set_config('app.user_id', p_actor, true);
    INSERT INTO public.newsletter_subscribers(tenant_id, contact_id, created_by)
      VALUES(p_tenant, p_contact, p_actor) RETURNING * INTO subscriber;
  END IF;
  INSERT INTO public.contact_consents(tenant_id, contact_id, purpose, channel, status, source, evidence, notice_version, occurred_at)
    VALUES(p_tenant, p_contact, 'newsletter', 'email', 'granted', 'newsletter_verified_signup', p_evidence, 'newsletter-subject-v1', clock_timestamp())
    RETURNING id INTO grant_id;
  IF public.newsletter_consent_allowed(p_tenant, p_contact, grant_id) THEN
    INSERT INTO public.newsletter_subscriptions AS ns(tenant_id, list_id, subscriber_id, state, consent_id)
      VALUES(p_tenant, p_list, subscriber.id, 'subscribed', grant_id)
    ON CONFLICT(tenant_id, list_id, subscriber_id) DO UPDATE SET
      state = excluded.state, consent_id = excluded.consent_id, version = ns.version + 1, updated_at = clock_timestamp();
  END IF;
  INSERT INTO public.audit_logs(tenant_id, actor_id, action, target_id, metadata)
    VALUES(p_tenant, NULL, 'newsletter.signup.confirmed', subscriber.id::text, jsonb_build_object('listId', p_list, 'notice', 'newsletter-subject-v1'));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.nl02_grant_list(uuid, uuid, uuid, text, timestamptz, text, text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.nl02_accept_signup(p_email text,p_token text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  pending public.newsletter_signup_challenges;
  form public.newsletter_signup_forms;
  contact uuid;
BEGIN
  SELECT * INTO pending FROM public.newsletter_signup_challenges
    WHERE token_hash=public.nl02_hash(p_token) AND expires_at>clock_timestamp()
      AND email_proof=public.nl02_hash(p_token||':'||p_email);
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO form FROM public.newsletter_signup_forms
    WHERE tenant_id=pending.tenant_id AND id=pending.form_id AND active AND version=pending.form_version FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id',form.tenant_id::text,true);
  PERFORM set_config('app.nl02_tenant',form.tenant_id::text,true);
  PERFORM pg_advisory_xact_lock(hashtextextended(form.tenant_id::text||':newsletter:'||p_email,0));

  SELECT contact_id INTO contact FROM public.contact_identifiers
    WHERE tenant_id=form.tenant_id AND kind='email' AND normalized_value=p_email;
  IF pending.contact_id IS NOT NULL AND pending.contact_id IS DISTINCT FROM contact THEN RETURN; END IF;
  IF contact IS NULL THEN
    BEGIN
      INSERT INTO public.contacts(tenant_id,name) VALUES(form.tenant_id,'Newsletter subscriber') RETURNING id INTO contact;
      INSERT INTO public.contact_identifiers(tenant_id,contact_id,kind,value,normalized_value)
        VALUES(form.tenant_id,contact,'email',p_email,p_email);
    EXCEPTION WHEN unique_violation THEN
      SELECT contact_id INTO contact FROM public.contact_identifiers
        WHERE tenant_id=form.tenant_id AND kind='email' AND normalized_value=p_email;
    END;
  END IF;
  PERFORM 1 FROM public.contacts WHERE tenant_id=form.tenant_id AND id=contact AND erased_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT FROM public.contact_identifiers
    WHERE tenant_id=form.tenant_id AND contact_id=contact AND kind='email' AND normalized_value=p_email) THEN RETURN; END IF;
  DELETE FROM public.newsletter_signup_challenges WHERE token_hash=pending.token_hash AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.nl02_grant_list(form.tenant_id,form.list_id,contact,p_email,pending.created_at,form.created_by,
    'Explicit newsletter selection and email confirmation');
END $$;
--> statement-breakpoint
-- A person's pending hosted sign-ups go with them when they are erased.
CREATE FUNCTION public.newsletter_form_signup_before_erase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := current_setting('app.nl02_private', true);
BEGIN
  PERFORM set_config('app.nl02_private', 'on', true);
  DELETE FROM public.newsletter_form_signups WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id;
  PERFORM set_config('app.nl02_private', coalesce(previous, ''), true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_form_signup_before_erase() FROM PUBLIC, harvest_app;
CREATE TRIGGER newsletter_form_signup_before_erase BEFORE UPDATE ON public.contacts
  FOR EACH ROW WHEN (OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL)
  EXECUTE FUNCTION public.newsletter_form_signup_before_erase();
--> statement-breakpoint
-- Start: the public form's server has already charged the hosted-form limits (per visitor and per ministry); this adds the per-address hourly cap.
-- Everything about the form comes from the published snapshot, never from the caller: the lists, the wording version and whether it is a sign-up form at all.
-- Returns true only when a new pending sign-up was recorded, so the caller sends exactly one confirmation message.
CREATE FUNCTION public.newsletter_form_signup_start(p_slug text, p_version uuid, p_receipt uuid, p_email text, p_first text, p_last text, p_token text, p_address_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  address record; snapshot jsonb; wanted uuid[]; live uuid[]; contact uuid; queued boolean;
  previous_tenant text := current_setting('app.tenant_id', true);
  previous_nl02 text := current_setting('app.nl02_tenant', true);
  previous_slug text := current_setting('app.crm_forms_slug', true);
  previous_forms text := current_setting('app.crm_forms_tenant', true);
  previous_private text := current_setting('app.nl02_private', true);
  moment timestamptz := clock_timestamp(); hour_bucket timestamptz := date_trunc('hour', clock_timestamp());
BEGIN
  IF current_database() !~ '^harvest_test(_|$)' OR NOT public.nl02_email(p_email)
    OR coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{43}$' OR coalesce(p_address_key, '') !~ '^[0-9a-f]{64}$'
    OR length(coalesce(p_first, '')) > 100 OR length(coalesce(p_last, '')) > 100 OR public.valid_crm_form_slug(p_slug) IS NOT TRUE THEN RETURN false; END IF;
  PERFORM set_config('app.nl02_private', 'on', true);
  PERFORM set_config('app.crm_forms_slug', p_slug, true);
  queued := false;
  SELECT * INTO address FROM public.crm_form_addresses WHERE slug = p_slug AND retired_at IS NULL AND version_id = p_version;
  IF FOUND THEN
    PERFORM set_config('app.crm_forms_tenant', address.tenant_id::text, true);
    SELECT p.definition->'newsletter' INTO snapshot
      FROM public.crm_form_publications p JOIN public.forms f ON f.tenant_id = p.tenant_id AND f.id = p.form_id AND f.archived_at IS NULL
      WHERE p.tenant_id = address.tenant_id AND p.form_id = address.form_id AND p.version_id = address.version_id;
    IF snapshot IS NOT NULL AND jsonb_typeof(snapshot->'listIds') = 'array' THEN
      SELECT coalesce(array_agg(value::uuid), ARRAY[]::uuid[]) INTO wanted FROM jsonb_array_elements_text(snapshot->'listIds');
      PERFORM set_config('app.nl02_tenant', address.tenant_id::text, true);
      SELECT coalesce(array_agg(l.id ORDER BY l.id), ARRAY[]::uuid[]) INTO live FROM public.newsletter_lists l
        WHERE l.tenant_id = address.tenant_id AND l.id = ANY(wanted) AND l.archived_at IS NULL;
      IF cardinality(live) > 0 AND public.nl02_take('hosted-address:' || address.form_id || ':' || p_address_key, hour_bucket, hour_bucket + interval '1 hour', 3) THEN
        PERFORM set_config('app.tenant_id', address.tenant_id::text, true);
        SELECT c.id INTO contact FROM public.contact_identifiers i JOIN public.contacts c
          ON c.tenant_id = i.tenant_id AND c.id = i.contact_id AND c.erased_at IS NULL
          WHERE i.tenant_id = address.tenant_id AND i.kind = 'email' AND i.normalized_value = p_email FOR SHARE OF c;
        UPDATE public.newsletter_form_signups SET state = 'expired', first_name = NULL, last_name = NULL WHERE (tenant_id, id) IN (
          SELECT tenant_id, id FROM public.newsletter_form_signups WHERE state = 'pending' AND expires_at <= moment
          ORDER BY expires_at, id LIMIT 40 FOR UPDATE SKIP LOCKED);
        INSERT INTO public.newsletter_form_signups(tenant_id, form_id, version_id, receipt, token_hash, email_proof, contact_id, list_ids, wording_version,
            first_name, last_name, created_at, expires_at)
          VALUES (address.tenant_id, address.form_id, address.version_id, p_receipt, public.nl02_hash(p_token), public.nl02_hash(p_token || ':' || p_email), contact,
            live, coalesce(snapshot->>'wordingVersion', ''), nullif(btrim(p_first), ''), nullif(btrim(p_last), ''), moment, moment + interval '30 minutes')
          ON CONFLICT DO NOTHING;
        queued := FOUND;
      END IF;
    END IF;
  END IF;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
  PERFORM set_config('app.nl02_tenant', coalesce(previous_nl02, ''), true);
  PERFORM set_config('app.crm_forms_slug', coalesce(previous_slug, ''), true);
  PERFORM set_config('app.crm_forms_tenant', coalesce(previous_forms, ''), true);
  PERFORM set_config('app.nl02_private', coalesce(previous_private, ''), true);
  RETURN queued;
END $$;
REVOKE ALL ON FUNCTION public.newsletter_form_signup_start(text, uuid, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_form_signup_start(text, uuid, uuid, text, text, text, text, text) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.nl02_accept_form_signup(p_email text, p_token text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pending public.newsletter_form_signups; creator text; contact uuid; list uuid; granted boolean := false; live boolean;
BEGIN
  SELECT * INTO pending FROM public.newsletter_form_signups
    WHERE token_hash = public.nl02_hash(p_token) AND state = 'pending' AND expires_at > clock_timestamp()
      AND email_proof = public.nl02_hash(p_token || ':' || p_email) FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  -- The form must still be published (not unpublished or archived) when the link is used.
  PERFORM set_config('app.crm_forms_tenant', pending.tenant_id::text, true);
  PERFORM set_config('app.nl_forms_tenant', pending.tenant_id::text, true);
  SELECT f.created_by INTO creator FROM public.crm_form_addresses a
    JOIN public.forms f ON f.tenant_id = a.tenant_id AND f.id = a.form_id AND f.archived_at IS NULL
    WHERE a.tenant_id = pending.tenant_id AND a.form_id = pending.form_id AND a.version_id IS NOT NULL AND a.retired_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id', pending.tenant_id::text, true);
  PERFORM set_config('app.nl02_tenant', pending.tenant_id::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended(pending.tenant_id::text || ':newsletter:' || p_email, 0));

  SELECT contact_id INTO contact FROM public.contact_identifiers
    WHERE tenant_id = pending.tenant_id AND kind = 'email' AND normalized_value = p_email;
  IF pending.contact_id IS NOT NULL AND pending.contact_id IS DISTINCT FROM contact THEN RETURN; END IF;
  IF contact IS NULL THEN
    BEGIN
      INSERT INTO public.contacts(tenant_id, name) VALUES (pending.tenant_id,
        coalesce(nullif(btrim(coalesce(pending.first_name, '') || ' ' || coalesce(pending.last_name, '')), ''), 'Newsletter subscriber')) RETURNING id INTO contact;
      INSERT INTO public.contact_identifiers(tenant_id, contact_id, kind, value, normalized_value)
        VALUES (pending.tenant_id, contact, 'email', p_email, p_email);
    EXCEPTION WHEN unique_violation THEN
      SELECT contact_id INTO contact FROM public.contact_identifiers
        WHERE tenant_id = pending.tenant_id AND kind = 'email' AND normalized_value = p_email;
    END;
  END IF;
  PERFORM 1 FROM public.contacts WHERE tenant_id = pending.tenant_id AND id = contact AND erased_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT FROM public.contact_identifiers
    WHERE tenant_id = pending.tenant_id AND contact_id = contact AND kind = 'email' AND normalized_value = p_email) THEN RETURN; END IF;
  -- Single use: the row leaves the pending state whatever the outcome, and the names are dropped with it.
  FOREACH list IN ARRAY pending.list_ids LOOP
    SELECT EXISTS (SELECT FROM public.newsletter_lists WHERE tenant_id = pending.tenant_id AND id = list AND archived_at IS NULL) INTO live;
    IF live AND public.nl02_grant_list(pending.tenant_id, list, contact, p_email, pending.created_at, creator,
        'Newsletter sign-up form, wording ' || pending.wording_version || ', email confirmation') THEN granted := true; END IF;
  END LOOP;
  UPDATE public.newsletter_form_signups SET state = CASE WHEN granted THEN 'confirmed' ELSE 'blocked' END,
    confirmed_at = clock_timestamp(), first_name = NULL, last_name = NULL
    WHERE tenant_id = pending.tenant_id AND id = pending.id;
END $$;
REVOKE ALL ON FUNCTION public.nl02_accept_form_signup(text, text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.newsletter_form_signup_confirm(p_email text, p_token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous_tenant text := current_setting('app.tenant_id', true);
  previous_public text := current_setting('app.nl02_tenant', true);
  previous_actor text := current_setting('app.user_id', true);
  previous_private text := current_setting('app.nl02_private', true);
  previous_forms text := current_setting('app.crm_forms_tenant', true);
  previous_archive text := current_setting('app.nl_forms_tenant', true);
BEGIN
  IF current_database() !~ '^harvest_test(_|$)' OR NOT public.nl02_email(p_email) OR coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN; END IF;
  PERFORM set_config('app.nl02_private', 'on', true);
  PERFORM public.nl02_accept_form_signup(p_email, p_token);
  PERFORM set_config('app.nl02_private', coalesce(previous_private, ''), true);
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
  PERFORM set_config('app.nl02_tenant', coalesce(previous_public, ''), true);
  PERFORM set_config('app.user_id', coalesce(previous_actor, ''), true);
  PERFORM set_config('app.crm_forms_tenant', coalesce(previous_forms, ''), true);
  PERFORM set_config('app.nl_forms_tenant', coalesce(previous_archive, ''), true);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_form_signup_confirm(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_form_signup_confirm(text, text) TO harvest_app;
--> statement-breakpoint
-- Archive: an owner or admin takes the form off the list and the web in one step. Collected sign-ups and what they granted are kept.
CREATE FUNCTION public.newsletter_form_archive(p_tenant uuid, p_form uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); previous text := current_setting('app.nl_forms_tenant', true); found_version uuid;
BEGIN
  IF current_database() !~ '^harvest_test(_|$)' THEN RETURN 'not_found'; END IF;
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN RAISE insufficient_privilege; END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_forms_tenant', p_tenant::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-form:' || p_tenant || ':' || p_form, 0));
  SELECT v.id INTO found_version FROM public.form_versions v WHERE v.tenant_id = p_tenant AND v.form_id = p_form
    AND v.definition->>'kind' = 'crm-form-v1' AND v.definition ? 'newsletter' LIMIT 1;
  IF NOT FOUND THEN PERFORM set_config('app.nl_forms_tenant', coalesce(previous, ''), true); RETURN 'not_found'; END IF;
  UPDATE public.forms SET archived_at = now() WHERE tenant_id = p_tenant AND id = p_form AND archived_at IS NULL;
  IF NOT FOUND THEN PERFORM set_config('app.nl_forms_tenant', coalesce(previous, ''), true); RETURN 'not_found'; END IF;
  UPDATE public.crm_form_addresses SET version_id = NULL, retired_at = coalesce(retired_at, now()) WHERE tenant_id = p_tenant AND form_id = p_form AND version_id IS NOT NULL;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (p_tenant, actor, 'newsletter.signup_form.archive', p_form::text);
  PERFORM set_config('app.nl_forms_tenant', coalesce(previous, ''), true);
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.newsletter_form_archive(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_form_archive(uuid, uuid) TO harvest_app;
