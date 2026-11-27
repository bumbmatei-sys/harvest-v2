DO $patch$
DECLARE
  def text := pg_catalog.pg_get_functiondef('public.bio_public_page_scoped(text)'::regprocedure);
  patched text;
  old_list text := $old$-- 0136: the ready gallery pictures of this page that a gallery block of the published copy lists (bio_files is scoped by app.bio_tenant, set above).
  SELECT coalesce(pg_catalog.jsonb_agg(f.id::text), '[]'::jsonb) INTO gallery FROM public.bio_files f
    WHERE f.tenant_id = page.tenant_id AND f.page_id = page.id AND f.kind = 'gallery' AND f.status = 'ready'
      AND f.id::text IN (SELECT i FROM pg_catalog.jsonb_array_elements(page.published->'blocks') b, pg_catalog.jsonb_array_elements_text(b->'fileIds') i
        WHERE b->>'type' = 'gallery' AND (b->>'hidden') = 'false');$old$;
  new_list text := $new$-- Use the picture resolver's visibility rule and omit unservable ids from the returned definition.
  SELECT coalesce(pg_catalog.jsonb_agg(f.id::text ORDER BY f.id), '[]'::jsonb) INTO gallery FROM public.bio_files f
    WHERE f.tenant_id = page.tenant_id AND f.page_id = page.id AND f.kind = 'gallery' AND f.status = 'ready'
      AND f.id::text IN (SELECT i FROM pg_catalog.jsonb_array_elements(page.published->'blocks') b, pg_catalog.jsonb_array_elements_text(b->'fileIds') i
        WHERE b->>'type' = 'gallery' AND public.bio_block_shown(page.published, b));
  IF pg_catalog.jsonb_typeof(page.published->'blocks') = 'array' THEN
    page.published := pg_catalog.jsonb_set(page.published, '{blocks}', (
      SELECT coalesce(pg_catalog.jsonb_agg(
        CASE WHEN b->>'type' <> 'gallery' THEN b ELSE pg_catalog.jsonb_set(b, '{fileIds}', available.ids) END ORDER BY ord), '[]'::jsonb)
      FROM pg_catalog.jsonb_array_elements(page.published->'blocks') WITH ORDINALITY blocks(b, ord)
      CROSS JOIN LATERAL (
        SELECT pg_catalog.jsonb_agg(i ORDER BY idx) AS ids
        FROM pg_catalog.jsonb_array_elements_text(b->'fileIds') WITH ORDINALITY ids(i, idx)
        WHERE gallery ? i
      ) available
      WHERE b->>'type' <> 'gallery' OR (public.bio_block_shown(page.published, b) AND available.ids IS NOT NULL)
    ));
  END IF;$new$;
BEGIN
  patched := pg_catalog.replace(def, old_list, new_list);
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(new_list) - pg_catalog.length(old_list) THEN
    RAISE EXCEPTION 'bio_public_page_scoped: expected exactly one gallery list';
  END IF;
  EXECUTE patched;
END
$patch$;
--> statement-breakpoint
ALTER TABLE public.bio_files ADD COLUMN gallery_unused_since timestamptz DEFAULT now();
CREATE INDEX bio_gallery_cleanup_due ON public.bio_files (gallery_unused_since, id) WHERE kind = 'gallery';

CREATE FUNCTION public.bio_gallery_references(p_definition jsonb, p_file uuid) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT FROM pg_catalog.jsonb_array_elements(p_definition->'blocks') b
    WHERE b->>'type' = 'gallery' AND (b->'fileIds') ? p_file::text
  )
$$;
REVOKE ALL ON FUNCTION public.bio_gallery_references(jsonb, uuid) FROM PUBLIC, harvest_app;

CREATE FUNCTION public.bio_gallery_track_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := public.bio_scope_clear(false);
BEGIN
  PERFORM pg_catalog.set_config('app.bio_tenant', NEW.tenant_id::text, true);
  UPDATE public.bio_files f
  SET gallery_unused_since = CASE WHEN public.bio_gallery_references(NEW.draft, f.id)
     OR public.bio_gallery_references(NEW.published, f.id) THEN NULL ELSE pg_catalog.clock_timestamp() END
  WHERE f.tenant_id = NEW.tenant_id AND f.page_id = NEW.id AND f.kind = 'gallery'
    AND (public.bio_gallery_references(OLD.draft, f.id) OR public.bio_gallery_references(OLD.published, f.id))
      IS DISTINCT FROM (public.bio_gallery_references(NEW.draft, f.id) OR public.bio_gallery_references(NEW.published, f.id));
  PERFORM public.bio_scope_restore(prior);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bio_gallery_track_references() FROM PUBLIC, harvest_app;
CREATE TRIGGER bio_gallery_track_references AFTER UPDATE OF draft, published ON public.bio_pages
FOR EACH ROW EXECUTE FUNCTION public.bio_gallery_track_references();

CREATE TABLE public.bio_gallery_cleanup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted integer NOT NULL CHECK (deleted BETWEEN 0 AND 50),
  failed integer NOT NULL CHECK (failed BETWEEN 0 AND 50)
);
ALTER TABLE public.bio_gallery_cleanup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bio_gallery_cleanup_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.bio_gallery_cleanup_runs FROM PUBLIC, harvest_app;

DO $$
DECLARE target text; def text; patched text;
  old_entry text := '''app.event_cover_cleanup'',';
  new_entry text := '''app.bio_gallery_cleanup'',''app.event_cover_cleanup'',';
BEGIN
  FOREACH target IN ARRAY ARRAY['public.blog_scope_clear()', 'public.account_self_reset()'] LOOP
    def := pg_catalog.pg_get_functiondef(target::regprocedure);
    patched := pg_catalog.replace(def, old_entry, new_entry);
    IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length(new_entry) - pg_catalog.length(old_entry) THEN
      RAISE EXCEPTION '%: expected exactly one event cover cleanup entry', target;
    END IF;
    EXECUTE patched;
  END LOOP;

  EXECUTE format($policy$CREATE POLICY bio_gallery_cleanup_file ON public.bio_files FOR SELECT TO %I
    USING (session_user = 'harvest_worker' AND current_setting('app.bio_gallery_cleanup', true) = 'on' AND kind = 'gallery')$policy$, current_user);
  EXECUTE format($policy$CREATE POLICY bio_gallery_cleanup_remove ON public.bio_files FOR DELETE TO %I
    USING (session_user = 'harvest_worker' AND current_setting('app.bio_gallery_cleanup', true) = 'on' AND kind = 'gallery')$policy$, current_user);
  EXECUTE format($policy$CREATE POLICY bio_gallery_cleanup_pages ON public.bio_pages FOR SELECT TO %I
    USING (session_user = 'harvest_worker' AND current_setting('app.bio_gallery_cleanup', true) = 'on')$policy$, current_user);
  EXECUTE format($policy$CREATE POLICY bio_gallery_cleanup_lock ON public.bio_pages FOR UPDATE TO %I
    USING (session_user = 'harvest_worker' AND current_setting('app.bio_gallery_cleanup', true) = 'on') WITH CHECK (false)$policy$, current_user);
  EXECUTE format($policy$CREATE POLICY bio_gallery_cleanup_log ON public.bio_gallery_cleanup_runs TO %I
    USING (session_user = 'harvest_worker' AND current_setting('app.bio_gallery_cleanup', true) = 'on')
    WITH CHECK (session_user = 'harvest_worker' AND current_setting('app.bio_gallery_cleanup', true) = 'on')$policy$, current_user);
END $$;
--> statement-breakpoint
-- Delete the database row and hold the page lock until the caller completes the object deletion.
-- Rolling back leaves the row available for another attempt.
CREATE FUNCTION public.bio_gallery_cleanup_take(p_skip uuid[]) RETURNS TABLE(file_id uuid, object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := pg_catalog.current_setting('app.bio_gallery_cleanup', true);
  candidate record;
  page public.bio_pages;
  cutoff timestamptz := pg_catalog.statement_timestamp() - interval '7 days';
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM pg_catalog.set_config('app.bio_gallery_cleanup', 'on', true);
  FOR candidate IN
    SELECT f.id, f.tenant_id, f.page_id FROM public.bio_files f
    JOIN public.bio_pages p ON p.tenant_id = f.tenant_id AND p.id = f.page_id
    WHERE f.kind = 'gallery' AND f.gallery_unused_since <= cutoff
      AND NOT (f.id = ANY(coalesce(p_skip, ARRAY[]::uuid[])))
      AND NOT public.bio_gallery_references(p.draft, f.id) AND NOT public.bio_gallery_references(p.published, f.id)
    ORDER BY f.gallery_unused_since, f.id LIMIT 50
  LOOP
    SELECT * INTO page FROM public.bio_pages p
    WHERE p.tenant_id = candidate.tenant_id AND p.id = candidate.page_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR public.bio_gallery_references(page.draft, candidate.id)
      OR public.bio_gallery_references(page.published, candidate.id) THEN CONTINUE; END IF;
    DELETE FROM public.bio_files f WHERE f.tenant_id = page.tenant_id AND f.page_id = page.id
      AND f.id = candidate.id AND f.kind = 'gallery' AND f.gallery_unused_since <= cutoff
      RETURNING f.id, f.key INTO file_id, object_key;
    IF FOUND THEN RETURN NEXT; EXIT; END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('app.bio_gallery_cleanup', coalesce(prior, ''), true);
END $$;

CREATE FUNCTION public.bio_gallery_cleanup_log(p_deleted integer, p_failed integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := pg_catalog.current_setting('app.bio_gallery_cleanup', true);
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM pg_catalog.set_config('app.bio_gallery_cleanup', 'on', true);
  INSERT INTO public.bio_gallery_cleanup_runs (deleted, failed) VALUES (p_deleted, p_failed);
  DELETE FROM public.bio_gallery_cleanup_runs WHERE finished_at < pg_catalog.statement_timestamp() - interval '90 days';
  PERFORM pg_catalog.set_config('app.bio_gallery_cleanup', coalesce(prior, ''), true);
END $$;

CREATE FUNCTION public.bio_gallery_cleanup_health() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := pg_catalog.current_setting('app.bio_gallery_cleanup', true); healthy boolean;
BEGIN
  IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM pg_catalog.set_config('app.bio_gallery_cleanup', 'on', true);
  SELECT finished_at > pg_catalog.statement_timestamp() - interval '26 hours' AND failed = 0
    INTO healthy FROM public.bio_gallery_cleanup_runs ORDER BY finished_at DESC, id DESC LIMIT 1;
  PERFORM pg_catalog.set_config('app.bio_gallery_cleanup', coalesce(prior, ''), true);
  RETURN coalesce(healthy, false);
END $$;

REVOKE ALL ON FUNCTION public.bio_gallery_cleanup_take(uuid[]), public.bio_gallery_cleanup_log(integer, integer),
  public.bio_gallery_cleanup_health() FROM PUBLIC, harvest_app;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.bio_gallery_cleanup_take(uuid[]), public.bio_gallery_cleanup_log(integer, integer),
      public.bio_gallery_cleanup_health() TO harvest_worker;
  END IF;
END $$;
