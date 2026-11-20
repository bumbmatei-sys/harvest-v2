ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_tenant_connection_id_key" UNIQUE("tenant_id","connection_id","id");
--> statement-breakpoint
CREATE TABLE "social_analytics_accounts" (
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"day" date NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"metrics" jsonb NOT NULL,
	CONSTRAINT "social_analytics_accounts_tenant_id_connection_id_day_pk" PRIMARY KEY("tenant_id","connection_id","day"),
	CONSTRAINT "social_analytics_account_shape" CHECK (jsonb_typeof("social_analytics_accounts"."metrics") = 'object' AND "social_analytics_accounts"."metrics" - array['followers','profileViews'] = '{}'::jsonb
    AND NOT jsonb_path_exists("social_analytics_accounts"."metrics", '$.keyvalue() ? (@.value.type() != "number")'))
);
--> statement-breakpoint
CREATE TABLE "social_analytics_posts" (
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"planner_post_id" uuid,
	"day" date NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"metrics" jsonb NOT NULL,
	CONSTRAINT "social_analytics_posts_tenant_id_connection_id_provider_ref_day_pk" PRIMARY KEY("tenant_id","connection_id","provider_ref","day"),
	CONSTRAINT "social_analytics_post_shape" CHECK (length("social_analytics_posts"."provider_ref") between 1 and 200 and "social_analytics_posts"."published_at" <= "social_analytics_posts"."captured_at" and "social_analytics_posts"."day" = ("social_analytics_posts"."captured_at" at time zone 'UTC')::date and jsonb_typeof("social_analytics_posts"."metrics") = 'object' AND "social_analytics_posts"."metrics" - array['impressions','reach','views','likes','comments','shares','saves','clicks','videoViews','watchTimeSeconds','score'] = '{}'::jsonb
    AND NOT jsonb_path_exists("social_analytics_posts"."metrics", '$.keyvalue() ? (@.value.type() != "number")'))
);
--> statement-breakpoint
CREATE TABLE "social_analytics_refresh" (
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"checked_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease" uuid,
	"leased_until" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"page" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "social_analytics_refresh_tenant_id_connection_id_pk" PRIMARY KEY("tenant_id","connection_id"),
	CONSTRAINT "social_analytics_refresh_shape" CHECK ("social_analytics_refresh"."state" in ('pending','ready','partial','delayed','expired','unavailable') and "social_analytics_refresh"."failures" between 0 and 20 and "social_analytics_refresh"."page" between 1 and 10000 and (("social_analytics_refresh"."lease" is null) = ("social_analytics_refresh"."leased_until" is null)))
);
--> statement-breakpoint
CREATE TABLE "social_analytics_times" (
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"day" date NOT NULL,
	"weekday" integer NOT NULL,
	"hour" integer NOT NULL,
	"engagement" double precision NOT NULL,
	"samples" integer NOT NULL,
	CONSTRAINT "social_analytics_times_tenant_id_connection_id_day_weekday_hour_pk" PRIMARY KEY("tenant_id","connection_id","day","weekday","hour"),
	CONSTRAINT "social_analytics_time_shape" CHECK ("social_analytics_times"."weekday" between 0 and 6 and "social_analytics_times"."hour" between 0 and 23 and "social_analytics_times"."samples" > 0 and "social_analytics_times"."engagement" between 0 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "social_analytics_accounts" ADD CONSTRAINT "social_analytics_accounts_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_analytics_posts" ADD CONSTRAINT "social_analytics_posts_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_analytics_posts" ADD CONSTRAINT "social_analytics_posts_planner_fk" FOREIGN KEY ("tenant_id","connection_id","planner_post_id") REFERENCES "public"."social_posts"("tenant_id","connection_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_analytics_refresh" ADD CONSTRAINT "social_analytics_refresh_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_analytics_times" ADD CONSTRAINT "social_analytics_times_account_fk" FOREIGN KEY ("tenant_id","connection_id","day") REFERENCES "public"."social_analytics_accounts"("tenant_id","connection_id","day") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_analytics_account_day_idx" ON "social_analytics_accounts" USING btree ("day","tenant_id");--> statement-breakpoint
CREATE INDEX "social_analytics_post_day_idx" ON "social_analytics_posts" USING btree ("day","tenant_id");--> statement-breakpoint
CREATE INDEX "social_analytics_post_planner_idx" ON "social_analytics_posts" USING btree ("tenant_id","planner_post_id","day");--> statement-breakpoint
CREATE INDEX "social_analytics_refresh_due_idx" ON "social_analytics_refresh" USING btree ("due_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.social_inbox_can(p_tenant uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND p_permission IN ('social:inbox','social:reply','social:assign','social:saved_replies','social:auto_dm','social:analytics')
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.tenant_id = p_tenant
      AND m.user_id = nullif(current_setting('app.user_id', true), '') AND m.role_id IN ('owner','admin'))
$$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['social_analytics_accounts','social_analytics_posts','social_analytics_times','social_analytics_refresh'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT ON public.%I TO harvest_app', t);
    EXECUTE format('CREATE POLICY analytics_admin ON public.%I FOR SELECT TO harvest_app USING (public.social_inbox_can(tenant_id,''social:analytics''))', t);
    EXECUTE format('CREATE POLICY analytics_definer ON public.%I TO %I USING (current_setting(''app.social_analytics_worker'', true) = ''on'')', t, current_user);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_analytics_claim(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'invalid analytics batch'; END IF;
  PERFORM set_config('app.social_analytics_worker','on',true);
  PERFORM set_config('app.social_definer','on',true);
  INSERT INTO public.social_analytics_refresh(tenant_id,connection_id)
  SELECT c.tenant_id,c.id FROM public.social_connections c
  WHERE c.status='active' AND c.health IN ('healthy','unknown') AND c.provider='fake'
    AND coalesce(c.health_code,'') !~ 'expired|token_revoked|reauth'
    AND NOT EXISTS(SELECT 1 FROM public.social_analytics_refresh r WHERE (r.tenant_id,r.connection_id)=(c.tenant_id,c.id))
  ORDER BY c.id LIMIT p_limit ON CONFLICT DO NOTHING;

  WITH due AS (
    SELECT r.tenant_id,r.connection_id,c.platform,c.version,c.external_account_ref,c.credential_envelope,
      CASE WHEN r.checked_at IS NULL OR (r.checked_at at time zone 'UTC')::date=(now() at time zone 'UTC')::date THEN r.page ELSE 1 END AS current_page
    FROM public.social_analytics_refresh r
    JOIN public.social_connections c ON (c.tenant_id,c.id)=(r.tenant_id,r.connection_id)
    WHERE r.due_at<=now() AND (r.lease IS NULL OR r.leased_until<=now()) AND c.status='active'
      AND c.health IN ('healthy','unknown') AND c.provider='fake' AND coalesce(c.health_code,'') !~ 'expired|token_revoked|reauth'
    ORDER BY r.due_at,r.connection_id LIMIT p_limit FOR UPDATE OF r SKIP LOCKED
  ), claimed AS (
    UPDATE public.social_analytics_refresh r SET lease=gen_random_uuid(),leased_until=now()+interval '60 seconds'
    FROM due WHERE (r.tenant_id,r.connection_id)=(due.tenant_id,due.connection_id)
    RETURNING to_jsonb(due) || jsonb_build_object('lease',r.lease,'failures',r.failures) AS payload
  ) SELECT coalesce(jsonb_agg(payload),'[]'::jsonb) INTO result FROM claimed;
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_analytics_complete(p_tenant uuid,p_connection uuid,p_lease uuid,p_version integer,
  p_state text,p_page integer,p_delay integer,p_posts jsonb,p_accounts jsonb,p_slots jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c record; instant timestamptz := clock_timestamp(); today date := (instant at time zone 'UTC')::date;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('ready','partial','delayed','expired','unavailable') OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 10000
    OR p_delay IS NULL OR p_delay NOT BETWEEN 1 AND 86400 OR jsonb_typeof(p_posts) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_accounts) IS DISTINCT FROM 'array' OR jsonb_typeof(p_slots) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_posts)>40 OR jsonb_array_length(p_accounts)>32 OR jsonb_array_length(p_slots)>168
  THEN RAISE EXCEPTION 'invalid analytics completion'; END IF;
  PERFORM set_config('app.social_analytics_worker','on',true);
  PERFORM set_config('app.social_definer','on',true);
  SELECT status,health,health_code,version INTO c FROM public.social_connections WHERE (tenant_id,id)=(p_tenant,p_connection)
    AND provider='fake' FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.social_analytics_refresh WHERE (tenant_id,connection_id,lease)=(p_tenant,p_connection,p_lease)
    AND leased_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF c.version<>p_version OR c.status<>'active' OR c.health NOT IN ('healthy','unknown') OR coalesce(c.health_code,'') ~ 'expired|token_revoked|reauth' THEN
    UPDATE public.social_analytics_refresh SET lease=NULL,leased_until=NULL,due_at=instant
      WHERE (tenant_id,connection_id)=(p_tenant,p_connection);
    RETURN false;
  END IF;

  IF p_state IN ('ready','partial') THEN
    INSERT INTO public.social_analytics_posts AS prior(tenant_id,connection_id,provider_ref,planner_post_id,day,captured_at,published_at,metrics)
    SELECT p_tenant,p_connection,item.ref,planner.id,today,instant,item.published_at,item.metrics
    FROM jsonb_to_recordset(p_posts) AS item(ref text,native_ref text,published_at timestamptz,metrics jsonb)
    LEFT JOIN LATERAL (
      SELECT p.id FROM public.social_posts p WHERE (p.tenant_id,p.connection_id)=(p_tenant,p_connection) AND p.status='published'
        AND p.provider_post_ref IN (item.ref,item.native_ref) ORDER BY (p.provider_post_ref=item.ref) DESC,p.id LIMIT 1
    ) planner ON true
    WHERE item.published_at<=instant AND item.published_at>=today-397
    ON CONFLICT (tenant_id,connection_id,provider_ref,day) DO UPDATE
      SET metrics=prior.metrics || excluded.metrics,captured_at=excluded.captured_at,
          planner_post_id=coalesce(excluded.planner_post_id,prior.planner_post_id);

    INSERT INTO public.social_analytics_accounts AS prior(tenant_id,connection_id,day,captured_at,metrics)
    SELECT p_tenant,p_connection,item.day,instant,item.metrics
    FROM jsonb_to_recordset(p_accounts) AS item(day date,metrics jsonb) WHERE item.day BETWEEN today-31 AND today
    ON CONFLICT (tenant_id,connection_id,day) DO UPDATE SET metrics=prior.metrics || excluded.metrics,captured_at=excluded.captured_at;

    IF jsonb_array_length(p_slots)>0 THEN
      INSERT INTO public.social_analytics_accounts(tenant_id,connection_id,day,captured_at,metrics)
      VALUES(p_tenant,p_connection,today,instant,'{}') ON CONFLICT DO NOTHING;
      INSERT INTO public.social_analytics_times(tenant_id,connection_id,day,weekday,hour,engagement,samples)
      SELECT p_tenant,p_connection,today,s.weekday,s.hour,s.engagement,s.samples
      FROM jsonb_to_recordset(p_slots) AS s(weekday integer,hour integer,engagement double precision,samples integer)
      ON CONFLICT (tenant_id,connection_id,day,weekday,hour) DO UPDATE SET engagement=excluded.engagement,samples=excluded.samples;
    END IF;
  END IF;
  UPDATE public.social_analytics_refresh SET state=p_state,checked_at=instant,
    refreshed_at=CASE WHEN p_state IN ('ready','partial') THEN instant ELSE refreshed_at END,
    due_at=instant+make_interval(secs=>p_delay),lease=NULL,leased_until=NULL,page=p_page,
    failures=CASE WHEN p_state='delayed' THEN least(20,failures+1) ELSE 0 END
    WHERE (tenant_id,connection_id)=(p_tenant,p_connection);
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.social_analytics_prune(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE posts integer; accounts integer; cutoff date := (now() at time zone 'UTC')::date-397;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid analytics prune batch'; END IF;
  PERFORM set_config('app.social_analytics_worker','on',true);
  WITH old AS (
    SELECT tenant_id,connection_id,provider_ref,day FROM public.social_analytics_posts
    WHERE day<cutoff ORDER BY day LIMIT p_limit FOR UPDATE SKIP LOCKED
  ) DELETE FROM public.social_analytics_posts s USING old
    WHERE (s.tenant_id,s.connection_id,s.provider_ref,s.day)=(old.tenant_id,old.connection_id,old.provider_ref,old.day);
  GET DIAGNOSTICS posts = ROW_COUNT;
  WITH old AS (
    SELECT tenant_id,connection_id,day FROM public.social_analytics_accounts
    WHERE day<cutoff ORDER BY day LIMIT p_limit FOR UPDATE SKIP LOCKED
  ) DELETE FROM public.social_analytics_accounts s USING old
    WHERE (s.tenant_id,s.connection_id,s.day)=(old.tenant_id,old.connection_id,old.day);
  GET DIAGNOSTICS accounts = ROW_COUNT;
  RETURN posts+accounts;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.social_analytics_claim(integer),
  public.social_analytics_complete(uuid,uuid,uuid,integer,text,integer,integer,jsonb,jsonb,jsonb),
  public.social_analytics_prune(integer) FROM PUBLIC, harvest_app;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='harvest_worker') THEN
    GRANT EXECUTE ON FUNCTION public.social_analytics_claim(integer),
      public.social_analytics_complete(uuid,uuid,uuid,integer,text,integer,integer,jsonb,jsonb,jsonb),
      public.social_analytics_prune(integer) TO harvest_worker;
  END IF;
END $$;
