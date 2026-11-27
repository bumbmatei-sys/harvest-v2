-- blog_scope_clear (0135) listed a truncated 'app.nl'; owner-role policies (0088) read app.nl02_tenant and app.nl02_private.
-- Patch the live definition instead of redefining it, so entries other migrations add to the list (before or after this one) are kept.
DO $$
DECLARE def text; patched text;
BEGIN
  def := pg_catalog.pg_get_functiondef('public.blog_scope_clear()'::regprocedure);
  patched := pg_catalog.replace(def, '''app.nl'',', '''app.nl02_tenant'',''app.nl02_private'',');
  IF pg_catalog.length(patched) - pg_catalog.length(def) <> pg_catalog.length('''app.nl02_tenant'',''app.nl02_private'',') - pg_catalog.length('''app.nl'',') THEN
    RAISE EXCEPTION 'blog_scope_clear: expected exactly one ''app.nl'' entry to replace';
  END IF;
  EXECUTE patched;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.blog_scope_clear() FROM PUBLIC, harvest_app;
