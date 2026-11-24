CREATE TABLE "doc_attachments" (
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"attached_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_attachments_doc_id_file_id_pk" PRIMARY KEY("doc_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "doc_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"quote" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"mentions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_comments_body_len" CHECK (char_length(btrim("doc_comments"."body")) between 1 and 2000),
	CONSTRAINT "doc_comments_quote_len" CHECK ("doc_comments"."quote" is null or char_length("doc_comments"."quote") <= 300),
	CONSTRAINT "doc_comments_status_known" CHECK ("doc_comments"."status" in ('open','resolved'))
);
--> statement-breakpoint
CREATE TABLE "doc_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"page_id" uuid,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_links_kind_known" CHECK ("doc_links"."target_kind" in ('contact','task','doc'))
);
--> statement-breakpoint
CREATE TABLE "doc_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"page_id" uuid,
	"comment_id" uuid,
	"actor_id" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_notifications_kind_known" CHECK ("doc_notifications"."kind" in ('mention','reply','assigned','shared'))
);
--> statement-breakpoint
CREATE TABLE "doc_page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" jsonb NOT NULL,
	"reason" text DEFAULT 'autosave' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_page_versions_content" CHECK (jsonb_typeof("doc_page_versions"."content")='object' and pg_column_size("doc_page_versions"."content")<=524288),
	CONSTRAINT "doc_page_versions_reason" CHECK ("doc_page_versions"."reason" in ('autosave','restore','template','import'))
);
--> statement-breakpoint
CREATE TABLE "doc_shares" (
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_shares_doc_id_user_id_pk" PRIMARY KEY("doc_id","user_id"),
	CONSTRAINT "doc_shares_role_known" CHECK ("doc_shares"."role" in ('view','comment','edit'))
);
--> statement-breakpoint
CREATE TABLE "doc_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"pages" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_templates_name_len" CHECK (char_length(btrim("doc_templates"."name")) between 1 and 80),
	CONSTRAINT "doc_templates_desc_len" CHECK (char_length("doc_templates"."description") <= 200),
	CONSTRAINT "doc_templates_category_known" CHECK ("doc_templates"."category" in ('meetings','worship','events','people','planning','other')),
	CONSTRAINT "doc_templates_pages" CHECK (jsonb_typeof("doc_templates"."pages")='array' and pg_column_size("doc_templates"."pages")<=524288)
);
--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_id_owner_uq" UNIQUE("id","owner_id");--> statement-breakpoint
ALTER TABLE "doc_pages" ADD COLUMN "subtitle" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Rows that exist now take 'ministry' (they were readable by the whole ministry); the default for new docs is set back to 'private' right after. No UPDATE: the table forces row-level security, which hides every row from a restricted owner that has no tenant set.
ALTER TABLE "docs" ADD COLUMN "visibility" text DEFAULT 'ministry' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ALTER COLUMN "visibility" SET DEFAULT 'private';--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "ministry_access" text DEFAULT 'view' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "public_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "public_token_hash" text;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "wiki" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_attachments" ADD CONSTRAINT "doc_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_attachments" ADD CONSTRAINT "doc_attachments_attached_by_users_id_fk" FOREIGN KEY ("attached_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_attachments" ADD CONSTRAINT "doc_attachments_doc_fk" FOREIGN KEY ("tenant_id","doc_id") REFERENCES "public"."docs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_page_fk" FOREIGN KEY ("doc_id","page_id") REFERENCES "public"."doc_pages"("doc_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."doc_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_comments" ADD CONSTRAINT "doc_comments_doc_fk" FOREIGN KEY ("tenant_id","doc_id") REFERENCES "public"."docs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_doc_fk" FOREIGN KEY ("tenant_id","doc_id") REFERENCES "public"."docs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_page_fk" FOREIGN KEY ("doc_id","page_id") REFERENCES "public"."doc_pages"("doc_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_notifications" ADD CONSTRAINT "doc_notifications_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_notifications" ADD CONSTRAINT "doc_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_notifications" ADD CONSTRAINT "doc_notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_notifications" ADD CONSTRAINT "doc_notifications_doc_fk" FOREIGN KEY ("tenant_id","doc_id") REFERENCES "public"."docs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_page_versions" ADD CONSTRAINT "doc_page_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_page_versions" ADD CONSTRAINT "doc_page_versions_page_fk" FOREIGN KEY ("doc_id","page_id") REFERENCES "public"."doc_pages"("doc_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_page_versions" ADD CONSTRAINT "doc_page_versions_doc_fk" FOREIGN KEY ("tenant_id","doc_id") REFERENCES "public"."docs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_shares" ADD CONSTRAINT "doc_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_shares" ADD CONSTRAINT "doc_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_shares" ADD CONSTRAINT "doc_shares_doc_fk" FOREIGN KEY ("tenant_id","doc_id") REFERENCES "public"."docs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_shares" ADD CONSTRAINT "doc_shares_owner_fk" FOREIGN KEY ("doc_id","owner_id") REFERENCES "public"."docs"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_templates" ADD CONSTRAINT "doc_templates_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_templates" ADD CONSTRAINT "doc_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_templates" ADD CONSTRAINT "doc_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_comments_page_idx" ON "doc_comments" USING btree ("doc_id","page_id","created_at");--> statement-breakpoint
CREATE INDEX "doc_links_target_idx" ON "doc_links" USING btree ("tenant_id","target_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_links_uq" ON "doc_links" USING btree ("doc_id",coalesce("page_id", '00000000-0000-0000-0000-000000000000'::uuid),"target_kind","target_id");--> statement-breakpoint
CREATE INDEX "doc_notifications_user_idx" ON "doc_notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "doc_page_versions_page_idx" ON "doc_page_versions" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "doc_templates_tenant_idx" ON "doc_templates" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "docs_public_token_uq" ON "docs" USING btree ("public_token_hash") WHERE "docs"."public_token_hash" is not null;--> statement-breakpoint
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_subtitle_len" CHECK (char_length("doc_pages"."subtitle") <= 200);--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_visibility_known" CHECK ("docs"."visibility" in ('private','ministry') and "docs"."ministry_access" in ('view','comment','edit'));--> statement-breakpoint
-- Docs slice 2: per-doc privacy replaces the slice 1 ministry-wide read. Docs that existed before keep their old reach (see the visibility column above).

CREATE FUNCTION public.docs_rank(p_role text, p_owner boolean, p_visibility text, p_ministry text, p_share text) RETURNS int
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE
    WHEN p_role IS NULL OR p_role NOT IN ('owner','admin','member','viewer') THEN 0
    WHEN p_role IN ('owner','admin') THEN 4
    WHEN p_owner AND p_role<>'viewer' THEN 4
    ELSE LEAST(CASE WHEN p_role='viewer' THEN 2 ELSE 3 END, GREATEST(
      CASE p_share WHEN 'edit' THEN 3 WHEN 'comment' THEN 2 WHEN 'view' THEN 1 ELSE 0 END,
      CASE WHEN p_visibility='ministry' THEN CASE p_ministry WHEN 'edit' THEN 3 WHEN 'comment' THEN 2 WHEN 'view' THEN 1 ELSE 0 END ELSE 0 END))
  END
$$
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.docs_rank(text,boolean,text,text,text) FROM PUBLIC
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.docs_rank(text,boolean,text,text,text) TO harvest_app
--> statement-breakpoint

ALTER TABLE public.doc_shares ENABLE ROW LEVEL SECURITY
--> statement-breakpoint

ALTER TABLE public.doc_shares FORCE ROW LEVEL SECURITY
--> statement-breakpoint

REVOKE ALL ON public.doc_shares FROM PUBLIC,harvest_app
--> statement-breakpoint

ALTER TABLE public.doc_comments ENABLE ROW LEVEL SECURITY
--> statement-breakpoint

ALTER TABLE public.doc_comments FORCE ROW LEVEL SECURITY
--> statement-breakpoint

REVOKE ALL ON public.doc_comments FROM PUBLIC,harvest_app
--> statement-breakpoint

ALTER TABLE public.doc_links ENABLE ROW LEVEL SECURITY
--> statement-breakpoint

ALTER TABLE public.doc_links FORCE ROW LEVEL SECURITY
--> statement-breakpoint

REVOKE ALL ON public.doc_links FROM PUBLIC,harvest_app
--> statement-breakpoint

ALTER TABLE public.doc_templates ENABLE ROW LEVEL SECURITY
--> statement-breakpoint

ALTER TABLE public.doc_templates FORCE ROW LEVEL SECURITY
--> statement-breakpoint

REVOKE ALL ON public.doc_templates FROM PUBLIC,harvest_app
--> statement-breakpoint

ALTER TABLE public.doc_page_versions ENABLE ROW LEVEL SECURITY
--> statement-breakpoint

ALTER TABLE public.doc_page_versions FORCE ROW LEVEL SECURITY
--> statement-breakpoint

REVOKE ALL ON public.doc_page_versions FROM PUBLIC,harvest_app
--> statement-breakpoint

ALTER TABLE public.doc_attachments ENABLE ROW LEVEL SECURITY
--> statement-breakpoint

ALTER TABLE public.doc_attachments FORCE ROW LEVEL SECURITY
--> statement-breakpoint

REVOKE ALL ON public.doc_attachments FROM PUBLIC,harvest_app
--> statement-breakpoint

ALTER TABLE public.doc_notifications ENABLE ROW LEVEL SECURITY
--> statement-breakpoint

ALTER TABLE public.doc_notifications FORCE ROW LEVEL SECURITY
--> statement-breakpoint

REVOKE ALL ON public.doc_notifications FROM PUBLIC,harvest_app
--> statement-breakpoint

DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker') THEN
  REVOKE ALL ON public.doc_shares,public.doc_comments,public.doc_links,public.doc_templates,public.doc_page_versions,public.doc_attachments,public.doc_notifications FROM harvest_worker; END IF; END $$
--> statement-breakpoint

DROP POLICY docs_read ON public.docs
--> statement-breakpoint

DROP POLICY docs_insert ON public.docs
--> statement-breakpoint

DROP POLICY docs_change ON public.docs
--> statement-breakpoint

DROP POLICY docs_read ON public.doc_pages
--> statement-breakpoint

DROP POLICY docs_insert ON public.doc_pages
--> statement-breakpoint

DROP POLICY docs_change ON public.doc_pages
--> statement-breakpoint

DROP POLICY docs_remove ON public.doc_pages
--> statement-breakpoint

CREATE POLICY docs_read ON public.docs FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=docs.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      AND public.docs_rank(m.role_id,docs.owner_id=m.user_id,docs.visibility,docs.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=docs.id AND s.user_id=m.user_id))>=1))
--> statement-breakpoint

CREATE POLICY docs_insert ON public.docs FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND owner_id=nullif(current_setting('app.user_id',true),'') AND EXISTS(
  SELECT FROM public.workspace_members m WHERE m.tenant_id=docs.tenant_id AND m.user_id=owner_id AND public.docs_role_can(m.role_id,'write')))
--> statement-breakpoint

CREATE POLICY docs_change ON public.docs FOR UPDATE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=docs.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      AND public.docs_rank(m.role_id,docs.owner_id=m.user_id,docs.visibility,docs.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=docs.id AND s.user_id=m.user_id))>=3)) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=docs.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      AND public.docs_rank(m.role_id,docs.owner_id=m.user_id,docs.visibility,docs.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=docs.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

CREATE POLICY docs_read ON public.doc_pages FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=1))
--> statement-breakpoint

CREATE POLICY docs_insert ON public.doc_pages FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by=nullif(current_setting('app.user_id',true),'') AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

CREATE POLICY docs_change ON public.doc_pages FOR UPDATE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3)) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

CREATE POLICY docs_remove ON public.doc_pages FOR DELETE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

-- Who shares a private doc is private too: a row is readable by the person it names, by the doc's owner and by owners and admins. (The rank checks in the doc policies only read the caller's own share row.)
CREATE POLICY docs_share_read ON public.doc_shares FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_shares.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (m.role_id IN ('owner','admin') OR m.user_id=doc_shares.owner_id OR m.user_id=doc_shares.user_id)))
--> statement-breakpoint




CREATE POLICY docs_share_insert ON public.doc_shares FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_shares.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (m.role_id IN ('owner','admin') OR (m.user_id=doc_shares.owner_id AND m.role_id<>'viewer'))))
--> statement-breakpoint
CREATE POLICY docs_share_update ON public.doc_shares FOR UPDATE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_shares.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (m.role_id IN ('owner','admin') OR (m.user_id=doc_shares.owner_id AND m.role_id<>'viewer')))) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_shares.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (m.role_id IN ('owner','admin') OR (m.user_id=doc_shares.owner_id AND m.role_id<>'viewer'))))
--> statement-breakpoint
CREATE POLICY docs_share_delete ON public.doc_shares FOR DELETE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND (EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_shares.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (m.role_id IN ('owner','admin') OR (m.user_id=doc_shares.owner_id AND m.role_id<>'viewer'))) OR user_id=nullif(current_setting('app.user_id',true),'')))
--> statement-breakpoint
CREATE POLICY docs_comment_read ON public.doc_comments FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_comments.tenant_id AND d.id=doc_comments.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=1))
--> statement-breakpoint

CREATE POLICY docs_comment_insert ON public.doc_comments FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND author_id=nullif(current_setting('app.user_id',true),'') AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_comments.tenant_id AND d.id=doc_comments.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=2))
--> statement-breakpoint

CREATE POLICY docs_comment_update ON public.doc_comments FOR UPDATE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_comments.tenant_id AND d.id=doc_comments.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=2)) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_comments.tenant_id AND d.id=doc_comments.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=2))
--> statement-breakpoint

CREATE POLICY docs_comment_delete ON public.doc_comments FOR DELETE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_comments.tenant_id AND d.id=doc_comments.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=2) AND (author_id=nullif(current_setting('app.user_id',true),'') OR EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_comments.tenant_id AND d.id=doc_comments.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=4)))
--> statement-breakpoint

CREATE POLICY docs_doc_links_read ON public.doc_links FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_links.tenant_id AND d.id=doc_links.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=1))
--> statement-breakpoint

CREATE POLICY docs_doc_links_insert ON public.doc_links FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_links.tenant_id AND d.id=doc_links.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

CREATE POLICY docs_doc_links_delete ON public.doc_links FOR DELETE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_links.tenant_id AND d.id=doc_links.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

CREATE POLICY docs_doc_attachments_read ON public.doc_attachments FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_attachments.tenant_id AND d.id=doc_attachments.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=1))
--> statement-breakpoint

CREATE POLICY docs_doc_attachments_insert ON public.doc_attachments FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_attachments.tenant_id AND d.id=doc_attachments.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

CREATE POLICY docs_doc_attachments_delete ON public.doc_attachments FOR DELETE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_attachments.tenant_id AND d.id=doc_attachments.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

CREATE POLICY docs_versions_read ON public.doc_page_versions FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_page_versions.tenant_id AND d.id=doc_page_versions.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

CREATE POLICY docs_versions_insert ON public.doc_page_versions FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by=nullif(current_setting('app.user_id',true),'') AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_page_versions.tenant_id AND d.id=doc_page_versions.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

CREATE POLICY docs_versions_delete ON public.doc_page_versions FOR DELETE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      WHERE d.tenant_id=doc_page_versions.tenant_id AND d.id=doc_page_versions.doc_id
      AND public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3))
--> statement-breakpoint

CREATE POLICY docs_template_read ON public.doc_templates FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_templates.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')))
--> statement-breakpoint

CREATE POLICY docs_template_insert ON public.doc_templates FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by=nullif(current_setting('app.user_id',true),'') AND EXISTS(
  SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_templates.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND public.docs_role_can(m.role_id,'write')))
--> statement-breakpoint

CREATE POLICY docs_template_update ON public.doc_templates FOR UPDATE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_templates.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
  AND (public.docs_role_can(m.role_id,'manage') OR (public.docs_role_can(m.role_id,'write') AND doc_templates.created_by=m.user_id)))) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_templates.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
  AND (public.docs_role_can(m.role_id,'manage') OR (public.docs_role_can(m.role_id,'write') AND doc_templates.created_by=m.user_id))))
--> statement-breakpoint

CREATE POLICY docs_template_delete ON public.doc_templates FOR DELETE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_templates.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
  AND (public.docs_role_can(m.role_id,'manage') OR (public.docs_role_can(m.role_id,'write') AND doc_templates.created_by=m.user_id))))
--> statement-breakpoint

CREATE POLICY docs_notification_read ON public.doc_notifications FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),''))
--> statement-breakpoint

CREATE POLICY docs_notification_insert ON public.doc_notifications FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND actor_id=nullif(current_setting('app.user_id',true),'') AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_notifications.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),''))
  AND EXISTS(SELECT FROM public.workspace_members r WHERE r.tenant_id=doc_notifications.tenant_id AND r.user_id=doc_notifications.user_id)
  AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m2 ON m2.tenant_id=d.tenant_id AND m2.user_id=nullif(current_setting('app.user_id',true),'') WHERE d.tenant_id=doc_notifications.tenant_id AND d.id=doc_notifications.doc_id AND public.docs_rank(m2.role_id,d.owner_id=m2.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m2.user_id))>=1))
--> statement-breakpoint

CREATE POLICY docs_notification_update ON public.doc_notifications FOR UPDATE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),''))
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE (role), DELETE ON public.doc_shares TO harvest_app
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON public.doc_comments, public.doc_links, public.doc_page_versions, public.doc_attachments TO harvest_app
--> statement-breakpoint

GRANT UPDATE (body, status, assignee_id, resolved_by, resolved_at, mentions, updated_at) ON public.doc_comments TO harvest_app
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON public.doc_templates TO harvest_app
--> statement-breakpoint

GRANT UPDATE (name, category, description, pages, version, updated_by, updated_at) ON public.doc_templates TO harvest_app
--> statement-breakpoint

GRANT SELECT, INSERT ON public.doc_notifications TO harvest_app
--> statement-breakpoint

GRANT UPDATE (read_at) ON public.doc_notifications TO harvest_app
--> statement-breakpoint

GRANT UPDATE (visibility, ministry_access, public_enabled, public_token_hash, wiki) ON public.docs TO harvest_app
--> statement-breakpoint
GRANT UPDATE (subtitle) ON public.doc_pages TO harvest_app
--> statement-breakpoint

CREATE FUNCTION public.docs_sharing_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF (NEW.visibility,NEW.ministry_access,NEW.public_enabled,NEW.public_token_hash) IS DISTINCT FROM (OLD.visibility,OLD.ministry_access,OLD.public_enabled,OLD.public_token_hash) THEN
    IF NOT EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=OLD.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
      AND (m.role_id IN ('owner','admin') OR (OLD.owner_id=m.user_id AND m.role_id<>'viewer'))) THEN RAISE EXCEPTION 'only the owner of a doc changes who can reach it' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.docs_sharing_guard() FROM PUBLIC
--> statement-breakpoint

CREATE TRIGGER docs_sharing_guard BEFORE UPDATE ON public.docs FOR EACH ROW EXECUTE FUNCTION public.docs_sharing_guard()
--> statement-breakpoint

CREATE FUNCTION public.doc_comments_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body AND OLD.author_id IS DISTINCT FROM nullif(current_setting('app.user_id',true),'') THEN RAISE EXCEPTION 'only the author edits a comment' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.doc_comments_guard() FROM PUBLIC
--> statement-breakpoint

CREATE TRIGGER doc_comments_guard BEFORE UPDATE ON public.doc_comments FOR EACH ROW EXECUTE FUNCTION public.doc_comments_guard()

--> statement-breakpoint
-- Deliberately tenant-less: a session-less reader has no tenant. Safe because the stored hash is unique (partial unique index) and the token is 32 random bytes, so a guess has negligible chance; the app gate keeps the whole path off in production.
-- The optional public link (hard-off in code unless the non-production gate allows it): a session-less read of the one doc whose stored token hash the server presents.
CREATE POLICY docs_public_read ON public.docs FOR SELECT TO harvest_app
  USING (public_enabled AND public_token_hash IS NOT NULL AND public_token_hash=nullif(current_setting('app.docs_public_hash',true),''))
--> statement-breakpoint
CREATE POLICY docs_public_read ON public.doc_pages FOR SELECT TO harvest_app
  USING (EXISTS (SELECT FROM public.docs d WHERE d.id=doc_pages.doc_id AND d.public_enabled AND d.public_token_hash IS NOT NULL AND d.public_token_hash=nullif(current_setting('app.docs_public_hash',true),'')))
--> statement-breakpoint
-- A contact link follows the person: erasing a contact removes the links to it (they hold no foreign key), and a merge moves them to the kept contact.
-- Same pattern as contact_form_sources (0082): a SECURITY DEFINER hook, with a policy for the function owner scoped to the current tenant and to contact links only.
CREATE POLICY docs_contact_links_definer ON public.doc_links TO PUBLIC
  USING (current_user <> 'harvest_app' AND target_kind = 'contact' AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_user <> 'harvest_app' AND target_kind = 'contact' AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
--> statement-breakpoint
CREATE FUNCTION public.docs_links_before_erase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior text := current_setting('app.tenant_id', true);
BEGIN
  -- The erase may run in another tenant's session (a merge, a maintenance job): scope the cleanup to this contact's tenant, then restore the setting.
  PERFORM set_config('app.tenant_id', OLD.tenant_id::text, true);
  DELETE FROM public.doc_links WHERE tenant_id = OLD.tenant_id AND target_kind = 'contact' AND target_id = OLD.id;
  IF EXISTS (SELECT 1 FROM public.doc_links WHERE tenant_id = OLD.tenant_id AND target_kind = 'contact' AND target_id = OLD.id) THEN
    RAISE EXCEPTION 'doc links to an erased contact survived' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.tenant_id', coalesce(prior, ''), true);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.docs_links_before_erase() FROM PUBLIC, harvest_app;
--> statement-breakpoint
CREATE TRIGGER docs_links_before_erase BEFORE UPDATE ON public.contacts
  FOR EACH ROW WHEN (OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL)
  EXECUTE FUNCTION public.docs_links_before_erase();
--> statement-breakpoint
-- NOTE: this patches the text of merge_contacts_scoped (it adds a step before the crm_form_responses repoint line, as 0082 does). If that function is ever redefined, port this step with it.
DO $$
DECLARE def text; patched text;
BEGIN
  def := pg_get_functiondef('public.merge_contacts_scoped(uuid, uuid, uuid)'::regprocedure);
  patched := replace(def, '  UPDATE public.crm_form_responses SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;',
    '  DELETE FROM public.doc_links s WHERE s.tenant_id = p_tenant AND s.target_kind = ''contact'' AND s.target_id = p_source
    AND EXISTS (SELECT 1 FROM public.doc_links t WHERE t.tenant_id = p_tenant AND t.target_kind = ''contact'' AND t.target_id = p_target AND t.doc_id = s.doc_id
      AND coalesce(t.page_id, ''00000000-0000-0000-0000-000000000000''::uuid) = coalesce(s.page_id, ''00000000-0000-0000-0000-000000000000''::uuid));
  UPDATE public.doc_links SET target_id = p_target WHERE tenant_id = p_tenant AND target_kind = ''contact'' AND target_id = p_source;
  UPDATE public.crm_form_responses SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;');
  IF patched = def THEN RAISE EXCEPTION 'merge hook not found'; END IF;
  EXECUTE patched;
END $$;
