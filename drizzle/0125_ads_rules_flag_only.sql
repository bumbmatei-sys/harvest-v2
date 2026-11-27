-- Founder decision 26 Nov: ad rules are flag only. A rule may never change delivery or spend.
-- Existing pause rules are kept as a record but switched off; they can never be switched on again (CHECK) and no new rule may pause (trigger).
-- ads_rules has FORCE RLS and the migration owner has no BYPASSRLS: the backfill reads every ministry's rows through the ads_definer policy (0098), and the flag is blanked straight after.
SELECT set_config('app.ads_definer', 'on', true);--> statement-breakpoint
UPDATE "ads_rules" SET "enabled" = false, "version" = "version" + 1, "updated_at" = now() WHERE "action" <> 'notify' AND "enabled";--> statement-breakpoint
SELECT set_config('app.ads_definer', '', true);--> statement-breakpoint
ALTER TABLE "ads_rules" DROP CONSTRAINT "ads_rules_shape";--> statement-breakpoint
ALTER TABLE "ads_rules" ADD CONSTRAINT "ads_rules_shape" CHECK (length("ads_rules"."name") between 1 and 120 and "ads_rules"."level" in ('campaign','adset','ad') and "ads_rules"."action" in ('pause','notify') and ("ads_rules"."action" = 'notify' or not "ads_rules"."enabled") and pg_column_size("ads_rules"."condition") <= 1024);--> statement-breakpoint
CREATE FUNCTION public.ads_rules_flag_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.action <> 'notify' AND (TG_OP = 'INSERT' OR NEW.action IS DISTINCT FROM OLD.action) THEN
    RAISE EXCEPTION 'ad rules only flag' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ads_rules_flag_only() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER ads_rules_flag_only BEFORE INSERT OR UPDATE OF action ON public.ads_rules FOR EACH ROW EXECUTE FUNCTION public.ads_rules_flag_only();
