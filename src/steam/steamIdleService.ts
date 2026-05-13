import { EventEmitter } from "node:events";

import SteamUser from "steam-user";

import type { AppConfig } from "../config";
import type { UserAccountRepository, UserEventsRepository, UserGamesRepository } from "../db/repositories";
import type { AppLogger } from "../logger";
import type { Notifier } from "../services/notifier";

export type IdlePhase =
  | "stopped"
  | "starting"
  | "running"
  | "standby"
  | "restarting"
  | "error";

export type IdleStatus = {
  phase: IdlePhase;
  connected: boolean;
  desiredRunning: boolean;
  activeAppIds: number[];
  standbyReason: string | null;
  realPlayingAppId: number | null;
  reconnectAttempt: number;
  nextRestartAt: string | null;
  startedAt: string | null;
  lastError: string | null;
  hasSteamGuard: boolean;
  autoRestartEnabled: boolean;
};

type SteamGuardRequest = {
  callback: (code: string) => void;
  requestedAt: Date;
  timer: NodeJS.Timeout;
};

type SteamCredentials = {
  username: string;
  password: string;
};

const STEAM_GUARD_TIMEOUT_MS = 5 * 60 * 1000;
const STEAM_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

export class SteamIdleService extends EventEmitter {
  private client: SteamUser | null = null;
  private phase: IdlePhase = "stopped";
  private connected = false;
  private desiredRunning = false;
  private standbyReason: string | null = null;
  private realPlayingAppId: number | null = null;
  private reconnectAttempt = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private resumeTimer: NodeJS.Timeout | null = null;
  private pendingSteamGuard: SteamGuardRequest | null = null;
  private nextRestartAt: Date | null = null;
  private startedAt: Date | null = null;
  private lastError: string | null = null;
  private intentionalStop = false;
  // Mis à jour à chaque connexion depuis la DB au moment de l'instanciation
  private hasSteamGuard: boolean;
  private autoRestartEnabled: boolean;

  constructor(
    private readonly discordUserId: string,
    private readonly credentials: SteamCredentials,
    private readonly config: AppConfig,
    private readonly games: UserGamesRepository,
    private readonly accounts: UserAccountRepository,
    private readonly events: UserEventsRepository,
    private readonly logger: AppLogger,
    private readonly notifier: Notifier,
    initialHasSteamGuard = false,
    initialAutoRestart = false,
  ) {
    super();
    this.hasSteamGuard = initialHasSteamGuard;
    this.autoRestartEnabled = initialAutoRestart;
  }

  getStatus(): IdleStatus {
    return {
      phase: this.phase,
      connected: this.connected,
      desiredRunning: this.desiredRunning,
      activeAppIds: [],
      standbyReason: this.standbyReason,
      realPlayingAppId: this.realPlayingAppId,
      reconnectAttempt: this.reconnectAttempt,
      nextRestartAt: this.nextRestartAt?.toISOString() ?? null,
      startedAt: this.startedAt?.toISOString() ?? null,
      lastError: this.lastError,
      hasSteamGuard: this.hasSteamGuard,
      autoRestartEnabled: this.autoRestartEnabled,
    };
  }

  hasPendingSteamGuard() {
    return this.pendingSteamGuard !== null;
  }

  async start(reason = "manual", steamGuardCode?: string) {
    this.clearRestartTimer();
    this.desiredRunning = true;
    this.intentionalStop = false;
    this.standbyReason = null;
    this.realPlayingAppId = null;
    this.startedAt = new Date();

    if (this.isDryRun()) {
      this.connected = true;
      this.phase = "running";
      this.reconnectAttempt = 0;
      const count = await this.games.countEnabled(this.discordUserId);
      this.log("info", "Idle dry-run démarré", { reason });
      this.emit("status");
      await this.notify(`Idle dry-run démarré (${count} jeux).`);
      return;
    }

    if (this.client) {
      if (this.pendingSteamGuard && steamGuardCode) {
        this.submitSteamGuardCode(steamGuardCode);
      }
      await this.applyGames();
      return;
    }

    this.phase = "starting";
    this.emit("status");
    this.log("info", "Connexion Steam en cours", { reason });

    const client = new SteamUser();
    this.client = client;
    this.bindClient(client);

    client.logOn({
      accountName: this.credentials.username,
      password: this.credentials.password,
      twoFactorCode: steamGuardCode,
      machineName: "idle-steam-discord-bot",
      autoRelogin: false,
    });
  }

  async stop(reason = "manual") {
    this.desiredRunning = false;
    this.intentionalStop = true;
    this.clearRestartTimer();
    this.clearResumeTimer();
    this.clearSteamGuardRequest();
    this.nextRestartAt = null;
    this.standbyReason = null;
    this.realPlayingAppId = null;

    if (this.client && this.connected) {
      this.client.gamesPlayed([]);
    }

    this.client?.logOff();
    this.client = null;
    this.connected = false;
    this.phase = "stopped";
    this.log("info", "Idle arrêté", { reason });
    this.emit("status");
  }

  async restart(reason = "manual", steamGuardCode?: string) {
    await this.stop(`restart:${reason}`);
    this.desiredRunning = true;
    this.intentionalStop = false;
    await this.start(reason, steamGuardCode);
  }

  async applyGames(reason = "games-updated") {
    if (!this.desiredRunning) return;

    if (this.isDryRun()) {
      const appIds = await this.games.enabledAppIds(this.discordUserId);
      this.log("info", "Liste de jeux appliquée en dry-run", { reason, appIds });
      this.emit("status");
      return;
    }

    if (!this.client || !this.connected) return;
    if (this.phase === "standby") return;

    const appIds = await this.games.enabledAppIds(this.discordUserId);
    this.client.gamesPlayed(appIds, false);
    this.log("info", "Liste de jeux appliquée", { reason, appIds });
    this.emit("status");
  }

  async setManualStandby(enabled: boolean) {
    if (enabled) {
      this.enterStandby("Standby manuel activé", null);
      await this.notify("Idle en standby manuel.", "warn");
      return;
    }

    this.standbyReason = null;
    this.realPlayingAppId = null;
    await this.applyGames("standby-disabled");
    if (this.desiredRunning && this.connected) {
      this.phase = "running";
    }
    this.emit("status");
    await this.notify("Standby manuel désactivé, idle repris.", "success");
  }

  submitSteamGuardCode(code: string) {
    if (!this.pendingSteamGuard) {
      throw new Error("Aucun code Steam Guard n'est attendu.");
    }

    const request = this.pendingSteamGuard;
    this.clearSteamGuardRequest();
    request.callback(code.trim());
    this.log("info", "Code Steam Guard transmis");
  }

  setAutoRestart(enabled: boolean) {
    if (enabled && this.hasSteamGuard) {
      throw new Error("Impossible d'activer l'auto-restart.\n- Ce compte a le Steam Guard activé, l'auto-restart nécessite une connexion sans code.");
    }
    this.autoRestartEnabled = enabled;
  }

  private bindClient(client: SteamUser) {
    // Suit si steamGuard a été demandé pendant ce login — pour mettre à jour has_steam_guard
    let steamGuardFiredThisLogin = false;

    client.on("loggedOn", () => {
      if (client !== this.client) return;

      this.connected = true;
      this.clearSteamGuardRequest();
      this.phase = "running";
      this.reconnectAttempt = 0;
      this.nextRestartAt = null;
      this.lastError = null;
      client.setPersona(SteamUser.EPersonaState.Online);
      this.log("info", "Connecté à Steam");

      // Mise à jour du flag Steam Guard en DB selon ce login
      const hadSteamGuard = steamGuardFiredThisLogin;
      steamGuardFiredThisLogin = false;
      this.hasSteamGuard = hadSteamGuard;
      if (hadSteamGuard) {
        this.autoRestartEnabled = false;
      }
      this.accounts
        .updateSteamGuardStatus(this.discordUserId, hadSteamGuard)
        .catch((err: unknown) => this.logger.warn({ err }, "Mise à jour Steam Guard échouée"));

      this.applyGames("logged-on").catch((error: unknown) => {
        this.handleFatal("Impossible d'appliquer les jeux", error);
      });

      this.emit("status");
    });

    client.on("steamGuard", (domain, callback, lastCodeWrong) => {
      if (client !== this.client) return;

      steamGuardFiredThisLogin = true;
      this.setSteamGuardRequest(callback, { domain, lastCodeWrong });
      this.phase = "starting";
      this.log("warn", "Code Steam Guard requis", { domain, lastCodeWrong });
      this.notify(
        lastCodeWrong
          ? "Code Steam Guard incorrect. Utilise `/idle start` pour en saisir un nouveau."
          : "Code Steam Guard requis. Utilise `/idle start` pour ouvrir le modal et saisir le code.",
        "warn",
      ).catch((error: unknown) =>
        this.logger.warn({ error }, "Notification Steam Guard échouée"),
      );
      this.emit("status");
    });

    client.on("playingState", (blocked, playingApp) => {
      if (client !== this.client) return;

      if (!blocked) {
        if (this.phase === "standby") {
          this.standbyReason = null;
          this.realPlayingAppId = null;
          this.phase = "running";
          this.applyGames("playing-state-unblocked").catch((error: unknown) => {
            this.handleFatal("Impossible de reprendre l'idle", error);
          });
        }
        return;
      }

      this.enterStandby(`Une autre session joue déjà à ${playingApp}`, playingApp);
      this.notify(
        `Idle mis en standby : tu joues à l'app ${playingApp} sur une autre session. Reprise auto quand Steam libère la session.`,
        "warn",
      ).catch((error: unknown) =>
        this.logger.warn({ error }, "Notification standby échouée"),
      );
    });

    client.on("disconnected", (eresult, message) => {
      if (client !== this.client) return;

      const reason = message || SteamUser.EResult[eresult] || String(eresult);
      this.client = null;
      this.connected = false;
      this.clearSteamGuardRequest();

      if (this.intentionalStop) {
        this.phase = "stopped";
        this.emit("status");
        return;
      }

      this.lastError = `Déconnexion Steam: ${reason}`;
      this.log("warn", this.lastError, { eresult, message });
      this.scheduleRestart(this.lastError);
    });

    client.on("error", (error) => {
      if (client !== this.client) return;

      this.client = null;
      this.connected = false;
      this.clearSteamGuardRequest();
      this.lastError = error.message;
      this.log("error", "Erreur Steam", {
        message: error.message,
        eresult: error.eresult,
      });

      if (this.isUnrecoverableLoginError(error.eresult)) {
        this.handleUnrecoverableSteamError(
          `Erreur Steam non récupérable: ${error.message}`,
          { message: error.message, eresult: error.eresult },
        );
        return;
      }

      if (error.eresult === SteamUser.EResult.RateLimitExceeded) {
        this.scheduleRateLimitBackoff(`Erreur Steam: ${error.message}`);
        return;
      }

      this.scheduleRestart(`Erreur Steam: ${error.message}`);
    });
  }

  private enterStandby(reason: string, playingApp: number | null) {
    this.phase = "standby";
    this.standbyReason = reason;
    this.realPlayingAppId = playingApp;

    if (this.client && this.connected) {
      this.client.gamesPlayed([]);
    }

    this.log("warn", "Idle en standby", { reason, playingApp });
    this.scheduleResumeProbe();
    this.emit("status");
  }

  private scheduleResumeProbe() {
    this.clearResumeTimer();
    if (!this.desiredRunning) return;

    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (!this.desiredRunning || !this.client || !this.connected) return;

      this.log("info", "Probe de reprise idle", {});
      this.standbyReason = null;
      this.realPlayingAppId = null;
      this.phase = "running";
      this.applyGames("standby-probe").catch((error: unknown) => {
        this.handleFatal("Probe de reprise échoué", error);
      });
    }, this.config.steam.playScanIntervalMs);
  }

  private scheduleRestart(reason: string) {
    if (!this.desiredRunning || !this.autoRestartEnabled) {
      this.phase = "error";
      this.emit("status");
      this.notify(
        `Idle arrêté: ${reason}. Auto-restart désactivé${this.hasSteamGuard ? " (Steam Guard actif)" : ""}.`,
        "error",
      ).catch((error: unknown) =>
        this.logger.warn({ error }, "Notification échouée"),
      );
      return;
    }

    this.phase = "restarting";
    this.reconnectAttempt += 1;
    const delayMs = this.restartDelayMs(this.reconnectAttempt);
    this.nextRestartAt = new Date(Date.now() + delayMs);
    this.emit("status");

    this.notify(
      `Idle arrêté: ${reason}. Auto-restart tentative ${this.reconnectAttempt} dans ${Math.round(delayMs / 1000)}s.`,
      "warn",
    ).catch((error: unknown) =>
      this.logger.warn({ error }, "Notification auto-restart échouée"),
    );

    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.client = null;
      this.connected = false;
      this.start("auto-restart").catch((error: unknown) => {
        this.handleFatal("Auto-restart échoué", error);
      });
    }, delayMs);
  }

  private scheduleRateLimitBackoff(reason: string) {
    this.phase = "restarting";
    this.reconnectAttempt += 1;
    this.nextRestartAt = new Date(Date.now() + STEAM_RATE_LIMIT_BACKOFF_MS);
    this.emit("status");

    this.notify(
      `${reason}. Steam a rate-limit le login — pause de 60 min avant nouvelle tentative.`,
      "warn",
    ).catch((error: unknown) =>
      this.logger.warn({ error }, "Notification rate-limit échouée"),
    );

    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.client = null;
      this.connected = false;
      this.start("rate-limit-backoff").catch((error: unknown) => {
        this.handleFatal("Relance après rate-limit échouée", error);
      });
    }, STEAM_RATE_LIMIT_BACKOFF_MS);
  }

  private restartDelayMs(attempt: number) {
    const seconds = [10, 30, 60, 300][Math.min(attempt - 1, 3)] ?? 900;
    return seconds * 1000;
  }

  private isDryRun() {
    return this.config.dryRun;
  }

  private clearRestartTimer() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private clearResumeTimer() {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  private setSteamGuardRequest(callback: (code: string) => void, meta: unknown) {
    this.clearSteamGuardRequest();
    const requestedAt = new Date();
    const timer = setTimeout(() => {
      this.clearSteamGuardRequest();
      this.lastError = "Code Steam Guard expiré";
      this.phase = "error";
      this.connected = false;
      this.desiredRunning = false;
      this.intentionalStop = true;
      this.client?.logOff();
      this.client = null;
      this.emit("status");
      this.log("warn", "Code Steam Guard expiré", meta);
      this.notify("Code Steam Guard expiré. Relance `/idle start`.", "error").catch(
        (error: unknown) =>
          this.logger.warn({ error }, "Notification expiration Steam Guard échouée"),
      );
    }, STEAM_GUARD_TIMEOUT_MS);

    this.pendingSteamGuard = { callback, requestedAt, timer };
  }

  private clearSteamGuardRequest() {
    if (this.pendingSteamGuard) {
      clearTimeout(this.pendingSteamGuard.timer);
      this.pendingSteamGuard = null;
    }
  }

  private handleFatal(message: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    this.lastError = `${message}: ${detail}`;
    this.log("error", this.lastError);
    this.scheduleRestart(this.lastError);
  }

  private handleUnrecoverableSteamError(message: string, meta?: unknown) {
    this.clearRestartTimer();
    this.clearSteamGuardRequest();
    this.desiredRunning = false;
    this.intentionalStop = true;
    this.connected = false;
    this.phase = "error";
    this.lastError = message;
    this.client?.logOff();
    this.client = null;
    this.emit("status");
    this.log("error", message, meta);
    this.notify(`${message} Auto-restart stoppé.`, "error").catch((error: unknown) =>
      this.logger.warn({ error }, "Notification erreur non récupérable échouée"),
    );
  }

  private isUnrecoverableLoginError(eresult?: SteamUser.EResult) {
    return (
      eresult === SteamUser.EResult.InvalidLoginAuthCode ||
      eresult === SteamUser.EResult.TwoFactorCodeMismatch ||
      eresult === SteamUser.EResult.ExpiredLoginAuthCode ||
      eresult === SteamUser.EResult.TimeNotSynced ||
      eresult === SteamUser.EResult.InvalidPassword ||
      eresult === SteamUser.EResult.AccountLoginDeniedNeedTwoFactor
    );
  }

  private log(level: "info" | "warn" | "error", message: string, meta?: unknown) {
    this.events.add(this.discordUserId, level, message, meta).catch(() => {});
    this.logger[level]({ discordUserId: this.discordUserId, meta }, message);
  }

  private async notify(message: string, type?: Parameters<Notifier["send"]>[1]) {
    await this.notifier.send(message, type);
  }
}
