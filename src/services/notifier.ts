import type { Client } from "discord.js";
import type { EmbedType } from "../utils/embeds";
import { buildEmbed } from "../utils/embeds";

export type Notifier = {
  send(message: string, type?: EmbedType): Promise<void>;
};

export const noopNotifier: Notifier = {
  async send() {
    return undefined;
  },
};

export class UserDMNotifier implements Notifier {
  constructor(
    private readonly client: Client,
    private readonly discordUserId: string,
  ) {}

  async send(message: string, type: EmbedType = "info") {
    try {
      const user = await this.client.users.fetch(this.discordUserId);
      await user.send({ embeds: [buildEmbed(type, message)] });
    } catch {
      // DM désactivés ou user introuvable — on absorbe silencieusement
    }
  }
}
