CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"city_region" text,
	"onboarding_completed_at" timestamp with time zone,
	"onboarding_skipped_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_city_region" CHECK ("user_profiles"."city_region" is null or length("user_profiles"."city_region") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Accounts that exist when this migration runs count as already offered onboarding.
INSERT INTO public.user_profiles (user_id, onboarding_skipped_at) SELECT id, now() FROM public.users ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_profiles FROM PUBLIC, harvest_app;
GRANT SELECT, INSERT, UPDATE ON public.user_profiles TO harvest_app;
CREATE POLICY user_profiles_owner ON public.user_profiles TO harvest_app
  USING (user_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), ''));
