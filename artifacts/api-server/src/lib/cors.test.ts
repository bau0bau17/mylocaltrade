import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { buildAllowedOrigins, isOriginAllowed } from "./cors";

/**
 * Regression tests for the CORS configuration hardening:
 *  - Flaw 1: with ALLOWED_ORIGINS unset, production must NOT fall back to
 *    allow-all (it derives exact origins from REPLIT_DOMAINS or throws).
 *  - Flaw 2: origins must match by strict normalised equality, never by
 *    suffix (`endsWith` let evil-admin.example.com match admin.example.com).
 */

const ADMIN = "https://admin.mylocaltrade.co.uk";

describe("isOriginAllowed — strict equality, no suffix matching", () => {
  const allowed = [ADMIN];

  it("allows an exactly matching origin", () => {
    expect(isOriginAllowed(ADMIN, allowed)).toBe(true);
  });

  it("rejects suffix-attack origins that merely end with the allowed value", () => {
    expect(isOriginAllowed("https://evil-admin.mylocaltrade.co.uk", allowed)).toBe(false);
    expect(isOriginAllowed("https://xyzadmin.mylocaltrade.co.uk", allowed)).toBe(false);
    // Attacker path/subdomain tricks around a bare-domain entry.
    expect(isOriginAllowed("https://admin.mylocaltrade.co.uk.evil.com", ["mylocaltrade.co.uk"])).toBe(false);
    expect(isOriginAllowed("https://evil.com/admin.mylocaltrade.co.uk", allowed)).toBe(false);
  });

  it("rejects unlisted subdomains and scheme mismatches", () => {
    expect(isOriginAllowed("https://api.mylocaltrade.co.uk", allowed)).toBe(false);
    expect(isOriginAllowed("http://admin.mylocaltrade.co.uk", allowed)).toBe(false);
  });

  it("normalises case and trailing slashes on both sides", () => {
    expect(isOriginAllowed("https://Admin.MyLocalTrade.co.uk", allowed)).toBe(true);
    expect(isOriginAllowed(`${ADMIN}/`, allowed)).toBe(true);
    expect(isOriginAllowed(ADMIN, ["HTTPS://ADMIN.MYLOCALTRADE.CO.UK/"])).toBe(true);
  });

  it("null allow-list (dev/test fallback) allows anything", () => {
    expect(isOriginAllowed("https://whatever.example", null)).toBe(true);
  });
});

describe("buildAllowedOrigins — production never falls back to allow-all", () => {
  it("returns null (permissive) only outside production", () => {
    expect(buildAllowedOrigins({} as NodeJS.ProcessEnv)).toBeNull();
    expect(buildAllowedOrigins({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("parses and normalises ALLOWED_ORIGINS in any environment", () => {
    expect(
      buildAllowedOrigins({
        ALLOWED_ORIGINS: ` ${ADMIN}/ , HTTPS://App.Example.com ,, `,
      } as NodeJS.ProcessEnv),
    ).toEqual([ADMIN, "https://app.example.com"]);
  });

  it("production without ALLOWED_ORIGINS derives exact https origins from REPLIT_DOMAINS", () => {
    expect(
      buildAllowedOrigins({
        NODE_ENV: "production",
        REPLIT_DOMAINS: "mylocaltrade.co.uk,myapp.replit.app",
      } as NodeJS.ProcessEnv),
    ).toEqual(["https://mylocaltrade.co.uk", "https://myapp.replit.app"]);
  });

  it("explicit ALLOWED_ORIGINS wins over REPLIT_DOMAINS in production", () => {
    expect(
      buildAllowedOrigins({
        NODE_ENV: "production",
        ALLOWED_ORIGINS: ADMIN,
        REPLIT_DOMAINS: "other.replit.app",
      } as NodeJS.ProcessEnv),
    ).toEqual([ADMIN]);
  });

  it("production with neither variable throws at startup (like JWT_SECRET)", () => {
    expect(() =>
      buildAllowedOrigins({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
    ).toThrow(/ALLOWED_ORIGINS/);
    expect(() =>
      buildAllowedOrigins({ NODE_ENV: "production", ALLOWED_ORIGINS: "  ", REPLIT_DOMAINS: " " } as NodeJS.ProcessEnv),
    ).toThrow(/ALLOWED_ORIGINS/);
  });
});

describe("app CORS integration (test env: ALLOWED_ORIGINS unset → documented dev-only fallback)", () => {
  it("reflects the origin in dev/test only, and still serves no-Origin clients", async () => {
    const withOrigin = await request(app).get("/api").set("Origin", "https://any.example");
    expect(withOrigin.status).toBe(200);
    expect(withOrigin.headers["access-control-allow-origin"]).toBe("https://any.example");
    expect(withOrigin.headers["access-control-allow-credentials"]).toBe("true");

    // Non-browser clients (mobile app fetch) send no Origin header.
    const noOrigin = await request(app).get("/api");
    expect(noOrigin.status).toBe(200);
  });
});
