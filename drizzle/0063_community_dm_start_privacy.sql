-- The caller already holds the per-sender advisory lock. Both checks use only sender state.
CREATE FUNCTION public.community_dm_message_retry_after(p_tenant uuid, p_community uuid, p_actor text, p_stamp timestamptz)
RETURNS integer LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN count(*) FILTER (WHERE created_at > p_stamp - interval '10 seconds') >= 5 THEN 10
    WHEN count(*) >= 60 THEN 600 END
  FROM public.community_dm_messages
  WHERE tenant_id=p_tenant AND community_id=p_community AND author_id=p_actor
    AND created_at > p_stamp - interval '10 minutes'
$$;

CREATE FUNCTION public.community_dm_start_capped(p_tenant uuid, p_community uuid, p_actor text, p_stamp timestamptz, p_host boolean)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT count(*) >= 10 OR (NOT p_host AND count(*) FILTER (WHERE created_at > p_stamp - interval '1 hour') >= 3)
  FROM public.community_dm_conversations
  WHERE tenant_id=p_tenant AND community_id=p_community AND started_by=p_actor
    AND created_at > p_stamp - interval '1 day'
$$;

REVOKE ALL ON FUNCTION public.community_dm_message_retry_after(uuid,uuid,text,timestamptz),
  public.community_dm_start_capped(uuid,uuid,text,timestamptz,boolean) FROM PUBLIC, harvest_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.community_dm_write(p_slug text, p_conversation uuid, p_target text, p_body text, p_client uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  ctx record;
  conversation public.community_dm_conversations%ROWTYPE;
  previous public.community_dm_messages%ROWTYPE;
  saved public.community_dm_messages%ROWTYPE;
  other_user text;
  pair text;
  host boolean;
  stamp timestamptz;
  retry_after integer;
  valid_input boolean;
BEGIN
  SELECT * INTO ctx FROM public.community_chat_actor(p_slug);
  IF ctx.tenant IS NULL THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;

  -- The same per-author lock as channels, followed by conversation then membership rows.
  PERFORM pg_advisory_xact_lock(hashtext(actor || ctx.community::text));
  valid_input := p_body IS NOT NULL AND p_body ~ '[^[:space:]]' AND length(p_body) BETWEEN 1 AND 2000 AND p_client IS NOT NULL;
  IF p_conversation IS NULL THEN
    stamp := clock_timestamp();
    host := coalesce(public.community_chat_can(public.community_dm_active(ctx.tenant,ctx.community,actor), 'chat:manage_channels'), false);
    -- Address-based start refuses a capped sender before probing a recipient or an existing pair.
    IF public.community_dm_message_retry_after(ctx.tenant,ctx.community,actor,stamp) IS NOT NULL
      OR public.community_dm_start_capped(ctx.tenant,ctx.community,actor,stamp,host) THEN
      RETURN public.community_chat_done('{"outcome":"not_available"}');
    END IF;
    IF NOT valid_input THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
    SELECT * INTO previous FROM public.community_dm_messages
      WHERE community_id=ctx.community AND author_id=actor AND client_id=p_client;
    IF FOUND AND previous.request_hash IS DISTINCT FROM encode(sha256(convert_to(p_body, 'UTF8')), 'hex') THEN
      RETURN public.community_chat_done('{"outcome":"client_id_conflict"}');
    END IF;
    IF p_target IS NULL OR actor = p_target THEN RETURN public.community_chat_done('{"outcome":"not_available"}'); END IF;
    other_user := p_target;
    pair := public.community_dm_pair(actor, other_user);
    PERFORM pg_advisory_xact_lock(hashtextextended(ctx.community::text || pair, 12058));
    SELECT * INTO conversation FROM public.community_dm_conversations c
      WHERE c.tenant_id = ctx.tenant AND c.community_id = ctx.community AND c.pair_key = pair FOR UPDATE;
  ELSE
    SELECT * INTO conversation FROM public.community_dm_conversations c
      WHERE c.tenant_id = ctx.tenant AND c.community_id = ctx.community AND c.id = p_conversation
      AND EXISTS(SELECT 1 FROM public.community_dm_participants p WHERE p.conversation_id = c.id AND p.user_id = actor AND p.left_at IS NULL)
      FOR UPDATE;
    IF NOT FOUND THEN RETURN public.community_chat_done('{"outcome":"not_found"}'); END IF;
    SELECT p.user_id INTO other_user FROM public.community_dm_participants p
      WHERE p.conversation_id = conversation.id AND p.user_id <> actor AND p.left_at IS NULL;
  END IF;
  PERFORM public.community_dm_lock_members(ctx.tenant, ctx.community, ARRAY[actor, other_user]);
  IF NOT public.community_dm_can_send(ctx.tenant, ctx.community, actor, other_user,
    conversation.id IS NOT NULL, conversation.staff_engaged_by, conversation.staff_engaged_at) THEN
    RETURN public.community_chat_done('{"outcome":"not_available"}');
  END IF;
  IF p_conversation IS NOT NULL THEN
    IF NOT valid_input THEN RETURN public.community_chat_done('{"outcome":"invalid"}'); END IF;
    SELECT * INTO previous FROM public.community_dm_messages
      WHERE community_id=ctx.community AND author_id=actor AND client_id=p_client;
  END IF;
  IF previous.id IS NOT NULL THEN
    IF previous.conversation_id IS DISTINCT FROM conversation.id OR previous.request_hash IS DISTINCT FROM encode(sha256(convert_to(p_body, 'UTF8')), 'hex') THEN
      RETURN public.community_chat_done(CASE WHEN p_conversation IS NULL THEN '{"outcome":"not_available"}'::jsonb
        ELSE '{"outcome":"client_id_conflict"}'::jsonb END);
    END IF;
    RETURN public.community_chat_done(jsonb_build_object('outcome','ok','conversationId',conversation.id,'message',public.community_dm_project(previous)));
  END IF;
  stamp := clock_timestamp();
  host := public.community_chat_can(public.community_dm_active(ctx.tenant, ctx.community, actor), 'chat:manage_channels');

  IF p_conversation IS NOT NULL THEN
    retry_after := public.community_dm_message_retry_after(ctx.tenant,ctx.community,actor,stamp);
    IF retry_after IS NOT NULL THEN
      RETURN public.community_chat_done(jsonb_build_object('outcome','rate_limited','retryAfter',retry_after));
    END IF;
  END IF;
  IF conversation.last_sender_id = actor AND conversation.unanswered >= 3 THEN
    RETURN public.community_chat_done(CASE WHEN p_conversation IS NULL THEN '{"outcome":"not_available"}'::jsonb
      ELSE '{"outcome":"unanswered_limit"}'::jsonb END);
  END IF;
  IF conversation.id IS NULL THEN
    -- Apply the current host rank under the membership locks if it changed since the precheck.
    IF public.community_dm_start_capped(ctx.tenant,ctx.community,actor,stamp,coalesce(host,false)) THEN
      RETURN public.community_chat_done('{"outcome":"not_available"}');
    END IF;
    INSERT INTO public.community_dm_conversations(tenant_id, community_id, pair_key, origin, started_by, created_at)
      VALUES(ctx.tenant, ctx.community, pair, CASE WHEN host THEN 'staff' ELSE 'member' END, actor, stamp)
      RETURNING * INTO conversation;
    INSERT INTO public.community_dm_participants(tenant_id, community_id, conversation_id, user_id)
      VALUES (ctx.tenant, ctx.community, conversation.id, actor), (ctx.tenant, ctx.community, conversation.id, other_user);
  END IF;
  UPDATE public.community_dm_conversations SET last_rev = last_rev + 1, last_message_at = stamp,
    unanswered = CASE WHEN last_sender_id = actor THEN unanswered + 1 ELSE 1 END, last_sender_id = actor,
    staff_engaged_at = CASE WHEN host THEN stamp ELSE staff_engaged_at END,
    staff_engaged_by = CASE WHEN host THEN actor ELSE staff_engaged_by END
    WHERE id = conversation.id RETURNING * INTO conversation;
  IF host THEN
    UPDATE public.community_dm_participants SET hidden_at = NULL WHERE conversation_id = conversation.id AND user_id = other_user;
  END IF;
  UPDATE public.community_dm_participants SET hidden_at = NULL WHERE conversation_id = conversation.id AND user_id = actor;
  INSERT INTO public.community_dm_messages(tenant_id, community_id, conversation_id, author_id, client_id, request_hash, body, seq, rev, created_at)
    VALUES(ctx.tenant, ctx.community, conversation.id, actor, p_client, encode(sha256(convert_to(p_body, 'UTF8')), 'hex'),
      p_body, conversation.last_rev, conversation.last_rev, stamp)
    RETURNING * INTO saved;
  PERFORM public.community_dm_bump(ctx.tenant, ctx.community, conversation.id, ARRAY[actor, other_user]);
  PERFORM public.community_dm_notify(ctx.tenant, ctx.community, conversation.id, actor, other_user);
  RETURN public.community_chat_done(jsonb_build_object('outcome','ok','conversationId',conversation.id,'message',public.community_dm_project(saved)));
END $$;
REVOKE ALL ON FUNCTION public.community_dm_write(text,uuid,text,text,uuid) FROM PUBLIC, harvest_app;
