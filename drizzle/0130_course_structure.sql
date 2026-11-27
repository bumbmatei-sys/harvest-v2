-- Courses follow-up, slice 1 (founder decision 25 Nov): course structure Level -> Section -> Lesson, the course's own labels for them, and a lesson
-- video stored as an allow-listed provider plus its video id (the URL is parsed and normalised by the server; no URL or HTML is stored).
-- Levels are optional. Every lesson sits in a section; existing lessons move into one untitled default section per course, in their order.
-- Lesson, section and level positions run across the whole course, so the lesson order stays the single lesson position it always was.
CREATE TABLE "catalog_levels" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'course' NOT NULL,
	"position" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	CONSTRAINT "catalog_levels_tenant_id_item_id_id_pk" PRIMARY KEY("tenant_id","item_id","id"),
	CONSTRAINT "catalog_levels_tenant_id_item_id_position_unique" UNIQUE("tenant_id","item_id","position"),
	CONSTRAINT "catalog_level_kind" CHECK ("catalog_levels"."kind" = 'course'),
	CONSTRAINT "catalog_level_position" CHECK ("catalog_levels"."position" between 0 and 9),
	CONSTRAINT "catalog_level_title" CHECK (length("catalog_levels"."title") <= 120 and "catalog_levels"."title" = trim("catalog_levels"."title"))
);
--> statement-breakpoint
CREATE TABLE "catalog_sections" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'course' NOT NULL,
	"level_id" uuid,
	"position" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	CONSTRAINT "catalog_sections_tenant_id_item_id_id_pk" PRIMARY KEY("tenant_id","item_id","id"),
	CONSTRAINT "catalog_sections_tenant_id_item_id_position_unique" UNIQUE("tenant_id","item_id","position"),
	CONSTRAINT "catalog_section_kind" CHECK ("catalog_sections"."kind" = 'course'),
	CONSTRAINT "catalog_section_position" CHECK ("catalog_sections"."position" between 0 and 49),
	CONSTRAINT "catalog_section_title" CHECK (length("catalog_sections"."title") <= 120 and "catalog_sections"."title" = trim("catalog_sections"."title"))
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "level_label" text;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "section_label" text;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "lesson_label" text;--> statement-breakpoint
ALTER TABLE "catalog_lessons" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_lessons" ADD COLUMN "video_provider" text;--> statement-breakpoint
ALTER TABLE "catalog_lessons" ADD COLUMN "video_id" text;--> statement-breakpoint
-- New tables: forced row security and the grants and policies of catalog_lessons (0061): owners and admins with catalogue rights author them
-- (catalog_staff, which asks public.access_role since 0113), and the catalogue definer reads them in the one ministry it resolved.
DO $$ DECLARE rel text; BEGIN
  FOREACH rel IN ARRAY ARRAY['catalog_levels','catalog_sections'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', rel);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO harvest_app', rel);
    EXECUTE format('CREATE POLICY catalog_staff_write ON public.%I TO harvest_app USING (public.catalog_staff(tenant_id)) WITH CHECK (public.catalog_staff(tenant_id))', rel);
    EXECUTE format($p$CREATE POLICY catalog_resolver_scope ON public.%I FOR SELECT TO %I
      USING (tenant_id=nullif(current_setting('app.catalog_tenant', true), '')::uuid)$p$, rel, current_user);
  END LOOP;
END $$;--> statement-breakpoint
-- Backfill. The owner runs under FORCE row security, which hides every lesson and section, so the tables are relaxed for this block only and
-- put back exactly as found (the 0091 pattern). One untitled section per course that has lessons; each lesson keeps its position.
DO $$
DECLARE r regclass; forced regclass[];
BEGIN
  SELECT coalesce(array_agg(c.oid::regclass), '{}') INTO forced FROM pg_class c
    WHERE c.relforcerowsecurity AND c.oid IN ('public.catalog_lessons'::regclass, 'public.catalog_sections'::regclass, 'public.catalog_items'::regclass);
  FOREACH r IN ARRAY forced LOOP EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', r); END LOOP;
  INSERT INTO public.catalog_sections (tenant_id, item_id, position, title)
    SELECT DISTINCT l.tenant_id, l.item_id, 0, '' FROM public.catalog_lessons l;
  UPDATE public.catalog_lessons l SET section_id = s.id FROM public.catalog_sections s
    WHERE s.tenant_id = l.tenant_id AND s.item_id = l.item_id AND l.section_id IS NULL;
  FOREACH r IN ARRAY forced LOOP EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', r); END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "catalog_lessons" ALTER COLUMN "section_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_levels" ADD CONSTRAINT "catalog_levels_tenant_id_item_id_kind_catalog_items_tenant_id_id_kind_fk" FOREIGN KEY ("tenant_id","item_id","kind") REFERENCES "public"."catalog_items"("tenant_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_sections" ADD CONSTRAINT "catalog_sections_tenant_id_item_id_kind_catalog_items_tenant_id_id_kind_fk" FOREIGN KEY ("tenant_id","item_id","kind") REFERENCES "public"."catalog_items"("tenant_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_sections" ADD CONSTRAINT "catalog_sections_tenant_id_item_id_level_id_catalog_levels_tenant_id_item_id_id_fk" FOREIGN KEY ("tenant_id","item_id","level_id") REFERENCES "public"."catalog_levels"("tenant_id","item_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_lessons" ADD CONSTRAINT "catalog_lessons_tenant_id_item_id_section_id_catalog_sections_tenant_id_item_id_id_fk" FOREIGN KEY ("tenant_id","item_id","section_id") REFERENCES "public"."catalog_sections"("tenant_id","item_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_item_labels" CHECK (("catalog_items"."kind" = 'course' or ("catalog_items"."level_label" is null and "catalog_items"."section_label" is null and "catalog_items"."lesson_label" is null))
    and ("catalog_items"."level_label" is null or length(trim("catalog_items"."level_label")) between 1 and 24)
    and ("catalog_items"."section_label" is null or length(trim("catalog_items"."section_label")) between 1 and 24)
    and ("catalog_items"."lesson_label" is null or length(trim("catalog_items"."lesson_label")) between 1 and 24));--> statement-breakpoint
ALTER TABLE "catalog_lessons" ADD CONSTRAINT "catalog_lesson_video" CHECK (("catalog_lessons"."video_provider" is null and "catalog_lessons"."video_id" is null)
    or ("catalog_lessons"."video_provider" = 'youtube' and "catalog_lessons"."video_id" is not null and "catalog_lessons"."video_id" ~ '^[A-Za-z0-9_-]{11}$')
    or ("catalog_lessons"."video_provider" = 'vk' and "catalog_lessons"."video_id" is not null and "catalog_lessons"."video_id" ~ '^-?[0-9]{1,19}_[0-9]{1,19}(_[A-Za-z0-9]{1,32})?$'));
--> statement-breakpoint
-- catalog_access as replaced by 0123 (hidden items through community shelves, community settings cleared on entry and exit), unchanged except
-- that course content now also returns the structure, labels and lesson videos. It still reads only the ministry it resolved (app.catalog_tenant).
CREATE OR REPLACE FUNCTION public.catalog_access(p_slug text, p_action text, p_file uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE item public.catalog_items%ROWTYPE;
  actor text := nullif(current_setting('app.user_id',true),'');
  resource_type text;
  metadata jsonb;
  result jsonb;
  shelved boolean;
BEGIN
  PERFORM set_config('app.catalog_tenant','',true);
  PERFORM public.community_definer_reset();
  <<resolve>>
  BEGIN
    IF p_action IS NULL OR p_action NOT IN ('metadata','enrol','content','file') OR
       (p_action <> 'metadata' AND actor IS NULL) THEN EXIT resolve; END IF;

    PERFORM set_config('app.catalog_slug',coalesce(p_slug,''),true);
    SELECT * INTO item FROM public.catalog_items i
      WHERE i.slug=p_slug AND i.state='published' AND i.visibility IN ('listed','unlisted','hidden') FOR SHARE;
    IF NOT FOUND THEN EXIT resolve; END IF;
    IF item.visibility='hidden' THEN
      IF actor IS NULL THEN EXIT resolve; END IF;
      PERFORM set_config('app.catalog_tenant',item.tenant_id::text,true);
      PERFORM set_config('app.community_definer_tenant',item.tenant_id::text,true);
      shelved := EXISTS (SELECT FROM public.community_product_links l
        JOIN public.communities c ON c.tenant_id=l.tenant_id AND c.id=l.community_id AND c.status='published'
        WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND public.community_can_read(l.tenant_id,l.community_id));
      PERFORM public.community_definer_reset();
      PERFORM set_config('app.catalog_tenant','',true);
      IF NOT shelved THEN EXIT resolve; END IF;
    END IF;
    metadata := jsonb_build_object('slug',item.slug,'title',item.title,'summary',item.summary,'kind',item.kind);
    IF p_action='metadata' THEN result := metadata; EXIT resolve; END IF;

    PERFORM set_config('app.catalog_tenant',item.tenant_id::text,true);
    resource_type := CASE WHEN item.kind='course' THEN 'course' ELSE 'product' END;
    IF p_action='enrol' THEN
      INSERT INTO public.catalog_enrolments(tenant_id,item_id,user_id) VALUES(item.tenant_id,item.id,actor)
        ON CONFLICT DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.entitlements(tenant_id,user_id,resource_type,resource_id,catalog_item_id,source)
          VALUES(item.tenant_id,actor,resource_type,item.id,item.id,'free_enrolment');
        INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id)
          VALUES(item.tenant_id,actor,'catalog.enrol',item.id::text);
      END IF;
    END IF;

    IF NOT EXISTS (SELECT FROM public.entitlements e WHERE e.tenant_id=item.tenant_id
      AND e.catalog_item_id=item.id AND e.user_id=actor AND e.revoked_at IS NULL AND e.valid_from<=now()
      AND (e.valid_until IS NULL OR e.valid_until>now())) THEN EXIT resolve; END IF;
    IF p_action='enrol' THEN result := jsonb_build_object('enrolled',true); EXIT resolve; END IF;
    IF p_action='file' THEN
      result := (SELECT jsonb_build_object('key',f.key,'name',f.name)
        FROM public.catalog_files l JOIN public.files f ON f.tenant_id=l.tenant_id AND f.id=l.file_id
        WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND l.file_id=p_file
          AND f.visibility='private' AND f.status='ready');
      EXIT resolve;
    END IF;
    -- 0130: each published lesson names its section and carries its video (provider and id only); the sections and levels that hold a
    -- published lesson come in course order, with the course's own labels. A section or level with no published lesson is not sent.
    result := metadata || jsonb_build_object(
      'labels', jsonb_build_object('level',item.level_label,'section',item.section_label,'lesson',item.lesson_label),
      'levels', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'title',v.title) ORDER BY v.position),'[]'::jsonb)
        FROM public.catalog_levels v WHERE v.tenant_id=item.tenant_id AND v.item_id=item.id AND EXISTS (
          SELECT FROM public.catalog_sections s JOIN public.catalog_lessons l ON l.tenant_id=s.tenant_id AND l.item_id=s.item_id AND l.section_id=s.id
          WHERE s.tenant_id=v.tenant_id AND s.item_id=v.item_id AND s.level_id=v.id AND l.published)),
      'sections', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'levelId',s.level_id,'title',s.title) ORDER BY s.position),'[]'::jsonb)
        FROM public.catalog_sections s WHERE s.tenant_id=item.tenant_id AND s.item_id=item.id AND EXISTS (
          SELECT FROM public.catalog_lessons l WHERE l.tenant_id=s.tenant_id AND l.item_id=s.item_id AND l.section_id=s.id AND l.published)),
      'lessons', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'body',l.body,'sectionId',l.section_id,
          'video',CASE WHEN l.video_provider IS NULL THEN NULL ELSE jsonb_build_object('provider',l.video_provider,'id',l.video_id) END) ORDER BY l.position),'[]'::jsonb)
        FROM public.catalog_lessons l WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND l.published),
      'files', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) ORDER BY l.position),'[]'::jsonb)
        FROM public.catalog_files l JOIN public.files f ON f.tenant_id=l.tenant_id AND f.id=l.file_id
        WHERE l.tenant_id=item.tenant_id AND l.item_id=item.id AND f.visibility='private' AND f.status='ready'));
  END resolve;
  PERFORM public.community_definer_reset();
  PERFORM set_config('app.catalog_slug','',true);
  PERFORM set_config('app.catalog_tenant','',true);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.catalog_access(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_access(text,text,uuid) TO harvest_app;
