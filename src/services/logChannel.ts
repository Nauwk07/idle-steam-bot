import type { Client, TextChannel } from "discord.js";
import type { GuildConfigRepository } from "../db/repositories";
import type { AppLogger } from "../logger";
import type { EmbedType } from "../utils/embeds";
import { buildEmbed } from "../utils/embeds";

export class LogChannelService {
  constructor(
    private readonly client: Client,
    private readonly guildId: string,
    private readonly guildConfig: GuildConfigRepository,
    private readonly logger: AppLogger,
  ) {}

  async send(message: string, type: EmbedType = "info") {
    try {
      const config = await this.guildConfig.get(this.guildId);
      if (!config?.logChannelId) return;

      const channel = await this.client.channels.fetch(config.logChannelId);
      if (!channel?.isTextBased()) return;

      await (channel as TextChannel).send({ embeds: [buildEmbed(type, message)] });
    } catch (err) {
      this.logger.warn({ err }, "LogChannelService: envoi échoué");
    }
  }
}
