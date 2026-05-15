import SteamUser from "steam-user";

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
