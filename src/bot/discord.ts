import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  ComponentType,
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
  AuditRepository,
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
import { brandedEmbed, type EmbedType } from "../utils/embeds";
import { formatDuration } from "../utils/format";
import { createBotLog, logCommand, type BotLog } from "../utils/log";
import { commandDefinitions } from "./commands";
import {
  resolveModalHandler,
  resolveSubHandler,
  type CommandMap,
  type ModalHandler,
} from "./dispatch";

const MODAL_STEAM_GUARD_PREFIX = "steamguard";
const MODAL_ACCOUNT_SETUP_ID = "account_setup";
const INPUT_SG_CODE = "steamguard_code";
const GAMES_PER_PAGE = 10;
const GAME_LIST_BTN_PREV = "game:list:prev";
const GAME_LIST_BTN_NEXT = "game:list:next";
const INPUT_STEAM_USERNAME = "steam_username";
const INPUT_STEAM_PASSWORD = "steam_password";

export function createDiscordClient() {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

export class DiscordBot {
  private readonly log: BotLog;
  private readonly commands: CommandMap;
  private readonly modals: ModalHandler[];

  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly idleManager: UserIdleManager,
    private readonly accounts: UserAccountRepository,
    private readonly games: UserGamesRepository,
    private readonly events: UserEventsRepository,
    private readonly audit: AuditRepository,
    private readonly guildConfig: GuildConfigRepository,
    private readonly logChannel: LogChannelService,
    private readonly logger: AppLogger,
  ) {
    this.log = createBotLog(logger);
    this.commands = this.buildCommandMap();
    this.modals = this.buildModalHandlers();
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
          brandedEmbed(
            this.client,
            "success",
            [`**Bot** : \`${botTag}\``, "Commandes synchronisées."].join("\n"),
            "Idle Steam démarré",
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
    if (interaction.guildId !== this.config.discord.guildId) return false;

    const cfg = await this.guildConfig.get(this.config.discord.guildId);
    if (!cfg?.allowedRoleId) return false;

    const member = interaction.member;
    if (!(member instanceof GuildMember)) return false;

    return member.roles.cache.has(cfg.allowedRoleId);
  }

  // ─── Dispatch ───────────────────────────────────────────────

  private buildCommandMap(): CommandMap {
    return {
      config: {
        status: { fn: (i) => this.configStatus(i), publicAccess: true },
        role: { fn: (i) => this.configSetRole(i), ownerOnly: true, publicAccess: true },
        "log-channel": { fn: (i) => this.configSetLogChannel(i), ownerOnly: true, publicAccess: true },
      },
      account: {
        setup: { fn: (i) => this.accountSetup(i) },
        status: { fn: (i) => this.accountStatus(i) },
        delete: { fn: (i) => this.accountDelete(i) },
      },
      idle: {
        start: { fn: (i) => this.idleStart(i) },
        stop: { fn: (i) => this.idleStop(i) },
        restart: { fn: (i) => this.idleRestart(i) },
        status: { fn: (i) => this.idleStatus(i) },
        logs: { fn: (i) => this.idleLogs(i) },
        standby: { fn: (i) => this.idleStandby(i) },
      },
      game: {
        add: { fn: (i) => this.gameAdd(i) },
        delete: { fn: (i) => this.gameDelete(i) },
        list: { fn: (i) => this.gameList(i) },
        search: { fn: (i) => this.gameSearch(i) },
      },
      audit: {
        list: { fn: (i) => this.auditList(i), ownerOnly: true },
      },
    };
  }

  private buildModalHandlers(): ModalHandler[] {
    return [
      {
        match: (id) => id === MODAL_ACCOUNT_SETUP_ID,
        fn: (i) => this.handleAccountSetupModal(i),
      },
      {
        match: (id) => id.startsWith(`${MODAL_STEAM_GUARD_PREFIX}:`),
        fn: (i) => this.handleSteamGuardModal(i),
      },
    ];
  }

  private async handleInteraction(interaction: ChatInputCommandInteraction) {
    try {
      logCommand(this.log, interaction, "received");

      const sub = interaction.options.getSubcommand(false);
      const handler = sub ? resolveSubHandler(this.commands, interaction.commandName, sub) : null;
      if (!handler) {
        await this.replyEphemeral(interaction, "warn", "Commande inconnue", "Cette sous-commande n'existe pas.");
        return;
      }

      if (!handler.publicAccess && !(await this.hasAccess(interaction))) {
        await this.replyEphemeral(interaction, "error", "Accès refusé", "Tu n'as pas le rôle requis pour utiliser ce bot.");
        return;
      }

      if (handler.ownerOnly && !this.isOwner(interaction.user.id)) {
        await this.replyEphemeral(interaction, "error", "Accès refusé", "Réservé au owner du bot.");
        return;
      }

      await handler.fn(interaction);
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
      const handler = resolveModalHandler(this.modals, interaction.customId);
      if (handler) await handler.fn(interaction);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error }, "Modal Discord échoué");
      await interaction.reply({
        embeds: [brandedEmbed(this.client, "error", `Erreur : ${message}`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ─── /config ─────────────────────────────────────────────────

  private async configStatus(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyEphemeral(interaction, "error", "Erreur", "Cette commande doit être utilisée dans un serveur.");
      return;
    }
    const cfg = await this.guildConfig.get(guild.id);
    const lines = [
      `- **Rôle autorisé** : ${cfg?.allowedRoleId ? `<@&${cfg.allowedRoleId}>` : "non configuré"}`,
      `- **Channel de logs** : ${cfg?.logChannelId ? `<#${cfg.logChannelId}>` : "non configuré"}`,
    ];
    await this.replyEphemeral(interaction, "info", "Configuration", lines.join("\n"));
  }

  private async configSetRole(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) throw new Error("Cette commande doit être utilisée dans un serveur.");
    const role = interaction.options.getRole("role", true);
    await this.guildConfig.setAllowedRole(guild.id, role.id);
    await this.audit.log({
      discordUserId: interaction.user.id,
      guildId: guild.id,
      action: "config.role",
      target: role.id,
      meta: { roleName: role.name },
    });
    this.log("info", "Rôle autorisé configuré", { guildId: guild.id, roleId: role.id });
    await this.replyEphemeral(interaction, "success", "Rôle configuré", `- **Rôle** : <@&${role.id}>`);
  }

  private async configSetLogChannel(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) throw new Error("Cette commande doit être utilisée dans un serveur.");
    const channel = interaction.options.getChannel("channel", true);
    if (channel.type !== ChannelType.GuildText) {
      await this.replyEphemeral(interaction, "error", "Erreur", "Le channel doit être un salon texte.");
      return;
    }
    await this.guildConfig.setLogChannel(guild.id, channel.id);
    await this.audit.log({
      discordUserId: interaction.user.id,
      guildId: guild.id,
      action: "config.log-channel",
      target: channel.id,
      meta: { channelName: channel.name },
    });
    this.log("info", "Channel de logs configuré", { guildId: guild.id, channelId: channel.id });
    await this.replyEphemeral(interaction, "success", "Channel de logs configuré", `- **Channel** : <#${channel.id}>`);
  }

  // ─── /account ────────────────────────────────────────────────

  private async accountSetup(interaction: ChatInputCommandInteraction) {
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

  private async accountStatus(interaction: ChatInputCommandInteraction) {
    const account = await this.accounts.findById(interaction.user.id);
    if (!account) {
      await this.replyEphemeral(interaction, "warn", "Compte Steam", "Aucun compte enregistré.\n- Utilise `/account setup` pour en configurer un.");
      return;
    }
    const lines = [
      `- **Identifiant Steam** : \`${account.steamUsername}\``,
      `- **Enregistré le** : ${account.createdAt.toLocaleString("fr-FR")}`,
    ];
    await this.replyEphemeral(interaction, "info", "Ton compte Steam", lines.join("\n"));
  }

  private async accountDelete(interaction: ChatInputCommandInteraction) {
    const account = await this.accounts.findById(interaction.user.id);
    if (!account) {
      await this.replyEphemeral(interaction, "warn", "Compte Steam", "Aucun compte à supprimer.");
      return;
    }

    const ok = await this.confirm(
      interaction,
      "Supprimer ton compte Steam ?",
      `Tu vas supprimer \`${account.steamUsername}\` et **tous tes jeux**.\nCette action est irréversible.`,
    );
    if (!ok) return;

    await this.idleManager.destroySession(interaction.user.id);
    await this.accounts.delete(interaction.user.id);
    await this.audit.log({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      action: "account.delete",
      target: account.steamUsername,
    });
    this.log("info", "Compte Steam supprimé", { userId: interaction.user.id, username: account.steamUsername });
    await this.logChannel.send(`Compte supprimé par <@${interaction.user.id}> (\`${account.steamUsername}\`)`, "warn");
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

    this.idleManager.createSession(interaction.user.id, steamUsername, encrypted, iv);

    await this.audit.log({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      action: "account.setup",
      target: steamUsername,
    });
    this.log("info", "Compte Steam enregistré", { userId: interaction.user.id, steamUsername });
    await this.logChannel.send(`Nouveau compte enregistré par <@${interaction.user.id}> (\`${steamUsername}\`)`, "info");

    await interaction.reply({
      embeds: [
        brandedEmbed(
          this.client,
          "success",
          `Compte \`${steamUsername}\` enregistré.\n- Lance \`/idle start\` pour démarrer l'idle.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─── /idle ───────────────────────────────────────────────────

  private async idleStart(interaction: ChatInputCommandInteraction) {
    if (!this.config.dryRun) {
      await this.showSteamGuardModal(interaction, "start");
      return;
    }
    const service = await this.idleManager.getOrCreate(interaction.user.id);
    await service.start("discord-command");
    await this.audit.log({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      action: "idle.start",
      meta: { dryRun: true },
    });
    await this.replyEphemeral(interaction, "success", "Idle démarré", "L'idle est en cours de démarrage.");
  }

  private async idleStop(interaction: ChatInputCommandInteraction) {
    const service = await this.idleManager.getOrCreate(interaction.user.id);
    await service.stop("discord-command");
    await this.audit.log({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      action: "idle.stop",
    });
    await this.replyEphemeral(interaction, "success", "Idle arrêté", "L'idle a été arrêté.");
  }

  private async idleRestart(interaction: ChatInputCommandInteraction) {
    await this.showSteamGuardModal(interaction, "restart");
  }

  private async idleStatus(interaction: ChatInputCommandInteraction) {
    await this.replyEphemeral(interaction, "info", "Statut Idle", await this.formatStatus(interaction.user.id));
  }

  private async idleLogs(interaction: ChatInputCommandInteraction) {
    const limit = interaction.options.getInteger("limit") ?? 20;
    const rows = await this.events.recent(interaction.user.id, limit);
    const text = rows.length === 0
      ? "Aucun log."
      : rows
          .map((row) => `- ${formatLogLevel(row.level)} **${row.message}** — ${row.createdAt.toLocaleString("fr-FR")}`)
          .join("\n");
    await this.replyEphemeral(interaction, "info", "Logs", text);
  }

  private async idleStandby(interaction: ChatInputCommandInteraction) {
    const active = interaction.options.getBoolean("active", true);
    const service = await this.idleManager.getOrCreate(interaction.user.id);
    await service.setManualStandby(active);
    await this.audit.log({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      action: "idle.standby",
      meta: { active },
    });
    await this.replyEphemeral(interaction, "success", "Standby", `- **État** : ${active ? "activé" : "désactivé"}`);
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
        embeds: [brandedEmbed(this.client, "error", "Ce modal ne t'est pas destiné.")],
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

      await this.audit.log({
        discordUserId: userId,
        guildId: interaction.guildId,
        action: action === "restart" ? "idle.restart" : "idle.start",
        meta: { withSteamGuardCode: Boolean(code) },
      });

      const result = await this.waitForIdleResult(service);
      const status = service.getStatus();

      if (result === "running") {
        await interaction.editReply({
          embeds: [brandedEmbed(this.client, "success", await this.formatStatus(userId), "Idle démarré")],
        });
      } else if (result === "steam-guard") {
        await interaction.editReply({
          embeds: [
            brandedEmbed(
              this.client,
              "warn",
              [
                "Steam demande un code de vérification.",
                "- Relance `/idle start` et saisis le code reçu par **email** ou l'**appli Steam Guard**.",
              ].join("\n"),
              "Code Steam Guard requis",
            ),
          ],
        });
      } else {
        const detail =
          status.lastError ??
          (status.phase === "starting"
            ? "Délai de connexion dépassé (20 s). Vérifie réseau, identifiants et Steam Guard."
            : "La connexion Steam n'a pas abouti.");
        await interaction.editReply({
          embeds: [
            brandedEmbed(
              this.client,
              "error",
              [`**${detail}**`, "- Consulte `/idle status` et `/idle logs` pour le détail."].join("\n"),
              "Connexion échouée",
            ),
          ],
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await interaction.editReply({
        embeds: [brandedEmbed(this.client, "error", `Erreur.\n- ${message}`)],
      });
    }
  }

  private waitForIdleResult(
    service: SteamIdleService,
    timeoutMs = 20_000,
  ): Promise<"running" | "steam-guard" | "error"> {
    const classify = (): "running" | "steam-guard" | "error" | null => {
      if (service.hasPendingSteamGuard()) return "steam-guard";
      const s = service.getStatus();
      if (s.phase === "running" || s.phase === "standby") return "running";
      if (s.phase === "error") return "error";
      return null;
    };

    const resolveOnTimeout = (): "running" | "steam-guard" | "error" => {
      const s = service.getStatus();
      if (s.phase === "running" || s.phase === "standby") return "running";
      if (service.hasPendingSteamGuard()) return "steam-guard";
      return "error";
    };

    const immediate = classify();
    if (immediate) return Promise.resolve(immediate);

    return new Promise((resolve) => {
      const finish = (result: "running" | "steam-guard" | "error") => {
        clearTimeout(timer);
        service.off("status", handler);
        resolve(result);
      };

      const timer = setTimeout(() => finish(resolveOnTimeout()), timeoutMs);
      const handler = () => {
        const r = classify();
        if (r) finish(r);
      };

      service.on("status", handler);
    });
  }

  // ─── /game ───────────────────────────────────────────────────

  private async gameAdd(interaction: ChatInputCommandInteraction) {
    const userId = interaction.user.id;
    const appId = interaction.options.getInteger("appid", true);
    const providedName = interaction.options.getString("name") ?? undefined;
    const name = providedName ?? (await getSteamAppName(appId)) ?? undefined;
    await this.games.upsert(userId, appId, name);

    const session = this.idleManager.get(userId);
    if (session) await session.applyGames("game-add");

    await this.audit.log({
      discordUserId: userId,
      guildId: interaction.guildId,
      action: "game.add",
      target: String(appId),
      meta: { name },
    });
    await this.replyEphemeral(
      interaction,
      "success",
      "Jeu ajouté",
      [`- **Nom** : ${name ? `**${name}**` : "inconnu"}`, `- **AppID** : \`${appId}\``].join("\n"),
    );
  }

  private async gameDelete(interaction: ChatInputCommandInteraction) {
    const userId = interaction.user.id;
    const appId = interaction.options.getInteger("appid", true);

    const ok = await this.confirm(
      interaction,
      "Supprimer ce jeu ?",
      `Tu vas retirer l'AppID \`${appId}\` de ta liste d'idle.`,
    );
    if (!ok) return;

    await this.games.remove(userId, appId);
    const session = this.idleManager.get(userId);
    if (session) await session.applyGames("game-delete");

    await this.audit.log({
      discordUserId: userId,
      guildId: interaction.guildId,
      action: "game.delete",
      target: String(appId),
    });
  }

  private async gameList(interaction: ChatInputCommandInteraction) {
    const userGames = await this.games.list(interaction.user.id, true);

    if (userGames.length === 0) {
      await this.replyEphemeral(
        interaction,
        "info",
        "Tes jeux",
        "Aucun jeu configuré.\n- Utilise `/game add appid:<id>` pour en ajouter un.",
      );
      return;
    }

    const totalPages = Math.ceil(userGames.length / GAMES_PER_PAGE);

    if (totalPages === 1) {
      await this.replyEphemeral(interaction, "info", "Tes jeux", buildGamePage(userGames, 0));
      return;
    }

    let page = 0;

    const buildRow = (p: number) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(GAME_LIST_BTN_PREV)
          .setLabel("◀ Précédent")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p === 0),
        new ButtonBuilder()
          .setCustomId(GAME_LIST_BTN_NEXT)
          .setLabel("Suivant ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p === totalPages - 1),
      );

    const reply = await interaction.reply({
      embeds: [brandedEmbed(this.client, "info", buildGamePage(userGames, page), "Tes jeux")],
      components: [buildRow(page)],
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });

    const collector = reply.resource!.message!.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (btn: ButtonInteraction) => btn.user.id === interaction.user.id,
      time: 5 * 60 * 1000,
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      page = btn.customId === GAME_LIST_BTN_PREV ? page - 1 : page + 1;
      page = Math.max(0, Math.min(page, totalPages - 1));
      await btn.update({
        embeds: [brandedEmbed(this.client, "info", buildGamePage(userGames, page), "Tes jeux")],
        components: [buildRow(page)],
      });
    });

    collector.on("end", async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch { /* message supprimé */ }
    });
  }

  private async gameSearch(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const query = interaction.options.getString("query", true);
    const results = await searchSteamStore(query);
    await interaction.editReply({
      embeds: [
        brandedEmbed(
          this.client,
          results.length > 0 ? "info" : "warn",
          formatSearchResults(query, results),
          "Recherche Steam",
        ),
      ],
    });
  }

  // ─── /audit ──────────────────────────────────────────────────

  private async auditList(interaction: ChatInputCommandInteraction) {
    const limit = interaction.options.getInteger("limit") ?? 20;
    const targetUser = interaction.options.getUser("user");
    const rows = await this.audit.recent(limit, targetUser?.id);

    const text = rows.length === 0
      ? "Aucune action enregistrée."
      : rows
          .map((row) => {
            const date = `<t:${Math.floor(row.createdAt.getTime() / 1000)}:R>`;
            const target = row.target ? ` — \`${row.target}\`` : "";
            return `- ${date} <@${row.discordUserId}> **${row.action}**${target}`;
          })
          .join("\n");

    const title = targetUser ? `Audit — <@${targetUser.id}>` : "Audit (tous utilisateurs)";
    await this.replyEphemeral(interaction, "info", title, text);
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private async formatStatus(userId: string): Promise<string> {
    const account = await this.accounts.findById(userId);
    if (!account) return "Aucun compte Steam enregistré.\n- Utilise `/account setup` pour en configurer un.";

    const session = this.idleManager.get(userId);
    const status: Partial<IdleStatus> = session?.getStatus() ?? {};
    const phase = status.phase ? translatePhase(status.phase) : "non démarré";
    const gameCount = await this.games.countEnabled(userId);

    const lines: string[] = [
      `- **Idle** : ${phase}`,
      `- **Compte** : \`${account.steamUsername}\``,
      `- **Jeux** : \`${gameCount}\``,
    ];

    if (status.startedAt && (status.phase === "running" || status.phase === "standby")) {
      const uptime = Date.now() - new Date(status.startedAt).getTime();
      if (uptime > 0) lines.push(`- **Uptime** : ${formatDuration(uptime)}`);
    }
    if (status.standbyReason) lines.push(`- **Standby** : ${status.standbyReason}`);
    if (status.lastError) lines.push(`- **Erreur** : ${status.lastError}`);

    return lines.join("\n");
  }

  private async confirm(
    interaction: ChatInputCommandInteraction,
    title: string,
    description: string,
  ): Promise<boolean> {
    const yes = new ButtonBuilder()
      .setCustomId("confirm:yes")
      .setStyle(ButtonStyle.Danger)
      .setLabel("Confirmer");
    const no = new ButtonBuilder()
      .setCustomId("confirm:no")
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Annuler");

    const reply = await interaction.reply({
      embeds: [brandedEmbed(this.client, "warn", description, title)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(yes, no)],
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });

    try {
      const press = await reply.resource!.message!.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i: ButtonInteraction) => i.user.id === interaction.user.id,
        time: 30_000,
      });
      const confirmed = press.customId === "confirm:yes";
      await press.update({
        embeds: [
          brandedEmbed(
            this.client,
            confirmed ? "success" : "info",
            confirmed ? "Action confirmée." : "Action annulée.",
            title,
          ),
        ],
        components: [],
      });
      return confirmed;
    } catch {
      await interaction.editReply({
        embeds: [brandedEmbed(this.client, "info", "Confirmation expirée, action annulée.", title)],
        components: [],
      });
      return false;
    }
  }

  private async replyEphemeral(
    interaction: ChatInputCommandInteraction,
    type: EmbedType,
    title: string,
    description: string,
  ) {
    const embed = brandedEmbed(this.client, type, description, title);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

// ─── Formatters ──────────────────────────────────────────────

function buildGamePage(
  games: { name: string | null; appId: number; enabled: boolean }[],
  page: number,
): string {
  const total = games.length;
  const totalPages = Math.ceil(total / GAMES_PER_PAGE);
  const slice = games.slice(page * GAMES_PER_PAGE, (page + 1) * GAMES_PER_PAGE);
  return [
    `- **Total** : \`${total}\` jeux — page **${page + 1}/${totalPages}**`,
    "",
    ...slice.map((g) => `- **${g.name ?? "Inconnu"}** — \`${g.appId}\`${g.enabled ? "" : " _(désactivé)_"}`),
  ].join("\n");
}

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
    error: "erreur",
  };
  return labels[phase];
}

function formatLogLevel(level: string) {
  const labels: Record<string, string> = { debug: "`debug`", info: "`info`", warn: "`warn`", error: "`erreur`" };
  return labels[level] ?? `\`${level}\``;
}
