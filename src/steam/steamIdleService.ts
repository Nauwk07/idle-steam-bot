import { EventEmitter } from "node:events";

import SteamUser from "steam-user";

import type { AppConfig } from "../config";
import type { UserEventsRepository, UserGamesRepository } from "../db/repositories";
import type { AppLogger } from "../logger";
import type { Notifier } from "../services/notifier";
import {
  formatSteamDisconnect,
  formatSteamLoginError,
  formatUnrecoverableNotification,
  isRealSessionTakeover,
  isUnrecoverableLoginError,
} from "./steamErrors";

export type IdlePhase =
  | "stopped"
  | "starting"
  | "running"
  | "standby"
  | "error";

export type IdleStatus = {
  phase: IdlePhase;
  connected: boolean;
  desiredRunning: boolean;
  activeAppIds: number[];
  standbyReason: string | null;
  realPlayingAppId: number | null;
  startedAt: string | null;
  lastError: string | null;
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

export class SteamIdleService extends EventEmitter {
  private client: SteamUser | null = null;
  private phase: IdlePhase = "stopped";
  private connected = false;
  private desiredRunning = false;
  private standbyReason: string | null = null;
  private realPlayingAppId: number | null = null;
  private currentAppIds: number[] = [];
  private resumeTimer: NodeJS.Timeout | null = null;
  private pendingSteamGuard: SteamGuardRequest | null = null;
  private startedAt: Date | null = null;
  private lastError: string | null = null;
  private intentionalStop = false;
  private transitionLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly discordUserId: string,
    private readonly credentials: SteamCredentials,
    private readonly config: AppConfig,
    private readonly games: UserGamesRepository,
    private readonly events: UserEventsRepository,
    private readonly logger: AppLogger,
    private readonly notifier: Notifier,
  ) {
    super();
  }

  getStatus(): IdleStatus {
    return {
      phase: this.phase,
      connected: this.connected,
      desiredRunning: this.desiredRunning,
      activeAppIds: [...this.currentAppIds],
      standbyReason: this.standbyReason,
      realPlayingAppId: this.realPlayingAppId,
      startedAt: this.startedAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }

  hasPendingSteamGuard() {
    return this.pendingSteamGuard !== null;
  }

  /** Sérialise start/stop/restart pour éviter les races sur this.client. */
  private async runExclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.transitionLock;
    let release!: () => void;
    this.transitionLock = new Promise<void>((res) => (release = res));
    try {
      await previous;
      return await fn();
    } finally {
      this.logger.debug({ discordUserId: this.discordUserId, label }, "Transition terminée");
      release();
    }
  }

  start(reason = "manual", steamGuardCode?: string) {
    return this.runExclusive("start", () => this.startInternal(reason, steamGuardCode));
  }

  stop(reason = "manual") {
    return this.runExclusive("stop", () => this.stopInternal(reason));
  }

  restart(reason = "manual", steamGuardCode?: string) {
    return this.runExclusive("restart", async () => {
      await this.stopInternal(`restart:${reason}`);
      this.desiredRunning = true;
      this.intentionalStop = false;
      await this.startInternal(reason, steamGuardCode);
    });
  }

  private async startInternal(reason = "manual", steamGuardCode?: string) {
    this.desiredRunning = true;
    this.intentionalStop = false;
    this.standbyReason = null;
    this.realPlayingAppId = null;

    if (this.isDryRun()) {
      this.startedAt = new Date();
      this.connected = true;
      this.phase = "running";
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

  private async stopInternal(reason = "manual") {
    this.desiredRunning = false;
    this.intentionalStop = true;
    this.clearResumeTimer();
    this.clearSteamGuardRequest();
    this.standbyReason = null;
    this.realPlayingAppId = null;
    this.currentAppIds = [];

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
    this.currentAppIds = appIds;
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

  private bindClient(client: SteamUser) {
    client.on("loggedOn", () => {
      if (client !== this.client) return;

      this.connected = true;
      this.clearSteamGuardRequest();
      this.phase = "running";
      this.lastError = null;
      this.startedAt = new Date();
      client.setPersona(SteamUser.EPersonaState.Online);
      this.log("info", "Connecté à Steam");

      this.applyGames("logged-on").catch((error: unknown) => {
        this.handleFatal("Impossible d'appliquer les jeux", error);
      });

      this.emit("status");
    });

    client.on("steamGuard", (domain, callback, lastCodeWrong) => {
      if (client !== this.client) return;

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

      this.client = null;
      this.connected = false;
      this.clearSteamGuardRequest();

      if (this.intentionalStop) {
        this.phase = "stopped";
        this.emit("status");
        return;
      }

      if (isRealSessionTakeover(eresult, message)) {
        this.stopForRealPlay({ eresult, message });
        return;
      }

      const cause = formatSteamDisconnect(eresult, message);
      this.lastError = cause.summary;
      this.phase = "error";
      this.desiredRunning = false;
      this.intentionalStop = true;
      this.log("warn", "Déconnexion Steam", { eresult, message, summary: cause.summary });
      this.emit("status");
      this.notify(
        `Connexion Steam perdue : ${cause.summary}\nRelance \`/idle start\` quand les serveurs sont disponibles.`,
        "error",
        "Connexion Steam perdue",
      ).catch((error: unknown) =>
        this.logger.warn({ error }, "Notification déconnexion échouée"),
      );
    });

    client.on("error", (error) => {
      if (client !== this.client) return;

      this.client = null;
      this.connected = false;
      this.clearSteamGuardRequest();

      if (isRealSessionTakeover(error.eresult, error.message)) {
        this.stopForRealPlay({ eresult: error.eresult, message: error.message });
        return;
      }

      const cause = formatSteamLoginError(error.eresult, error.message);
      this.lastError = cause.summary;
      this.log("error", "Erreur Steam", {
        message: error.message,
        eresult: error.eresult,
        summary: cause.summary,
      });

      if (isUnrecoverableLoginError(error.eresult)) {
        this.handleUnrecoverableSteamError(cause, { message: error.message, eresult: error.eresult });
        return;
      }

      this.phase = "error";
      this.desiredRunning = false;
      this.intentionalStop = true;
      this.emit("status");
      this.notify(
        `Erreur de connexion Steam : ${cause.summary}\nRelance \`/idle start\` pour réessayer.`,
        "error",
        "Connexion Steam perdue",
      ).catch((err: unknown) =>
        this.logger.warn({ err }, "Notification erreur Steam échouée"),
      );
    });
  }

  private enterStandby(reason: string, playingApp: number | null) {
    this.phase = "standby";
    this.standbyReason = reason;
    this.realPlayingAppId = playingApp;

    if (this.client && this.connected) {
      this.client.gamesPlayed([]);
    }

    this.currentAppIds = [];
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

  private isDryRun() {
    return this.config.dryRun;
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
    this.lastError = `${message} : ${detail}`;
    this.log("error", this.lastError);
    this.phase = "error";
    this.desiredRunning = false;
    this.intentionalStop = true;
    this.connected = false;
    this.client?.logOff();
    this.client = null;
    this.emit("status");
    this.notify(
      `Erreur inattendue : ${this.lastError}\nRelance \`/idle start\`.`,
      "error",
      "Erreur Steam",
    ).catch((err: unknown) =>
      this.logger.warn({ err }, "Notification erreur fatale échouée"),
    );
  }

  private stopForRealPlay(meta: unknown) {
    this.clearResumeTimer();
    this.desiredRunning = false;
    this.intentionalStop = true;
    this.phase = "stopped";
    this.lastError = null;
    this.standbyReason = null;
    this.realPlayingAppId = null;
    this.emit("status");

    this.log("info", "Idle arrêté — jeu lancé pour de vrai", meta);
    this.notify(
      "Steam a repris la main sur ton compte (jeu lancé ou client ouvert ailleurs).\n\nRelance `/idle start` quand tu as fini.",
      "success",
      "🎮 Tu joues pour de vrai",
    ).catch((error: unknown) =>
      this.logger.warn({ error }, "Notification arrêt jeu réel échouée"),
    );
  }

  private handleUnrecoverableSteamError(cause: ReturnType<typeof formatSteamLoginError>, meta?: unknown) {
    this.clearSteamGuardRequest();
    this.desiredRunning = false;
    this.intentionalStop = true;
    this.connected = false;
    this.phase = "error";
    this.lastError = cause.summary;
    this.client?.logOff();
    this.client = null;
    this.emit("status");
    this.log("error", cause.summary, meta);
    this.notify(formatUnrecoverableNotification(cause), "error", "Connexion impossible").catch(
      (error: unknown) =>
        this.logger.warn({ error }, "Notification erreur non récupérable échouée"),
    );
  }

  private log(level: "info" | "warn" | "error", message: string, meta?: unknown) {
    this.events.add(this.discordUserId, level, message, meta).catch((err: unknown) => {
      this.logger.warn({ err, discordUserId: this.discordUserId }, "Échec enregistrement événement");
    });
    this.logger[level]({ discordUserId: this.discordUserId, meta }, message);
  }

  private async notify(
    message: string,
    type?: Parameters<Notifier["send"]>[1],
    title?: Parameters<Notifier["send"]>[2],
  ) {
    await this.notifier.send(message, type, title);
  }
}
