import type { Client } from "discord.js";
import type { AppConfig } from "../config";
import type {
  UserAccountRepository,
  UserEventsRepository,
  UserGamesRepository,
} from "../db/repositories";
import type { AppLogger } from "../logger";
import { UserDMNotifier } from "./notifier";
import { SteamIdleService } from "../steam/steamIdleService";
import { decrypt, encrypt } from "../utils/encryption";

export class UserIdleManager {
  private sessions = new Map<string, SteamIdleService>();

  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly accounts: UserAccountRepository,
    private readonly games: UserGamesRepository,
    private readonly events: UserEventsRepository,
    private readonly logger: AppLogger,
  ) {}

  /** Retourne la session existante ou en crée une à la volée depuis la DB. */
  async getOrCreate(discordUserId: string): Promise<SteamIdleService> {
    const existing = this.sessions.get(discordUserId);
    if (existing) return existing;

    const account = await this.accounts.findById(discordUserId);
    if (!account) throw new Error("Aucun compte Steam enregistré.\n- Utilise `/account setup` pour en configurer un.");

    const refreshToken =
      account.refreshToken && account.refreshTokenIv
        ? decrypt(account.refreshToken, account.refreshTokenIv, this.config.encryptionKey)
        : null;

    return this.createSession(
      discordUserId,
      account.steamUsername,
      account.encryptedPassword,
      account.encryptionIv,
      refreshToken,
    );
  }

  /** Crée ou remplace la session pour un user (après /account setup). */
  createSession(
    discordUserId: string,
    steamUsername: string,
    encryptedPassword: string,
    iv: string,
    refreshToken: string | null = null,
  ): SteamIdleService {
    this.destroySession(discordUserId);

    const password = decrypt(encryptedPassword, iv, this.config.encryptionKey);
    const notifier = new UserDMNotifier(this.client, discordUserId);

    const onRefreshToken = async (token: string | null) => {
      if (token === null) {
        await this.accounts.updateRefreshToken(discordUserId, null, null);
        return;
      }
      const { encrypted, iv: tokenIv } = encrypt(token, this.config.encryptionKey);
      await this.accounts.updateRefreshToken(discordUserId, encrypted, tokenIv);
    };

    const service = new SteamIdleService(
      discordUserId,
      { username: steamUsername, password, refreshToken },
      this.config,
      this.games,
      this.events,
      this.logger,
      notifier,
      onRefreshToken,
    );

    this.sessions.set(discordUserId, service);
    return service;
  }

  get(discordUserId: string): SteamIdleService | undefined {
    return this.sessions.get(discordUserId);
  }

  /** Arrête proprement la session et la supprime du manager. */
  async destroySession(discordUserId: string) {
    const session = this.sessions.get(discordUserId);
    if (session) {
      await session.stop("account-deleted");
      this.sessions.delete(discordUserId);
    }
  }

  /** Arrête toutes les sessions actives (utilisé au shutdown). */
  async stopAll(reason = "shutdown") {
    const promises = [...this.sessions.values()].map((s) => s.stop(reason));
    await Promise.allSettled(promises);
    this.sessions.clear();
  }
}
