CREATE OR REPLACE FUNCTION public.blog_scope_clear() RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb := '{}'::jsonb; key text;
BEGIN
  FOREACH key IN ARRAY ARRAY['app.blog_public_handle','app.blog_public_tenant','app.blog_public_file','app.blog_publish','app.access_tenant','app.account_export','app.access_token',
      'app.ads_definer','app.bio_handle','app.bio_tenant','app.campaign_budget_tenant','app.campaign_invite_tenant','app.campaign_invite_token',
      'app.catalog_slug','app.catalog_tenant','app.catalog_learner_tenant','app.catalog_my_notes','app.catalog_progress_tenant','app.chat_purge','app.chat_settings','app.community_definer_tenant','app.community_email_worker',
      'app.community_purge','app.community_resolve_email','app.community_resolve_ids','app.community_resolve_invite','app.community_resolve_slug',
      'app.community_resolve_user','app.community_stats_write','app.connect_campaign','app.connect_flow','app.connect_intake_mode',
      'app.connect_invite_id','app.connect_invite_token','app.connect_invite_worker','app.connect_landing_link','app.connect_metrics',
      'app.connect_purge','app.connect_receipt','app.connect_resolve_code','app.connect_resolve_tenant','app.connect_retention',
      'app.connect_version','app.crm_forms_slug','app.crm_forms_tenant','app.discover_platform','app.discover_read','app.dm_evidence_report',
      'app.dm_purge','app.docs_purge','app.event_cover_cleanup','app.events_tenant','app.give_public_fundraising','app.give_public_slug',
      'app.give_public_tenant','app.giving_definer','app.giving_definer_tenant','app.giving_public_tenant','app.live_community',
      'app.newsletter_erasure_contact','app.newsletter_erasure_tenant','app.nl02_tenant','app.nl02_private','app.nl_auto_private','app.nl_forms_tenant','app.nl_growth_scan',
      'app.nl_send_insight','app.nl_send_tenant','app.nl_send_worker','app.office_erasure_contact','app.platform_staff',
      'app.social_analytics_worker','app.social_approval_definer','app.social_auto_dm_worker','app.social_definer','app.social_inbox_worker',
      'app.social_media_tenant','app.social_upload_cleanup','app.tenant_id','app.user_id'] LOOP
    prior := prior || pg_catalog.jsonb_build_object(key, coalesce(pg_catalog.current_setting(key, true), ''));
    PERFORM pg_catalog.set_config(key, '', true);
  END LOOP;
  RETURN prior;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_scope_clear() FROM PUBLIC, harvest_app;
