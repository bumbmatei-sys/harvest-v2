CREATE TABLE "contact_source_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"import_id" uuid,
	"row_number" integer,
	"reverted_at" timestamp with time zone,
	CONSTRAINT "contact_sources_contract" CHECK (("contact_source_events"."kind" = 'manual' and "contact_source_events"."outcome" = 'created' and "contact_source_events"."import_id" is null and "contact_source_events"."row_number" is null and "contact_source_events"."reverted_at" is null) or ("contact_source_events"."kind" = 'csv_import' and "contact_source_events"."outcome" in ('created','updated') and "contact_source_events"."import_id" is not null and "contact_source_events"."row_number" is not null and "row_number" > 0))
);
--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD CONSTRAINT "contact_source_events_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_source_events" ADD CONSTRAINT "contact_source_events_tenant_id_import_id_crm_imports_tenant_id_id_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."crm_imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_sources_import_unique" ON "contact_source_events" USING btree ("tenant_id","import_id","row_number") WHERE "contact_source_events"."kind" = 'csv_import';--> statement-breakpoint
CREATE INDEX "contact_sources_history" ON "contact_source_events" USING btree ("tenant_id","contact_id","occurred_at","id");
--> statement-breakpoint
ALTER TABLE public.contact_source_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_source_events FORCE ROW LEVEL SECURITY;
CREATE POLICY sources_read ON public.contact_source_events FOR SELECT TO harvest_app USING (
 tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
 SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = contact_source_events.tenant_id
 AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner','admin')));
GRANT SELECT ON public.contact_source_events TO harvest_app;
DO $$ BEGIN
 EXECUTE format($policy$CREATE POLICY sources_writer ON public.contact_source_events TO %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$policy$, current_user);
END $$;
--> statement-breakpoint
-- A row is manual unless a successful import row in the same transaction identifies
-- the creation. No historical rows are backfilled, nor can callers write the ledger.
CREATE FUNCTION public.contact_source_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NEW.erased_at IS NULL AND NEW.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
 AND EXISTS (SELECT 1 FROM public.workspace_members WHERE tenant_id = NEW.tenant_id
 AND user_id = nullif(current_setting('app.user_id', true), '') AND role_id IN ('owner','admin','member')) THEN
 INSERT INTO public.contact_source_events(tenant_id,contact_id,kind,outcome) VALUES(NEW.tenant_id,NEW.id,'manual','created');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contact_source_created() FROM PUBLIC;
CREATE TRIGGER contact_source_created AFTER INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contact_source_created();
--> statement-breakpoint
CREATE FUNCTION public.contact_source_imported() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' AND NEW.contact_id IS NOT NULL THEN
 -- Serialize with merge/erase and reject a stale parent after any lock wait.
 PERFORM 1 FROM public.contacts WHERE tenant_id=NEW.tenant_id AND id=NEW.contact_id AND erased_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'source contact unavailable' USING ERRCODE='23503'; END IF;
 IF NEW.created THEN
 DELETE FROM public.contact_source_events WHERE tenant_id=NEW.tenant_id AND contact_id=NEW.contact_id AND kind='manual';
 END IF;
 INSERT INTO public.contact_source_events(tenant_id,contact_id,kind,outcome,import_id,row_number)
 VALUES(NEW.tenant_id,NEW.contact_id,'csv_import',CASE WHEN NEW.created THEN 'created' ELSE 'updated' END,NEW.import_id,NEW.row_number)
 ON CONFLICT DO NOTHING;
 ELSIF NEW.status = 'rolled_back' AND OLD.status = 'done' THEN
 UPDATE public.contact_source_events SET reverted_at=now()
 WHERE tenant_id=NEW.tenant_id AND import_id=NEW.import_id AND row_number=NEW.row_number;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contact_source_imported() FROM PUBLIC;
CREATE TRIGGER contact_source_imported AFTER UPDATE OF status ON public.crm_import_rows FOR EACH ROW EXECUTE FUNCTION public.contact_source_imported();
--> statement-breakpoint
CREATE FUNCTION public.contact_source_erased() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NEW.erased_at IS NOT NULL THEN DELETE FROM public.contact_source_events WHERE tenant_id=OLD.tenant_id AND contact_id=OLD.id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contact_source_erased() FROM PUBLIC;
CREATE TRIGGER contact_source_erased BEFORE UPDATE OF erased_at ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contact_source_erased();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.merge_contacts(p_tenant uuid, p_target uuid, p_source uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); n_live integer;
  moved_identifiers integer; dropped_identifiers integer; moved_links integer; moved_consents integer;
  moved_tasks integer; moved_notes integer; moved_activities integer; moved_deals integer; moved_values integer; repointed_values integer; notes_taken boolean := false;
BEGIN
  IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid OR actor IS NULL THEN
    RAISE EXCEPTION 'merge access denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspace_members WHERE tenant_id = p_tenant AND user_id = actor AND role_id IN ('owner', 'admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge access denied' USING ERRCODE = '42501'; END IF;
  IF p_target = p_source THEN RAISE EXCEPTION 'a person cannot be merged into themselves' USING ERRCODE = '22023'; END IF;
  -- Lock both people in id order so concurrent merges cannot deadlock.
  PERFORM 1 FROM public.contacts WHERE tenant_id = p_tenant AND id IN (p_target, p_source) AND erased_at IS NULL ORDER BY id FOR UPDATE;
  SELECT count(*) INTO n_live FROM public.contacts WHERE tenant_id = p_tenant AND id IN (p_target, p_source) AND erased_at IS NULL;
  IF n_live <> 2 THEN RETURN NULL; END IF;
  UPDATE public.contact_source_events SET contact_id=p_target WHERE tenant_id=p_tenant AND contact_id=p_source;
  PERFORM set_config('app.merge_source', p_source::text, true);
  UPDATE public.crm_import_rows r SET raw = '[]'::jsonb,
    match_keys = CASE WHEN r.contact_id = p_source THEN '{}'::text[] ELSE ARRAY(
      SELECT key FROM unnest(r.match_keys) AS key WHERE NOT EXISTS (
        SELECT 1 FROM public.contact_identifiers i WHERE i.tenant_id = p_tenant AND i.contact_id = p_source
          AND i.kind || ':' || i.normalized_value = key)) END,
    contact_id = CASE WHEN r.contact_id = p_source THEN NULL ELSE r.contact_id END
    WHERE r.tenant_id = p_tenant AND (r.contact_id = p_source OR EXISTS (
      SELECT 1 FROM public.contact_identifiers i
      WHERE i.tenant_id = p_tenant AND i.contact_id = p_source AND (
        i.kind || ':' || i.normalized_value = ANY(r.match_keys) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(r.raw) AS cell(value)
          WHERE CASE WHEN i.kind = 'phone' THEN
            length(regexp_replace(i.normalized_value, '[^0-9]', '', 'g')) > 0 AND
            regexp_replace(i.normalized_value, '[^0-9]', '', 'g') = regexp_replace(cell.value, '[^0-9]', '', 'g')
          ELSE length(i.normalized_value) > 0 AND EXISTS (
            SELECT 1 FROM generate_series(1, length(cell.value) - length(i.normalized_value) + 1) AS pos(n)
            WHERE lower(substring(cell.value FROM pos.n FOR length(i.normalized_value))) = lower(i.normalized_value)
              -- A bare one-character handle in prose is indistinguishable from a word.
              AND (i.kind <> 'social' OR length(i.normalized_value) > 1
                OR lower(btrim(cell.value)) = lower(i.normalized_value)
                OR (pos.n > 1 AND substring(cell.value FROM pos.n - 1 FOR 1) = '@'))
              AND (pos.n = 1 OR substring(cell.value FROM pos.n - 1 FOR 1) !~ '[[:alnum:]_@.+:-]'
                OR (i.kind = 'social' AND substring(cell.value FROM pos.n - 1 FOR 1) = '@'
                  AND (pos.n = 2 OR substring(cell.value FROM pos.n - 2 FOR 1) !~ '[[:alnum:]_@.+:-]')))
              AND (pos.n + length(i.normalized_value) > length(cell.value)
                OR substring(cell.value FROM pos.n + length(i.normalized_value) FOR 1) !~ '[[:alnum:]_@.+:-]'
                OR (substring(cell.value FROM pos.n + length(i.normalized_value) FOR 1) = '.'
                  AND (pos.n + length(i.normalized_value) = length(cell.value)
                    OR substring(cell.value FROM pos.n + length(i.normalized_value) + 1 FOR 1) !~ '[[:alnum:]_]')))) END))));
  WITH moved AS (
    UPDATE public.contact_identifiers s SET contact_id = p_target
    WHERE s.tenant_id = p_tenant AND s.contact_id = p_source
      AND NOT EXISTS (SELECT 1 FROM public.contact_identifiers t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.kind = s.kind)
    RETURNING 1) SELECT count(*) INTO moved_identifiers FROM moved;
  DELETE FROM public.contact_identifiers WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS dropped_identifiers = ROW_COUNT;
  INSERT INTO public.contact_company_links (tenant_id, contact_id, company_id, title, is_primary, created_by, created_at)
    SELECT p_tenant, p_target, l.company_id, l.title,
      l.is_primary AND NOT EXISTS (SELECT 1 FROM public.contact_company_links t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.is_primary),
      actor, l.created_at
    FROM public.contact_company_links l
    WHERE l.tenant_id = p_tenant AND l.contact_id = p_source
      AND NOT EXISTS (SELECT 1 FROM public.contact_company_links t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.company_id = l.company_id);
  GET DIAGNOSTICS moved_links = ROW_COUNT;
  DELETE FROM public.contact_company_links WHERE tenant_id = p_tenant AND contact_id = p_source;
  UPDATE public.contact_consents SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_consents = ROW_COUNT;
  UPDATE public.crm_tasks SET contact_id = p_target, version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_tasks = ROW_COUNT;
  UPDATE public.crm_notes SET contact_id = p_target, version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_notes = ROW_COUNT;
  UPDATE public.opportunities SET contact_id = p_target, version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_deals = ROW_COUNT;
  -- CRM-07: association events keep their consent row, which moved above with the same id.
  UPDATE public.crm_associations SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  GET DIAGNOSTICS moved_activities = ROW_COUNT;
  INSERT INTO public.crm_field_values (tenant_id, field_id, object_type, contact_id, value_text, value_number, value_date, value_boolean, value_options, relation_contact_id, relation_company_id, updated_by, updated_at)
    SELECT p_tenant, v.field_id, v.object_type, p_target, v.value_text, v.value_number, v.value_date, v.value_boolean, v.value_options,
      CASE WHEN v.relation_contact_id = p_source THEN p_target ELSE v.relation_contact_id END, v.relation_company_id, actor, now()
    FROM public.crm_field_values v JOIN public.crm_field_definitions d ON d.tenant_id = v.tenant_id AND d.id = v.field_id AND d.archived_at IS NULL
    WHERE v.tenant_id = p_tenant AND v.contact_id = p_source
      AND NOT EXISTS (SELECT 1 FROM public.crm_field_values t WHERE t.tenant_id = p_tenant AND t.contact_id = p_target AND t.field_id = v.field_id);
  GET DIAGNOSTICS moved_values = ROW_COUNT;
  UPDATE public.crm_field_values v SET relation_contact_id = p_target, updated_by = actor, updated_at = now()
    FROM public.crm_field_definitions d
    WHERE v.tenant_id = p_tenant AND v.relation_contact_id = p_source AND v.contact_id IS DISTINCT FROM p_source
      AND d.tenant_id = v.tenant_id AND d.id = v.field_id AND d.archived_at IS NULL;
  GET DIAGNOSTICS repointed_values = ROW_COUNT;
  UPDATE public.contacts t SET notes = s.notes FROM public.contacts s
    WHERE t.tenant_id = p_tenant AND t.id = p_target AND s.tenant_id = p_tenant AND s.id = p_source AND t.notes = '' AND s.notes <> '';
  notes_taken := FOUND;
  UPDATE public.contacts SET version = version + 1, updated_at = now() WHERE tenant_id = p_tenant AND id = p_target;
  UPDATE public.crm_import_rows SET contact_id = p_target WHERE tenant_id = p_tenant AND contact_id = p_source;
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id, metadata)
    VALUES (p_tenant, actor, 'contact.merge', p_target::text, jsonb_build_object(
      'identifiers', moved_identifiers::text, 'links', moved_links::text, 'consents', moved_consents::text,
      'tasks', moved_tasks::text, 'notes', moved_notes::text, 'deals', moved_deals::text, 'values', (moved_values + repointed_values)::text, 'activities', moved_activities::text));
  PERFORM set_config('app.merge_source', '', true);
  -- The merged person's own record, history and leftovers leave through controlled erasure.
  PERFORM public.erase_contact(p_tenant, p_source);
  RETURN jsonb_build_object('identifiers', moved_identifiers, 'droppedIdentifiers', dropped_identifiers, 'links', moved_links,
    'consents', moved_consents, 'tasks', moved_tasks, 'notes', moved_notes, 'deals', moved_deals,
    'values', moved_values + repointed_values, 'activities', moved_activities, 'notesCopied', notes_taken);
END $$;

--> statement-breakpoint
CREATE FUNCTION public.guard_source_import_outcome() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_user = 'harvest_app' AND (NEW.contact_id IS NOT NULL OR OLD.contact_id IS NOT NULL) AND (
 NEW.status IN ('done','rolled_back') OR OLD.status IN ('done','rolled_back') OR
 NEW.created OR NEW.result_version IS NOT NULL OR NEW.applied IS NOT NULL) THEN
 RAISE EXCEPTION 'controlled import completion required' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_source_import_outcome() FROM PUBLIC;
CREATE TRIGGER source_import_outcome_guard BEFORE UPDATE ON public.crm_import_rows FOR EACH ROW EXECUTE FUNCTION public.guard_source_import_outcome();

--> statement-breakpoint
-- The writer derives values and rollback deltas from the immutable CSV row. It
-- accepts no caller-selected contact, creation outcome or applied metadata.
CREATE FUNCTION public.apply_person_import_row(p_tenant uuid,p_import uuid,p_row integer,p_company uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE actor text:=nullif(current_setting('app.user_id',true),''); imp record; r record; c record;
 values_map jsonb:='{}'; cell text; target text; i integer; candidate uuid; matches integer; was_created boolean;
 k text; val text; norm text; added jsonb:='[]'; delta jsonb:='{}'; linked boolean:=false; v integer;
BEGIN
 IF p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid OR actor IS NULL THEN RAISE EXCEPTION 'import denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspace_members WHERE tenant_id=p_tenant AND user_id=actor AND role_id IN ('owner','admin','member') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'import denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO imp FROM public.crm_imports WHERE tenant_id=p_tenant AND id=p_import AND entity='person' AND status='running' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'import unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.crm_import_rows WHERE tenant_id=p_tenant AND import_id=p_import AND row_number=p_row AND status='ready';
 IF NOT FOUND THEN RAISE EXCEPTION 'ready import row required' USING ERRCODE='42501'; END IF;
 FOR i IN 0..jsonb_array_length(imp.mapping)-1 LOOP
 target:=imp.mapping->>i;
 IF target IS NULL THEN CONTINUE; END IF;
 IF target NOT IN ('name','email','phone','social','notes','company','title') OR values_map ? target THEN RAISE EXCEPTION 'invalid mapping' USING ERRCODE='22023'; END IF;
 cell:=coalesce(r.raw->>i,'');
 IF left(cell,1)=chr(39) AND substr(cell,2,1) IN ('=','+','-','@',chr(9),chr(13)) THEN cell:=substr(cell,2); END IF;
 values_map:=values_map || jsonb_build_object(target,btrim(cell,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'));
 END LOOP;
 IF length(coalesce(values_map->>'phone',''))>40 THEN RAISE EXCEPTION 'invalid phone' USING ERRCODE='22023'; END IF;
 values_map:=values_map || jsonb_build_object('name',regexp_replace(coalesce(values_map->>'name',''),U&'[\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff]+',' ','g'),
 'email',lower(coalesce(values_map->>'email','')),'phone',regexp_replace(coalesce(values_map->>'phone',''),U&'[\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff().-]','','g'));
 IF length(values_map->>'name') NOT BETWEEN 1 AND 100 OR length(coalesce(values_map->>'notes',''))>5000
 OR length(coalesce(values_map->>'title',''))>100 OR length(coalesce(values_map->>'email',''))>254
 OR (coalesce(values_map->>'email','')<>'' AND (values_map->>'email') !~ $email$^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$$email$)
 OR (coalesce(values_map->>'phone','')<>'' AND (values_map->>'phone') !~ '^\+[1-9][0-9]{6,14}$')
 OR length(coalesce(values_map->>'social',''))>100
 OR (coalesce(values_map->>'social','')<>'' AND (values_map->>'social') !~* '^@?[a-z0-9_][a-z0-9_.:-]*$') THEN
 RAISE EXCEPTION 'invalid person row' USING ERRCODE='22023'; END IF;
 SELECT count(DISTINCT id.contact_id),(array_agg(DISTINCT id.contact_id))[1] INTO matches,candidate
 FROM public.contact_identifiers id JOIN public.contacts live ON live.tenant_id=id.tenant_id AND live.id=id.contact_id AND live.erased_at IS NULL
 WHERE id.tenant_id=p_tenant AND id.normalized_value=CASE WHEN id.kind='social' THEN lower(ltrim(coalesce(values_map->>'social',''),'@')) ELSE coalesce(values_map->>id.kind,'') END
 AND coalesce(values_map->>id.kind,'')<>'';
 IF matches>1 THEN RAISE EXCEPTION 'multiple matches' USING ERRCODE='23505'; END IF;
 was_created:=matches=0;
 IF NOT was_created AND imp.on_match<>'fill' THEN RAISE EXCEPTION 'row no longer applicable' USING ERRCODE='23505'; END IF;
 -- Company resolution stays in the established server URL/IDN normalizer. A
 -- writer already has authority to link any live company inside this tenant.
 IF p_company IS NOT NULL THEN
 PERFORM 1 FROM public.companies WHERE tenant_id=p_tenant AND id=p_company FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'company unavailable' USING ERRCODE='23505'; END IF;
 END IF;
 IF was_created THEN
 INSERT INTO public.contacts(tenant_id,name,notes) VALUES(p_tenant,values_map->>'name',coalesce(values_map->>'notes','')) RETURNING id,version INTO candidate,v;
 ELSE
 SELECT * INTO c FROM public.contacts WHERE tenant_id=p_tenant AND id=candidate AND erased_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'contact unavailable' USING ERRCODE='23505'; END IF;
 IF (SELECT count(DISTINCT id.contact_id) FROM public.contact_identifiers id
 JOIN public.contacts live ON live.tenant_id=id.tenant_id AND live.id=id.contact_id AND live.erased_at IS NULL
 WHERE id.tenant_id=p_tenant AND id.normalized_value=CASE WHEN id.kind='social' THEN lower(ltrim(coalesce(values_map->>'social',''),'@')) ELSE coalesce(values_map->>id.kind,'') END
 AND coalesce(values_map->>id.kind,'')<>'')<>1 OR NOT EXISTS(
 SELECT 1 FROM public.contact_identifiers id WHERE id.tenant_id=p_tenant AND id.contact_id=candidate
 AND id.normalized_value=CASE WHEN id.kind='social' THEN lower(ltrim(coalesce(values_map->>'social',''),'@')) ELSE coalesce(values_map->>id.kind,'') END
 AND coalesce(values_map->>id.kind,'')<>'') THEN RAISE EXCEPTION 'match changed' USING ERRCODE='23505'; END IF;
 IF c.notes='' AND coalesce(values_map->>'notes','')<>'' THEN
 UPDATE public.contacts SET notes=values_map->>'notes' WHERE tenant_id=p_tenant AND id=candidate;
 delta:=delta || '{"notes":true}';
 END IF;
 END IF;
 FOREACH k IN ARRAY ARRAY['email','phone','social'] LOOP
 val:=coalesce(values_map->>k,''); norm:=CASE WHEN k='social' THEN lower(ltrim(val,'@')) ELSE val END;
 IF val<>'' AND NOT EXISTS(SELECT 1 FROM public.contact_identifiers WHERE tenant_id=p_tenant AND contact_id=candidate AND kind=k) THEN
 INSERT INTO public.contact_identifiers(tenant_id,contact_id,kind,value,normalized_value) VALUES(p_tenant,candidate,k,val,norm);
 added:=added || to_jsonb(k);
 END IF;
 END LOOP;
 IF NOT was_created AND jsonb_array_length(added)>0 THEN delta:=delta || jsonb_build_object('identifiers',added); END IF;
 IF p_company IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contact_company_links WHERE tenant_id=p_tenant AND contact_id=candidate AND company_id=p_company) THEN
 INSERT INTO public.contact_company_links(tenant_id,contact_id,company_id,title,is_primary,created_by)
 VALUES(p_tenant,candidate,p_company,coalesce(values_map->>'title',''),NOT EXISTS(SELECT 1 FROM public.contact_company_links WHERE tenant_id=p_tenant AND contact_id=candidate AND is_primary),actor);
 delta:=delta || jsonb_build_object('companyId',p_company,'linked',true); linked:=true;
 INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata) VALUES(p_tenant,actor,'contact.company_link',candidate::text,jsonb_build_object('companyId',p_company,'importId',p_import));
 END IF;
 IF NOT was_created THEN
 IF delta='{}'::jsonb THEN RAISE EXCEPTION 'row no longer applicable' USING ERRCODE='23505'; END IF;
 UPDATE public.contacts SET updated_at=now(),version=version+1 WHERE tenant_id=p_tenant AND id=candidate RETURNING version INTO v;
 END IF;
 INSERT INTO public.audit_logs(tenant_id,actor_id,action,target_id,metadata) VALUES(p_tenant,actor,CASE WHEN was_created THEN 'contact.create' ELSE 'contact.update' END,candidate::text,jsonb_build_object('importId',p_import));
 UPDATE public.crm_import_rows SET status='done',action=CASE WHEN was_created THEN 'create' ELSE 'update' END,
 contact_id=candidate,created=was_created,applied=CASE WHEN delta='{}'::jsonb THEN NULL ELSE delta END,result_version=v
 WHERE tenant_id=p_tenant AND import_id=p_import AND row_number=p_row AND status='ready';
 IF NOT FOUND THEN RAISE EXCEPTION 'import row changed' USING ERRCODE='23505'; END IF;
END $body$;
REVOKE ALL ON FUNCTION public.apply_person_import_row(uuid,uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_person_import_row(uuid,uuid,integer,uuid) TO harvest_app;
