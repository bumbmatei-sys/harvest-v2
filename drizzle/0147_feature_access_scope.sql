-- A refusal must clear the same private scope as a successful operation. Apply
-- exact replacements to the deployed definitions, checking the expected count.
DO $$
DECLARE
  patch record;
  def text;
  updated text;
  needle text;
  prefix constant text := 'PERFORM set_config(''app.access_tenant'', '''', true); ';
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    ('public.workspace_access_change(text,text,jsonb,boolean)', 'forbidden', 4),
    ('public.workspace_access_change(text,text,jsonb,boolean)', 'invalid', 3),
    ('public.workspace_access_change(text,text,jsonb,boolean)', 'not_found', 1),
    ('public.workspace_access_change(text,text,jsonb,boolean)', 'conflict', 1),
    ('public.workspace_invitation_create(text,text,jsonb,text,boolean)', 'forbidden', 3),
    ('public.workspace_invitation_create(text,text,jsonb,text,boolean)', 'invalid', 3),
    ('public.workspace_invitation_revoke(uuid)', 'forbidden', 2)
  ) AS p(signature, outcome, occurrences)
  LOOP
    def := pg_catalog.pg_get_functiondef(patch.signature::regprocedure);
    needle := format('RETURN ''{"outcome":"%s"}''::jsonb;', patch.outcome);
    updated := pg_catalog.replace(def, needle, prefix || needle);
    IF pg_catalog.length(updated) - pg_catalog.length(def) <> patch.occurrences * pg_catalog.length(prefix) THEN
      RAISE EXCEPTION 'Unexpected access scope definition: % (%).', patch.signature, patch.outcome;
    END IF;
    EXECUTE updated;
  END LOOP;
END $$;
