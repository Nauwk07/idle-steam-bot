import {
  SlashCommandBuilder,
  SlashCommandIntegerOption,
  SlashCommandStringOption,
} from "discord.js";

export const commandDefinitions = [
  // ─── /config ──────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure le bot (réservé au owner Discord du serveur).")
    .addSubcommand((sub) =>
      sub
        .setName("role")
        .setDescription("Définit le rôle autorisé à utiliser le bot.")
        .addRoleOption((o) =>
          o.setName("role").setDescription("Rôle autorisé.").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("log-channel")
        .setDescription("Définit le channel de logs du bot.")
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel texte.").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Affiche la configuration actuelle."),
    ),

  // ─── /account ─────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("account")
    .setDescription("Gère ton compte Steam.")
    .addSubcommand((sub) =>
      sub.setName("setup").setDescription("Enregistre ou met à jour ton compte Steam (modal privé)."),
    )
    .addSubcommand((sub) =>
      sub.setName("delete").setDescription("Supprime ton compte Steam et arrête l'idle."),
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Affiche les infos de ton compte."),
    ),

  // ─── /idle ────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("idle")
    .setDescription("Pilote ton idle Steam.")
    .addSubcommand((sub) =>
      sub.setName("start").setDescription("Démarre l'idle."),
    )
    .addSubcommand((sub) =>
      sub.setName("stop").setDescription("Arrête l'idle."),
    )
    .addSubcommand((sub) =>
      sub.setName("restart").setDescription("Redémarre l'idle."),
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Affiche l'état de ta session."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("logs")
        .setDescription("Affiche tes derniers logs.")
        .addIntegerOption((o: SlashCommandIntegerOption) =>
          o
            .setName("limit")
            .setDescription("Nombre de lignes (max 50).")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(50),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("standby")
        .setDescription("Pause/reprise manuelle de l'idle.")
        .addBooleanOption((o) =>
          o.setName("active").setDescription("Mettre en pause.").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("stats").setDescription("Tes statistiques d'idle (sessions, historique)."),
    ),

  // ─── /game ────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("game")
    .setDescription("Gère les jeux à idle.")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Ajoute un jeu.")
        .addIntegerOption((o: SlashCommandIntegerOption) =>
          o.setName("appid").setDescription("AppID Steam.").setRequired(true).setMinValue(1),
        )
        .addStringOption((o: SlashCommandStringOption) =>
          o.setName("name").setDescription("Nom optionnel.").setRequired(false).setMaxLength(120),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Supprime un jeu.")
        .addIntegerOption((o: SlashCommandIntegerOption) =>
          o.setName("appid").setDescription("AppID Steam.").setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Liste tes jeux."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("bulk")
        .setDescription("Ajoute plusieurs jeux d'un coup.")
        .addStringOption((o: SlashCommandStringOption) =>
          o
            .setName("appids")
            .setDescription("AppIDs séparés par des espaces (ex: 440 570 730).")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("search")
        .setDescription("Recherche sur le store Steam.")
        .addStringOption((o: SlashCommandStringOption) =>
          o
            .setName("query")
            .setDescription("Nom du jeu.")
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(80),
        ),
    ),

  // ─── /audit ───────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("audit")
    .setDescription("Trace des actions Discord (owner uniquement).")
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Affiche les dernières actions sensibles.")
        .addIntegerOption((o: SlashCommandIntegerOption) =>
          o
            .setName("limit")
            .setDescription("Nombre de lignes (max 50).")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(50),
        )
        .addUserOption((o) =>
          o.setName("user").setDescription("Filtrer par utilisateur.").setRequired(false),
        ),
    ),
].map((cmd) => cmd.toJSON());
