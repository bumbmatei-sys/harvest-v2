CREATE TABLE "doc_page_shares" (
	"tenant_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_page_shares_page_id_user_id_pk" PRIMARY KEY("page_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "doc_favorites" ADD COLUMN "placement" text DEFAULT 'top' NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_page_shares" ADD CONSTRAINT "doc_page_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_page_shares" ADD CONSTRAINT "doc_page_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_page_shares" ADD CONSTRAINT "doc_page_shares_page_fk" FOREIGN KEY ("doc_id","page_id") REFERENCES "public"."doc_pages"("doc_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_page_shares" ADD CONSTRAINT "doc_page_shares_doc_fk" FOREIGN KEY ("tenant_id","doc_id") REFERENCES "public"."docs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_page_shares" ADD CONSTRAINT "doc_page_shares_owner_fk" FOREIGN KEY ("doc_id","owner_id") REFERENCES "public"."docs"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_page_shares_user_idx" ON "doc_page_shares" USING btree ("user_id","doc_id");
--> statement-breakpoint
ALTER TABLE public.doc_page_shares ENABLE ROW LEVEL SECURITY
--> statement-breakpoint
ALTER TABLE public.doc_page_shares FORCE ROW LEVEL SECURITY
--> statement-breakpoint
REVOKE ALL ON public.doc_page_shares FROM PUBLIC,harvest_app
--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname='harvest_worker') THEN REVOKE ALL ON public.doc_page_shares FROM harvest_worker; END IF; END $$
--> statement-breakpoint
ALTER TABLE public.doc_page_shares ADD CONSTRAINT doc_page_shares_role_known CHECK (role in ('view','comment','edit'))
--> statement-breakpoint
ALTER TABLE public.doc_favorites ADD CONSTRAINT doc_favorites_placement_known CHECK (placement in ('top','sidebar'))
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (role), DELETE ON public.doc_page_shares TO harvest_app
--> statement-breakpoint
GRANT UPDATE (placement) ON public.doc_favorites TO harvest_app
--> statement-breakpoint
CREATE POLICY docs_favorite_update ON public.doc_favorites FOR UPDATE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.user_id',true),''))
--> statement-breakpoint
-- A page share reads only its own table (never `docs`), so the policies of `docs` and `doc_pages` can consult it without recursion.
CREATE FUNCTION public.docs_page_rank(p_doc uuid, p_page uuid) RETURNS int LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT coalesce((SELECT CASE s.role WHEN 'edit' THEN 3 WHEN 'comment' THEN 2 WHEN 'view' THEN 1 ELSE 0 END FROM public.doc_page_shares s WHERE s.doc_id=p_doc AND s.page_id=p_page AND s.user_id=nullif(current_setting('app.user_id',true),'')),0)
$$
--> statement-breakpoint
CREATE FUNCTION public.docs_has_page_share(p_doc uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT EXISTS (SELECT FROM public.doc_page_shares s WHERE s.doc_id=p_doc AND s.user_id=nullif(current_setting('app.user_id',true),'')) $$
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.docs_page_rank(uuid,uuid), public.docs_has_page_share(uuid) FROM PUBLIC
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.docs_page_rank(uuid,uuid), public.docs_has_page_share(uuid) TO harvest_app
--> statement-breakpoint
DROP POLICY docs_read ON public.docs
--> statement-breakpoint
DROP POLICY docs_read ON public.doc_pages
--> statement-breakpoint
DROP POLICY docs_change ON public.doc_pages
--> statement-breakpoint
DROP POLICY docs_comment_read ON public.doc_comments
--> statement-breakpoint
DROP POLICY docs_comment_insert ON public.doc_comments
--> statement-breakpoint
DROP POLICY docs_comment_update ON public.doc_comments
--> statement-breakpoint
CREATE POLICY docs_read ON public.docs FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=docs.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'')
  AND (public.docs_rank(m.role_id,docs.owner_id=m.user_id,docs.visibility,docs.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=docs.id AND s.user_id=m.user_id))>=1 OR public.docs_has_page_share(docs.id))))
--> statement-breakpoint
CREATE POLICY docs_read ON public.doc_pages FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id AND (public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=1 OR public.docs_page_rank(d.id,doc_pages.id)>=1)))
--> statement-breakpoint
CREATE POLICY docs_change ON public.doc_pages FOR UPDATE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id AND (public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3 OR public.docs_page_rank(d.id,doc_pages.id)>=3))) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') WHERE d.tenant_id=doc_pages.tenant_id AND d.id=doc_pages.doc_id AND (public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=3 OR public.docs_page_rank(d.id,doc_pages.id)>=3)))
--> statement-breakpoint
CREATE POLICY docs_comment_read ON public.doc_comments FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') WHERE d.tenant_id=doc_comments.tenant_id AND d.id=doc_comments.doc_id AND (public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=1 OR public.docs_page_rank(d.id,doc_comments.page_id)>=1)))
--> statement-breakpoint
CREATE POLICY docs_comment_insert ON public.doc_comments FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND author_id=nullif(current_setting('app.user_id',true),'') AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') WHERE d.tenant_id=doc_comments.tenant_id AND d.id=doc_comments.doc_id AND (public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=2 OR public.docs_page_rank(d.id,doc_comments.page_id)>=2)))
--> statement-breakpoint
CREATE POLICY docs_comment_update ON public.doc_comments FOR UPDATE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') WHERE d.tenant_id=doc_comments.tenant_id AND d.id=doc_comments.doc_id AND (public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=2 OR public.docs_page_rank(d.id,doc_comments.page_id)>=2))) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.docs d JOIN public.workspace_members m ON m.tenant_id=d.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') WHERE d.tenant_id=doc_comments.tenant_id AND d.id=doc_comments.doc_id AND (public.docs_rank(m.role_id,d.owner_id=m.user_id,d.visibility,d.ministry_access,(SELECT s.role FROM public.doc_shares s WHERE s.doc_id=d.id AND s.user_id=m.user_id))>=2 OR public.docs_page_rank(d.id,doc_comments.page_id)>=2)))
--> statement-breakpoint
CREATE POLICY docs_page_share_read ON public.doc_page_shares FOR SELECT TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_page_shares.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (m.role_id IN ('owner','admin') OR m.user_id=doc_page_shares.owner_id OR doc_page_shares.user_id=m.user_id)))
--> statement-breakpoint
CREATE POLICY docs_page_share_insert ON public.doc_page_shares FOR INSERT TO harvest_app WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_page_shares.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (m.role_id IN ('owner','admin') OR (m.user_id=doc_page_shares.owner_id AND m.role_id<>'viewer'))))
--> statement-breakpoint
CREATE POLICY docs_page_share_update ON public.doc_page_shares FOR UPDATE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_page_shares.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (m.role_id IN ('owner','admin') OR (m.user_id=doc_page_shares.owner_id AND m.role_id<>'viewer')))) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_page_shares.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (m.role_id IN ('owner','admin') OR (m.user_id=doc_page_shares.owner_id AND m.role_id<>'viewer'))))
--> statement-breakpoint
CREATE POLICY docs_page_share_delete ON public.doc_page_shares FOR DELETE TO harvest_app USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND (EXISTS (SELECT FROM public.workspace_members m WHERE m.tenant_id=doc_page_shares.tenant_id AND m.user_id=nullif(current_setting('app.user_id',true),'') AND (m.role_id IN ('owner','admin') OR (m.user_id=doc_page_shares.owner_id AND m.role_id<>'viewer'))) OR user_id=nullif(current_setting('app.user_id',true),'')))
--> statement-breakpoint
