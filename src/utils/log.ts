import type { ChatInputCommandInteraction } from "discord.js";

import type { EventLogRepository } from "../db/repositories";
import type { AppLogger } from "../logger";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type BotLog = (level: LogLevel, message: string, meta?: unknown) => void;

export function createBotLog(
  events: EventLogRepository,
  logger: AppLogger,
): BotLog {
  return (level, message, meta) => {
    if (level !== "debug") {
      events.add(level, message, meta);
    }
    logger[level]({ meta }, message);
  };
}

export function logCommand(
  log: BotLog,
  interaction: ChatInputCommandInteraction,
  status: "received" | "success" | "error",
  meta?: unknown,
) {
  const subcommand = interaction.options.getSubcommand(false);
  log("debug", `Commande Discord ${status}`, {
    command: interaction.commandName,
    subcommand,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    meta,
  });
}
