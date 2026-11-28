CREATE TABLE "church_network_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"unlinked_by" text,
	"unlinked_at" timestamp with time zone,
	CONSTRAINT "church_network_distinct_ministries" CHECK ("church_network_links"."parent_id" <> "church_network_links"."child_id"),
	CONSTRAINT "church_network_audit_pairs" CHECK (("church_network_links"."accepted_by" IS NULL) = ("church_network_links"."accepted_at" IS NULL)
    AND ("church_network_links"."unlinked_by" IS NULL) = ("church_network_links"."unlinked_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "church_network_links" ADD CONSTRAINT "church_network_links_parent_id_workspaces_tenant_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "church_network_links" ADD CONSTRAINT "church_network_links_child_id_workspaces_tenant_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "church_network_current_pair" ON "church_network_links" USING btree ("parent_id","child_id") WHERE "church_network_links"."unlinked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "church_network_child" ON "church_network_links" USING btree ("child_id");
ALTER TABLE public.church_network_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_network_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.church_network_links FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$
DECLARE item record; original text; patched text; anchor text := '''app.community_stats_write''';
  replacement text := anchor || ',''app.church_network_child''';
BEGIN
  FOR item IN SELECT unnest(ARRAY['public.blog_scope_clear()', 'public.account_self_reset()', 'public.community_definer_reset()']) AS signature LOOP
    original := pg_catalog.pg_get_functiondef(item.signature::regprocedure);
    patched := pg_catalog.replace(original, anchor, replacement);
    IF pg_catalog.length(patched) - pg_catalog.length(original) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
      RAISE EXCEPTION 'Expected one reset insertion point in %', item.signature;
    END IF;
    EXECUTE patched;
  END LOOP;
  EXECUTE format($p$CREATE POLICY church_network_manage ON public.church_network_links TO %I
    USING (nullif(current_setting('app.access_tenant', true), '')::uuid IN (parent_id, child_id))
    WITH CHECK (nullif(current_setting('app.access_tenant', true), '')::uuid IN (parent_id, child_id))$p$, current_user);
  EXECUTE format($p$CREATE POLICY church_network_count ON public.campaigns FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.church_network_child', true), '')::uuid
      AND status = 'active' AND archived_at IS NULL AND type = 'local_outreach')$p$, current_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.church_network(p_tenant uuid, p_action text, p_target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
DECLARE link public.church_network_links%ROWTYPE;
DECLARE answer jsonb;
DECLARE outreach_count bigint;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM public.community_definer_reset();
  IF actor IS NULL OR p_tenant IS NULL OR p_target IS NULL OR p_action IS NULL
    OR p_action NOT IN ('request','accept','unlink','count')
    OR (p_action = 'request' AND p_tenant = p_target) THEN RETURN NULL; END IF;

  PERFORM set_config('app.access_tenant', p_tenant::text, true);
  PERFORM 1 FROM public.workspace_members m
    WHERE m.tenant_id = p_tenant AND m.user_id = actor AND m.role_id = 'owner' FOR SHARE;
  IF FOUND THEN
    IF p_action = 'request' THEN
      BEGIN
        INSERT INTO public.church_network_links (parent_id, child_id, requested_by)
          VALUES (p_tenant, p_target, actor)
        ON CONFLICT (parent_id, child_id) WHERE unlinked_at IS NULL DO NOTHING RETURNING * INTO link;
        IF NOT FOUND THEN
          SELECT * INTO link FROM public.church_network_links
          WHERE parent_id = p_tenant AND child_id = p_target AND unlinked_at IS NULL;
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        link := NULL;
      END;
    ELSIF p_action = 'accept' THEN
      UPDATE public.church_network_links SET accepted_at = now(), accepted_by = actor
        WHERE id = p_target AND child_id = p_tenant AND accepted_at IS NULL AND unlinked_at IS NULL
        RETURNING * INTO link;
      IF NOT FOUND THEN
        SELECT * INTO link FROM public.church_network_links
        WHERE id = p_target AND child_id = p_tenant AND accepted_at IS NOT NULL AND unlinked_at IS NULL;
      END IF;
    ELSIF p_action = 'unlink' THEN
      UPDATE public.church_network_links SET unlinked_at = now(), unlinked_by = actor
        WHERE id = p_target AND p_tenant IN (parent_id, child_id) AND unlinked_at IS NULL
        RETURNING * INTO link;
      IF NOT FOUND THEN
        SELECT * INTO link FROM public.church_network_links
        WHERE id = p_target AND p_tenant IN (parent_id, child_id) AND unlinked_at IS NOT NULL;
      END IF;
    ELSE
      SELECT * INTO link FROM public.church_network_links
        WHERE id = p_target AND parent_id = p_tenant AND accepted_at IS NOT NULL AND unlinked_at IS NULL FOR SHARE;
      IF FOUND THEN
        PERFORM set_config('app.church_network_child', link.child_id::text, true);
        SELECT count(*) INTO outreach_count FROM public.campaigns
          WHERE tenant_id = link.child_id AND status = 'active' AND archived_at IS NULL AND type = 'local_outreach';
        PERFORM set_config('app.church_network_child', '', true);
      END IF;
    END IF;
  END IF;
  PERFORM set_config('app.access_tenant', '', true);
  IF link.id IS NULL THEN RETURN NULL; END IF;
  answer := jsonb_build_object('id', link.id, 'parentId', link.parent_id, 'childId', link.child_id,
    'status', CASE WHEN link.unlinked_at IS NOT NULL THEN 'unlinked'
                   WHEN link.accepted_at IS NOT NULL THEN 'linked' ELSE 'pending' END);
  IF p_action = 'count' THEN
    answer := answer || jsonb_build_object('activeOutreachCampaigns', outreach_count);
  END IF;
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.church_network(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.church_network(uuid,text,uuid) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.church_network_invitations(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
DECLARE answer jsonb;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM public.community_definer_reset();
  IF actor IS NULL OR p_tenant IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.access_tenant', p_tenant::text, true);
  IF EXISTS (SELECT 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id = 'owner') THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'parentId', l.parent_id, 'childId', l.child_id,
      'status', CASE WHEN l.accepted_at IS NULL THEN 'pending' ELSE 'linked' END) ORDER BY l.requested_at DESC, l.id), '[]')
    INTO answer FROM (SELECT id, parent_id, child_id, accepted_at, requested_at FROM public.church_network_links
      WHERE p_tenant IN (parent_id, child_id) AND unlinked_at IS NULL ORDER BY requested_at DESC, id LIMIT 100) l;
  END IF;
  PERFORM set_config('app.access_tenant', '', true);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.church_network_invitations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.church_network_invitations(uuid) TO harvest_app;
