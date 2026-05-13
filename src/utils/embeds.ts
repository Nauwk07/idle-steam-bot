import { Client, EmbedBuilder } from "discord.js";

import { Colors } from "./colors";

const TYPE_COLORS = {
  success: Colors.Green,
  error: Colors.Red,
  info: Colors.Blue,
  warn: Colors.Yellow,
} as const;

export type EmbedType = keyof typeof TYPE_COLORS;

/** Version sans client Discord — pour les DMs et les notifications sans branding. */
export function buildEmbed(type: EmbedType, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(TYPE_COLORS[type])
    .setDescription(description)
    .setTimestamp();
}

export function responseEmbed(
  client: Client,
  type: EmbedType,
  description: string,
  title?: string,
) {
  const embed = new EmbedBuilder()
    .setColor(TYPE_COLORS[type])
    .setDescription(description)
    .setTimestamp();

  if (title) embed.setTitle(title);
  applyBotBranding(client, embed);

  return embed;
}

export function panelEmbed(
  client: Client,
  title: string,
  description: string,
  type: EmbedType = "info",
) {
  return responseEmbed(client, type, description, title);
}

export function applyBotBranding(client: Client, embed: EmbedBuilder) {
  const botUser = client.user;
  if (!botUser) return embed;

  return embed
    .setThumbnail(botUser.displayAvatarURL())
    .setFooter({ text: "Idle Steam", iconURL: botUser.displayAvatarURL() });
}
