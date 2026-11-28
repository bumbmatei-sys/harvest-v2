-- The QA seed uses only the reserved example.invalid mail domain. The existing
-- synthetic provider and worker gates still apply. Scope optional worker claims
-- to one campaign while the preview seed is building its statistics.
DO $$
DECLARE
  target regprocedure;
  definition text;
  needle text;
  replacement text;
BEGIN
  FOR target, needle, replacement IN VALUES
    (
      'public.newsletter_verify_domain(uuid,uuid,integer,boolean,boolean,boolean,boolean,boolean)'::regprocedure,
      $find$current_domain ~ '[.]example[.]test$'$find$,
      $patch$(current_domain ~ '[.]example[.]test$' OR current_domain='example.invalid')$patch$
    ),
    (
      'public.newsletter_delivery_authorize(uuid,uuid,uuid,text)'::regprocedure,
      $find$cfg.domain ~ '[.]example[.]test$'$find$,
      $patch$(cfg.domain ~ '[.]example[.]test$' OR cfg.domain='example.invalid')$patch$
    ),
    (
      'public.newsletter_delivery_claim(integer,integer)'::regprocedure,
      $find$WHERE d.state='queued' AND c.state$find$,
      $patch$WHERE d.state='queued'
      AND (nullif(current_setting('app.qa_newsletter_campaign',true),'') IS NULL
        OR d.campaign_id::text=current_setting('app.qa_newsletter_campaign',true))
      AND c.state$patch$
    ),
    (
      'public.newsletter_delivery_claim(integer,integer)'::regprocedure,
      $find$  RETURN result;$find$,
      $patch$  PERFORM set_config('app.qa_newsletter_campaign','',true);
  PERFORM set_config('app.nl_send_worker','',true);
  RETURN result;$patch$
    )
  LOOP
    definition := pg_catalog.pg_get_functiondef(target);
    IF (length(definition) - length(replace(definition, needle, ''))) <> length(needle) THEN
      RAISE EXCEPTION 'Expected exactly one QA newsletter patch anchor in %', target;
    END IF;
    EXECUTE replace(definition, needle, replacement);
  END LOOP;
END $$;
