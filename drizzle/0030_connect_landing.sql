-- Landing content never changes QR lifecycle, Forms or invitation eligibility.
CREATE FUNCTION public.valid_connect_landing_url(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE host text; port text;
BEGIN
  IF value IS NULL OR length(value) > 2048 OR value ~ '[[:space:][:cntrl:]\\]' OR value !~* '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:[0-9]{1,5})?([/?#][^[:space:]\\]*)?$' THEN RETURN false; END IF;
  -- Scheme matching is case-insensitive; extract with a normalized scheme too.
  host := lower(substring(lower(value) from '^https://([^/?#:]+)'));
  IF host ~ '(^|\.)(localhost|local|internal)$' THEN RETURN false; END IF;
  port := substring(lower(value) from '^https://[^/?#:]+:([0-9]+)');
  RETURN port IS NULL OR port::integer BETWEEN 1 AND 65535;
END $$;
REVOKE ALL ON FUNCTION public.valid_connect_landing_url(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valid_connect_landing_url(text) TO harvest_app;

CREATE FUNCTION public.valid_connect_landing(d jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE card jsonb; value text;
BEGIN
  IF d IS NULL OR jsonb_typeof(d) <> 'object' OR NOT (d ?& ARRAY['heading','message','cards'])
    OR (d - ARRAY['heading','message','cards']) <> '{}'::jsonb
    OR jsonb_typeof(d->'heading') <> 'string' OR length(d->>'heading') > 120
    OR jsonb_typeof(d->'message') <> 'string' OR length(d->>'message') > 600
    OR jsonb_typeof(d->'cards') <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(d->'cards') > 8 THEN RETURN false; END IF;
  FOR card IN SELECT * FROM jsonb_array_elements(d->'cards') LOOP
    IF jsonb_typeof(card) <> 'object' THEN RETURN false; END IF;
    IF card->>'kind' = 'resource' THEN
      IF NOT (card ?& ARRAY['kind','resourceId']) OR (card - ARRAY['kind','resourceId']) <> '{}'::jsonb
        OR card->>'resourceId' NOT IN ('first-reading','common-questions','keep-exploring') THEN RETURN false; END IF;
    ELSIF card->>'kind' = 'external' THEN
      IF NOT (card ?& ARRAY['kind','category','title','description','url','price'])
        OR (card - ARRAY['kind','category','title','description','url','price']) <> '{}'::jsonb
        OR card->>'category' NOT IN ('community','course','product') OR card->>'price' NOT IN ('free','paid')
        OR (card->>'category' = 'community' AND card->>'price' <> 'free')
        OR jsonb_typeof(card->'title') <> 'string' OR length(btrim(card->>'title')) NOT BETWEEN 1 AND 120 OR length(card->>'title') > 120
        OR jsonb_typeof(card->'description') <> 'string' OR length(card->>'description') > 300
        OR jsonb_typeof(card->'url') <> 'string' OR NOT public.valid_connect_landing_url(card->>'url') THEN RETURN false; END IF;
    ELSE RETURN false; END IF;
    -- Require string types even for enum fields (including JSON null).
    FOR value IN SELECT v FROM jsonb_each_text(card) AS e(k,v) LOOP
      IF value IS NULL THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  -- Plain text only: React escapes markup. Reject non-display controls; allow tabs/newlines.
  FOR value IN SELECT d->>'heading' UNION ALL SELECT d->>'message'
    UNION ALL SELECT c->>'title' FROM jsonb_array_elements(d->'cards') c WHERE c->>'kind'='external'
    UNION ALL SELECT c->>'description' FROM jsonb_array_elements(d->'cards') c WHERE c->>'kind'='external' LOOP
    IF regexp_replace(value, E'[\t\n\r]', '', 'g') ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.valid_connect_landing(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valid_connect_landing(jsonb) TO harvest_app;
--> statement-breakpoint
CREATE TABLE public.connect_landing_versions (
  tenant_id uuid NOT NULL, link_id uuid NOT NULL, revision integer NOT NULL CHECK (revision > 0),
  definition jsonb NOT NULL CHECK (public.valid_connect_landing(definition)),
  published_at timestamptz NOT NULL DEFAULT now(), published_by text NOT NULL CONSTRAINT connect_landing_versions_published_by_users_id_fk REFERENCES public.users(id),
  CONSTRAINT connect_landing_versions_tenant_id_link_id_revision_pk PRIMARY KEY (tenant_id, link_id, revision),
  CONSTRAINT connect_landing_versions_link_fk FOREIGN KEY (tenant_id, link_id) REFERENCES public.campaign_response_links(tenant_id, id)
);
CREATE TABLE public.connect_landing_states (
  tenant_id uuid NOT NULL, link_id uuid NOT NULL, revision integer NOT NULL CHECK (revision > 0),
  definition jsonb NOT NULL CHECK (public.valid_connect_landing(definition)),
  published_revision integer, updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_landing_states_tenant_id_link_id_pk PRIMARY KEY (tenant_id, link_id),
  CONSTRAINT connect_landing_states_link_fk FOREIGN KEY (tenant_id, link_id) REFERENCES public.campaign_response_links(tenant_id, id),
  CONSTRAINT connect_landing_states_published_fk FOREIGN KEY (tenant_id, link_id, published_revision) REFERENCES public.connect_landing_versions(tenant_id, link_id, revision),
  CHECK (published_revision IS NULL OR published_revision <= revision)
);
ALTER TABLE public.connect_landing_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_landing_states FORCE ROW LEVEL SECURITY;
ALTER TABLE public.connect_landing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_landing_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.connect_landing_states, public.connect_landing_versions FROM PUBLIC, harvest_app;
GRANT SELECT ON public.connect_landing_states, public.connect_landing_versions TO harvest_app;
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['connect_landing_states','connect_landing_versions'] LOOP
    EXECUTE format($p$CREATE POLICY landing_editor_read ON public.%I FOR SELECT TO harvest_app
      USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
        SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = %I.tenant_id
          AND m.user_id = nullif(current_setting('app.user_id',true),'') AND m.role_id IN ('owner','admin','member')))$p$,tbl,tbl);
    EXECUTE format($p$CREATE POLICY landing_definer ON public.%I TO %I
      USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)$p$,tbl,current_user);
    EXECUTE format($p$CREATE POLICY landing_public_read ON public.%I FOR SELECT TO %I
      USING (tenant_id = nullif(current_setting('app.connect_resolve_tenant',true),'')::uuid
        AND link_id = nullif(current_setting('app.connect_landing_link',true),'')::uuid)$p$,tbl,current_user);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.connect_landing_write(p_tenant uuid, p_campaign uuid, p_link uuid, p_revision integer, p_code text, p_definition jsonb, p_publish boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id',true),''); l record; s record; archived timestamptz; campaign_found boolean;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR actor IS NULL OR p_publish IS NULL THEN
    RAISE EXCEPTION 'landing access denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=actor
    AND (role_id IN ('owner','admin') OR (NOT p_publish AND role_id='member')) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'landing access denied' USING ERRCODE='42501'; END IF;
  -- Reuse 0028's exact-campaign migration-owner lock policy; no new campaign grants.
  PERFORM set_config('app.connect_campaign',p_campaign::text,true);
  SELECT archived_at INTO archived FROM public.campaigns WHERE tenant_id=p_tenant AND id=p_campaign FOR SHARE;
  campaign_found := FOUND;
  PERFORM set_config('app.connect_campaign','',true);
  IF NOT campaign_found THEN RETURN 'not_found'; END IF;
  IF archived IS NOT NULL THEN RETURN 'archived'; END IF;
  SELECT * INTO l FROM public.campaign_response_links WHERE tenant_id=p_tenant AND campaign_id=p_campaign AND id=p_link FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF l.status='archived' OR l.archived_at IS NOT NULL THEN RETURN 'archived'; END IF;
  IF p_code IS NULL OR p_code IS DISTINCT FROM l.public_code THEN RETURN 'stale'; END IF;
  -- The link lock serializes even the first save (no state row yet).
  SELECT * INTO s FROM public.connect_landing_states WHERE tenant_id=p_tenant AND link_id=p_link;
  IF p_revision IS NULL OR p_revision IS DISTINCT FROM coalesce(s.revision,0) THEN RETURN 'stale'; END IF;
  IF p_publish THEN
    IF s.revision IS NULL THEN RETURN 'no_draft'; END IF;
    IF s.published_revision = s.revision THEN RETURN 'unchanged'; END IF;
    IF NOT public.valid_connect_landing(s.definition) THEN RETURN 'invalid'; END IF;
    INSERT INTO public.connect_landing_versions(tenant_id,link_id,revision,definition,published_by)
      VALUES(p_tenant,p_link,s.revision,s.definition,actor);
    UPDATE public.connect_landing_states SET published_revision=s.revision WHERE tenant_id=p_tenant AND link_id=p_link;
    INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata)
      VALUES(p_tenant,actor,'connect.landing.publish',p_link::text,jsonb_build_object('revision',s.revision));
    RETURN 'published';
  END IF;
  IF NOT public.valid_connect_landing(p_definition) THEN RETURN 'invalid'; END IF;
  INSERT INTO public.connect_landing_states(tenant_id,link_id,revision,definition) VALUES(p_tenant,p_link,1,p_definition)
    ON CONFLICT(tenant_id,link_id) DO UPDATE SET revision=connect_landing_states.revision+1,definition=excluded.definition,updated_at=clock_timestamp();
  RETURN 'saved';
END $$;
REVOKE ALL ON FUNCTION public.connect_landing_write(uuid,uuid,uuid,integer,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_landing_write(uuid,uuid,uuid,integer,text,jsonb,boolean) TO harvest_app;

CREATE FUNCTION public.guard_connect_landing() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='connect_landing_versions' AND TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'published landing versions are immutable'; END IF;
  IF current_user <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='public.connect_landing_write(uuid,uuid,uuid,integer,text,jsonb,boolean)'::regprocedure)) THEN
    RAISE EXCEPTION 'landing writes require the landing function'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_connect_landing() FROM PUBLIC;
CREATE TRIGGER connect_landing_state_guard BEFORE INSERT OR UPDATE OR DELETE ON public.connect_landing_states FOR EACH ROW EXECUTE FUNCTION public.guard_connect_landing();
CREATE TRIGGER connect_landing_version_guard BEFORE INSERT OR UPDATE OR DELETE ON public.connect_landing_versions FOR EACH ROW EXECUTE FUNCTION public.guard_connect_landing();
--> statement-breakpoint
-- Preserve resolve_connect_link(text,text) unchanged. This projection derives ownership from
-- the opaque code and returns only public text/cards, never draft/revision/actor/tenant fields.
CREATE FUNCTION public.resolve_connect_landing(p_kind text,p_code text) RETURNS TABLE(locale text,public_title text,definition jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE l record; campaign_live boolean;
BEGIN
  IF NOT coalesce((p_kind='qr' AND p_code ~ '^[a-f0-9]{32}$') OR (p_kind='short' AND p_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),false) THEN RETURN; END IF;
  PERFORM set_config('app.connect_resolve_code',p_code,true);
  SELECT x.tenant_id,x.id,x.campaign_id,x.locale,x.public_title INTO l FROM public.campaign_response_links x
    WHERE (CASE WHEN p_kind='qr' THEN x.public_code=p_code ELSE x.short_code=p_code END)
      AND x.status='published' AND (x.expires_at IS NULL OR x.expires_at>clock_timestamp());
  PERFORM set_config('app.connect_resolve_code','',true);
  IF l.id IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.connect_resolve_tenant',l.tenant_id::text,true);
  PERFORM set_config('app.connect_landing_link',l.id::text,true);
  SELECT c.archived_at IS NULL INTO campaign_live FROM public.campaigns c WHERE c.tenant_id=l.tenant_id AND c.id=l.campaign_id;
  IF campaign_live IS TRUE THEN
    RETURN QUERY SELECT l.locale,l.public_title,v.definition FROM (SELECT 1) seed
      LEFT JOIN public.connect_landing_states s ON s.tenant_id=l.tenant_id AND s.link_id=l.id
      LEFT JOIN public.connect_landing_versions v ON v.tenant_id=s.tenant_id AND v.link_id=s.link_id AND v.revision=s.published_revision;
  END IF;
  PERFORM set_config('app.connect_resolve_tenant','',true);
  PERFORM set_config('app.connect_landing_link','',true);
END $$;
REVOKE ALL ON FUNCTION public.resolve_connect_landing(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_connect_landing(text,text) TO harvest_app;
