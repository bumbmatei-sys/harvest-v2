ALTER TABLE public.ads_audiences ADD COLUMN crm_saved_view_id uuid, ADD COLUMN crm_managed boolean NOT NULL DEFAULT false;
ALTER TABLE public.ads_audiences ADD CONSTRAINT ads_audiences_crm_view_fk
  FOREIGN KEY (tenant_id, crm_saved_view_id) REFERENCES public.crm_saved_views (tenant_id, id)
  ON DELETE SET NULL (crm_saved_view_id);
ALTER TABLE public.ads_audiences ADD CONSTRAINT ads_audiences_crm_view_kind
  CHECK ((NOT crm_managed OR kind = 'customer_list') AND (crm_saved_view_id IS NULL OR crm_managed));
