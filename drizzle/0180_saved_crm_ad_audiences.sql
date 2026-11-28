ALTER TABLE public.ads_audiences ADD COLUMN crm_saved_view_id uuid, ADD COLUMN crm_managed boolean NOT NULL DEFAULT false;
ALTER TABLE public.ads_audiences ADD CONSTRAINT ads_audiences_crm_view_fk
  FOREIGN KEY (tenant_id, crm_saved_view_id) REFERENCES public.crm_saved_views (tenant_id, id)
  ON DELETE SET NULL (crm_saved_view_id);
ALTER TABLE public.ads_audiences ADD CONSTRAINT ads_audiences_crm_view_kind
  CHECK ((NOT crm_managed OR kind = 'customer_list') AND (crm_saved_view_id IS NULL OR crm_managed));
--> statement-breakpoint
-- Founder decision 28 Nov 2026: only owners and admins build, sync or delete an ad audience made from CRM people.
-- The check reads the stored membership role on purpose, not public.access_role: a collaborator with Social access
-- (which access_role maps to admin for ads_can) must not reach CRM-based audiences.
CREATE FUNCTION public.ads_crm_audience_staff(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner','admin'))
$$;
REVOKE ALL ON FUNCTION public.ads_crm_audience_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ads_crm_audience_staff(uuid) TO harvest_app;
CREATE POLICY ads_crm_audience_create ON public.ads_audiences AS RESTRICTIVE FOR INSERT TO harvest_app
  WITH CHECK (NOT crm_managed OR public.ads_crm_audience_staff(tenant_id));
CREATE POLICY ads_crm_audience_change ON public.ads_audiences AS RESTRICTIVE FOR UPDATE TO harvest_app
  USING (NOT crm_managed OR public.ads_crm_audience_staff(tenant_id))
  WITH CHECK (NOT crm_managed OR public.ads_crm_audience_staff(tenant_id));
CREATE POLICY ads_crm_audience_delete ON public.ads_audiences AS RESTRICTIVE FOR DELETE TO harvest_app
  USING (NOT crm_managed OR public.ads_crm_audience_staff(tenant_id));
-- Every upload is a CRM audience sync.
CREATE POLICY ads_crm_audience_uploads ON public.ads_audience_uploads AS RESTRICTIVE TO harvest_app
  USING (public.ads_crm_audience_staff(tenant_id)) WITH CHECK (public.ads_crm_audience_staff(tenant_id));
