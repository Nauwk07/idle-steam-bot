import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import type { AppConfig } from "../config";
import type {
  EventLogRepository,
  GamesRepository,
  SettingsRepository,
} from "../db/repositories";
import type { AppLogger } from "../logger";
import type { Notifier } from "../services/notifier";
import {
  getSteamAppName,
  searchSteamStore,
  type SteamSearchResult,
} from "../services/steamStore";
import type { IdleStatus, SteamIdleService } from "../steam/steamIdleService";
import { responseEmbed, panelEmbed, type EmbedType } from "../utils/embeds";
import { formatBoolean, formatDate, formatDuration } from "../utils/format";
import { createBotLog, logCommand, type BotLog } from "../utils/log";
import { commandDefinitions } from "./commands";

const STEAM_GUARD_MODAL_PREFIX = "steamguard";
const STEAM_GUARD_CODE_INPUT_ID = "steamguard_code";

export function createDiscordClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds],
  });
}

export class DiscordNotifier implements Notifier {
  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
  ) {}

  async send(message: string, type: EmbedType = "info") {
    const embed = responseEmbed(this.client, type, message, "Notification Idle");

    try {
      const user = await this.client.users.fetch(this.config.discord.ownerId);
      await user.send({ embeds: [embed] });
    } catch (error) {
      this.logger.warn({ error }, "Impossible d'envoyer la notification Discord en DM");
    }
  }
}

export class DiscordBot {
  private readonly operationLog: BotLog;

  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly idle: SteamIdleService,
    private readonly games: GamesRepository,
    private readonly settings: SettingsRepository,
    private readonly events: EventLogRepository,
    private readonly logger: AppLogger,
  ) {
    this.operationLog = createBotLog(events, logger);
  }

  async start() {
    this.client.once(Events.ClientReady, async (readyClient) => {
      this.operationLog("info", "Bot Discord connecté", {
        user: readyClient.user.tag,
      });
      await this.registerGuildCommands();
      await this.sendStartupDm(readyClient.user.tag);
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.handleInteraction(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        await this.handleModalInteraction(interaction);
      }
    });

    await this.client.login(this.config.discord.token);
  }

  private async registerGuildCommands() {
    const guild = await this.client.guilds.fetch(this.config.discord.guildId);
    await guild.commands.set(commandDefinitions);
    this.operationLog("info", "Commandes Discord synchronisées", {
      guildId: guild.id,
      commandCount: commandDefinitions.length,
    });
  }

  private async sendStartupDm(botTag: string) {
    const description = [
      "**Bot prêt**",
      `- **Connecté en tant que**: \`${botTag}\``,
      `- **Commandes**: synchronisées`,
      `- **Jeux configurés**: \`${this.games.countEnabled()}\``,
    ].join("\n");

    try {
      const user = await this.client.users.fetch(this.config.discord.ownerId);
      await user.send({
        embeds: [panelEmbed(this.client, "Idle Steam démarré", description, "success")],
      });
      this.operationLog("info", "Notification de démarrage envoyée en DM");
    } catch (error) {
      this.logger.warn({ error }, "Impossible d'envoyer le DM de démarrage");
    }
  }

  private async handleInteraction(interaction: ChatInputCommandInteraction) {
    if (interaction.user.id !== this.config.discord.ownerId) {
      await interaction.reply({
        embeds: [
          responseEmbed(
            this.client,
            "error",
            "Whitelist stricte propriétaire uniquement.",
            "Accès refusé",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      logCommand(this.operationLog, interaction, "received");

      if (interaction.commandName === "info") {
        await this.reply(interaction, "info", "Commandes", this.infoText());
      } else if (interaction.commandName === "idle") {
        await this.handleIdle(interaction);
      } else if (interaction.commandName === "game") {
        await this.handleGame(interaction);
      }

      logCommand(this.operationLog, interaction, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error }, "Commande Discord échouée");
      logCommand(this.operationLog, interaction, "error", { error: message });
      await this.reply(interaction, "error", "Erreur", `- **Message**: ${message}`);
    }
  }

  private async handleModalInteraction(interaction: ModalSubmitInteraction) {
    if (!interaction.customId.startsWith(`${STEAM_GUARD_MODAL_PREFIX}:`)) return;

    if (interaction.user.id !== this.config.discord.ownerId) {
      await interaction.reply({
        embeds: [
          responseEmbed(
            this.client,
            "error",
            "Whitelist stricte propriétaire uniquement.",
            "Accès refusé",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [, action] = interaction.customId.split(":");
    const code = interaction.fields.getTextInputValue(STEAM_GUARD_CODE_INPUT_ID);

    try {
      this.operationLog("info", "Code Steam Guard reçu via modal", { action });

      if (action === "restart") {
        await this.idle.restart("discord-modal", code);
      } else {
        await this.idle.start("discord-modal", code);
      }

      await this.replyModal(
        interaction,
        "success",
        action === "restart" ? "Idle redémarré" : "Idle démarré",
        await this.formatStatus(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error }, "Modal Steam Guard échoué");
      await this.replyModal(interaction, "error", "Steam Guard", `- **Message**: ${message}`);
    }
  }

  private async handleIdle(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "start") {
      if (this.shouldOpenSteamGuardModal("start")) {
        await this.showSteamGuardModal(interaction, "start");
        return;
      }

      await this.idle.start("discord-command");
      await this.reply(
        interaction,
        "success",
        "Idle démarré",
        await this.formatStatus(),
      );
      return;
    }

    if (subcommand === "stop") {
      await this.idle.stop("discord-command");
      await this.reply(interaction, "success", "Idle arrêté", await this.formatStatus());
      return;
    }

    if (subcommand === "restart") {
      if (this.shouldOpenSteamGuardModal("restart")) {
        await this.showSteamGuardModal(interaction, "restart");
        return;
      }

      await this.idle.restart("discord-command");
      await this.reply(
        interaction,
        "success",
        "Idle redémarré",
        await this.formatStatus(),
      );
      return;
    }

    if (subcommand === "status") {
      await this.reply(interaction, "info", "Statut Idle", await this.formatStatus());
      return;
    }

    if (subcommand === "doctor") {
      await this.reply(interaction, "info", "Diagnostic Idle", await this.doctorText());
      return;
    }

    if (subcommand === "logs") {
      const limit = interaction.options.getInteger("limit") ?? 20;
      await this.reply(interaction, "info", "Logs SQLite", this.formatLogs(limit));
      return;
    }

    if (subcommand === "autorestart") {
      const active = interaction.options.getBoolean("active", true);
      this.settings.setBoolean("auto_restart", active);
      this.operationLog("info", "Auto-restart modifié", { active });
      await this.reply(
        interaction,
        "success",
        "Auto-restart",
        `- **Etat**: ${active ? "activé" : "désactivé"}`,
      );
      return;
    }

    if (subcommand === "dry-run") {
      const active = interaction.options.getBoolean("active", true);
      this.settings.setBoolean("dry_run", active);
      this.operationLog("info", "Dry-run modifié", { active });
      await this.reply(
        interaction,
        "warn",
        "Dry-run",
        [
          `- **Etat**: ${active ? "activé" : "désactivé"}`,
          "- **Note**: redémarre l'idle si Steam est déjà connecté",
        ].join("\n"),
      );
      return;
    }

    if (subcommand === "standby") {
      const active = interaction.options.getBoolean("active", true);
      await this.idle.setManualStandby(active);
      this.operationLog("info", "Standby manuel modifié", { active });
      await this.reply(
        interaction,
        "success",
        "Standby manuel",
        `- **Etat**: ${active ? "activé" : "désactivé"}`,
      );
    }
  }

  private async handleGame(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "add") {
      const appId = interaction.options.getInteger("appid", true);
      const providedName = interaction.options.getString("name") ?? undefined;
      const name = providedName ?? (await getSteamAppName(appId)) ?? undefined;
      this.games.upsert(appId, name);
      this.operationLog("info", "Jeu ajouté ou réactivé", { appId, name });
      await this.idle.applyGames("game-add");
      await this.reply(
        interaction,
        "success",
        "Jeu ajouté",
        [
          `- **Nom**: ${name ? `**${name}**` : "nom introuvable"}`,
          `- **AppID**: \`${appId}\``,
        ].join("\n"),
      );
      return;
    }

    if (subcommand === "delete") {
      const appId = interaction.options.getInteger("appid", true);
      this.games.remove(appId);
      this.operationLog("info", "Jeu supprimé", { appId });
      await this.idle.applyGames("game-delete");
      await this.reply(
        interaction,
        "success",
        "Jeu supprimé",
        `- **AppID**: \`${appId}\`\n- **Base SQLite**: supprimé`,
      );
      return;
    }

    if (subcommand === "list") {
      await this.reply(interaction, "info", "Jeux configurés", await this.formatGames());
      return;
    }

    if (subcommand === "search") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const query = interaction.options.getString("query", true);
      const results = await searchSteamStore(query);
      await interaction.editReply({
        embeds: [
          panelEmbed(
            this.client,
            "Recherche Steam",
            formatSearchResults(query, results),
            results.length > 0 ? "info" : "warn",
          ),
        ],
      });
      this.operationLog("debug", "Réponse Discord envoyée", {
        command: interaction.commandName,
        subcommand,
        title: "Recherche Steam",
        type: results.length > 0 ? "info" : "warn",
      });
    }
  }

  private infoText() {
    return [
      "**Idle**",
      "- `/idle start` - démarre l'idle",
      "- `/idle stop` - arrête l'idle",
      "- `/idle restart` - relance proprement Steam",
      "- `/idle status` - affiche l'état utile",
      "",
      "**Jeux**",
      "- `/game search query:<nom>` - cherche un AppID",
      "- `/game add appid:<id> name:<nom>` - ajoute un jeu",
      "- `/game delete appid:<id>` - supprime un jeu",
      "- `/game list` - liste les jeux configurés",
      "",
      "**Outils**",
      "- `/idle doctor` - diagnostic complet",
      "- `/idle logs limit:20` - derniers événements",
      "- `/idle autorestart active:true|false` - relance automatique",
      "- `/idle dry-run active:true|false` - mode test sans Steam",
      "- `/idle standby active:true|false` - pause manuelle",
    ].join("\n");
  }

  private async doctorText() {
    const status = this.idle.getStatus();
    const configuredGames = this.games.countEnabled();
    const checks = [
      ["Compte Discord autorisé", Boolean(this.config.discord.ownerId)],
      ["Notifications DM", true],
      ["Identifiant Steam", Boolean(this.config.steam.username)],
      ["Mot de passe Steam", Boolean(this.config.steam.password)],
      ["Jeux configurés", configuredGames > 0],
      ["Auto-restart", this.settings.getBoolean("auto_restart")],
      ["Dry-run", this.settings.getBoolean("dry_run") || this.config.dryRun],
      ["Steam connecté", status.connected],
      ["Steam Guard en attente", this.idle.hasPendingSteamGuard()],
    ] as const;

    return [
      "**Configuration**",
      ...checks.map(([label, ok]) => `- **${label}**: ${ok ? "OK" : "KO"}`),
      "",
      `- **Nombre de jeux**: \`${configuredGames}\``,
      "",
      await this.formatStatus(status),
    ].join("\n");
  }

  private formatLogs(limit: number) {
    const rows = this.events.recent(limit);
    if (rows.length === 0) return "Aucun log.";

    return rows
      .map((row) => {
        const createdAt = new Date(row.createdAt).toLocaleString("fr-FR");
        const meta = formatLogMeta(row.meta);
        return [
          `- **#${row.id}** ${formatLogLevel(row.level)} - ${createdAt}`,
          `  **${row.message}**${meta ? ` - ${meta}` : ""}`,
        ].join("\n");
      })
      .join("\n")
      .slice(0, 1900);
  }

  private async formatGames() {
    const games = this.games.list(false);
    if (games.length === 0) return "Aucun jeu configuré.";

    const lines = await this.formatGameLines(games.map((game) => game.appId));
    return [`- **Total**: \`${games.length}\``, "", ...lines].join("\n").slice(0, 1900);
  }

  private async formatStatus(status = this.idle.getStatus()) {
    const phase = translatePhase(status.phase);
    const activeGameLines = await this.formatGameLines(status.activeAppIds, 6);
    const configuredGames = this.games.countEnabled();
    const settingsLines = [
      `- **Relance auto**: ${formatBoolean(this.settings.getBoolean("auto_restart"))}`,
      `- **Mode test**: ${formatBoolean(this.settings.getBoolean("dry_run") || this.config.dryRun)}`,
    ];

    const lines = [
      "**État**",
      `- **Idle**: ${phase}`,
      `- **Steam**: ${formatBoolean(status.connected)}`,
      `- **Jeux configurés**: \`${configuredGames}\``,
      `- **Jeux actifs**: \`${status.activeAppIds.length}\``,
      "",
      "**Options**",
      ...settingsLines,
    ];

    if (activeGameLines.length > 0) {
      lines.push("", "**Jeux**", ...activeGameLines);
    }

    const runtimeLines = [
      status.standbyReason ? `- **Standby**: ${status.standbyReason}` : null,
      status.realPlayingAppId
        ? `- **Jeu lancé ailleurs**: \`${status.realPlayingAppId}\``
        : null,
      status.reconnectAttempt > 0
        ? `- **Tentative restart**: \`${status.reconnectAttempt}\``
        : null,
      status.nextRestartAt
        ? `- **Prochaine tentative**: ${formatDate(status.nextRestartAt)}`
        : null,
      status.startedAt
        ? `- **Uptime**: \`${formatDuration(Date.now() - new Date(status.startedAt).getTime())}\``
        : null,
      status.lastError ? `- **Dernière erreur**: ${status.lastError}` : null,
    ].filter((line): line is string => Boolean(line));

    if (runtimeLines.length > 0) {
      lines.push("", "**Runtime**", ...runtimeLines);
    }

    return lines.join("\n");
  }

  private async formatGameLines(appIds: number[], limit = appIds.length) {
    const displayedAppIds = appIds.slice(0, limit);
    const localGames = this.games.list(true);
    const lines = await Promise.all(
      displayedAppIds.map(async (appId) => {
        const localGame = localGames.find((game) => game.appId === appId);
        const resolvedName = localGame?.name ?? (await getSteamAppName(appId));
        if (localGame && !localGame.name && resolvedName) {
          this.games.updateName(appId, resolvedName);
        }

        return `- **${resolvedName ?? "Nom introuvable"}** - \`${appId}\``;
      }),
    );

    const remaining = appIds.length - displayedAppIds.length;
    if (remaining > 0) {
      lines.push(`- ...et \`${remaining}\` autre${remaining > 1 ? "s" : ""}`);
    }

    return lines;
  }

  private async reply(
    interaction: ChatInputCommandInteraction,
    type: EmbedType,
    title: string,
    description: string,
  ) {
    const embed = panelEmbed(this.client, title, description.slice(0, 3900), type);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
      this.logReply(interaction, title, type);
      return;
    }

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
    this.logReply(interaction, title, type);
  }

  private async replyModal(
    interaction: ModalSubmitInteraction,
    type: EmbedType,
    title: string,
    description: string,
  ) {
    await interaction.reply({
      embeds: [panelEmbed(this.client, title, description.slice(0, 3900), type)],
      flags: MessageFlags.Ephemeral,
    });
    this.operationLog("debug", "Réponse modal Discord envoyée", {
      customId: interaction.customId,
      title,
      type,
    });
  }

  private shouldOpenSteamGuardModal(action: "start" | "restart") {
    if (this.config.dryRun || this.settings.getBoolean("dry_run")) return false;
    if (action === "restart") return true;
    const status = this.idle.getStatus();
    return this.idle.hasPendingSteamGuard() || !status.connected;
  }

  private async showSteamGuardModal(
    interaction: ChatInputCommandInteraction,
    action: "start" | "restart",
  ) {
    const modal = new ModalBuilder()
      .setCustomId(`${STEAM_GUARD_MODAL_PREFIX}:${action}`)
      .setTitle(action === "restart" ? "Redémarrer l'idle" : "Démarrer l'idle");

    const codeInput = new TextInputBuilder()
      .setCustomId(STEAM_GUARD_CODE_INPUT_ID)
      .setLabel("Code Steam Guard")
      .setPlaceholder("12345")
      .setMinLength(5)
      .setMaxLength(8)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput),
    );

    await interaction.showModal(modal);
    this.operationLog("debug", "Modal Steam Guard ouvert", {
      command: interaction.commandName,
      subcommand: interaction.options.getSubcommand(false),
      action,
    });
  }

  private logReply(
    interaction: ChatInputCommandInteraction,
    title: string,
    type: EmbedType,
  ) {
    this.operationLog("debug", "Réponse Discord envoyée", {
      command: interaction.commandName,
      subcommand: interaction.options.getSubcommand(false),
      title,
      type,
    });
  }
}

function formatSearchResults(query: string, results: SteamSearchResult[]) {
  if (results.length === 0) {
    return `Aucun résultat Steam pour **${query}**.`;
  }

  return [
    `**Résultats pour ${query}**`,
    ...results.map((item) => `- **${item.name}** - \`${item.id}\``),
    "",
    "**Suite**",
    "- Ajoute ensuite avec `/game add appid:<id> name:<nom>`",
  ].join("\n");
}

function translatePhase(phase: IdleStatus["phase"]) {
  const labels: Record<IdleStatus["phase"], string> = {
    stopped: "arrêté",
    starting: "démarrage",
    running: "actif",
    standby: "standby",
    restarting: "relance en cours",
    error: "erreur",
  };
  return labels[phase];
}

function formatLogLevel(level: string) {
  const labels: Record<string, string> = {
    debug: "`debug`",
    info: "`info`",
    warn: "`warning`",
    error: "`erreur`",
  };
  return labels[level] ?? `\`${level}\``;
}

function formatLogMeta(meta: string | null) {
  if (!meta) return "";

  try {
    const parsed = JSON.parse(meta) as Record<string, unknown>;
    const parts = [
      typeof parsed.reason === "string" ? `raison: \`${parsed.reason}\`` : null,
      Array.isArray(parsed.appIds)
        ? `jeux: ${parsed.appIds.map((id) => `\`${id}\``).join(", ")}`
        : null,
      typeof parsed.appId === "number" ? `appid: \`${parsed.appId}\`` : null,
      typeof parsed.name === "string" ? `jeu: **${parsed.name}**` : null,
      typeof parsed.message === "string" ? `détail: ${parsed.message}` : null,
      typeof parsed.eresult === "number" ? `eresult: \`${parsed.eresult}\`` : null,
    ].filter((part): part is string => Boolean(part));

    return parts.join(" - ");
  } catch {
    return "";
  }
}
