CREATE TABLE "guild_config" (
	"guild_id" varchar(20) PRIMARY KEY NOT NULL,
	"allowed_role_id" varchar(20),
	"log_channel_id" varchar(20),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"discord_user_id" varchar(20) PRIMARY KEY NOT NULL,
	"guild_id" varchar(20) NOT NULL,
	"steam_username" varchar(100) NOT NULL,
	"encrypted_password" text NOT NULL,
	"encryption_iv" varchar(64) NOT NULL,
	"has_steam_guard" boolean DEFAULT false NOT NULL,
	"auto_restart_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" varchar(20) NOT NULL,
	"level" varchar(10) NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" varchar(20) NOT NULL,
	"app_id" integer NOT NULL,
	"name" varchar(120),
	"enabled" boolean DEFAULT true NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_games" ADD CONSTRAINT "user_games_discord_user_id_user_accounts_discord_user_id_fk" FOREIGN KEY ("discord_user_id") REFERENCES "public"."user_accounts"("discord_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_events_user_created" ON "user_events" USING btree ("discord_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_games_user_app" ON "user_games" USING btree ("discord_user_id","app_id");