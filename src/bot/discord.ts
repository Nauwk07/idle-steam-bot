import {
  ActionRowBuilder,
  ActivityType,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import type { AppConfig } from "../config";
import type {
  GuildConfigRepository,
  UserAccountRepository,
  UserEventsRepository,
  UserGamesRepository,
} from "../db/repositories";
import type { AppLogger } from "../logger";
import type { LogChannelService } from "../services/logChannel";
import type { UserIdleManager } from "../services/userIdleManager";
import {
  getSteamAppName,
  searchSteamStore,
  type SteamSearchResult,
} from "../services/steamStore";
import { SteamIdleService, type IdleStatus } from "../steam/steamIdleService";
import { encrypt } from "../utils/encryption";
import { responseEmbed, panelEmbed, type EmbedType } from "../utils/embeds";
import { formatBoolean } from "../utils/format";
import { createBotLog, logCommand, type BotLog } from "../utils/log";
import { commandDefinitions } from "./commands";

const MODAL_STEAM_GUARD_PREFIX = "steamguard";
const MODAL_ACCOUNT_SETUP_ID = "account_setup";
const INPUT_SG_CODE = "steamguard_code";
const INPUT_STEAM_USERNAME = "steam_username";
const INPUT_STEAM_PASSWORD = "steam_password";

export function createDiscordClient() {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

export class DiscordBot {
  private readonly log: BotLog;

  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly idleManager: UserIdleManager,
    private readonly accounts: UserAccountRepository,
    private readonly games: UserGamesRepository,
    private readonly events: UserEventsRepository,
    private readonly guildConfig: GuildConfigRepository,
    private readonly logChannel: LogChannelService,
    private readonly logger: AppLogger,
  ) {
    this.log = createBotLog(logger);
  }

  async start() {
    this.client.once(Events.ClientReady, async (readyClient) => {
      this.logger.info(`Connecté en tant que ${readyClient.user.tag}`);
      readyClient.user.setActivity("idle Steam", { type: ActivityType.Custom });
      await this.registerGuildCommands();
      this.logger.info("Commandes synchronisées, bot opérationnel");
      await this.notifyOwnerStartup(readyClient.user.tag);
      await this.logChannel.send(`Bot démarré — \`${readyClient.user.tag}\``, "success");
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.handleInteraction(interaction);
        return;
      }
      if (interaction.isModalSubmit()) {
        await this.handleModal(interaction);
      }
    });

    await this.client.login(this.config.discord.token);
  }

  // ─── Bootstrap ──────────────────────────────────────────────

  private async registerGuildCommands() {
    const guild = await this.client.guilds.fetch(this.config.discord.guildId);
    await guild.commands.set(commandDefinitions);
    this.log("info", "Commandes synchronisées", { guildId: guild.id, count: commandDefinitions.length });
  }

  private async notifyOwnerStartup(botTag: string) {
    try {
      const owner = await this.client.users.fetch(this.config.discord.ownerId);
      await owner.send({
        embeds: [
          panelEmbed(
            this.client,
            "Idle Steam démarré",
            [`**Bot** : \`${botTag}\``, "Commandes synchronisées."].join("\n"),
            "success",
          ),
        ],
      });
    } catch {
      this.logger.warn("Impossible d'envoyer le DM de démarrage au owner");
    }
  }

  // ─── Access control ──────────────────────────────────────────

  private isOwner(userId: string) {
    return userId === this.config.discord.ownerId;
  }

  private async hasAccess(interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (this.isOwner(interaction.user.id)) return true;

    const cfg = await this.guildConfig.get(this.config.discord.guildId);
    if (!cfg?.allowedRoleId) return false;

    const member = interaction.member;
    if (!(member instanceof GuildMember)) return false;

    return member.roles.cache.has(cfg.allowedRoleId);
  }

  // ─── Interaction router ──────────────────────────────────────

  private async handleInteraction(interaction: ChatInputCommandInteraction) {
    try {
      logCommand(this.log, interaction, "received");

      if (interaction.commandName === "config") {
        await this.handleConfig(interaction);
        return;
      }

      if (!(await this.hasAccess(interaction))) {
        await this.replyEphemeral(interaction, "error", "Accès refusé", "Tu n'as pas le rôle requis pour utiliser ce bot.");
        return;
      }

      if (interaction.commandName === "account") {
        await this.handleAccount(interaction);
      } else if (interaction.commandName === "idle") {
        await this.handleIdle(interaction);
      } else if (interaction.commandName === "game") {
        await this.handleGame(interaction);
      }

      logCommand(this.log, interaction, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error }, "Commande Discord échouée");
      logCommand(this.log, interaction, "error", { error: message });
      await this.replyEphemeral(interaction, "error", "Erreur", `- **Message** : ${message}`);
    }
  }

  private async handleModal(interaction: ModalSubmitInteraction) {
    try {
      if (interaction.customId === MODAL_ACCOUNT_SETUP_ID) {
        await this.handleAccountSetupModal(interaction);
        return;
      }
      if (interaction.customId.startsWith(`${MODAL_STEAM_GUARD_PREFIX}:`)) {
        await this.handleSteamGuardModal(interaction);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error }, "Modal Discord échoué");
      await interaction.reply({
        embeds: [responseEmbed(this.client, "error", `Erreur : ${message}`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ─── /config ─────────────────────────────────────────────────

  private async handleConfig(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!guild) {
      await this.replyEphemeral(interaction, "error", "Erreur", "Cette commande doit être utilisée dans un serveur.");
      return;
    }

    if (sub === "status") {
      const cfg = await this.guildConfig.get(guild.id);
      const lines = [
        `- **Rôle autorisé** : ${cfg?.allowedRoleId ? `<@&${cfg.allowedRoleId}>` : "non configuré"}`,
        `- **Channel de logs** : ${cfg?.logChannelId ? `<#${cfg.logChannelId}>` : "non configuré"}`,
      ];
      await this.replyEphemeral(interaction, "info", "Configuration", lines.join("\n"));
      return;
    }

    if (!this.isOwner(interaction.user.id)) {
      await this.replyEphemeral(interaction, "error", "Accès refusé", "Réservé au owner du bot.");
      return;
    }

    if (sub === "role") {
      const role = interaction.options.getRole("role", true);
      await this.guildConfig.setAllowedRole(guild.id, role.id);
      this.log("info", "Rôle autorisé configuré", { guildId: guild.id, roleId: role.id });
      await this.replyEphemeral(interaction, "success", "Rôle configuré", `- **Rôle** : <@&${role.id}>`);
      return;
    }

    if (sub === "log-channel") {
      const channel = interaction.options.getChannel("channel", true);
      if (channel.type !== ChannelType.GuildText) {
        await this.replyEphemeral(interaction, "error", "Erreur", "Le channel doit être un salon texte.");
        return;
      }
      await this.guildConfig.setLogChannel(guild.id, channel.id);
      this.log("info", "Channel de logs configuré", { guildId: guild.id, channelId: channel.id });
      await this.replyEphemeral(interaction, "success", "Channel de logs configuré", `- **Channel** : <#${channel.id}>`);
    }
  }

  // ─── /account ────────────────────────────────────────────────

  private async handleAccount(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "setup") {
      await this.showAccountSetupModal(interaction);
      return;
    }

    if (sub === "status") {
      const account = await this.accounts.findById(interaction.user.id);
      if (!account) {
        await this.replyEphemeral(interaction, "warn", "Compte Steam", "Aucun compte enregistré.\n- Utilise `/account setup` pour en configurer un.");
        return;
      }
      const lines = [
        `- **Identifiant Steam** : \`${account.steamUsername}\``,
        `- **Steam Guard** : ${formatBoolean(account.hasSteamGuard)}`,
        `- **Auto-restart** : ${formatBoolean(account.autoRestartEnabled)}`,
        `- **Enregistré le** : ${account.createdAt.toLocaleString("fr-FR")}`,
      ];
      await this.replyEphemeral(interaction, "info", "Ton compte Steam", lines.join("\n"));
      return;
    }

    if (sub === "delete") {
      const account = await this.accounts.findById(interaction.user.id);
      if (!account) {
        await this.replyEphemeral(interaction, "warn", "Compte Steam", "Aucun compte à supprimer.");
        return;
      }
      await this.idleManager.destroySession(interaction.user.id);
      await this.accounts.delete(interaction.user.id);
      this.log("info", "Compte Steam supprimé", { userId: interaction.user.id, username: account.steamUsername });
      await this.logChannel.send(`Compte supprimé par <@${interaction.user.id}> (\`${account.steamUsername}\`)`, "warn");
      await this.replyEphemeral(interaction, "success", "Compte supprimé", `Compte \`${account.steamUsername}\` et tous tes jeux ont été supprimés.`);
    }
  }

  private async showAccountSetupModal(interaction: ChatInputCommandInteraction) {
    const existing = await this.accounts.findById(interaction.user.id);

    const modal = new ModalBuilder()
      .setCustomId(MODAL_ACCOUNT_SETUP_ID)
      .setTitle(existing ? "Mettre à jour ton compte Steam" : "Enregistrer ton compte Steam");

    const usernameInput = new TextInputBuilder()
      .setCustomId(INPUT_STEAM_USERNAME)
      .setLabel("Identifiant Steam")
      .setPlaceholder("mon_compte_steam")
      .setMinLength(2)
      .setMaxLength(64)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    if (existing) usernameInput.setValue(existing.steamUsername);

    const passwordInput = new TextInputBuilder()
      .setCustomId(INPUT_STEAM_PASSWORD)
      .setLabel("Mot de passe Steam")
      .setPlaceholder("••••••••")
      .setMinLength(6)
      .setMaxLength(128)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput),
    );

    await interaction.showModal(modal);
  }

  private async handleAccountSetupModal(interaction: ModalSubmitInteraction) {
    const steamUsername = interaction.fields.getTextInputValue(INPUT_STEAM_USERNAME).trim();
    const steamPassword = interaction.fields.getTextInputValue(INPUT_STEAM_PASSWORD);

    const { encrypted, iv } = encrypt(steamPassword, this.config.encryptionKey);

    await this.accounts.upsert({
      discordUserId: interaction.user.id,
      guildId: this.config.discord.guildId,
      steamUsername,
      encryptedPassword: encrypted,
      encryptionIv: iv,
    });

    // Recrée la session avec les nouveaux credentials
    this.idleManager.createSession(
      interaction.user.id,
      steamUsername,
      encrypted,
      iv,
    );

    this.log("info", "Compte Steam enregistré", { userId: interaction.user.id, steamUsername });
    await this.logChannel.send(`Nouveau compte enregistré par <@${interaction.user.id}> (\`${steamUsername}\`)`, "info");

    await interaction.reply({
      embeds: [
        responseEmbed(
          this.client,
          "success",
          `Compte \`${steamUsername}\` enregistré.\n- Lance \`/idle start\` pour démarrer l'idle.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─── /idle ───────────────────────────────────────────────────

  private async handleIdle(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === "start") {
      if (!this.config.dryRun) {
        await this.showSteamGuardModal(interaction, "start");
        return;
      }
      const service = await this.idleManager.getOrCreate(userId);
      await service.start("discord-command");
      await this.replyEphemeral(interaction, "success", "Idle démarré", "L'idle est en cours de démarrage.");
      return;
    }

    if (sub === "stop") {
      const service = await this.idleManager.getOrCreate(userId);
      await service.stop("discord-command");
      await this.replyEphemeral(interaction, "success", "Idle arrêté", "L'idle a été arrêté.");
      return;
    }

    if (sub === "restart") {
      await this.showSteamGuardModal(interaction, "restart");
      return;
    }

    if (sub === "status") {
      await this.replyEphemeral(interaction, "info", "Statut Idle", await this.formatStatus(userId));
      return;
    }

    if (sub === "logs") {
      const limit = interaction.options.getInteger("limit") ?? 20;
      const rows = await this.events.recent(userId, limit);
      const text = rows.length === 0
        ? "Aucun log."
        : rows
            .map((row) => {
              const date = row.createdAt.toLocaleString("fr-FR");
              return `- ${formatLogLevel(row.level)} **${row.message}** — ${date}`;
            })
            .join("\n")
            .slice(0, 3900);
      await this.replyEphemeral(interaction, "info", "Logs", text);
      return;
    }

    if (sub === "standby") {
      const active = interaction.options.getBoolean("active", true);
      const service = await this.idleManager.getOrCreate(userId);
      await service.setManualStandby(active);
      await this.replyEphemeral(interaction, "success", "Standby", `- **État** : ${active ? "activé" : "désactivé"}`);
      return;
    }

    if (sub === "autorestart") {
      const active = interaction.options.getBoolean("active", true);
      const service = await this.idleManager.getOrCreate(userId);
      service.setAutoRestart(active);
      await this.accounts.setAutoRestart(userId, active);
      await this.replyEphemeral(interaction, "success", "Auto-restart", `- **État** : ${active ? "activé" : "désactivé"}`);
    }
  }

  private async showSteamGuardModal(
    interaction: ChatInputCommandInteraction,
    action: "start" | "restart",
  ) {
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_STEAM_GUARD_PREFIX}:${action}:${interaction.user.id}`)
      .setTitle(action === "restart" ? "Redémarrer l'idle" : "Démarrer l'idle");

    const codeInput = new TextInputBuilder()
      .setCustomId(INPUT_SG_CODE)
      .setLabel("Code Steam Guard (laisse vide si non requis)")
      .setPlaceholder("12345")
      .setMinLength(0)
      .setMaxLength(8)
      .setRequired(false)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput));
    await interaction.showModal(modal);
  }

  private async handleSteamGuardModal(interaction: ModalSubmitInteraction) {
    const parts = interaction.customId.split(":");
    const action = parts[1] as "start" | "restart";
    const userId = parts[2];

    if (interaction.user.id !== userId) {
      await interaction.reply({
        embeds: [responseEmbed(this.client, "error", "Ce modal ne t'est pas destiné.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const code = interaction.fields.getTextInputValue(INPUT_SG_CODE).trim() || undefined;
      const service = await this.idleManager.getOrCreate(userId);

      if (action === "restart") {
        await service.restart("discord-modal", code);
      } else {
        await service.start("discord-modal", code);
      }

      const result = await this.waitForIdleResult(service);
      const status = service.getStatus();

      if (result === "running") {
        await interaction.editReply({
          embeds: [panelEmbed(this.client, "Idle démarré", await this.formatStatus(userId), "success")],
        });
      } else if (result === "steam-guard") {
        await interaction.editReply({
          embeds: [responseEmbed(this.client, "warn", "Code Steam Guard requis.\n- Relance `/idle start` et saisis le code reçu par email ou l'appli Steam.")],
        });
      } else {
        await interaction.editReply({
          embeds: [responseEmbed(this.client, "error", `Connexion échouée.\n- ${status.lastError ?? "Erreur inconnue."}`)],
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await interaction.editReply({
        embeds: [responseEmbed(this.client, "error", `Erreur.\n- ${message}`)],
      });
    }
  }

  private waitForIdleResult(
    service: SteamIdleService,
    timeoutMs = 20_000,
  ): Promise<"running" | "steam-guard" | "error"> {
    const current = service.getStatus();
    if (current.phase === "running") return Promise.resolve("running");
    if (current.phase === "error") return Promise.resolve("error");
    if (service.hasPendingSteamGuard()) return Promise.resolve("steam-guard");

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        service.off("status", handler);
        const s = service.getStatus();
        if (service.hasPendingSteamGuard()) resolve("steam-guard");
        else if (s.phase === "error") resolve("error");
        else resolve("running");
      }, timeoutMs);

      const handler = () => {
        const s = service.getStatus();
        if (s.phase === "running") {
          clearTimeout(timer);
          service.off("status", handler);
          resolve("running");
        } else if (s.phase === "error") {
          clearTimeout(timer);
          service.off("status", handler);
          resolve("error");
        } else if (service.hasPendingSteamGuard()) {
          clearTimeout(timer);
          service.off("status", handler);
          resolve("steam-guard");
        }
      };

      service.on("status", handler);
    });
  }

  // ─── /game ───────────────────────────────────────────────────

  private async handleGame(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === "add") {
      const appId = interaction.options.getInteger("appid", true);
      const providedName = interaction.options.getString("name") ?? undefined;
      const name = providedName ?? (await getSteamAppName(appId)) ?? undefined;
      await this.games.upsert(userId, appId, name);

      const session = this.idleManager.get(userId);
      if (session) await session.applyGames("game-add");

      await this.replyEphemeral(
        interaction,
        "success",
        "Jeu ajouté",
        [`- **Nom** : ${name ? `**${name}**` : "inconnu"}`, `- **AppID** : \`${appId}\``].join("\n"),
      );
      return;
    }

    if (sub === "delete") {
      const appId = interaction.options.getInteger("appid", true);
      await this.games.remove(userId, appId);

      const session = this.idleManager.get(userId);
      if (session) await session.applyGames("game-delete");

      await this.replyEphemeral(interaction, "success", "Jeu supprimé", `- **AppID** : \`${appId}\``);
      return;
    }

    if (sub === "list") {
      const userGames = await this.games.list(userId, true);
      const text = userGames.length === 0
        ? "Aucun jeu configuré.\n- Utilise `/game add appid:<id>` pour en ajouter un."
        : [`- **Total** : \`${userGames.length}\``, "", ...userGames.map((g) => `- **${g.name ?? "Inconnu"}** — \`${g.appId}\` ${g.enabled ? "" : "_(désactivé)_"}`)]
            .join("\n")
            .slice(0, 3900);
      await this.replyEphemeral(interaction, "info", "Tes jeux", text);
      return;
    }

    if (sub === "search") {
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
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private async formatStatus(userId: string): Promise<string> {
    const account = await this.accounts.findById(userId);
    if (!account) return "Aucun compte Steam enregistré.\n- Utilise `/account setup` pour en configurer un.";

    const session = this.idleManager.get(userId);
    const status: Partial<IdleStatus> = session?.getStatus() ?? {};
    const phase = status.phase ? translatePhase(status.phase) : "non démarré";
    const gameCount = await this.games.countEnabled(userId);

    const lines = [
      `- **Idle** : ${phase}`,
      `- **Compte** : \`${account.steamUsername}\``,
      `- **Jeux** : \`${gameCount}\``,
      `- **Auto-restart** : ${formatBoolean(account.autoRestartEnabled)}`,
      `- **Steam Guard** : ${formatBoolean(account.hasSteamGuard)}`,
    ];

    if (status.standbyReason) lines.push(`- **Standby** : ${status.standbyReason}`);
    if (status.lastError) lines.push(`- **Erreur** : ${status.lastError}`);

    return lines.join("\n");
  }

  private async replyEphemeral(
    interaction: ChatInputCommandInteraction,
    type: EmbedType,
    title: string,
    description: string,
  ) {
    const embed = panelEmbed(this.client, title, description.slice(0, 3900), type);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

// ─── Formatters ──────────────────────────────────────────────

function formatSearchResults(query: string, results: SteamSearchResult[]) {
  if (results.length === 0) return `Aucun résultat Steam pour **${query}**.`;
  return [
    `**Résultats pour "${query}"**`,
    ...results.map((item) => `- **${item.name}** — \`${item.id}\``),
    "",
    "- Ajoute un jeu avec `/game add appid:<id>`",
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
  const labels: Record<string, string> = { debug: "`debug`", info: "`info`", warn: "`warn`", error: "`erreur`" };
  return labels[level] ?? `\`${level}\``;
}
