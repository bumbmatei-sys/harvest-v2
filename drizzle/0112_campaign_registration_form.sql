ALTER TABLE "campaign_drafts" ADD COLUMN "registration_form_id" uuid;--> statement-breakpoint
-- CW-08 follow-up (founder, 25 Nov): when Public Campaign Registration is on, Finish creates ONE unpublished registration form (a record of the CRM forms
-- module) and records it on the finished draft. The finishing update sets the id first and the form is inserted afterwards in the same transaction, so the
-- reference to forms is deferred to commit; a finish that loses the update never inserts a form. The column can change only in that finishing update.
ALTER TABLE public.campaign_drafts ADD CONSTRAINT campaign_drafts_registration_form_fk FOREIGN KEY (tenant_id, registration_form_id)
  REFERENCES public.forms (tenant_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
GRANT UPDATE (registration_form_id) ON public.campaign_drafts TO harvest_app;
--> statement-breakpoint
CREATE FUNCTION public.campaign_drafts_guard_registration_form() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.registration_form_id IS DISTINCT FROM OLD.registration_form_id
    AND NOT (OLD.status = 'draft' AND NEW.status = 'finished' AND OLD.registration_form_id IS NULL) THEN
    RAISE EXCEPTION 'the registration form is recorded only when the draft is finished' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.campaign_drafts_guard_registration_form() FROM PUBLIC;
CREATE TRIGGER campaign_drafts_guard_registration_form BEFORE UPDATE OF registration_form_id ON public.campaign_drafts FOR EACH ROW EXECUTE FUNCTION public.campaign_drafts_guard_registration_form();
