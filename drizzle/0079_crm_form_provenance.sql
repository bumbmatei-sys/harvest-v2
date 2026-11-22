ALTER TABLE "contact_source_events" DROP CONSTRAINT "contact_sources_contract";--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD COLUMN "crm_form_response_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD CONSTRAINT "contact_sources_crm_form_response_fk" FOREIGN KEY ("tenant_id","crm_form_response_id") REFERENCES "public"."crm_form_responses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_sources_crm_form_response_unique" ON "contact_source_events" USING btree ("tenant_id","crm_form_response_id") WHERE "contact_source_events"."crm_form_response_id" is not null;--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD CONSTRAINT "contact_sources_contract" CHECK ((("contact_source_events"."kind" = 'manual' and "contact_source_events"."outcome" = 'created' and "contact_source_events"."import_id" is null and "contact_source_events"."row_number" is null and "contact_source_events"."reverted_at" is null and "contact_source_events"."response_id" is null and "contact_source_events"."entry_route" is null) or ("contact_source_events"."kind" = 'csv_import' and "contact_source_events"."outcome" in ('created','updated') and "contact_source_events"."import_id" is not null and "contact_source_events"."row_number" is not null and "contact_source_events"."row_number" > 0 and "contact_source_events"."response_id" is null and "contact_source_events"."entry_route" is null) or ("contact_source_events"."kind" = 'connect' and "contact_source_events"."outcome" in ('created','updated') and "contact_source_events"."import_id" is null and "contact_source_events"."row_number" is null and "contact_source_events"."reverted_at" is null and "contact_source_events"."response_id" is not null and "contact_source_events"."entry_route" is not null and "contact_source_events"."entry_route" in ('qr','short'))) and "contact_source_events"."crm_form_response_id" is null or ("contact_source_events"."kind" = 'form' and "contact_source_events"."outcome" in ('created','updated') and "contact_source_events"."import_id" is null and "contact_source_events"."row_number" is null and "contact_source_events"."reverted_at" is null and "contact_source_events"."response_id" is null and "contact_source_events"."entry_route" is null and "contact_source_events"."crm_form_response_id" is not null));
--> statement-breakpoint
-- Keep the response as the sole copy of campaign/link attribution and the binding
-- to the immutable publication. As with Connect, expired evidence is hidden.
ALTER POLICY sources_read ON public.contact_source_events USING (
  tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id = contact_source_events.tenant_id
    AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin'))
  AND public.contact_source_retained(tenant_id, response_id)
  AND (crm_form_response_id IS NULL OR EXISTS (
    SELECT FROM public.crm_form_responses r WHERE r.tenant_id = contact_source_events.tenant_id
      AND r.id = contact_source_events.crm_form_response_id AND r.contact_id = contact_source_events.contact_id
      AND r.expires_at > now()
  ))
);
--> statement-breakpoint
-- The response INSERT runs inside the existing gated submit definer, after the
-- replay check. No app role can insert responses or write source events directly.
CREATE FUNCTION public.crm_form_record_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.created_contact THEN
    DELETE FROM public.contact_source_events
      WHERE tenant_id = NEW.tenant_id AND contact_id = NEW.contact_id AND kind = 'manual';
  END IF;
  INSERT INTO public.contact_source_events(tenant_id, contact_id, kind, outcome, occurred_at, crm_form_response_id)
    VALUES (NEW.tenant_id, NEW.contact_id, 'form', CASE WHEN NEW.created_contact THEN 'created' ELSE 'updated' END,
      NEW.submitted_at, NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_form_record_source() FROM PUBLIC;
CREATE TRIGGER crm_form_record_source AFTER INSERT ON public.crm_form_responses
  FOR EACH ROW EXECUTE FUNCTION public.crm_form_record_source();
