ALTER TABLE "otp_cooldowns" ADD COLUMN "issued_at" timestamp with time zone[] DEFAULT ARRAY[]::timestamptz[] NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_cooldowns" ADD COLUMN "reservation_id" uuid;
--> statement-breakpoint
-- Preserve the last known issuance when upgrading existing cooldown rows.
UPDATE "otp_cooldowns" SET "issued_at" = ARRAY["sent_at"];
