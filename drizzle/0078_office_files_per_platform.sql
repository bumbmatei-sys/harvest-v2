-- Install the replacement safeguards before dropping the old keys. Drizzle applies this in a transaction.
CREATE UNIQUE INDEX "office_connection_personal_files_platform_idx" ON "office_connections" USING btree ("tenant_id","owner_user_id","kind","platform") WHERE "office_connections"."platform" is not null and "office_connections"."kind" = 'files';--> statement-breakpoint
DROP INDEX "office_connection_personal_kind_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "office_connection_personal_kind_idx" ON "office_connections" USING btree ("tenant_id","owner_user_id","kind") WHERE "office_connections"."platform" is not null and "office_connections"."kind" <> 'files';--> statement-breakpoint
CREATE UNIQUE INDEX "office_attempt_personal_kind_idx" ON "office_connect_attempts" USING btree ("tenant_id","owner_user_id","kind") WHERE "office_connect_attempts"."kind" <> 'files';--> statement-breakpoint
CREATE UNIQUE INDEX "office_attempt_personal_files_platform_idx" ON "office_connect_attempts" USING btree ("tenant_id","owner_user_id","kind","platform") WHERE "office_connect_attempts"."kind" = 'files';--> statement-breakpoint
ALTER TABLE "office_connect_attempts" DROP CONSTRAINT "office_connect_attempts_tenant_id_owner_user_id_kind_pk";--> statement-breakpoint
ALTER TABLE "office_connect_attempts" ADD CONSTRAINT "office_connect_attempts_tenant_id_owner_user_id_id_pk" PRIMARY KEY("tenant_id","owner_user_id","id");
