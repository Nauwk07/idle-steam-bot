import { describe, expect, it } from "vitest";
import SteamUser from "steam-user";

import {
  describeEResult,
  isRealSessionTakeover,
  isUnrecoverableLoginError,
} from "../src/steam/steamErrors";

describe("isRealSessionTakeover", () => {
  it("détecte LoggedInElsewhere par eresult", () => {
    expect(isRealSessionTakeover(SteamUser.EResult.LoggedInElsewhere)).toBe(true);
    expect(isRealSessionTakeover(SteamUser.EResult.AlreadyLoggedInElsewhere)).toBe(true);
  });

  it("détecte par message (fallback regex)", () => {
    expect(isRealSessionTakeover(undefined, "LoggedInElsewhere")).toBe(true);
    expect(isRealSessionTakeover(undefined, "logged in elsewhere")).toBe(true);
    expect(isRealSessionTakeover(undefined, "LOGGED-IN-ELSEWHERE")).toBe(true);
  });

  it("retourne false pour les autres EResult", () => {
    expect(isRealSessionTakeover(SteamUser.EResult.OK)).toBe(false);
    expect(isRealSessionTakeover(SteamUser.EResult.RateLimitExceeded)).toBe(false);
    expect(isRealSessionTakeover(undefined, "")).toBe(false);
    expect(isRealSessionTakeover(undefined, null)).toBe(false);
  });
});

describe("isUnrecoverableLoginError", () => {
  it("retourne true pour les erreurs de login terminales", () => {
    const codes = [
      SteamUser.EResult.InvalidPassword,
      SteamUser.EResult.InvalidLoginAuthCode,
      SteamUser.EResult.TwoFactorCodeMismatch,
      SteamUser.EResult.ExpiredLoginAuthCode,
      SteamUser.EResult.TimeNotSynced,
      SteamUser.EResult.AccountLoginDeniedNeedTwoFactor,
    ];
    for (const c of codes) expect(isUnrecoverableLoginError(c)).toBe(true);
  });

  it("retourne false pour les erreurs transientes", () => {
    expect(isUnrecoverableLoginError(SteamUser.EResult.RateLimitExceeded)).toBe(false);
    expect(isUnrecoverableLoginError(SteamUser.EResult.LoggedInElsewhere)).toBe(false);
    expect(isUnrecoverableLoginError(undefined)).toBe(false);
  });
});

describe("describeEResult", () => {
  it("préfère le message texte si fourni", () => {
    expect(describeEResult(SteamUser.EResult.InvalidPassword, "Password is wrong")).toBe(
      "Password is wrong",
    );
  });

  it("tombe sur le nom EResult sinon", () => {
    expect(describeEResult(SteamUser.EResult.InvalidPassword)).toBe("InvalidPassword");
  });

  it("retourne 'unknown' si tout est null", () => {
    expect(describeEResult(undefined, null)).toMatch(/unknown|undefined/);
  });
});
