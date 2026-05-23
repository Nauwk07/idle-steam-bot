ALTER TABLE "user_accounts" ADD COLUMN "refresh_token" text;
ALTER TABLE "user_accounts" ADD COLUMN "refresh_token_iv" varchar(64);
