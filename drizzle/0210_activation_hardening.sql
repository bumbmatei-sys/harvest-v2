ALTER TABLE "connect_contact_decrypt_audit" DROP CONSTRAINT "connect_contact_decrypt_audit_key_version_check";--> statement-breakpoint
ALTER TABLE "ads_audience_uploads" ADD COLUMN "attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "connect_contact_decrypt_audit" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "connect_contact_decrypt_audit" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "connect_contact_decrypt_audit" ADD COLUMN "actor_kind" text;--> statement-breakpoint
ALTER TABLE "connect_contact_decrypt_audit" ADD COLUMN "actor_id" text;--> statement-breakpoint
CREATE INDEX "connect_contact_decrypt_audit_tenant_recent" ON "connect_contact_decrypt_audit" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
ALTER TABLE "connect_contact_decrypt_audit" DROP COLUMN "key_version";--> statement-breakpoint
ALTER TABLE "connect_contact_decrypt_audit" ADD CONSTRAINT "connect_contact_decrypt_audit_scope" CHECK ("connect_contact_decrypt_audit"."tenant_id" IS NOT NULL AND "connect_contact_decrypt_audit"."record_id" IS NOT NULL AND
    CASE "connect_contact_decrypt_audit"."purpose"
      WHEN 'invitation_request' THEN "connect_contact_decrypt_audit"."actor_kind" IS NOT DISTINCT FROM 'receipt' AND "connect_contact_decrypt_audit"."actor_id" IS NULL
      WHEN 'invitation_claim' THEN "connect_contact_decrypt_audit"."actor_kind" IS NOT DISTINCT FROM 'user' AND "connect_contact_decrypt_audit"."actor_id" IS NOT NULL
      ELSE "connect_contact_decrypt_audit"."actor_kind" IS NOT DISTINCT FROM 'worker' AND "connect_contact_decrypt_audit"."actor_id" IS NOT NULL
    END) NOT VALID;
--> statement-breakpoint
-- Older audit rows have no recoverable scope. They stay invisible to the app.
GRANT SELECT ON public.connect_contact_decrypt_audit TO harvest_app;
CREATE POLICY connect_contact_staff_read ON public.connect_contact_decrypt_audit FOR SELECT TO harvest_app
  USING (public.ministry_profile_role(tenant_id) IN ('owner', 'admin'));
--> statement-breakpoint
CREATE FUNCTION public.connect_audit_contact_open(p_tenant uuid, p_record uuid, p_purpose text, p_actor_kind text, p_actor_id text)
RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO public.connect_contact_decrypt_audit (tenant_id, record_id, purpose, actor_kind, actor_id)
  VALUES (p_tenant, p_record, p_purpose, p_actor_kind, p_actor_id)
$$;
REVOKE ALL ON FUNCTION public.connect_audit_contact_open(uuid,uuid,text,text,text) FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.connect_invitation_pending(p_receipt text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE mode text := current_setting('app.connect_intake_mode', true);
DECLARE answer jsonb; tenant uuid; record_id uuid;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM public.community_definer_reset();
  IF mode IS DISTINCT FROM 'synthetic' THEN RETURN NULL; END IF;
  PERFORM set_config('app.connect_intake_mode', 'synthetic', true);
  answer := public.connect_invitation_pending_scoped(p_receipt);
  IF answer IS NOT NULL AND answer->>'limited' IS DISTINCT FROM 'true' THEN
    SELECT r.tenant_id, r.response_id INTO STRICT tenant, record_id
      FROM public.connect_intake_receipts r WHERE r.receipt_hash = p_receipt;
    PERFORM public.connect_audit_contact_open(tenant, record_id, 'invitation_request', 'receipt', NULL);
  END IF;
  PERFORM public.account_self_reset();
  RETURN answer;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.connect_invitation_reserve(p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE mode text := current_setting('app.connect_intake_mode', true);
DECLARE answer jsonb;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM public.community_definer_reset();
  IF mode IS DISTINCT FROM 'synthetic' THEN RETURN NULL; END IF;
  PERFORM set_config('app.connect_intake_mode', 'synthetic', true);
  answer := public.connect_invitation_reserve_scoped(p_lease);
  IF answer->'envelope' IS NOT NULL THEN
    PERFORM public.connect_audit_contact_open((answer->>'tenant')::uuid, (answer->>'id')::uuid,
      'invitation_dispatch', 'worker', 'invitation-dispatch');
  END IF;
  PERFORM public.account_self_reset();
  RETURN answer;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.connect_claim_contact_open(p_flow text, p_recipient text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE mode text := current_setting('app.connect_intake_mode', true);
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
DECLARE flow jsonb; answer jsonb; tenant uuid; record_id uuid;
BEGIN
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM public.community_definer_reset();
  IF mode IS DISTINCT FROM 'synthetic' OR p_recipient IS NULL OR p_recipient !~ '^[a-f0-9]{64}$'
    OR NOT EXISTS (SELECT FROM public.users u WHERE u.id = actor AND u.email_verified) THEN RETURN NULL; END IF;

  PERFORM set_config('app.connect_intake_mode', 'synthetic', true);
  flow := public.connect_invitation_flow(p_flow);
  IF flow->>'automatic' = 'true' AND flow->>'recipientHash' = p_recipient THEN
    SELECT r.sealed_data, r.tenant_id, r.response_id INTO answer, tenant, record_id
    FROM public.connect_invitation_flows f
    JOIN public.connect_invitations i ON i.tenant_id = f.tenant_id AND i.id = f.invitation_id
    JOIN public.connect_intake_receipts r ON r.tenant_id = i.tenant_id AND r.response_id = i.response_id
    WHERE f.hash = p_flow;
    IF answer IS NOT NULL THEN
      PERFORM public.connect_audit_contact_open(tenant, record_id, 'invitation_claim', 'user', actor);
    END IF;
  END IF;
  PERFORM public.account_self_reset();
  RETURN answer;
END $$;
--> statement-breakpoint
DO $$
DECLARE original text; patched text; signature text;
  old_audit text := $a$public.connect_audit_contact_open(item.sealed_data, 'legacy_rotation')$a$;
  new_audit text := $a$public.connect_audit_contact_open(item.tenant_id, item.response_id, 'legacy_rotation', 'worker', 'contact-rotation')$a$;
  old_gate text := $g$IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;$g$;
  new_gate text := $g$IF session_user <> 'harvest_worker' THEN RAISE insufficient_privilege; END IF;
  PERFORM public.blog_scope_clear();
  PERFORM public.account_self_reset();
  PERFORM public.community_definer_reset();
  prior := '';$g$;
  anchor text := '''app.community_stats_write''';
  replacement text := anchor || ',''app.contact_rotation''';
BEGIN
  original := pg_catalog.pg_get_functiondef('public.community_definer_reset()'::regprocedure);
  patched := pg_catalog.replace(original, anchor, replacement);
  IF pg_catalog.length(patched) - pg_catalog.length(original) <> pg_catalog.length(replacement) - pg_catalog.length(anchor) THEN
    RAISE EXCEPTION 'Expected one rotation reset insertion point';
  END IF;
  EXECUTE patched;
  FOREACH signature IN ARRAY ARRAY[
    'public.connect_contact_rotation_page(uuid,uuid,text,integer)',
    'public.connect_contact_rotation_replace(uuid,uuid,jsonb,jsonb)',
    'public.connect_contact_rotation_remaining(text)'] LOOP
    original := pg_catalog.pg_get_functiondef(signature::regprocedure);
    patched := pg_catalog.replace(original, old_gate, new_gate);
    IF pg_catalog.length(patched) - pg_catalog.length(original) <> pg_catalog.length(new_gate) - pg_catalog.length(old_gate) THEN
      RAISE EXCEPTION 'Expected one worker gate in %', signature;
    END IF;
    IF signature = 'public.connect_contact_rotation_page(uuid,uuid,text,integer)' THEN
      original := patched;
      patched := pg_catalog.replace(original, old_audit, new_audit);
      IF pg_catalog.length(patched) - pg_catalog.length(original) <> pg_catalog.length(new_audit) - pg_catalog.length(old_audit) THEN
        RAISE EXCEPTION 'Expected one rotation audit insertion point';
      END IF;
    END IF;
    EXECUTE patched;
  END LOOP;
END $$;
DROP FUNCTION public.connect_audit_contact_open(jsonb,text);
