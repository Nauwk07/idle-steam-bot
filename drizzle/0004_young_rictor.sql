ALTER TABLE "user_accounts" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "refresh_token_iv" varchar(64);