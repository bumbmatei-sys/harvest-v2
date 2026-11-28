-- Keep the SQL reports aligned with the owner/admin server capability.
DO $$
DECLARE
  report record;
  def text;
  updated text;
  replacement text;
BEGIN
  FOR report IN SELECT * FROM (VALUES
    ('public.newsletter_analytics_groups(uuid,uuid,date,date)', 'public.access_role(tenant_id, user_id, ''newsletter'', role_id)'),
    ('public.newsletter_current_eligibility(uuid,uuid,date,date)', 'public.access_role(tenant_id, user_id, ''newsletter'', role_id)'),
    ('public.newsletter_audience_growth(uuid,date,date)', 'public.access_role(m.tenant_id,m.user_id,''newsletter'',m.role_id)'),
    ('public.newsletter_outcome_days(uuid,uuid,date,date)', 'public.access_role(m.tenant_id,m.user_id,''newsletter'',m.role_id)')
  ) AS r(signature, original)
  LOOP
    def := pg_catalog.pg_get_functiondef(report.signature::regprocedure);
    replacement := pg_catalog.replace(report.original, '''newsletter''', '''owner_admin''');
    updated := pg_catalog.replace(def, report.original, replacement);
    IF pg_catalog.length(updated) - pg_catalog.length(def) <> pg_catalog.length(replacement) - pg_catalog.length(report.original) THEN
      RAISE EXCEPTION 'Expected exactly one analytics access check in %', report.signature;
    END IF;
    EXECUTE updated;
  END LOOP;
END $$;
