import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./index";
import type {
  GuildConfig,
  NewUserAccount,
  UserAccount,
  UserEvent,
  UserGame,
} from "./schema";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

// ─── GuildConfigRepository ────────────────────────────────────

export class GuildConfigRepository {
  async get(guildId: string): Promise<GuildConfig | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.guildConfig)
      .where(eq(schema.guildConfig.guildId, guildId));
    return row ?? null;
  }

  async setAllowedRole(guildId: string, roleId: string | null) {
    const db = getDb();
    await db
      .insert(schema.guildConfig)
      .values({ guildId, allowedRoleId: roleId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.guildConfig.guildId,
        set: { allowedRoleId: roleId, updatedAt: new Date() },
      });
  }

  async setLogChannel(guildId: string, channelId: string | null) {
    const db = getDb();
    await db
      .insert(schema.guildConfig)
      .values({ guildId, logChannelId: channelId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.guildConfig.guildId,
        set: { logChannelId: channelId, updatedAt: new Date() },
      });
  }
}

// ─── UserAccountRepository ────────────────────────────────────

export class UserAccountRepository {
  async findById(discordUserId: string): Promise<UserAccount | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.userAccounts)
      .where(eq(schema.userAccounts.discordUserId, discordUserId));
    return row ?? null;
  }

  async upsert(account: NewUserAccount) {
    const db = getDb();
    const now = new Date();
    try {
      await db
        .insert(schema.userAccounts)
        .values({ ...account, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.userAccounts.discordUserId,
          set: {
            steamUsername: account.steamUsername,
            encryptedPassword: account.encryptedPassword,
            encryptionIv: account.encryptionIv,
            // Reset à false : la prochaine connexion remettra le bon flag
            hasSteamGuard: false,
            autoRestartEnabled: false,
            updatedAt: now,
          },
        });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `Le compte Steam \`${account.steamUsername}\` est déjà enregistré par un autre utilisateur.`,
        );
      }
      throw err;
    }
  }

  async updateSteamGuardStatus(discordUserId: string, hasSteamGuard: boolean) {
    const db = getDb();
    await db
      .update(schema.userAccounts)
      .set({
        hasSteamGuard,
        // Si Steam Guard activé, on force la désactivation de l'auto-restart
        autoRestartEnabled: hasSteamGuard ? false : undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.userAccounts.discordUserId, discordUserId));
  }

  async setAutoRestart(discordUserId: string, enabled: boolean) {
    const db = getDb();
    await db
      .update(schema.userAccounts)
      .set({ autoRestartEnabled: enabled, updatedAt: new Date() })
      .where(eq(schema.userAccounts.discordUserId, discordUserId));
  }

  async delete(discordUserId: string) {
    const db = getDb();
    await db
      .delete(schema.userAccounts)
      .where(eq(schema.userAccounts.discordUserId, discordUserId));
  }
}

// ─── UserGamesRepository ──────────────────────────────────────

export class UserGamesRepository {
  async list(discordUserId: string, includeDisabled = true): Promise<UserGame[]> {
    const db = getDb();
    const query = db
      .select()
      .from(schema.userGames)
      .where(
        includeDisabled
          ? eq(schema.userGames.discordUserId, discordUserId)
          : and(
              eq(schema.userGames.discordUserId, discordUserId),
              eq(schema.userGames.enabled, true),
            ),
      )
      .orderBy(schema.userGames.appId);
    return query;
  }

  async enabledAppIds(discordUserId: string): Promise<number[]> {
    const games = await this.list(discordUserId, false);
    return games.map((g) => g.appId);
  }

  async countEnabled(discordUserId: string): Promise<number> {
    const db = getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.userGames)
      .where(
        and(
          eq(schema.userGames.discordUserId, discordUserId),
          eq(schema.userGames.enabled, true),
        ),
      );
    return row?.count ?? 0;
  }

  async upsert(discordUserId: string, appId: number, name?: string) {
    const db = getDb();
    const now = new Date();
    await db
      .insert(schema.userGames)
      .values({ discordUserId, appId, name: name ?? null, enabled: true, addedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.userGames.discordUserId, schema.userGames.appId],
        set: {
          name: sql`COALESCE(excluded.name, ${schema.userGames.name})`,
          enabled: true,
          updatedAt: now,
        },
      });
  }

  async remove(discordUserId: string, appId: number) {
    const db = getDb();
    const result = await db
      .delete(schema.userGames)
      .where(
        and(
          eq(schema.userGames.discordUserId, discordUserId),
          eq(schema.userGames.appId, appId),
        ),
      );
    if (result.rowCount === 0) {
      throw new Error(`Jeu introuvable : \`${appId}\``);
    }
  }
}

// ─── UserEventsRepository ─────────────────────────────────────

export class UserEventsRepository {
  async add(discordUserId: string, level: string, message: string, meta?: unknown) {
    const db = getDb();
    await db.insert(schema.userEvents).values({
      discordUserId,
      level,
      message,
      meta: meta !== undefined ? meta : null,
      createdAt: new Date(),
    });
  }

  async recent(discordUserId: string, limit: number): Promise<UserEvent[]> {
    const db = getDb();
    return db
      .select()
      .from(schema.userEvents)
      .where(eq(schema.userEvents.discordUserId, discordUserId))
      .orderBy(desc(schema.userEvents.createdAt))
      .limit(Math.max(1, Math.min(limit, 50)));
  }
}
