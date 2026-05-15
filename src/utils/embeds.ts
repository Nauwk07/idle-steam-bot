import { Client, EmbedBuilder } from "discord.js";

import { Colors } from "./colors";

const TYPE_COLORS = {
  success: Colors.Green,
  error: Colors.Red,
  info: Colors.Blue,
  warn: Colors.Yellow,
} as const;

export type EmbedType = keyof typeof TYPE_COLORS;

type EmbedOptions = {
  title?: string;
  branded?: boolean;
  client?: Client;
};

export function buildEmbed(
  type: EmbedType,
  description: string,
  options: EmbedOptions = {},
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(TYPE_COLORS[type])
    .setDescription(description.slice(0, 4000))
    .setTimestamp();

  if (options.title) embed.setTitle(options.title);
  if (options.branded && options.client) applyBotBranding(options.client, embed);

  return embed;
}

export function brandedEmbed(
  client: Client,
  type: EmbedType,
  description: string,
  title?: string,
) {
  return buildEmbed(type, description, { title, branded: true, client });
}

export function applyBotBranding(client: Client, embed: EmbedBuilder) {
  const botUser = client.user;
  if (!botUser) return embed;

  return embed
    .setThumbnail(botUser.displayAvatarURL())
    .setFooter({ text: "Idle Steam", iconURL: botUser.displayAvatarURL() });
}
