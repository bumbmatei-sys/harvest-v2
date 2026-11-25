CREATE TABLE "community_daily_counts" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "community_daily_counts_tenant_id_community_id_day_kind_pk" PRIMARY KEY("tenant_id","community_id","day","kind"),
	CONSTRAINT "community_daily_counts_shape" CHECK ("community_daily_counts"."kind" in ('visit','join_click') and "community_daily_counts"."n" between 0 and 2147483000)
);
--> statement-breakpoint
CREATE TABLE "community_exits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"other_text" text,
	CONSTRAINT "community_exits_shape" CHECK ("community_exits"."kind" in ('left','removed','banned') and ("community_exits"."reason" is null or ("community_exits"."kind" = 'left' and "community_exits"."reason" in ('moved_away','too_busy','not_relevant','too_many_notifications','content_quality','privacy','other')))
    and ("community_exits"."other_text" is null or ("community_exits"."reason" = 'other' and length(btrim("community_exits"."other_text")) between 1 and 200)))
);
--> statement-breakpoint
ALTER TABLE "community_daily_counts" ADD CONSTRAINT "community_daily_counts_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_exits" ADD CONSTRAINT "community_exits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_exits" ADD CONSTRAINT "community_exits_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_exits_period_idx" ON "community_exits" USING btree ("tenant_id","community_id","left_at");--> statement-breakpoint
CREATE INDEX "community_exits_user_idx" ON "community_exits" USING btree ("user_id");--> statement-breakpoint
CREATE FUNCTION public.community_stats_can(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner','admin'))
$$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['community_exits','community_daily_counts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', t);
    EXECUTE format('GRANT SELECT ON public.%I TO harvest_app', t);
    EXECUTE format('CREATE POLICY community_stats_staff ON public.%I FOR SELECT TO harvest_app USING (public.community_stats_can(tenant_id))', t);
    -- Only the SECURITY DEFINER functions below set this flag; the application role can never satisfy the guard.
    EXECUTE format('CREATE POLICY community_stats_definer ON public.%I TO PUBLIC USING (current_user <> ''harvest_app'' AND current_setting(''app.community_stats_write'', true) = ''on'') WITH CHECK (current_user <> ''harvest_app'' AND current_setting(''app.community_stats_write'', true) = ''on'')', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- A departure is recorded by the database whenever an ACTIVE membership becomes left, removed or banned, whichever code path did it. The voluntary reason travels in two
-- transaction-local settings that only community_leave sets; any other path records the departure without a reason. Members who left before this migration have no record.
CREATE FUNCTION public.community_exit_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE kind text := CASE NEW.status WHEN 'left' THEN 'left' WHEN 'removed' THEN 'removed' ELSE 'banned' END;
  why text := nullif(current_setting('app.community_leave_reason', true), ''); other text := nullif(btrim(current_setting('app.community_leave_other', true)), '');
BEGIN
  PERFORM set_config('app.community_stats_write', 'on', true);
  INSERT INTO public.community_exits(tenant_id, community_id, user_id, kind, joined_at, left_at, reason, other_text)
    VALUES (NEW.tenant_id, NEW.community_id, NEW.user_id, kind, OLD.joined_at, now(), CASE WHEN kind = 'left' THEN why END, CASE WHEN kind = 'left' AND why = 'other' THEN other END);
  PERFORM set_config('app.community_stats_write', '', true);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER community_exit_record AFTER UPDATE OF status ON public.community_memberships FOR EACH ROW
  WHEN (OLD.status = 'active' AND NEW.status IN ('left','removed','banned')) EXECUTE FUNCTION public.community_exit_record();
--> statement-breakpoint
-- A member leaves, optionally saying why. Owners cannot leave (they hand over or archive first).
CREATE FUNCTION public.community_leave(p_slug text, p_reason text, p_other text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); c record; m record; other text := nullif(btrim(coalesce(p_other, '')), '');
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NOT NULL AND p_reason NOT IN ('moved_away','too_busy','not_relevant','too_many_notifications','content_quality','privacy','other') THEN RAISE EXCEPTION 'invalid leave reason'; END IF;
  IF (other IS NOT NULL AND p_reason IS DISTINCT FROM 'other') OR length(coalesce(other, '')) > 200 THEN RAISE EXCEPTION 'invalid leave reason'; END IF;
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT * INTO c FROM public.communities WHERE communities.slug = p_slug AND communities.status = 'published';
  IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN 'not_found'; END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  SELECT * INTO m FROM public.community_memberships WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor FOR UPDATE;
  IF NOT FOUND OR m.status <> 'active' THEN PERFORM public.community_definer_reset(); RETURN 'not_member'; END IF;
  IF m.role = 'owner' THEN PERFORM public.community_definer_reset(); RETURN 'owner'; END IF;
  PERFORM set_config('app.community_leave_reason', coalesce(p_reason, ''), true);
  PERFORM set_config('app.community_leave_other', coalesce(other, ''), true);
  UPDATE public.community_memberships SET status = 'left', role = 'member', muted_until = NULL, updated_at = now() WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor;
  PERFORM set_config('app.community_leave_reason', '', true); PERFORM set_config('app.community_leave_other', '', true);
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id) VALUES (c.tenant_id, actor, 'community.leave', c.id::text);
  PERFORM public.community_definer_reset();
  RETURN 'left';
END $$;
--> statement-breakpoint
-- Aggregate counter only: a visit or a join click on a published, not hidden community. Stores a count per community, day and kind, nothing about the visitor.
CREATE FUNCTION public.community_count_event(p_slug text, p_kind text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c record;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('visit','join_click') THEN RAISE EXCEPTION 'invalid count kind'; END IF;
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT tenant_id, id INTO c FROM public.communities WHERE communities.slug = p_slug AND communities.status = 'published' AND communities.visibility <> 'hidden';
  IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN false; END IF;
  PERFORM set_config('app.community_stats_write', 'on', true);
  INSERT INTO public.community_daily_counts(tenant_id, community_id, day, kind, n) VALUES (c.tenant_id, c.id, (now() at time zone 'UTC')::date, p_kind, 1)
    ON CONFLICT (tenant_id, community_id, day, kind) DO UPDATE SET n = least(public.community_daily_counts.n + 1, 2147483000);
  PERFORM set_config('app.community_stats_write', '', true);
  PERFORM public.community_definer_reset();
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_stats_can(uuid), public.community_exit_record(), public.community_leave(text,text,text), public.community_count_event(text,text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_stats_can(uuid), public.community_leave(text,text,text), public.community_count_event(text,text) TO harvest_app;
