CREATE TABLE "contact_first_sources" (
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contact_first_sources_tenant_id_contact_id_pk" PRIMARY KEY("tenant_id","contact_id"),
	CONSTRAINT "contact_first_sources_kind" CHECK ("contact_first_sources"."kind" in ('manual', 'csv_import', 'connect', 'form'))
);
--> statement-breakpoint
CREATE TABLE "crm_deal_stage_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"from_stage_id" uuid NOT NULL,
	"to_stage_id" uuid NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_by" text
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_first_sources" ADD CONSTRAINT "contact_first_sources_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_stage_moves" ADD CONSTRAINT "crm_deal_stage_moves_moved_by_users_id_fk" FOREIGN KEY ("moved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_deal_stage_moves" ADD CONSTRAINT "crm_deal_stage_moves_deal_fk" FOREIGN KEY ("tenant_id","deal_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_deal_stage_moves_period_idx" ON "crm_deal_stage_moves" USING btree ("tenant_id","moved_at");--> statement-breakpoint
CREATE INDEX "crm_deal_stage_moves_deal_idx" ON "crm_deal_stage_moves" USING btree ("tenant_id","deal_id","moved_at");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspace_time_zone" CHECK (length("workspaces"."time_zone") between 1 and 64);
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------------------------
-- Durable first source: kind and first-seen date only, per person. Owners and admins read it; only the definer
-- triggers below (and the erase and merge paths) change it.
ALTER TABLE public.contact_first_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_first_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY first_source_read ON public.contact_first_sources FOR SELECT TO harvest_app USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = contact_first_sources.tenant_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
GRANT SELECT ON public.contact_first_sources TO harvest_app;
-- The writers are the owners of the definer functions, which differ between environments (the migration runner here, another role on Neon),
-- so the policy is not tied to current_user: it applies to every role except the app role, whose only access is the read policy above
-- (and which has no INSERT, UPDATE or DELETE privilege on the table).
CREATE POLICY first_source_definer ON public.contact_first_sources TO PUBLIC
  USING (current_user <> 'harvest_app' AND tenant_id IN (nullif(current_setting('app.tenant_id', true), '')::uuid, nullif(current_setting('app.crm_forms_tenant', true), '')::uuid))
  WITH CHECK (current_user <> 'harvest_app' AND tenant_id IN (nullif(current_setting('app.tenant_id', true), '')::uuid, nullif(current_setting('app.crm_forms_tenant', true), '')::uuid));
--> statement-breakpoint
-- A new source event credits the person only if it is earlier than the credit they already have.
CREATE FUNCTION public.contact_first_source_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.contact_first_sources(tenant_id, contact_id, kind, first_seen_at)
    VALUES (NEW.tenant_id, NEW.contact_id, NEW.kind, NEW.occurred_at)
    ON CONFLICT (tenant_id, contact_id) DO UPDATE SET kind = excluded.kind, first_seen_at = excluded.first_seen_at
      WHERE excluded.first_seen_at < public.contact_first_sources.first_seen_at;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contact_first_source_event() FROM PUBLIC, harvest_app;
CREATE TRIGGER contact_first_source_event AFTER INSERT ON public.contact_source_events
  FOR EACH ROW EXECUTE FUNCTION public.contact_first_source_event();
--> statement-breakpoint
-- A later source replaces the provisional manual one: the paths that create a person through another source delete the manual event first.
CREATE FUNCTION public.contact_first_source_manual_removed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.tenant_id', true), '');
BEGIN
  -- Scope to the row's own tenant (the 0032 pattern) so the delete does not depend on the caller's context, then put the caller's back.
  PERFORM set_config('app.tenant_id', OLD.tenant_id::text, true);
  DELETE FROM public.contact_first_sources WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.contact_id AND kind = 'manual';
  PERFORM set_config('app.tenant_id', previous, true);
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.contact_first_source_manual_removed() FROM PUBLIC, harvest_app;
CREATE TRIGGER contact_first_source_manual_removed AFTER DELETE ON public.contact_source_events
  FOR EACH ROW WHEN (OLD.kind = 'manual') EXECUTE FUNCTION public.contact_first_source_manual_removed();
--> statement-breakpoint
-- A reverted import row no longer credits the person: the credit falls back to the earliest remaining evidence, or to nothing.
CREATE FUNCTION public.contact_first_source_reverted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.tenant_id', true), ''); credited boolean;
BEGIN
  PERFORM set_config('app.tenant_id', NEW.tenant_id::text, true);
  DELETE FROM public.contact_first_sources
    WHERE tenant_id = NEW.tenant_id AND contact_id = NEW.contact_id AND kind = NEW.kind AND first_seen_at = NEW.occurred_at;
  credited := FOUND;
  IF credited THEN
    INSERT INTO public.contact_first_sources(tenant_id, contact_id, kind, first_seen_at)
      SELECT u.tenant_id, u.contact_id, u.kind, u.occurred_at FROM (
        SELECT e.tenant_id, e.contact_id, e.kind, e.occurred_at, e.id::text AS tie FROM public.contact_source_events e
          WHERE e.tenant_id = NEW.tenant_id AND e.contact_id = NEW.contact_id AND e.reverted_at IS NULL
        UNION ALL
        SELECT t.tenant_id, t.contact_id, 'form', t.occurred_at, t.version_id::text FROM public.contact_form_sources t
          WHERE t.tenant_id = NEW.tenant_id AND t.contact_id = NEW.contact_id) u
      ORDER BY u.occurred_at, u.tie LIMIT 1;
  END IF;
  PERFORM set_config('app.tenant_id', previous, true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contact_first_source_reverted() FROM PUBLIC, harvest_app;
CREATE TRIGGER contact_first_source_reverted AFTER UPDATE OF reverted_at ON public.contact_source_events
  FOR EACH ROW WHEN (OLD.reverted_at IS NULL AND NEW.reverted_at IS NOT NULL) EXECUTE FUNCTION public.contact_first_source_reverted();
--> statement-breakpoint
-- Erasure removes the durable source with the person.
CREATE FUNCTION public.contact_first_source_before_erase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous text := coalesce(current_setting('app.tenant_id', true), '');
BEGIN
  PERFORM set_config('app.tenant_id', OLD.tenant_id::text, true);
  DELETE FROM public.contact_first_sources WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id;
  -- Never leave a durable source behind an erased person: a row that survives (a policy that hid it) stops the erasure.
  IF EXISTS (SELECT 1 FROM public.contact_first_sources WHERE tenant_id = OLD.tenant_id AND contact_id = OLD.id) THEN
    RAISE EXCEPTION 'durable source not removed' USING ERRCODE = '23000';
  END IF;
  PERFORM set_config('app.tenant_id', previous, true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contact_first_source_before_erase() FROM PUBLIC, harvest_app;
CREATE TRIGGER contact_first_source_before_erase BEFORE UPDATE ON public.contacts
  FOR EACH ROW WHEN (OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL) EXECUTE FUNCTION public.contact_first_source_before_erase();
--> statement-breakpoint
-- NOTE: this patches the text of merge_contacts_scoped as left by migration 0082 (it anchors on the crm_form_responses
-- repoint line that 0082 kept). If the merge wrapper is ever redefined, port this step with it.
-- A merge keeps the earliest first source on the kept person; the merged person's row goes with the merge.
DO $$
DECLARE def text; patched text;
BEGIN
  def := pg_get_functiondef('public.merge_contacts_scoped(uuid, uuid, uuid)'::regprocedure);
  patched := replace(def, '  UPDATE public.crm_form_responses SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;',
    '  INSERT INTO public.contact_first_sources(tenant_id, contact_id, kind, first_seen_at)
    SELECT tenant_id, p_target, kind, first_seen_at FROM public.contact_first_sources
      WHERE tenant_id = p_tenant AND contact_id = p_source
    ON CONFLICT (tenant_id, contact_id) DO UPDATE SET kind = excluded.kind, first_seen_at = excluded.first_seen_at
      WHERE excluded.first_seen_at < public.contact_first_sources.first_seen_at;
  DELETE FROM public.contact_first_sources WHERE tenant_id = p_tenant AND contact_id = p_source;
  UPDATE public.crm_form_responses SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;');
  IF patched = def THEN RAISE EXCEPTION 'merge hook not found'; END IF;
  EXECUTE patched;
END $$;
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------------------------
-- Deal stage movement: one row per stage change, no content. Owners and admins read it; the trigger writes it.
ALTER TABLE public.crm_deal_stage_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_deal_stage_moves FORCE ROW LEVEL SECURITY;
CREATE POLICY stage_moves_read ON public.crm_deal_stage_moves FOR SELECT TO harvest_app USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = crm_deal_stage_moves.tenant_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin')));
GRANT SELECT ON public.crm_deal_stage_moves TO harvest_app;
-- Not tied to current_user, for the same reason as first_source_definer above.
CREATE POLICY stage_moves_definer ON public.crm_deal_stage_moves TO PUBLIC
  USING (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_user <> 'harvest_app' AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Recorded for every path that changes a deal's stage. A person who is not a user (or is gone) leaves moved_by empty rather than blocking the move.
CREATE FUNCTION public.crm_deal_stage_moved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.crm_deal_stage_moves(tenant_id, deal_id, from_stage_id, to_stage_id, moved_by)
    VALUES (NEW.tenant_id, NEW.id, OLD.stage_id, NEW.stage_id,
      (SELECT u.id FROM public.users u WHERE u.id = nullif(current_setting('app.user_id', true), '')));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_deal_stage_moved() FROM PUBLIC, harvest_app;
CREATE TRIGGER crm_deal_stage_moved AFTER UPDATE OF stage_id ON public.opportunities
  FOR EACH ROW WHEN (OLD.stage_id IS DISTINCT FROM NEW.stage_id) EXECUTE FUNCTION public.crm_deal_stage_moved();
--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------------------------
-- Backfill. The owner runs under FORCE row security, which would hide every row, so the source tables are
-- relaxed for this statement block only and put back exactly as found.
DO $$
DECLARE r regclass; forced regclass[];
BEGIN
  SELECT coalesce(array_agg(c.oid::regclass), '{}') INTO forced FROM pg_class c WHERE c.relforcerowsecurity AND c.oid IN ('public.contact_source_events'::regclass,
    'public.contact_form_sources'::regclass, 'public.contact_first_sources'::regclass, 'public.audit_logs'::regclass, 'public.opportunities'::regclass,
    'public.crm_deal_stage_moves'::regclass, 'public.contacts'::regclass, 'public.users'::regclass);
  FOREACH r IN ARRAY forced LOOP EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', r); END LOOP;
  -- Every live person's earliest unreverted source evidence (events and form tags). Erased people have none.
  INSERT INTO public.contact_first_sources(tenant_id, contact_id, kind, first_seen_at)
    SELECT DISTINCT ON (u.tenant_id, u.contact_id) u.tenant_id, u.contact_id, u.kind, u.occurred_at FROM (
      SELECT e.tenant_id, e.contact_id, e.kind, e.occurred_at, e.id::text AS tie FROM public.contact_source_events e WHERE e.reverted_at IS NULL
      UNION ALL
      SELECT t.tenant_id, t.contact_id, 'form', t.occurred_at, t.version_id::text FROM public.contact_form_sources t) u
    JOIN public.contacts c ON c.tenant_id = u.tenant_id AND c.id = u.contact_id AND c.erased_at IS NULL
    ORDER BY u.tenant_id, u.contact_id, u.occurred_at, u.tie
    ON CONFLICT DO NOTHING;
  -- Stage moves already in the audit log (it holds the from and to stage of every move).
  INSERT INTO public.crm_deal_stage_moves(tenant_id, deal_id, from_stage_id, to_stage_id, moved_at, moved_by)
    SELECT a.tenant_id, o.id, (a.metadata->>'fromStageId')::uuid, (a.metadata->>'toStageId')::uuid, a.created_at, u.id
    FROM public.audit_logs a
    JOIN public.opportunities o ON o.tenant_id = a.tenant_id AND o.id::text = a.target_id
    LEFT JOIN public.users u ON u.id = a.actor_id
    WHERE a.action = 'opportunity.move'
      AND a.metadata->>'fromStageId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND a.metadata->>'toStageId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  FOREACH r IN ARRAY forced LOOP EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', r); END LOOP;
END $$;
