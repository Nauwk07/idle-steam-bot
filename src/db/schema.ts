import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { InferInsertModel, InferSelectModel } from "drizzle-orm";

// ─── Guild config ─────────────────────────────────────────────
// Une ligne par guild Discord. Configuré par le owner Discord du bot.
export const guildConfig = pgTable("guild_config", {
  guildId: varchar("guild_id", { length: 20 }).primaryKey(),
  allowedRoleId: varchar("allowed_role_id", { length: 20 }),
  logChannelId: varchar("log_channel_id", { length: 20 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GuildConfig = InferSelectModel<typeof guildConfig>;
export type NewGuildConfig = InferInsertModel<typeof guildConfig>;

// ─── User accounts ────────────────────────────────────────────
// Un compte Steam par utilisateur Discord. Max 1.
export const userAccounts = pgTable(
  "user_accounts",
  {
    discordUserId: varchar("discord_user_id", { length: 20 }).primaryKey(),
    guildId: varchar("guild_id", { length: 20 }).notNull(),
    steamUsername: varchar("steam_username", { length: 100 }).notNull(),
    encryptedPassword: text("encrypted_password").notNull(),
    encryptionIv: varchar("encryption_iv", { length: 64 }).notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenIv: varchar("refresh_token_iv", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("idx_user_accounts_steam_username").on(t.steamUsername)],
);

export type UserAccount = InferSelectModel<typeof userAccounts>;
export type NewUserAccount = InferInsertModel<typeof userAccounts>;

// ─── User games ───────────────────────────────────────────────
export const userGames = pgTable(
  "user_games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordUserId: varchar("discord_user_id", { length: 20 })
      .notNull()
      .references(() => userAccounts.discordUserId, { onDelete: "cascade" }),
    appId: integer("app_id").notNull(),
    name: varchar("name", { length: 120 }),
    enabled: boolean("enabled").notNull().default(true),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("idx_user_games_user_app").on(t.discordUserId, t.appId)],
);

export type UserGame = InferSelectModel<typeof userGames>;
export type NewUserGame = InferInsertModel<typeof userGames>;

// ─── User events (logs techniques par user) ──────────────────
// Émis par SteamIdleService — observabilité du process Steam (connexion, dévco, erreurs).
export const userEvents = pgTable(
  "user_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordUserId: varchar("discord_user_id", { length: 20 }).notNull(),
    level: varchar("level", { length: 10 }).notNull(),
    message: text("message").notNull(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_user_events_user_created").on(t.discordUserId, t.createdAt)],
);

export type UserEvent = InferSelectModel<typeof userEvents>;
export type NewUserEvent = InferInsertModel<typeof userEvents>;

// ─── Audit events (traçabilité des actions Discord) ──────────
// Une ligne par action utilisateur sensible (setup, delete, start, stop, ...).
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordUserId: varchar("discord_user_id", { length: 20 }).notNull(),
    guildId: varchar("guild_id", { length: 20 }),
    action: varchar("action", { length: 64 }).notNull(),
    target: varchar("target", { length: 200 }),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_audit_events_user_created").on(t.discordUserId, t.createdAt),
    index("idx_audit_events_action_created").on(t.action, t.createdAt),
  ],
);

export type AuditEvent = InferSelectModel<typeof auditEvents>;
export type NewAuditEvent = InferInsertModel<typeof auditEvents>;
