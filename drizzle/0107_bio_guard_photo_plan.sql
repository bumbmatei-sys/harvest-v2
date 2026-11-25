-- bio_guard_photo runs as the caller (harvest_app), which has no privilege on bio_files by design. The 0094 version put the bio_files query in the
-- same expression as "wanted IS NOT NULL"; with a cached generic plan the table stays in the plan even when every id is null, and a first-read page
-- creation failed with "permission denied for table bio_files". The query is now nested, so it is only planned when an id is set (photo writes run
-- through the definer bio_photo_perform). Same name, owner, grants and trigger.
CREATE OR REPLACE FUNCTION public.bio_guard_photo() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE wanted uuid;
BEGIN
  FOREACH wanted IN ARRAY ARRAY[NEW.photo_file_id, NEW.published_photo_file_id, NEW.cover_file_id, NEW.published_cover_file_id] LOOP
    IF wanted IS NOT NULL THEN
      IF NOT EXISTS (SELECT FROM public.bio_files f WHERE f.id = wanted AND f.tenant_id = NEW.tenant_id AND f.page_id = NEW.id AND f.status = 'ready') THEN
        RAISE EXCEPTION 'photo does not belong to this page or is unavailable' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bio_guard_photo() FROM PUBLIC, harvest_app;
