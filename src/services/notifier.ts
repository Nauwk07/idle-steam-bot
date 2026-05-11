import type { EmbedType } from "../utils/embeds";

export type Notifier = {
  send(message: string, type?: EmbedType): Promise<void>;
};

export const noopNotifier: Notifier = {
  async send() {
    return undefined;
  },
};
