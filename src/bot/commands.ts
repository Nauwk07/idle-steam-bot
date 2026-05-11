import {
  SlashCommandBuilder,
  SlashCommandIntegerOption,
  SlashCommandStringOption,
} from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("info")
    .setDescription("Liste les commandes disponibles."),

  new SlashCommandBuilder()
    .setName("idle")
    .setDescription("Pilote l'idle Steam.")
    .addSubcommand((subcommand) =>
      subcommand.setName("start").setDescription("Démarre l'idle."),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("stop").setDescription("Arrête l'idle."),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("restart").setDescription("Redémarre l'idle."),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Affiche l'état actuel."),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("doctor").setDescription("Vérifie config, SQLite et Steam."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("logs")
        .setDescription("Affiche les derniers logs SQLite.")
        .addIntegerOption((option: SlashCommandIntegerOption) =>
          option
            .setName("limit")
            .setDescription("Nombre de lignes, max 50.")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(50),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("autorestart")
        .setDescription("Active ou désactive l'auto-restart.")
        .addBooleanOption((option) =>
          option
            .setName("active")
            .setDescription("Activer l'auto-restart.")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("dry-run")
        .setDescription("Teste Discord/SQLite sans connexion Steam.")
        .addBooleanOption((option) =>
          option
            .setName("active")
            .setDescription("Activer le mode test.")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("standby")
        .setDescription("Pause/reprise manuelle de l'idle.")
        .addBooleanOption((option) =>
          option
            .setName("active")
            .setDescription("Mettre l'idle en pause.")
            .setRequired(true),
        ),
    ),

  new SlashCommandBuilder()
    .setName("game")
    .setDescription("Gère les jeux à idle.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Ajoute un jeu.")
        .addIntegerOption((option: SlashCommandIntegerOption) =>
          option
            .setName("appid")
            .setDescription("AppID Steam.")
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("name")
            .setDescription("Nom lisible optionnel.")
            .setRequired(false)
            .setMaxLength(120),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Supprime un jeu.")
        .addIntegerOption((option: SlashCommandIntegerOption) =>
          option
            .setName("appid")
            .setDescription("AppID Steam.")
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("Liste les jeux configurés."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("search")
        .setDescription("Recherche des AppIDs sur le store Steam.")
        .addStringOption((option: SlashCommandStringOption) =>
          option
            .setName("query")
            .setDescription("Nom du jeu.")
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(80),
        ),
    ),
].map((command) => command.toJSON());
