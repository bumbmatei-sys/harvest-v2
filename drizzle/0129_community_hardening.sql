-- C23 hardening. Indexes for the category-filtered forum list and for the per-author write limit, then the write limit itself.
CREATE INDEX "community_comments_author_recent_idx" ON "community_comments" USING btree ("community_id","author_id","created_at");--> statement-breakpoint
CREATE INDEX "community_posts_category_feed_idx" ON "community_posts" USING btree ("community_id","category_id","pinned","created_at");--> statement-breakpoint
CREATE INDEX "community_posts_author_recent_idx" ON "community_posts" USING btree ("community_id","author_id","created_at");--> statement-breakpoint
CREATE INDEX "community_reports_reporter_recent_idx" ON "community_reports" USING btree ("community_id","reporter_id","created_at");--> statement-breakpoint
-- Write limit (PRD section 15: strong rate limits for posts and reports). Chat, private messages, reactions and Discover reports
-- already limit themselves (0057, 0058, 0100); forum posts, forum comments and every kind of community report did not.
-- One BEFORE INSERT trigger per table, so every write path is covered, including the existing definers, which are unchanged.
-- Arguments: the author column and the most rows one person may add in one community in 10 minutes. The count runs as the
-- caller (inside a definer, the owner role under the definer's own tenant scope), so it never reads another tenant's rows.
-- An advisory lock per person, community and table keeps two concurrent requests from both passing the count.
-- SQLSTATE P0429 is mapped to HTTP 429 by errorResponse; the transaction rolls back, so nothing partial is kept.
CREATE FUNCTION public.community_write_rate_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_actor text := pg_catalog.to_jsonb(NEW) ->> TG_ARGV[0]; v_limit integer := TG_ARGV[1]::integer; v_count integer;
BEGIN
  IF v_actor IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('community_write_rate:' || TG_TABLE_NAME || ':' || NEW.community_id::text || ':' || v_actor));
  EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I WHERE community_id = $1 AND %I = $2 AND created_at > pg_catalog.now() - interval ''10 minutes''',
    TG_TABLE_NAME, TG_ARGV[0]) INTO v_count USING NEW.community_id, v_actor;
  IF v_count >= v_limit THEN RAISE EXCEPTION 'community_rate_limited' USING ERRCODE = 'P0429'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_write_rate_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER community_posts_rate_guard BEFORE INSERT ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.community_write_rate_guard('author_id', '10');--> statement-breakpoint
CREATE TRIGGER community_comments_rate_guard BEFORE INSERT ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.community_write_rate_guard('author_id', '30');--> statement-breakpoint
CREATE TRIGGER community_reports_rate_guard BEFORE INSERT ON public.community_reports
  FOR EACH ROW EXECUTE FUNCTION public.community_write_rate_guard('reporter_id', '20');
--> statement-breakpoint
-- Entry reset (C23 catalog audit): every owner-role policy on a community table is keyed on an app.* flag, and the definers
-- clear those flags on entry so a value the caller set cannot widen what the definer reads. Nine flags that owner policies read
-- were missing from the list: the chat, private-message and Discover worker flags, the stats, live, events and catalog scopes.
-- Same body as 0124 with those nine added; app.tenant_id and app.user_id stay, as before.
CREATE OR REPLACE FUNCTION public.community_definer_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT set_config(name, '', true) FROM unnest(ARRAY['app.community_resolve_slug','app.community_definer_tenant','app.community_resolve_ids',
    'app.community_resolve_invite','app.community_resolve_email','app.discover_read','app.community_resolve_user','app.community_purge',
    'app.community_email_worker','app.giving_definer','app.giving_definer_tenant','app.giving_public_tenant',
    'app.give_public_slug','app.give_public_tenant','app.give_public_fundraising',
    'app.catalog_tenant','app.chat_purge','app.chat_settings','app.community_stats_write','app.discover_platform',
    'app.dm_evidence_report','app.dm_purge','app.events_tenant','app.live_community']) AS name;
$$;
