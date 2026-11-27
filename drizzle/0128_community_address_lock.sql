-- Permanent community address lock (founder decision 17 Nov, follow-up). 0127 is reserved for open PR #300.
-- first_published_at is set the first time a community is published and never cleared, unpublish included. Once it is set the
-- address (slug) can never change, so shared links, QR codes and invitations keep working after an unpublish and republish.
ALTER TABLE "communities" ADD COLUMN "first_published_at" timestamp with time zone;--> statement-breakpoint
-- The lock lives in the database as well as the app (409 communitySlugLocked). A plain invoker trigger (not SECURITY DEFINER): it only reads
-- and sets the row being written, needs no privilege of its own and reads or sets no app.* setting.
CREATE FUNCTION public.community_address_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.first_published_at IS NOT NULL THEN
    IF NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
      RAISE EXCEPTION 'community_first_published_at is permanent' USING ERRCODE = 'check_violation', CONSTRAINT = 'community_first_published';
    END IF;
    IF NEW.slug IS DISTINCT FROM OLD.slug THEN
      RAISE EXCEPTION 'community_address_locked' USING ERRCODE = 'check_violation', CONSTRAINT = 'community_address_locked';
    END IF;
  ELSIF NEW.status = 'published' AND NEW.first_published_at IS NULL THEN
    NEW.first_published_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_address_lock() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER community_address_lock BEFORE INSERT OR UPDATE ON public.communities
  FOR EACH ROW EXECUTE FUNCTION public.community_address_lock();--> statement-breakpoint
-- Backfill: every community published now, and every community the audit log shows was published before (unpublished or archived since),
-- gets its earliest recorded publish time, else its last update. The owner runs under FORCE row security (0035, 0001), which would hide
-- every row, so both tables are relaxed for this block only and put back exactly as found (the 0091 pattern). The other update triggers on
-- communities (chat settings revision, event publication epoch) act only on chat settings or status changes, which this does not make.
DO $$
DECLARE r regclass; forced regclass[];
BEGIN
  SELECT coalesce(array_agg(c.oid::regclass), '{}') INTO forced FROM pg_class c
    WHERE c.relforcerowsecurity AND c.oid IN ('public.communities'::regclass, 'public.audit_logs'::regclass);
  FOREACH r IN ARRAY forced LOOP EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', r); END LOOP;
  -- 'unsubscribe' becomes reserved below (the static /communities/unsubscribe page, #301). A migration cannot rename a live address, so an
  -- existing community holding it stops the migration with a clear message instead of a bare CHECK failure (the whole migration rolls back).
  IF EXISTS (SELECT FROM public.communities c WHERE c.slug = 'unsubscribe') THEN
    RAISE EXCEPTION 'migration 0128: a community already uses the reserved address "unsubscribe"; rename it by hand before applying this migration'
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.communities c SET first_published_at = coalesce(p.first_at, c.updated_at)
    FROM (SELECT c2.tenant_id, c2.id, (SELECT min(a.created_at) FROM public.audit_logs a
        WHERE a.tenant_id = c2.tenant_id AND a.action = 'community.publish' AND a.target_id = c2.id::text) AS first_at
      FROM public.communities c2) p
    WHERE p.tenant_id = c.tenant_id AND p.id = c.id AND c.first_published_at IS NULL AND (c.status = 'published' OR p.first_at IS NOT NULL);
  FOREACH r IN ARRAY forced LOOP EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', r); END LOOP;
END $$;--> statement-breakpoint
-- 'unsubscribe' joins the reserved addresses (schema reservedCommunitySlugs), in the database as well as the app.
ALTER TABLE "communities" DROP CONSTRAINT "community_slug";--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "community_slug" CHECK ("communities"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$' and "communities"."slug" not in ('new', 'discover', 'search', 'create', 'settings', 'admin', 'api', 'me', 'account', 'unsubscribe'));
