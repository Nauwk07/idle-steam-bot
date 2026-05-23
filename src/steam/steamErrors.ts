import SteamUser from "steam-user";

export type SteamErrorPresentation = {
  /** Ligne courte pour logs, lastError, embed status */
  summary: string;
  /** Corps formaté pour DM Discord */
  body: string;
};

type KnownError = {
  summary: string;
  detail: string;
  hint?: string;
};

const KNOWN_ERRORS: Partial<Record<number, KnownError>> = {
  [SteamUser.EResult.NoConnection]: {
    summary: "Connexion Steam perdue",
    detail: "Steam a coupé la session (pas de connexion au réseau Steam).",
    hint: "Vérifie internet, VPN/firewall, et l'état des serveurs Steam avant de relancer.",
  },
  [SteamUser.EResult.ServiceUnavailable]: {
    summary: "Serveurs Steam indisponibles",
    detail: "Les serveurs Steam ne répondent pas pour le moment.",
    hint: "Réessaie dans quelques minutes — c'est souvent temporaire.",
  },
  [SteamUser.EResult.Timeout]: {
    summary: "Délai Steam dépassé",
    detail: "La connexion à Steam a expiré.",
    hint: "Relance `/idle start` ; si ça persiste, vérifie ton réseau.",
  },
  [SteamUser.EResult.TryAnotherCM]: {
    summary: "Serveur Steam saturé",
    detail: "Le serveur de connexion actuel est surchargé.",
    hint: "Relance `/idle start` dans quelques instants — un autre serveur sera tenté.",
  },
  [SteamUser.EResult.RateLimitExceeded]: {
    summary: "Trop de tentatives de connexion",
    detail: "Steam limite temporairement les logins.",
    hint: "Attends quelques minutes avant de relancer `/idle start`.",
  },
  [SteamUser.EResult.AccountLogonDenied]: {
    summary: "Connexion refusée par Steam",
    detail: "Steam a refusé la connexion à ce compte.",
    hint: "Vérifie que le compte n'est pas restreint ou verrouillé.",
  },
  [SteamUser.EResult.InvalidPassword]: {
    summary: "Mot de passe incorrect",
    detail: "Les identifiants enregistrés ne sont plus valides.",
    hint: "Reconfigure le compte avec `/account setup`.",
  },
  [SteamUser.EResult.InvalidLoginAuthCode]: {
    summary: "Code Steam Guard invalide",
    detail: "Le code saisi n'est pas accepté par Steam.",
    hint: "Relance `/idle start` avec un code frais (email ou appli mobile).",
  },
  [SteamUser.EResult.TwoFactorCodeMismatch]: {
    summary: "Code 2FA incorrect",
    detail: "Le code d'authentification ne correspond pas.",
    hint: "Utilise le code actuel de l'appli Steam Guard.",
  },
  [SteamUser.EResult.ExpiredLoginAuthCode]: {
    summary: "Code Steam Guard expiré",
    detail: "Le code n'est plus valide.",
    hint: "Demande un nouveau code et relance `/idle start`.",
  },
};

export function isRealSessionTakeover(
  eresult: number | undefined,
  message?: string | null,
): boolean {
  return (
    eresult === SteamUser.EResult.LoggedInElsewhere ||
    eresult === SteamUser.EResult.AlreadyLoggedInElsewhere ||
    /logged.?in.?elsewhere/i.test(message ?? "")
  );
}

export function isUnrecoverableLoginError(eresult?: number): boolean {
  return (
    eresult === SteamUser.EResult.InvalidLoginAuthCode ||
    eresult === SteamUser.EResult.TwoFactorCodeMismatch ||
    eresult === SteamUser.EResult.ExpiredLoginAuthCode ||
    eresult === SteamUser.EResult.TimeNotSynced ||
    eresult === SteamUser.EResult.InvalidPassword ||
    eresult === SteamUser.EResult.AccountLoginDeniedNeedTwoFactor
  );
}

export function describeEResult(eresult: number | undefined, message?: string | null): string {
  return message || (eresult !== undefined ? SteamUser.EResult[eresult] : null) || String(eresult ?? "unknown");
}

export function formatSteamDisconnect(
  eresult: number | undefined,
  message?: string | null,
): SteamErrorPresentation {
  const known = eresult !== undefined ? KNOWN_ERRORS[eresult] : undefined;
  if (known) {
    return toPresentation(known);
  }

  const raw = describeEResult(eresult, message);
  const codeSuffix = eresult !== undefined ? ` (\`${raw}\`, code ${eresult})` : ` (\`${raw}\`)`;

  return {
    summary: "Connexion Steam interrompue",
    body: [
      "**Connexion Steam interrompue**",
      `Steam a fermé la session${codeSuffix}.`,
    ].join("\n"),
  };
}

export function formatSteamLoginError(
  eresult: number | undefined,
  message?: string | null,
): SteamErrorPresentation {
  const known = eresult !== undefined ? KNOWN_ERRORS[eresult] : undefined;
  if (known) {
    return toPresentation(known);
  }

  const raw = message ?? describeEResult(eresult, message);
  return {
    summary: `Erreur Steam : ${raw}`,
    body: `**Erreur de connexion**\n${raw}`,
  };
}

export function formatUnrecoverableNotification(cause: SteamErrorPresentation): string {
  return [
    cause.body,
    "",
    "L'idle a été arrêté — erreur non récupérable.",
    "Corrige le problème puis relance `/idle start`.",
  ].join("\n");
}

function toPresentation(known: KnownError): SteamErrorPresentation {
  const lines = [`**${known.summary}**`, known.detail];
  if (known.hint) lines.push(`_${known.hint}_`);
  return { summary: known.summary, body: lines.join("\n") };
}
