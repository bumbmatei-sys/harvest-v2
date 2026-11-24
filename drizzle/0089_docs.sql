CREATE TABLE "doc_favorites" (
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_favorites_doc_id_user_id_pk" PRIMARY KEY("doc_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "doc_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"owner_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_folders_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "doc_folders_name_len" CHECK (char_length(btrim("doc_folders"."name")) between 1 and 80 and "doc_folders"."name"=btrim("doc_folders"."name")),
	CONSTRAINT "doc_folders_not_own_parent" CHECK ("doc_folders"."parent_id" is distinct from "doc_folders"."id")
);
--> statement-breakpoint
CREATE TABLE "doc_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"icon" text,
	"engine" text DEFAULT 'tiptap' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"protected" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_pages_doc_id_uq" UNIQUE("doc_id","id"),
	CONSTRAINT "doc_pages_title_len" CHECK (char_length("doc_pages"."title") <= 200),
	CONSTRAINT "doc_pages_engine_known" CHECK ("doc_pages"."engine" in ('tiptap')),
	CONSTRAINT "doc_pages_content_object" CHECK (jsonb_typeof("doc_pages"."content")='object' AND pg_column_size("doc_pages"."content")<=524288),
	CONSTRAINT "doc_pages_style_object" CHECK (jsonb_typeof("doc_pages"."style")='object' AND pg_column_size("doc_pages"."style")<=2048),
	CONSTRAINT "doc_pages_not_own_parent" CHECK ("doc_pages"."parent_id" is distinct from "doc_pages"."id")
);
--> statement-breakpoint
CREATE TABLE "docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"folder_id" uuid,
	"kind" text DEFAULT 'document' NOT NULL,
	"title" text NOT NULL,
	"owner_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docs_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "docs_title_len" CHECK (char_length("docs"."title") <= 200),
	CONSTRAINT "docs_kind_known" CHECK ("docs"."kind" in ('document','spreadsheet'))
);
--> statement-breakpoint
ALTER TABLE "doc_favorites" ADD CONSTRAINT "doc_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_favorites" ADD CONSTRAINT "doc_favorites_doc_fk" FOREIGN KEY ("tenant_id","doc_id") REFERENCES "public"."docs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."doc_folders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_doc_fk" FOREIGN KEY ("tenant_id","doc_id") REFERENCES "public"."docs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_parent_fk" FOREIGN KEY ("doc_id","parent_id") REFERENCES "public"."doc_pages"("doc_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_folder_fk" FOREIGN KEY ("tenant_id","folder_id") REFERENCES "public"."doc_folders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_folders_parent_idx" ON "doc_folders" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_folders_name_uq" ON "doc_folders" USING btree ("tenant_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "doc_folders"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "doc_pages_tree_idx" ON "doc_pages" USING btree ("doc_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "docs_folder_idx" ON "docs" USING btree ("tenant_id","folder_id","updated_at");
--> statement-breakpoint
-- Docs (slice 1): every ministry role reads; owners and admins manage all; members create and edit what they own; viewers never write. Policies key on the session's tenant and user.
CREATE FUNCTION public.docs_role_can(p_role text, p_action text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE p_action WHEN 'read' THEN p_role IN ('owner','admin','member','viewer')
    WHEN 'write' THEN p_role IN ('owner','admin','member') WHEN 'manage' THEN p_role IN ('owner','admin') ELSE false END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.docs_role_can(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.docs_role_can(text,text) TO harvest_app;
--> statement-breakpoint
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['doc_folders','docs','doc_pages','doc_favorites'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,harvest_app',rel);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker') THEN EXECUTE format('REVOKE ALL ON public.%I FROM harvest_worker',rel); END IF;
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['doc_folders','docs','doc_pages'] LOOP
    EXECUTE format($p$CREATE POLICY docs_read ON public.%I FOR SELECT TO harvest_app
      USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
        SELECT FROM public.workspace_members m WHERE m.tenant_id=%I.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND public.docs_role_can(m.role_id,'read')))$p$,rel,rel);
  END LOOP;
END $$;
--> statement-breakpoint
-- Folders and docs: insert as the owner; change when owner/admin, or a member who owns the row.
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['doc_folders','docs'] LOOP
    EXECUTE format($p$CREATE POLICY docs_insert ON public.%I FOR INSERT TO harvest_app
      WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND owner_id=nullif(current_setting('app.user_id',true),'') AND EXISTS(
        SELECT FROM public.workspace_members m WHERE m.tenant_id=%I.tenant_id AND m.user_id=owner_id AND public.docs_role_can(m.role_id,'write')))$p$,rel,rel);
    EXECUTE format($p$CREATE POLICY docs_change ON public.%I FOR UPDATE TO harvest_app
      USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
        SELECT FROM public.workspace_members m WHERE m.tenant_id=%I.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
          AND (public.docs_role_can(m.role_id,'manage') OR (public.docs_role_can(m.role_id,'write') AND %I.owner_id=m.user_id))))
      WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
        SELECT FROM public.workspace_members m WHERE m.tenant_id=%I.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
          AND (public.docs_role_can(m.role_id,'manage') OR (public.docs_role_can(m.role_id,'write') AND %I.owner_id=m.user_id))))$p$,rel,rel,rel,rel,rel);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE POLICY docs_remove ON public.doc_folders FOR DELETE TO harvest_app
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
    SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_folders.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      AND (public.docs_role_can(m.role_id,'manage') OR (public.docs_role_can(m.role_id,'write') AND doc_folders.owner_id=m.user_id))));
--> statement-breakpoint
-- Pages follow the doc: owner/admin, or the member who owns the doc.
CREATE POLICY docs_insert ON public.doc_pages FOR INSERT TO harvest_app
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by=nullif(current_setting('app.user_id',true),'') AND EXISTS(
    SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (public.docs_role_can(m.role_id,'manage') OR (public.docs_role_can(m.role_id,'write') AND d.owner_id=m.user_id))));
--> statement-breakpoint
CREATE POLICY docs_change ON public.doc_pages FOR UPDATE TO harvest_app
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
    SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (public.docs_role_can(m.role_id,'manage') OR (public.docs_role_can(m.role_id,'write') AND d.owner_id=m.user_id))))
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
    SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (public.docs_role_can(m.role_id,'manage') OR (public.docs_role_can(m.role_id,'write') AND d.owner_id=m.user_id))));
--> statement-breakpoint
CREATE POLICY docs_remove ON public.doc_pages FOR DELETE TO harvest_app
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
    SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id
      AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (public.docs_role_can(m.role_id,'manage') OR (public.docs_role_can(m.role_id,'write') AND d.owner_id=m.user_id))));
--> statement-breakpoint
-- Favourites are private to the person who starred (any role, including viewers).
CREATE POLICY docs_favorite_read ON public.doc_favorites FOR SELECT TO harvest_app
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),''));
--> statement-breakpoint
CREATE POLICY docs_favorite_write ON public.doc_favorites FOR INSERT TO harvest_app
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),''));
--> statement-breakpoint
CREATE POLICY docs_favorite_remove ON public.doc_favorites FOR DELETE TO harvest_app
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),''));
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.doc_folders, public.doc_pages TO harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.docs TO harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.doc_favorites TO harvest_app;
--> statement-breakpoint
GRANT UPDATE (parent_id, name, position, archived_at, updated_at) ON public.doc_folders TO harvest_app;
--> statement-breakpoint
GRANT UPDATE (folder_id, title, version, archived_at, deleted_at, updated_at) ON public.docs TO harvest_app;
--> statement-breakpoint
GRANT UPDATE (parent_id, position, title, icon, content, style, protected, version, updated_by, archived_at, updated_at) ON public.doc_pages TO harvest_app;
--> statement-breakpoint
-- Cycle-proof trees: a folder cannot sit inside its own subtree and a page cannot sit under its own descendant. A transaction-scoped lock per ministry (folders) or doc (pages)
-- serialises two concurrent moves so neither can create the cycle the other forbids.
CREATE FUNCTION public.doc_folders_no_cycle() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE cur uuid; steps int:=0;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('doc_folders:'||NEW.tenant_id::text,0));
  cur:=NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    IF cur=NEW.id THEN RAISE EXCEPTION 'doc folder cycle' USING ERRCODE='23514'; END IF;
    steps:=steps+1; IF steps>64 THEN RAISE EXCEPTION 'doc folder too deep' USING ERRCODE='23514'; END IF;
    SELECT f.parent_id INTO cur FROM public.doc_folders f WHERE f.tenant_id=NEW.tenant_id AND f.id=cur;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.doc_folders_no_cycle() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER doc_folders_no_cycle BEFORE INSERT OR UPDATE OF parent_id ON public.doc_folders FOR EACH ROW EXECUTE FUNCTION public.doc_folders_no_cycle();
--> statement-breakpoint
CREATE FUNCTION public.doc_pages_no_cycle() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE cur uuid; steps int:=0;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('doc_pages:'||NEW.doc_id::text,0));
  cur:=NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    IF cur=NEW.id THEN RAISE EXCEPTION 'doc page cycle' USING ERRCODE='23514'; END IF;
    steps:=steps+1; IF steps>64 THEN RAISE EXCEPTION 'doc page too deep' USING ERRCODE='23514'; END IF;
    SELECT p.parent_id INTO cur FROM public.doc_pages p WHERE p.doc_id=NEW.doc_id AND p.id=cur;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.doc_pages_no_cycle() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER doc_pages_no_cycle BEFORE INSERT OR UPDATE OF parent_id ON public.doc_pages FOR EACH ROW EXECUTE FUNCTION public.doc_pages_no_cycle();
