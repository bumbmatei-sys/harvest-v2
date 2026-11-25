ALTER TABLE "newsletter_identities" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "newsletter_identities" ADD CONSTRAINT "newsletter_identity_display_name" CHECK ("newsletter_identities"."display_name" is null or (char_length("newsletter_identities"."display_name") between 1 and 80 and "newsletter_identities"."display_name" !~ '[<>"@[:cntrl:]]'));
--> statement-breakpoint
-- Sender follow-ups. A display name per sender address; changing it bumps the identity version (the existing guard trigger), which invalidates any
-- review that froze the old version, like any other sender change.
GRANT UPDATE (display_name) ON public.newsletter_identities TO harvest_app;
--> statement-breakpoint
-- Real delete of a sender address, and removal / re-issue of a sending domain. harvest_app has no DELETE grant and no write grant on the domain
-- records or checks, so each action is one SECURITY DEFINER function with a fixed search_path that re-checks the caller's ministry and delivery capability.
-- They set app.nl_send_tenant for their own statements only (the same way newsletter_verify_domain does) so the table policies admit the owner role,
-- and restore the prior value. None of them can mark a domain verified: re-issue resets every check.
CREATE FUNCTION public.newsletter_delete_identity(p_tenant uuid,p_id uuid,p_version integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior text:=current_setting('app.nl_send_tenant',true); found_version integer; used boolean; outcome text;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'')
      AND public.newsletter_capability(role_id,'newsletter:delivery')) THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT version INTO found_version FROM public.newsletter_identities WHERE tenant_id=p_tenant AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN outcome:='missing';
  ELSIF found_version<>p_version THEN outcome:='stale';
  ELSE
    -- Any revision of any campaign (draft, reviewed, sent or cancelled) that names the address as From or Reply-to keeps it.
    SELECT EXISTS (SELECT FROM public.newsletter_campaign_revisions r WHERE r.tenant_id=p_tenant AND (r.sender_id=p_id OR r.reply_to_id=p_id)) INTO used;
    IF used THEN outcome:='in_use';
    ELSE DELETE FROM public.newsletter_identities WHERE tenant_id=p_tenant AND id=p_id AND version=p_version; outcome:='deleted'; END IF;
  END IF;
  PERFORM set_config('app.nl_send_tenant',coalesce(prior,''),true);
  RETURN outcome;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.newsletter_delete_identity(uuid,uuid,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.newsletter_delete_identity(uuid,uuid,integer) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.newsletter_remove_domain(p_tenant uuid,p_id uuid,p_version integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior text:=current_setting('app.nl_send_tenant',true); found_version integer; outcome text;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'')
      AND public.newsletter_capability(role_id,'newsletter:delivery')) THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT version INTO found_version FROM public.newsletter_connections WHERE tenant_id=p_tenant AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN outcome:='missing';
  ELSIF found_version<>p_version THEN outcome:='stale';
  -- A domain with sender addresses stays: delete or move those addresses first.
  ELSIF EXISTS (SELECT FROM public.newsletter_identities i WHERE i.tenant_id=p_tenant AND i.connection_id=p_id) THEN outcome:='has_senders';
  ELSE DELETE FROM public.newsletter_connections WHERE tenant_id=p_tenant AND id=p_id AND version=p_version; outcome:='deleted'; END IF;
  PERFORM set_config('app.nl_send_tenant',coalesce(prior,''),true);
  RETURN outcome;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.newsletter_remove_domain(uuid,uuid,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.newsletter_remove_domain(uuid,uuid,integer) TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.newsletter_reissue_domain(p_tenant uuid,p_id uuid,p_version integer,p_records jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior text:=current_setting('app.nl_send_tenant',true); updated integer;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR NOT EXISTS (
    SELECT FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=nullif(current_setting('app.user_id',true),'')
      AND public.newsletter_capability(role_id,'newsletter:delivery')) THEN RAISE insufficient_privilege; END IF;
  IF p_records IS NULL OR jsonb_typeof(p_records)<>'array' OR jsonb_array_length(p_records)=0 THEN RAISE check_violation; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  -- New records, every check back to "not checked": the domain and its sender addresses are unverified until the next check, and the version bump
  -- invalidates any review that froze the old domain version.
  UPDATE public.newsletter_connections SET records=p_records,ownership=false,spf=false,dkim=false,bounce=false,dmarc=false,checked_at=NULL,version=version+1
    WHERE tenant_id=p_tenant AND id=p_id AND version=p_version;
  GET DIAGNOSTICS updated=ROW_COUNT;
  PERFORM set_config('app.nl_send_tenant',coalesce(prior,''),true);
  RETURN updated>0;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.newsletter_reissue_domain(uuid,uuid,integer,jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.newsletter_reissue_domain(uuid,uuid,integer,jsonb) TO harvest_app;
