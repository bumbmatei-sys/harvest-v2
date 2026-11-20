-- The existing staff policy permits owner/admin access to every item state.
-- Other ministry members retain the existing published and archived metadata reads.
ALTER POLICY catalog_metadata ON public.catalog_items
  USING (state <> 'draft' AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
    SELECT FROM public.workspace_members m WHERE m.tenant_id = catalog_items.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '')
  ));
