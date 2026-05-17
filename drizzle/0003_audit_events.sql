CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" varchar(20) NOT NULL,
	"guild_id" varchar(20),
	"action" varchar(64) NOT NULL,
	"target" varchar(200),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_audit_events_user_created" ON "audit_events" USING btree ("discord_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_events_action_created" ON "audit_events" USING btree ("action","created_at");