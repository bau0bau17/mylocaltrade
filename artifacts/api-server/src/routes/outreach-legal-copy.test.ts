import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "../lib/legal";

/**
 * Outreach (business contacts) legal-copy consistency.
 *
 * The Article-14 business-contacts notice must exist, with identical core
 * wording, in all three privacy surfaces:
 *  - the prerendered landing privacy HTML,
 *  - its matching compiled JS chunk (hydration must not swap the copy —
 *    see the landing-site prebuilt-lockstep convention),
 *  - the in-app privacy screen.
 *
 * The notice is transparency-only (it does not change what users must agree
 * to), so the legal versions must NOT have been bumped — a bump would force
 * every trader through re-acceptance.
 */

const MOBILE_ROOT = join(__dirname, "..", "..", "..", "mobile");
const LANDING_PRIVACY_HTML = join(
  MOBILE_ROOT,
  "server",
  "landing-site",
  "privacy-policy",
  "index.html",
);
const LANDING_ASSETS_DIR = join(MOBILE_ROOT, "server", "landing-site", "assets");
const MOBILE_PRIVACY_SCREEN = join(MOBILE_ROOT, "app", "(tabs)", "privacy.tsx");

/** Core Article-14 sentence that must appear verbatim on every surface. */
const SHARED_SENTENCE =
  "We record the source of every contact and the lawful basis we rely on before any marketing email is sent, and every such email tells you where we got your details.";

const SECTION_TITLE = "Business Contacts and Direct Marketing";

function landingPrivacyChunk(): string {
  const chunk = readdirSync(LANDING_ASSETS_DIR).find(
    (f) => f.startsWith("PrivacyPolicy-") && f.endsWith(".js"),
  );
  expect(chunk, "PrivacyPolicy-*.js chunk must exist in landing assets").toBeTruthy();
  return readFileSync(join(LANDING_ASSETS_DIR, chunk!), "utf8");
}

describe("outreach legal copy consistency", () => {
  it("landing privacy HTML contains the business-contacts notice", () => {
    const html = readFileSync(LANDING_PRIVACY_HTML, "utf8");
    expect(html).toContain(SECTION_TITLE);
    expect(html).toContain(SHARED_SENTENCE);
    // The page's stated update date must not have regressed.
    expect(html).toContain("Last updated: 12 August 2026");
  });

  it("landing privacy JS chunk stays in lockstep with the HTML", () => {
    const js = landingPrivacyChunk();
    expect(js).toContain(SECTION_TITLE);
    // JSON-escape before searching: the chunk stores strings inside
    // double-quoted JS literals, so any embedded quotes are escaped there.
    const escaped = JSON.stringify(SHARED_SENTENCE).slice(1, -1);
    expect(js).toContain(escaped);
  });

  it("mobile privacy screen contains the same notice", () => {
    const tsx = readFileSync(MOBILE_PRIVACY_SCREEN, "utf8");
    expect(tsx).toContain(SECTION_TITLE);
    expect(tsx).toContain(SHARED_SENTENCE);
  });

  it("legal versions were NOT bumped (transparency-only change)", () => {
    expect(CURRENT_PRIVACY_VERSION).toBe("1.1.0");
    expect(CURRENT_TERMS_VERSION).toBe("1.1.0");
  });
});
