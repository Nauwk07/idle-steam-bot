import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";

export type SubHandler = {
  fn: (interaction: ChatInputCommandInteraction) => Promise<void>;
  ownerOnly?: boolean;
  /** Si true, le contrôle d'accès par rôle est sauté (ex: /config status). */
  publicAccess?: boolean;
};

export type CommandMap = Record<string, Record<string, SubHandler>>;

export type ModalHandler = {
  match: (customId: string) => boolean;
  fn: (interaction: ModalSubmitInteraction) => Promise<void>;
};

export function resolveSubHandler(
  map: CommandMap,
  commandName: string,
  subcommand: string,
): SubHandler | null {
  return map[commandName]?.[subcommand] ?? null;
}

export function resolveModalHandler(
  handlers: ModalHandler[],
  customId: string,
): ModalHandler | null {
  return handlers.find((h) => h.match(customId)) ?? null;
}
