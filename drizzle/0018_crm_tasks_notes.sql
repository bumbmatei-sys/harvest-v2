CREATE TABLE "crm_notes" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"body" text NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"opportunity_id" uuid,
	"edited_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_notes_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_note_target" CHECK (num_nonnulls("crm_notes"."contact_id", "crm_notes"."company_id", "crm_notes"."opportunity_id") = 1),
	CONSTRAINT "crm_note_body" CHECK (length(btrim("crm_notes"."body")) between 1 and 10000),
	CONSTRAINT "crm_note_version" CHECK ("crm_notes"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "crm_notifications" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" text NOT NULL,
	"actor_user_id" text,
	"kind" text NOT NULL,
	"task_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_notifications_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_notification_kind" CHECK ("crm_notifications"."kind" in ('task_assigned'))
);
--> statement-breakpoint
CREATE TABLE "crm_tasks" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'none' NOT NULL,
	"due_at" timestamp with time zone,
	"assignee_user_id" text,
	"contact_id" uuid,
	"company_id" uuid,
	"opportunity_id" uuid,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_tasks_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "crm_task_title" CHECK (length(btrim("crm_tasks"."title")) between 1 and 200 and "crm_tasks"."title" = btrim("crm_tasks"."title")),
	CONSTRAINT "crm_task_body" CHECK (length("crm_tasks"."body") <= 5000),
	CONSTRAINT "crm_task_status" CHECK ("crm_tasks"."status" in ('open', 'done')),
	CONSTRAINT "crm_task_priority" CHECK ("crm_tasks"."priority" in ('none', 'low', 'medium', 'high')),
	CONSTRAINT "crm_task_completed" CHECK (("crm_tasks"."status" = 'done') = ("crm_tasks"."completed_at" is not null)),
	CONSTRAINT "crm_task_version" CHECK ("crm_tasks"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_tenant_id_company_id_companies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_tenant_id_opportunity_id_opportunities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notifications_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notifications_tenant_id_task_id_crm_tasks_tenant_id_id_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."crm_tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_tenant_id_workspaces_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_tenant_id_contact_id_contacts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_tenant_id_company_id_companies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_tenant_id_opportunity_id_opportunities_tenant_id_id_fk" FOREIGN KEY ("tenant_id","opportunity_id") REFERENCES "public"."opportunities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_notes_contact_idx" ON "crm_notes" USING btree ("tenant_id","contact_id","created_at") WHERE "crm_notes"."contact_id" is not null;--> statement-breakpoint
CREATE INDEX "crm_notes_company_idx" ON "crm_notes" USING btree ("tenant_id","company_id","created_at") WHERE "crm_notes"."company_id" is not null;--> statement-breakpoint
CREATE INDEX "crm_notes_opportunity_idx" ON "crm_notes" USING btree ("tenant_id","opportunity_id","created_at") WHERE "crm_notes"."opportunity_id" is not null;--> statement-breakpoint
CREATE INDEX "crm_notifications_recipient_idx" ON "crm_notifications" USING btree ("tenant_id","recipient_user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "crm_tasks_assignee_idx" ON "crm_tasks" USING btree ("tenant_id","assignee_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "crm_tasks_due_idx" ON "crm_tasks" USING btree ("tenant_id","status","due_at");--> statement-breakpoint
CREATE INDEX "crm_tasks_contact_idx" ON "crm_tasks" USING btree ("tenant_id","contact_id") WHERE "crm_tasks"."contact_id" is not null;--> statement-breakpoint
CREATE INDEX "crm_tasks_company_idx" ON "crm_tasks" USING btree ("tenant_id","company_id") WHERE "crm_tasks"."company_id" is not null;--> statement-breakpoint
CREATE INDEX "crm_tasks_opportunity_idx" ON "crm_tasks" USING btree ("tenant_id","opportunity_id") WHERE "crm_tasks"."opportunity_id" is not null;