import { describe, it, expect } from "vitest";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import request from "supertest";
import app from "../app";
import { getEmailLogoUrl } from "../lib/email";

/**
 * Regression tests for the canonical email logo (v2 rename).
 *
 * Background: /api/public/logo.png used to serve an old "house with tools"
 * icon that was never the approved MyLocalTrade mark. The fix serves a
 * byte-identical copy of the canonical mobile-app logo (logo@2x.png) from a
 * NEW versioned path (cache-busting) and keeps the legacy path as an alias
 * to the same file so already-delivered emails render correctly.
 */

// SHA-256 of the canonical mark — byte-identical to
// artifacts/mobile/assets/images/logo@2x.png (320x320, the source of truth
// used by the mobile app / website).
const CANONICAL_SHA256 =
  "34d63ae899856c9d8741e49175959a58dea6b40ad87c0770cef96cf109c4bb12";

const sha256 = (buf: Buffer) =>
  crypto.createHash("sha256").update(buf).digest("hex");

describe("GET /api/public/mylocaltrade-logo-v2.png", () => {
  it("serves the canonical logo: 200, image/png, no redirect, cacheable", async () => {
    const res = await request(app).get("/api/public/mylocaltrade-logo-v2.png");
    expect(res.status).toBe(200); // not a 3xx redirect
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toContain("public");
    expect(sha256(res.body as Buffer)).toBe(CANONICAL_SHA256);
  });

  it("legacy /api/public/logo.png now aliases the SAME canonical bytes", async () => {
    const res = await request(app).get("/api/public/logo.png");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(sha256(res.body as Buffer)).toBe(CANONICAL_SHA256);
  });

  it("is unauthenticated (no cookie/session required)", async () => {
    const res = await request(app)
      .get("/api/public/mylocaltrade-logo-v2.png")
      .set("Cookie", "");
    expect(res.status).toBe(200);
  });
});

describe("canonical logo asset on disk", () => {
  it("src/assets contains only the v2 asset; the old house-and-tools file is gone", () => {
    const assetsDir = path.resolve(__dirname, "../assets");
    const files = fs.readdirSync(assetsDir).sort();
    expect(files).toContain("mylocaltrade-logo-v2.png");
    expect(files).not.toContain("logo.png");
    const bytes = fs.readFileSync(
      path.join(assetsDir, "mylocaltrade-logo-v2.png"),
    );
    expect(sha256(bytes)).toBe(CANONICAL_SHA256);
  });

  it("matches the mobile app's canonical logo@2x.png byte-for-byte", () => {
    const mobileLogo = path.resolve(
      __dirname,
      "../../../mobile/assets/images/logo@2x.png",
    );
    // The monorepo layout is stable; if this ever moves, update BOTH copies.
    expect(fs.existsSync(mobileLogo)).toBe(true);
    expect(sha256(fs.readFileSync(mobileLogo))).toBe(CANONICAL_SHA256);
  });
});

describe("email shell logo URL", () => {
  it("references only the versioned canonical URL", () => {
    expect(getEmailLogoUrl()).toMatch(
      /\/api\/public\/mylocaltrade-logo-v2\.png$/,
    );
  });
});
