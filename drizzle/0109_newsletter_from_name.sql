-- The delivery authorization also returns the sender's display name, so the worker can put it in the From header. Same signature, owner and grants as 0073.
CREATE OR REPLACE FUNCTION public.newsletter_delivery_authorize(p_tenant uuid,p_key uuid,p_lease uuid,p_nonce text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d public.newsletter_deliveries; c public.newsletter_campaigns; r public.newsletter_campaign_revisions;
  subscriber public.newsletter_subscribers; contact public.contacts; subscription public.newsletter_subscriptions;
  address record; fingerprint record; assets jsonb; sender text; sender_name text; reply text; ministry text; reason text; consent uuid;
BEGIN
  IF session_user<>'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM set_config('app.nl_send_worker','on',true);
  PERFORM set_config('app.nl02_private','on',true);
  IF coalesce(p_nonce,'') !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE invalid_parameter_value; END IF;
  PERFORM set_config('app.nl_send_tenant',p_tenant::text,true);
  SELECT * INTO d FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND id=p_key AND lease=p_lease
    AND lease_until>clock_timestamp() AND state='queued' AND selected_at>clock_timestamp()-interval '2160 hours';
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT s.* INTO subscriber FROM public.newsletter_subscribers s WHERE s.tenant_id=p_tenant AND s.id=d.subscriber_id;
  SELECT * INTO contact FROM public.contacts WHERE tenant_id=p_tenant AND id=subscriber.contact_id AND erased_at IS NULL FOR UPDATE;
  SELECT * INTO subscriber FROM public.newsletter_subscribers WHERE tenant_id=p_tenant AND id=d.subscriber_id FOR UPDATE;
  SELECT * INTO c FROM public.newsletter_campaigns WHERE tenant_id=p_tenant AND id=d.campaign_id FOR UPDATE;
  SELECT * INTO d FROM public.newsletter_deliveries WHERE tenant_id=p_tenant AND id=p_key AND lease=p_lease
    AND lease_until>clock_timestamp() AND state='queued' AND selected_at>clock_timestamp()-interval '2160 hours' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.newsletter_campaign_revisions WHERE tenant_id=p_tenant AND campaign_id=c.id AND revision=c.revision;

  IF c.state NOT IN ('scheduled','sending') OR c.revision<>d.revision OR c.frozen_at IS NULL THEN reason:='cancelled';
  ELSIF contact.id IS NULL OR subscriber.id IS NULL OR subscriber.contact_id<>contact.id THEN reason:='person_unavailable';
  ELSIF subscriber.suppressed THEN reason:='global_suppressed';
  ELSE
    SELECT * INTO subscription FROM public.newsletter_subscriptions WHERE tenant_id=p_tenant
      AND subscriber_id=subscriber.id AND list_id=d.list_id FOR SHARE;
    IF subscription.state IN ('suppressed','bounced') THEN reason:='list_suppressed';
    ELSIF subscription.state IS DISTINCT FROM 'subscribed' THEN reason:='not_subscribed';
    ELSIF subscription.version IS DISTINCT FROM d.subscription_version THEN reason:='eligibility_changed';
    END IF;
    SELECT id INTO consent FROM public.contact_consents WHERE tenant_id=p_tenant AND contact_id=contact.id
      AND purpose='newsletter' AND channel='email' AND redacted_at IS NULL ORDER BY recorded_at DESC,occurred_at DESC,id DESC LIMIT 1;
    IF reason IS NULL AND NOT coalesce(public.newsletter_consent_allowed(p_tenant,contact.id,consent),false) THEN
      reason:=CASE WHEN public.nl02_has_withdrawal(p_tenant,contact.id,NULL,false) THEN 'consent_withdrawn' ELSE 'consent_missing' END;
    END IF;
  END IF;

  IF reason IS NULL THEN
    IF EXISTS (SELECT FROM public.newsletter_campaign_lists p JOIN public.newsletter_lists l
      ON l.tenant_id=p.tenant_id AND l.id=p.list_id WHERE p.tenant_id=p_tenant AND p.campaign_id=c.id
        AND p.revision=c.revision AND p.list_version<>l.version)
      OR EXISTS (SELECT FROM public.newsletter_campaign_segments p LEFT JOIN public.newsletter_segments s
        ON s.tenant_id=p.tenant_id AND s.id=p.segment_id LEFT JOIN public.crm_saved_views v
        ON v.tenant_id=s.tenant_id AND v.id=s.saved_view_id AND v.version=p.segment_version
          AND v.owner_user_id IS NULL AND v.object_type='person' AND coalesce(v.state->'sources','[]'::jsonb)='[]'::jsonb
        WHERE p.tenant_id=p_tenant AND p.campaign_id=c.id AND p.revision=c.revision
          AND (v.id IS NULL OR s.saved_view_version<>p.segment_version)) THEN
      reason:='review_invalidated';
    END IF;
    SELECT i.address, i.display_name INTO sender, sender_name FROM public.newsletter_identities i JOIN public.newsletter_connections cfg
      ON cfg.tenant_id=i.tenant_id AND cfg.id=i.connection_id
      WHERE i.tenant_id=p_tenant AND i.id=r.sender_id AND i.version=c.sender_version AND cfg.version=c.sender_domain_version
        AND i.ownership_verified AND i.enabled AND i.purpose='sender'
        AND cfg.ownership AND cfg.spf AND cfg.dkim AND cfg.bounce AND cfg.dmarc
        AND cfg.checked_at>clock_timestamp()-interval '48 hours'
        AND split_part(i.address,'@',2)=cfg.domain AND cfg.domain ~ '[.]example[.]test$' AND cfg.domain<>'newsletter.example.test' FOR SHARE OF i,cfg;
    SELECT i.address INTO reply FROM public.newsletter_identities i
      WHERE i.tenant_id=p_tenant AND i.id=r.reply_to_id AND i.version=c.reply_version
        AND i.ownership_verified AND i.enabled AND i.purpose='reply-to' FOR SHARE;
    IF sender IS NULL OR reply IS NULL THEN reason:='review_invalidated'; END IF;
    SELECT i.id,i.normalized_value INTO address FROM public.contact_identifiers i
      WHERE i.tenant_id=p_tenant AND i.contact_id=contact.id AND i.kind='email' FOR SHARE;
    IF NOT FOUND OR NOT public.nl02_email(address.normalized_value) THEN reason:='address_unavailable';
    ELSIF d.address_binding IS DISTINCT FROM (address.id::text||':'||contact.version::text) THEN reason:='eligibility_changed';
    ELSE reason:=coalesce(reason,public.newsletter_address_block(p_tenant,address.normalized_value,d.list_id)); END IF;
    SELECT coalesce(jsonb_agg(f.id),'[]'::jsonb) INTO assets FROM public.files f
      JOIN jsonb_array_elements(r.content) block ON block->>'type'='image' AND f.id::text=block->>'fileId'
      WHERE f.tenant_id=p_tenant AND f.status='ready' AND f.visibility='public' AND f.mime IN ('image/jpeg','image/png','image/webp');
    IF jsonb_array_length(assets)<>(SELECT count(*) FROM jsonb_array_elements(r.content) block WHERE block->>'type'='image')
      THEN reason:='review_invalidated'; END IF;
  END IF;

  IF reason IS NOT NULL THEN
    UPDATE public.newsletter_deliveries SET state='skipped',skip_reason=reason,lease=NULL,lease_until=NULL
      WHERE tenant_id=p_tenant AND id=p_key;
    PERFORM public.newsletter_finish_campaign(p_tenant,c.id);
    RETURN NULL;
  END IF;

  SELECT name INTO ministry FROM public.workspaces WHERE tenant_id=p_tenant;
  INSERT INTO public.newsletter_preference_tokens(token_hash,tenant_id,subscriber_id,list_id,scope,email_proof,expires_at)
    VALUES(public.nl02_hash(p_nonce),p_tenant,subscriber.id,d.list_id,'list',
      public.nl02_hash(p_nonce||':'||address.normalized_value),clock_timestamp()+interval '30 days');
  UPDATE public.newsletter_campaigns SET state='sending',version=version+1 WHERE tenant_id=p_tenant AND id=c.id AND state='scheduled';
  SELECT * INTO STRICT fingerprint FROM public.newsletter_suppression_digests(p_tenant,address.normalized_value)
    WHERE write_key;
  UPDATE public.newsletter_deliveries SET state='unknown',attempted_at=clock_timestamp(),
    attempted_address_hash=fingerprint.address_hash,attempted_key_version=fingerprint.key_version
    WHERE tenant_id=p_tenant AND id=p_key;
  RETURN jsonb_build_object('email',address.normalized_value,'firstName',split_part(btrim(contact.name),' ',1),'ministryName',ministry,
    'from',sender,'fromName',sender_name,'replyTo',reply,'content',r.content,'subject',r.subject,'preheader',r.preheader,'images',assets);
END $$;
