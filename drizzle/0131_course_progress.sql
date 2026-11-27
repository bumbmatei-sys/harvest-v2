-- Courses follow-up, slice 2: stable lesson saves (positions checked at commit, so the editor can upsert lessons, sections and levels by id), learner
-- progress per (learner, lesson), and private learner notes per lesson. Learners write only their own rows, through public.catalog_learner, which
-- first passes public.catalog_access (published, hidden-shelf rule, active grant). Owners and admins read aggregate counts only, with small groups
-- hidden; nobody but the learner reads a note: there is no staff policy on catalog_notes.
CREATE TABLE "catalog_notes" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_notes_tenant_id_item_id_lesson_id_user_id_pk" PRIMARY KEY("tenant_id","item_id","lesson_id","user_id"),
	CONSTRAINT "catalog_note_body" CHECK (length(btrim("catalog_notes"."body")) between 1 and 4000 and translate("catalog_notes"."body", E'\n\r\t', '') !~ '[[:cntrl:]]')
);
--> statement-breakpoint
CREATE TABLE "catalog_progress" (
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_progress_tenant_id_item_id_lesson_id_user_id_pk" PRIMARY KEY("tenant_id","item_id","lesson_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_notes" ADD CONSTRAINT "catalog_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_notes" ADD CONSTRAINT "catalog_notes_tenant_id_item_id_lesson_id_catalog_lessons_tenant_id_item_id_id_fk" FOREIGN KEY ("tenant_id","item_id","lesson_id") REFERENCES "public"."catalog_lessons"("tenant_id","item_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_progress" ADD CONSTRAINT "catalog_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_progress" ADD CONSTRAINT "catalog_progress_tenant_id_item_id_lesson_id_catalog_lessons_tenant_id_item_id_id_fk" FOREIGN KEY ("tenant_id","item_id","lesson_id") REFERENCES "public"."catalog_lessons"("tenant_id","item_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_notes_user_idx" ON "catalog_notes" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "catalog_progress_user_idx" ON "catalog_progress" USING btree ("user_id","tenant_id","item_id");
--> statement-breakpoint
-- Saves update rows in place now, so a reorder swaps positions inside one statement sequence: the position uniques are checked at commit.
ALTER TABLE public.catalog_lessons DROP CONSTRAINT "catalog_lessons_tenant_id_item_id_position_unique",
  ADD CONSTRAINT "catalog_lessons_tenant_id_item_id_position_unique" UNIQUE (tenant_id, item_id, position) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE public.catalog_sections DROP CONSTRAINT "catalog_sections_tenant_id_item_id_position_unique",
  ADD CONSTRAINT "catalog_sections_tenant_id_item_id_position_unique" UNIQUE (tenant_id, item_id, position) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE public.catalog_levels DROP CONSTRAINT "catalog_levels_tenant_id_item_id_position_unique",
  ADD CONSTRAINT "catalog_levels_tenant_id_item_id_position_unique" UNIQUE (tenant_id, item_id, position) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
-- Row security. The app reads only the caller's own rows and writes none directly. The definers below run as this migration's owner and reach rows
-- only through flags they set and clear themselves; each owner policy also pins the row to the caller (app.user_id), except the staff count, which
-- needs every learner's row of one ministry and returns counts only.
DO $$ DECLARE rel text; BEGIN
  FOREACH rel IN ARRAY ARRAY['catalog_progress','catalog_notes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', rel);
    EXECUTE format('GRANT SELECT ON public.%I TO harvest_app', rel);
    EXECUTE format($p$CREATE POLICY catalog_learner_own ON public.%I FOR SELECT TO harvest_app
      USING (user_id = nullif(current_setting('app.user_id', true), ''))$p$, rel);
    EXECUTE format($p$CREATE POLICY catalog_learner_scope ON public.%I TO %I
      USING (user_id = nullif(current_setting('app.user_id', true), '') AND tenant_id = nullif(current_setting('app.catalog_learner_tenant', true), '')::uuid)
      WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '') AND tenant_id = nullif(current_setting('app.catalog_learner_tenant', true), '')::uuid)$p$, rel, current_user);
  END LOOP;
  EXECUTE format($p$CREATE POLICY catalog_notes_mine ON public.catalog_notes FOR SELECT TO %I
    USING (user_id = nullif(current_setting('app.user_id', true), '') AND current_setting('app.catalog_my_notes', true) = 'on')$p$, current_user);
  EXECUTE format($p$CREATE POLICY catalog_progress_staff_count ON public.catalog_progress FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.catalog_progress_tenant', true), '')::uuid)$p$, current_user);
  -- The summary definer checks the caller's own membership, under its flag: only the caller's row, only that ministry.
  EXECUTE format($p$CREATE POLICY catalog_progress_member ON public.workspace_members FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.catalog_progress_tenant', true), '')::uuid AND user_id = nullif(current_setting('app.user_id', true), ''))$p$, current_user);
END $$;--> statement-breakpoint
-- The learner's own writes: complete, incomplete, or a note (an empty note deletes it). It runs catalog_access(slug, 'content') first, so every rule
-- that decides what the learner may open (published, the hidden-shelf rule, an active grant, a published lesson) decides what they may mark.
CREATE FUNCTION public.catalog_learner(p_slug text, p_lesson uuid, p_action text, p_body text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); content jsonb; v_tenant uuid; v_item uuid; note text; result jsonb;
BEGIN
  PERFORM set_config('app.catalog_learner_tenant', '', true);
  PERFORM set_config('app.catalog_my_notes', '', true);
  PERFORM set_config('app.catalog_progress_tenant', '', true);
  IF actor IS NULL OR p_lesson IS NULL OR p_action IS NULL OR p_action NOT IN ('complete', 'incomplete', 'note') THEN RETURN NULL; END IF;
  content := public.catalog_access(p_slug, 'content', NULL);
  IF content IS NULL OR content ->> 'kind' IS DISTINCT FROM 'course'
     OR NOT ((content -> 'lessons') @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', p_lesson))) THEN RETURN NULL; END IF;
  PERFORM set_config('app.catalog_slug', coalesce(p_slug, ''), true);
  SELECT i.tenant_id, i.id INTO v_tenant, v_item FROM public.catalog_items i WHERE i.slug = p_slug;
  PERFORM set_config('app.catalog_slug', '', true);
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.catalog_learner_tenant', v_tenant::text, true);
  IF p_action = 'complete' THEN
    INSERT INTO public.catalog_progress (tenant_id, item_id, lesson_id, user_id) VALUES (v_tenant, v_item, p_lesson, actor) ON CONFLICT DO NOTHING;
    result := pg_catalog.jsonb_build_object('completed', true);
  ELSIF p_action = 'incomplete' THEN
    DELETE FROM public.catalog_progress p WHERE p.tenant_id = v_tenant AND p.item_id = v_item AND p.lesson_id = p_lesson AND p.user_id = actor;
    result := pg_catalog.jsonb_build_object('completed', false);
  ELSE
    note := pg_catalog.btrim(coalesce(p_body, ''));
    IF note = '' THEN
      DELETE FROM public.catalog_notes n WHERE n.tenant_id = v_tenant AND n.item_id = v_item AND n.lesson_id = p_lesson AND n.user_id = actor;
    ELSE
      INSERT INTO public.catalog_notes (tenant_id, item_id, lesson_id, user_id, body) VALUES (v_tenant, v_item, p_lesson, actor, note)
        ON CONFLICT (tenant_id, item_id, lesson_id, user_id) DO UPDATE SET body = excluded.body, updated_at = now();
    END IF;
    result := pg_catalog.jsonb_build_object('saved', true);
  END IF;
  PERFORM set_config('app.catalog_learner_tenant', '', true);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_learner(text, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_learner(text, uuid, text, text) TO harvest_app;--> statement-breakpoint
-- "My notes": the caller's notes across courses, newest first. A course title and address appear only while the course is published; a lesson title
-- only while that lesson is published. Each ministry's catalogue is read under its own flag, set and cleared per note.
CREATE FUNCTION public.catalog_my_notes() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); r record; course record; lesson_title text; result jsonb := '[]'::jsonb;
BEGIN
  PERFORM set_config('app.catalog_learner_tenant', '', true);
  PERFORM set_config('app.catalog_progress_tenant', '', true);
  PERFORM set_config('app.catalog_tenant', '', true);
  PERFORM set_config('app.catalog_slug', '', true);
  IF actor IS NULL THEN RETURN result; END IF;
  PERFORM set_config('app.catalog_my_notes', 'on', true);
  FOR r IN SELECT n.tenant_id, n.item_id, n.lesson_id, n.body, n.updated_at FROM public.catalog_notes n
    WHERE n.user_id = actor ORDER BY n.updated_at DESC, n.lesson_id LIMIT 500 LOOP
    PERFORM set_config('app.catalog_tenant', r.tenant_id::text, true);
    SELECT i.slug, i.title INTO course FROM public.catalog_items i WHERE i.tenant_id = r.tenant_id AND i.id = r.item_id AND i.state = 'published';
    lesson_title := NULL;
    IF course.slug IS NOT NULL THEN
      SELECT l.title INTO lesson_title FROM public.catalog_lessons l WHERE l.tenant_id = r.tenant_id AND l.item_id = r.item_id AND l.id = r.lesson_id AND l.published;
    END IF;
    result := result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('lessonId', r.lesson_id, 'body', r.body, 'updatedAt', r.updated_at,
      'course', CASE WHEN course.slug IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('slug', course.slug, 'title', course.title) END,
      'lesson', lesson_title));
    PERFORM set_config('app.catalog_tenant', '', true);
  END LOOP;
  PERFORM set_config('app.catalog_my_notes', '', true);
  PERFORM set_config('app.catalog_tenant', '', true);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_my_notes() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_my_notes() TO harvest_app;--> statement-breakpoint
-- Internal (not granted): one course's enrolment count and per-lesson completion counts for an owner or admin with catalogue rights in the caller's own
-- ministry. Every count of 1 to 4 is withheld (public.connect_suppress_small, the shared small-group rule). No learner, row or note is returned.
CREATE FUNCTION public.catalog_progress_summary_scoped(p_tenant uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); stored_role text; enrolled integer; result jsonb;
BEGIN
  IF actor IS NULL OR p_tenant IS NULL OR p_item IS NULL OR p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid THEN RETURN NULL; END IF;
  SELECT w.role_id INTO stored_role FROM public.workspace_members w WHERE w.tenant_id = p_tenant AND w.user_id = actor;
  IF stored_role IS NULL OR coalesce(public.access_role(p_tenant, actor, 'catalog', stored_role), '') NOT IN ('owner', 'admin') THEN RETURN NULL; END IF;
  PERFORM pg_catalog.set_config('app.catalog_tenant', p_tenant::text, true);
  PERFORM 1 FROM public.catalog_items i WHERE i.tenant_id = p_tenant AND i.id = p_item AND i.kind = 'course';
  IF NOT FOUND THEN PERFORM pg_catalog.set_config('app.catalog_tenant', '', true); RETURN NULL; END IF;
  SELECT count(*)::int INTO enrolled FROM public.catalog_enrolments e WHERE e.tenant_id = p_tenant AND e.item_id = p_item;
  SELECT pg_catalog.jsonb_build_object('enrolled', public.connect_suppress_small(enrolled), 'minimumGroup', (SELECT small_group_min FROM public.connect_retention_policy()),
    'lessons', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', q.id, 'title', q.title, 'published', q.published,
      'completed', public.connect_suppress_small(q.n)) ORDER BY q.position), '[]'::jsonb))
  INTO result FROM (
    SELECT l.id, l.title, l.published, l.position, (SELECT count(*)::int FROM public.catalog_progress p
      WHERE p.tenant_id = l.tenant_id AND p.item_id = l.item_id AND p.lesson_id = l.id) AS n
    FROM public.catalog_lessons l WHERE l.tenant_id = p_tenant AND l.item_id = p_item) q;
  PERFORM pg_catalog.set_config('app.catalog_tenant', '', true);
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_progress_summary_scoped(uuid, uuid) FROM PUBLIC, harvest_app;--> statement-breakpoint
-- The entry point (the 0120 pattern): every other app.* flag except the caller's ministry and user is cleared for the call, so nothing the app set
-- beforehand can widen what the owner-role policies let it read; it sets its own flag and puts every setting back afterwards.
CREATE FUNCTION public.catalog_progress_summary(p_tenant uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prior jsonb; entry record; result jsonb;
BEGIN
  SELECT coalesce(pg_catalog.jsonb_object_agg(s.name, s.setting), '{}'::jsonb) INTO prior FROM pg_catalog.pg_settings s
    WHERE s.name LIKE 'app.%' AND s.name NOT IN ('app.tenant_id', 'app.user_id');
  FOR entry IN SELECT key FROM pg_catalog.jsonb_each_text(prior) LOOP PERFORM pg_catalog.set_config(entry.key, '', true); END LOOP;
  PERFORM pg_catalog.set_config('app.catalog_progress_tenant', coalesce(p_tenant::text, ''), true);
  result := public.catalog_progress_summary_scoped(p_tenant, p_item);
  PERFORM pg_catalog.set_config('app.catalog_progress_tenant', '', true);
  PERFORM pg_catalog.set_config('app.catalog_tenant', '', true);
  FOR entry IN SELECT key, value FROM pg_catalog.jsonb_each_text(prior) LOOP PERFORM pg_catalog.set_config(entry.key, entry.value, true); END LOOP;
  RETURN result;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.catalog_progress_summary(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.catalog_progress_summary(uuid, uuid) TO harvest_app;--> statement-breakpoint
-- catalog_access as replaced by 0130, unchanged except that course content also returns the caller's own completed lessons and notes (published
-- lessons only), read under app.catalog_learner_tenant, which it clears on entry and on exit like its other settings.
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
  PERFORM set_config('app.catalog_learner_tenant','',true);
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
    -- 0131: the caller's own progress and notes, on published lessons only.
    IF item.kind='course' THEN
      PERFORM set_config('app.catalog_learner_tenant',item.tenant_id::text,true);
      result := result || jsonb_build_object(
        'completed', (SELECT coalesce(jsonb_agg(p.lesson_id ORDER BY l.position),'[]'::jsonb) FROM public.catalog_progress p
          JOIN public.catalog_lessons l ON l.tenant_id=p.tenant_id AND l.item_id=p.item_id AND l.id=p.lesson_id
          WHERE p.tenant_id=item.tenant_id AND p.item_id=item.id AND p.user_id=actor AND l.published),
        'notes', (SELECT coalesce(jsonb_agg(jsonb_build_object('lessonId',n.lesson_id,'body',n.body) ORDER BY l.position),'[]'::jsonb) FROM public.catalog_notes n
          JOIN public.catalog_lessons l ON l.tenant_id=n.tenant_id AND l.item_id=n.item_id AND l.id=n.lesson_id
          WHERE n.tenant_id=item.tenant_id AND n.item_id=item.id AND n.user_id=actor AND l.published));
      PERFORM set_config('app.catalog_learner_tenant','',true);
    END IF;
  END resolve;
  PERFORM set_config('app.catalog_learner_tenant','',true);
  PERFORM public.community_definer_reset();
  PERFORM set_config('app.catalog_slug','',true);
  PERFORM set_config('app.catalog_tenant','',true);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.catalog_access(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_access(text,text,uuid) TO harvest_app;
