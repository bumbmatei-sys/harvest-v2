CREATE TABLE "campaign_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"uploader_id" text,
	"key" text NOT NULL,
	"kind" text DEFAULT 'cover' NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"checksum" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_files_key_unique" UNIQUE("key"),
	CONSTRAINT "campaign_file_kind" CHECK ("campaign_files"."kind" = 'cover'),
	CONSTRAINT "campaign_file_mime" CHECK ("campaign_files"."mime" in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "campaign_file_name" CHECK (length(btrim("campaign_files"."name")) between 1 and 200),
	CONSTRAINT "campaign_file_size" CHECK ("campaign_files"."size" between 1 and 10485760),
	CONSTRAINT "campaign_file_checksum" CHECK ("campaign_files"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "campaign_file_status" CHECK ("campaign_files"."status" in ('pending','uploaded','quarantined','ready')),
	CONSTRAINT "campaign_file_key" CHECK ("campaign_files"."key" = 'workspaces/' || "campaign_files"."tenant_id"::text || '/campaign-drafts/' || "campaign_files"."draft_id"::text || '/files/' || "campaign_files"."id"::text)
);
--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD COLUMN "cover_file_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "cover_file_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_files" ADD CONSTRAINT "campaign_files_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_files" ADD CONSTRAINT "campaign_files_tenant_id_draft_id_campaign_drafts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","draft_id") REFERENCES "public"."campaign_drafts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_files_draft_idx" ON "campaign_files" USING btree ("tenant_id","draft_id");--> statement-breakpoint
ALTER TABLE "campaign_drafts" ADD CONSTRAINT "campaign_drafts_cover_file_id_campaign_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."campaign_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_cover_file_id_campaign_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."campaign_files"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Shared drafts (founder decision, 25 Nov, Q1): anyone who can write campaigns (owner, admin, member) reads, edits and finishes any open draft of their
-- ministry. The creator stays the draft's owner and becomes the campaign's owner. The version check in the service stays the guard against overwriting.
-- A viewer still reads and writes nothing. Only the creator or an owner/admin may discard. Ordinary policies for the runtime role; no SECURITY DEFINER.
DROP POLICY campaign_drafts_read ON public.campaign_drafts;
CREATE POLICY campaign_drafts_read ON public.campaign_drafts FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.workspace_members m
    WHERE m.tenant_id = campaign_drafts.tenant_id AND m.user_id = nullif(current_setting('app.user_id', true), '')
      AND m.role_id IN ('owner', 'admin', 'member')));
DROP POLICY campaign_drafts_edit ON public.campaign_drafts;
-- The new row may stay a draft, be discarded by its creator, or be marked finished only for the campaign that this same draft's Finish created
-- (key wizard-<draft id>), owned by the draft's creator or, when the creator is no longer a member who can write, by the person finishing it.
CREATE POLICY campaign_drafts_edit ON public.campaign_drafts FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND status = 'draft'
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_drafts.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin', 'member')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_drafts.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin', 'member'))
    AND (status = 'draft'
      OR (status = 'discarded' AND created_by = nullif(current_setting('app.user_id', true), ''))
      OR (status = 'finished' AND EXISTS (SELECT 1 FROM public.campaigns c WHERE c.tenant_id = campaign_drafts.tenant_id AND c.id = campaign_drafts.campaign_id
        AND c.owner_user_id IN (campaign_drafts.created_by, nullif(current_setting('app.user_id', true), ''))
        AND c.idempotency_key = 'wizard-' || campaign_drafts.id::text))));
--> statement-breakpoint
-- The creator-only guard becomes a guard on what must never change: a draft keeps its ministry, id, creator and key, and a draft that someone else
-- started can be discarded only by an owner or admin (the discard policy) while the creator discards their own.
DROP TRIGGER campaign_drafts_guard_discard ON public.campaign_drafts;
DROP FUNCTION public.campaign_drafts_guard_discard();
CREATE FUNCTION public.campaign_drafts_guard_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.client_key IS DISTINCT FROM OLD.client_key THEN
    RAISE EXCEPTION 'a draft keeps its ministry, creator and key' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'discarded' AND OLD.status = 'draft' AND OLD.created_by IS DISTINCT FROM actor AND NOT EXISTS (SELECT 1 FROM public.workspace_members m
    WHERE m.tenant_id = OLD.tenant_id AND m.user_id = actor AND m.role_id IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'only the creator, an owner or an admin can discard a draft' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.campaign_drafts_guard_update() FROM PUBLIC;
CREATE TRIGGER campaign_drafts_guard_update BEFORE UPDATE ON public.campaign_drafts FOR EACH ROW EXECUTE FUNCTION public.campaign_drafts_guard_update();
--> statement-breakpoint
-- Assignments follow the draft: anyone who can edit the open draft can place people.
DROP POLICY campaign_draft_assignments_write ON public.campaign_draft_assignments;
DROP POLICY campaign_draft_assignments_delete ON public.campaign_draft_assignments;
CREATE POLICY campaign_draft_assignments_write ON public.campaign_draft_assignments FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.campaign_drafts d
    WHERE d.tenant_id = campaign_draft_assignments.tenant_id AND d.id = campaign_draft_assignments.draft_id AND d.status = 'draft')
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_draft_assignments.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin', 'member')));
CREATE POLICY campaign_draft_assignments_delete ON public.campaign_draft_assignments FOR DELETE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.campaign_drafts d
    WHERE d.tenant_id = campaign_draft_assignments.tenant_id AND d.id = campaign_draft_assignments.draft_id AND d.status = 'draft')
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_draft_assignments.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin', 'member')));
--> statement-breakpoint
-- Finish by someone other than the creator: the campaign is still owned by the draft's creator. This insert is allowed only for the campaign that
-- this draft's Finish makes (key wizard-<draft id>), for an open draft, with the creator as owner while still a member who can write.
CREATE POLICY campaigns_create_wizard ON public.campaigns FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND status = 'draft' AND archived_at IS NULL
    AND idempotency_key LIKE 'wizard-%'
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaigns.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin', 'member'))
    AND EXISTS (SELECT 1 FROM public.workspace_members o WHERE o.tenant_id = campaigns.tenant_id AND o.user_id = campaigns.owner_user_id
      AND o.role_id IN ('owner', 'admin', 'member'))
    AND EXISTS (SELECT 1 FROM public.campaign_drafts d WHERE d.tenant_id = campaigns.tenant_id AND d.id::text = substring(campaigns.idempotency_key from 8)
      AND d.status = 'draft' AND d.created_by = campaigns.owner_user_id));
--> statement-breakpoint
-- Cover image or logo (founder decision, 25 Nov, Q3). FORCE RLS; the runtime role works through ordinary policies. A file belongs to one draft and goes
-- pending -> uploaded -> ready (or quarantined) exactly like an event cover; only a ready, unretired file can be the draft's cover, and the campaign
-- takes the cover of the draft that made it.
ALTER TABLE public.campaign_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_files FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_files FROM PUBLIC, harvest_app;
GRANT SELECT, INSERT ON public.campaign_files TO harvest_app;
GRANT UPDATE (status, retired_at) ON public.campaign_files TO harvest_app;
GRANT UPDATE (cover_file_id) ON public.campaign_drafts TO harvest_app;
--> statement-breakpoint
CREATE POLICY campaign_files_read ON public.campaign_files FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.campaign_drafts d
    WHERE d.tenant_id = campaign_files.tenant_id AND d.id = campaign_files.draft_id));
-- Anyone who can read the campaign (a viewer included) can read the file that is its cover, and no other file.
CREATE POLICY campaign_files_read_cover ON public.campaign_files FOR SELECT TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM public.campaigns c
    WHERE c.tenant_id = campaign_files.tenant_id AND c.cover_file_id = campaign_files.id AND c.archived_at IS NULL));
CREATE POLICY campaign_files_create ON public.campaign_files FOR INSERT TO harvest_app
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND uploader_id = nullif(current_setting('app.user_id', true), '') AND status = 'pending' AND retired_at IS NULL
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_files.tenant_id
      AND m.user_id = uploader_id AND m.role_id IN ('owner', 'admin', 'member'))
    AND EXISTS (SELECT 1 FROM public.campaign_drafts d WHERE d.tenant_id = campaign_files.tenant_id AND d.id = campaign_files.draft_id AND d.status = 'draft'));
-- The uploader moves a file through the scan; any member who can edit the draft retires a file it replaces.
CREATE POLICY campaign_files_scan ON public.campaign_files FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND retired_at IS NULL
    AND uploader_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND uploader_id = nullif(current_setting('app.user_id', true), ''));
CREATE POLICY campaign_files_retire ON public.campaign_files FOR UPDATE TO harvest_app
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND retired_at IS NULL
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = campaign_files.tenant_id
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner', 'admin', 'member')))
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND retired_at IS NOT NULL);
--> statement-breakpoint
-- A file's scan state only moves forward, and only its uploader moves it; a retired file never changes again.
CREATE FUNCTION public.campaign_files_guard_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.retired_at IS NOT NULL THEN RAISE EXCEPTION 'a retired file does not change' USING ERRCODE = '42501'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    OLD.uploader_id IS NOT DISTINCT FROM nullif(current_setting('app.user_id', true), '')
    AND ((OLD.status = 'pending' AND NEW.status IN ('uploaded', 'quarantined')) OR (OLD.status = 'uploaded' AND NEW.status IN ('ready', 'quarantined')))) THEN
    RAISE EXCEPTION 'file state cannot change that way' USING ERRCODE = '23514';
  END IF;
  IF OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'retiring a file does not change its state' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.campaign_files_guard_update() FROM PUBLIC;
CREATE TRIGGER campaign_files_guard_update BEFORE UPDATE ON public.campaign_files FOR EACH ROW EXECUTE FUNCTION public.campaign_files_guard_update();
--> statement-breakpoint
-- The single-column references can SET NULL on delete; these guards hold the full match at the database boundary.
CREATE FUNCTION public.campaign_drafts_guard_cover() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.cover_file_id IS NOT NULL AND NEW.cover_file_id IS DISTINCT FROM OLD.cover_file_id AND NOT EXISTS (SELECT FROM public.campaign_files f
    WHERE f.id = NEW.cover_file_id AND f.tenant_id = NEW.tenant_id AND f.draft_id = NEW.id AND f.status = 'ready' AND f.retired_at IS NULL) THEN
    RAISE EXCEPTION 'cover does not belong to this draft or is unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.campaign_drafts_guard_cover() FROM PUBLIC;
CREATE TRIGGER campaign_drafts_guard_cover BEFORE UPDATE OF cover_file_id ON public.campaign_drafts FOR EACH ROW EXECUTE FUNCTION public.campaign_drafts_guard_cover();
CREATE FUNCTION public.campaigns_guard_cover() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.cover_file_id IS NOT NULL AND NOT EXISTS (SELECT FROM public.campaign_files f
    WHERE f.id = NEW.cover_file_id AND f.tenant_id = NEW.tenant_id AND NEW.idempotency_key = 'wizard-' || f.draft_id::text
      AND f.status = 'ready' AND f.retired_at IS NULL) THEN
    RAISE EXCEPTION 'cover does not belong to the draft that made this campaign' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.campaigns_guard_cover() FROM PUBLIC;
CREATE TRIGGER campaigns_guard_cover BEFORE INSERT ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.campaigns_guard_cover();
