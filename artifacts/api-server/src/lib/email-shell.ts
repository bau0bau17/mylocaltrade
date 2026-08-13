/**
 * MyLocalTrade shared email design system.
 *
 * ONE table-based, email-client-compatible shell with three server-selected
 * audience variants (neutral / trader / customer). Every transactional email
 * in `email.ts` and the marketing campaign renderer build on this module so
 * the visual identity stays consistent and each sender automatically gets a
 * complete plain-text alternative derived from the same content blocks.
 *
 * Design tokens (approved reference):
 *   - outer background  #07111F   (deep navy)
 *   - content card      #0F1B2D   (lighter navy)
 *   - accent / CTA      #12B8D4   (cyan)
 *   - headings          #FFFFFF
 *   - body text         #C6D4E7   (pale blue-grey)
 *   - muted text        #8FA3BF
 *   - amber             #F5B83D   (ONLY expiries / genuine warnings)
 *
 * Constraints honoured: max content width 600px, thin cyan top rule, no
 * gradients/glow/webfonts/JS, inline critical CSS, Outlook-safe buttons
 * (bgcolor on a table cell), and the layout stays readable with images
 * blocked, CSS stripped, or client-forced dark mode.
 */

export type EmailVariant = "neutral" | "trader" | "customer";

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const C = {
  outer: "#07111F",
  card: "#0F1B2D",
  cardInset: "#0A1626",
  border: "#1C2B42",
  accent: "#12B8D4",
  accentText: "#06121F",
  heading: "#FFFFFF",
  body: "#C6D4E7",
  muted: "#8FA3BF",
  faint: "#64789A",
  amber: "#F5B83D",
  danger: "#F87171",
  success: "#34D399",
} as const;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// ---------------------------------------------------------------------------
// Variant copy (server-selected; never client-derived)
// ---------------------------------------------------------------------------

export const VARIANT_TAGLINES: Record<EmailVariant, [string, string]> = {
  neutral: ["Local help. Clear communication.", "All in one place."],
  trader: ["Your business. Your community.", "We're here to help you grow."],
  customer: [
    "Your home. Your project.",
    "Find trusted local tradespeople with confidence.",
  ],
};

export const SECURITY_NOTE_COPY =
  "For your security, never share this code. We will never ask for your code or password.";

export const COMPANY_IDENTITY_LINE =
  "MyLocalTrade · Service Provider LTD · Company No: 15830141 · 71-75 Shelton Street, London, WC2H 9JQ";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function escapeEmailHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped cyan-emphasised inline value for use inside `html` blocks. */
export function em(value: string): string {
  return `<strong style="color: ${C.accent};">${escapeEmailHtml(value)}</strong>`;
}

/** Escaped white-emphasised inline value for use inside `html` blocks. */
export function strongText(value: string): string {
  return `<strong style="color: ${C.heading};">${escapeEmailHtml(value)}</strong>`;
}

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export type EmailBlock =
  /** "Hi <name>," — name is escaped. */
  | { kind: "greeting"; name: string }
  /** Plain paragraph — text is escaped; `muted` renders smaller/dimmer. */
  | { kind: "paragraph"; text: string; muted?: boolean }
  /**
   * Rich paragraph: caller supplies BOTH pre-escaped html (via em()/
   * strongText()/escapeEmailHtml()) and the plain-text equivalent.
   */
  | { kind: "html"; html: string; text: string; muted?: boolean }
  /** Prominent one-time code with amber expiry line. */
  | { kind: "code"; code: string; expiresMinutes: number }
  /**
   * Boxed panel (quoted message, reviewer note, status…). Text content is
   * escaped and rendered with preserved newlines.
   */
  | {
      kind: "panel";
      title?: string;
      text: string;
      tone?: "info" | "success" | "warning" | "danger";
    }
  /** Amber banner for genuine warnings only. */
  | { kind: "warningBanner"; text: string }
  /** Label/value detail rows. Values are escaped. */
  | { kind: "rows"; rows: Array<[string, string]> }
  /** Bulleted list. Items are escaped. */
  | { kind: "list"; title?: string; items: string[] }
  /** Primary CTA button (one per email). */
  | { kind: "cta"; label: string; url: string }
  /** "If the button doesn't work…" URL fallback. */
  | { kind: "linkFallback"; url: string; note?: string }
  /** Thin divider. */
  | { kind: "divider" }
  /**
   * Escape hatch for the campaign renderer: raw pre-built HTML + matching
   * plain text (used for Brevo merge tags that must NOT be escaped).
   */
  | { kind: "raw"; html: string; text: string };

const PANEL_TONES = {
  info: C.accent,
  success: C.success,
  warning: C.amber,
  danger: C.danger,
} as const;

function renderBlockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "greeting":
      return `<p style="color: ${C.body}; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${escapeEmailHtml(block.name || "there")},</p>`;
    case "paragraph":
      return block.muted
        ? `<p style="color: ${C.muted}; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">${escapeEmailHtml(block.text)}</p>`
        : `<p style="color: ${C.body}; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">${escapeEmailHtml(block.text)}</p>`;
    case "html":
      return block.muted
        ? `<p style="color: ${C.muted}; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">${block.html}</p>`
        : `<p style="color: ${C.body}; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">${block.html}</p>`;
    case "code":
      return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 8px auto 8px;">
  <tr>
    <td align="center" bgcolor="${C.cardInset}" style="background-color: ${C.cardInset}; border: 1px solid ${C.border}; border-radius: 12px; padding: 18px 32px;">
      <span style="color: ${C.heading}; font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', Courier, monospace;">${escapeEmailHtml(block.code)}</span>
    </td>
  </tr>
</table>
<p style="color: ${C.amber}; font-size: 13px; text-align: center; line-height: 1.6; margin: 0 0 20px;">This code expires in ${block.expiresMinutes} minutes.</p>`;
    case "panel": {
      const tone = PANEL_TONES[block.tone ?? "info"];
      return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 20px;">
  <tr>
    <td bgcolor="${C.cardInset}" style="background-color: ${C.cardInset}; border-left: 3px solid ${tone}; border-radius: 8px; padding: 14px 16px;">
      ${block.title ? `<p style="color: ${tone}; font-size: 12px; font-weight: 700; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">${escapeEmailHtml(block.title)}</p>` : ""}
      <p style="color: ${C.body}; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap; word-break: break-word;">${escapeEmailHtml(block.text)}</p>
    </td>
  </tr>
</table>`;
    }
    case "warningBanner":
      return `<p style="background-color: #2A1F0E; color: ${C.amber}; font-size: 13px; font-weight: 700; padding: 10px 14px; border-radius: 8px; margin: 0 0 16px; text-align: center;">${escapeEmailHtml(block.text)}</p>`;
    case "rows":
      return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 16px;">
${block.rows
  .map(
    ([k, v]) => `  <tr>
    <td valign="top" style="padding: 8px 12px 8px 0; color: ${C.muted}; font-size: 13px; width: 130px;">${escapeEmailHtml(k)}</td>
    <td valign="top" style="padding: 8px 0; color: ${C.body}; font-size: 13px; word-break: break-word;">${escapeEmailHtml(v)}</td>
  </tr>`,
  )
  .join("\n")}
</table>`;
    case "list":
      return `${block.title ? `<p style="color: ${C.body}; font-size: 15px; line-height: 1.6; margin: 0 0 12px;"><strong style="color: ${C.heading};">${escapeEmailHtml(block.title)}</strong></p>` : ""}
<ul style="color: ${C.body}; font-size: 14px; line-height: 1.7; margin: 0 0 20px; padding-left: 20px;">
${block.items.map((i) => `  <li style="margin: 0 0 4px;">${escapeEmailHtml(i)}</li>`).join("\n")}
</ul>`;
    case "cta":
      // Outlook-safe button: solid bgcolor on the table cell + padded link.
      return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 8px auto 20px;">
  <tr>
    <td align="center" bgcolor="${C.accent}" style="background-color: ${C.accent}; border-radius: 10px; mso-padding-alt: 14px 36px;">
      <a href="${escapeEmailHtml(block.url)}" target="_blank" style="display: inline-block; padding: 14px 36px; font-family: ${FONT}; font-size: 16px; font-weight: 700; color: ${C.accentText}; text-decoration: none; border-radius: 10px;">${escapeEmailHtml(block.label)}</a>
    </td>
  </tr>
</table>`;
    case "linkFallback":
      return `<p style="color: ${C.muted}; font-size: 13px; line-height: 1.6; margin: 0 0 16px;">${escapeEmailHtml(block.note ?? "If the button doesn't work, copy and paste this address into your browser:")}<br><a href="${escapeEmailHtml(block.url)}" style="color: ${C.accent}; word-break: break-all; text-decoration: underline;">${escapeEmailHtml(block.url)}</a></p>`;
    case "divider":
      return `<hr style="border: none; border-top: 1px solid ${C.border}; margin: 20px 0;">`;
    case "raw":
      return block.html;
  }
}

function renderBlockText(block: EmailBlock): string | null {
  switch (block.kind) {
    case "greeting":
      return `Hi ${block.name || "there"},`;
    case "paragraph":
      return block.text;
    case "html":
      return block.text;
    case "code":
      return `${block.code}\n\nThis code expires in ${block.expiresMinutes} minutes.`;
    case "panel":
      return block.title ? `${block.title}:\n${block.text}` : block.text;
    case "warningBanner":
      return block.text.toUpperCase();
    case "rows":
      return block.rows.map(([k, v]) => `${k}: ${v}`).join("\n");
    case "list":
      return `${block.title ? `${block.title}\n` : ""}${block.items.map((i) => `- ${i}`).join("\n")}`;
    case "cta":
      return `${block.label}: ${block.url}`;
    case "linkFallback":
      return null; // the CTA text line already carries the URL
    case "divider":
      return null;
    case "raw":
      return block.text;
  }
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export interface BrandedEmailOptions {
  /** Server-selected audience variant. Unknown/mixed recipients MUST be neutral. */
  variant: EmailVariant;
  /** <title> + main heading (white, centred, below the logo). */
  heading: string;
  /** Optional <title> override (defaults to `heading`) — campaigns use the subject. */
  title?: string;
  /** Hidden inbox preview snippet. Escaped. */
  preheader?: string;
  blocks: EmailBlock[];
  /**
   * Absolute HTTPS logo URL. The email must stay understandable without it
   * (alt text + wordmark in the footer are always plain text).
   */
  logoUrl: string;
  footer: {
    /** "You are receiving this because…" line (escaped). */
    reasonLine?: string;
    /**
     * RAW reason line (campaign renderer only): the html half may contain
     * Brevo merge tags that must not be escaped; text is the plain version.
     */
    rawReason?: { html: string; text: string };
    /**
     * RAW extra link fragment appended inside the footer link row (campaign
     * renderer only — Brevo's native `{{ unsubscribe }}` one-click link).
     */
    extraLinkHtml?: string;
    /**
     * Unsubscribe link. `raw` skips URL escaping for Brevo merge tags —
     * only the campaign renderer may set it.
     */
    unsubscribe?: { url: string; label?: string; raw?: boolean };
    /** Marketing link row: Unsubscribe · Privacy Policy · Contact us. */
    marketingLinks?: { privacyUrl: string; contactUrl: string };
    /** Company legal identity line (required for marketing). */
    companyIdentity?: boolean;
    /** "This mailbox isn't monitored…" note. */
    notMonitored?: boolean;
  };
  /** Security strip under the card (OTP / credential emails). */
  securityNote?: string;
  /** Optional banner injected above the heading (test sends, internal alerts). */
  bannerHtml?: string;
  bannerText?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

export function renderBrandedEmail(opts: BrandedEmailOptions): RenderedEmail {
  const [tag1, tag2] = VARIANT_TAGLINES[opts.variant];
  const blocksHtml = opts.blocks.map(renderBlockHtml).join("\n");

  const unsubUrl = opts.footer.unsubscribe
    ? opts.footer.unsubscribe.raw
      ? opts.footer.unsubscribe.url
      : escapeEmailHtml(opts.footer.unsubscribe.url)
    : null;

  let footerLinksHtml = "";
  if (opts.footer.marketingLinks && unsubUrl) {
    footerLinksHtml = `<p style="color: ${C.faint}; font-size: 12px; text-align: center; margin: 0 0 8px;"><a href="${unsubUrl}" style="color: ${C.muted}; text-decoration: underline;">${escapeEmailHtml(opts.footer.unsubscribe?.label ?? "Unsubscribe")}</a>${opts.footer.extraLinkHtml ?? ""} &nbsp;·&nbsp; <a href="${escapeEmailHtml(opts.footer.marketingLinks.privacyUrl)}" style="color: ${C.muted}; text-decoration: underline;">Privacy Policy</a> &nbsp;·&nbsp; <a href="${escapeEmailHtml(opts.footer.marketingLinks.contactUrl)}" style="color: ${C.muted}; text-decoration: underline;">Contact us</a></p>`;
  } else if (unsubUrl) {
    footerLinksHtml = `<p style="color: ${C.faint}; font-size: 12px; text-align: center; margin: 0 0 8px;"><a href="${unsubUrl}" style="color: ${C.muted}; text-decoration: underline;">${escapeEmailHtml(opts.footer.unsubscribe?.label ?? "Unsubscribe")}</a></p>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${escapeEmailHtml(opts.title ?? opts.heading)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: ${C.outer}; font-family: ${FONT}; -webkit-text-size-adjust: 100%;">
  ${opts.preheader ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${escapeEmailHtml(opts.preheader)}</div>` : ""}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.outer}" style="background-color: ${C.outer};">
    <tr>
      <td align="center" style="padding: 28px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width: 100%; max-width: 600px;">
          <tr>
            <td bgcolor="${C.card}" style="background-color: ${C.card}; border: 1px solid ${C.border}; border-top: 3px solid ${C.accent}; border-radius: 14px; padding: 36px 28px;">
              ${opts.bannerHtml ?? ""}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding: 0 0 16px;">
                    <img src="${opts.logoUrl}" alt="MyLocalTrade logo" width="72" height="72" style="display: block; width: 72px; height: 72px; border-radius: 16px; border: 0;">
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding: 0 0 24px;">
                    <h1 style="color: ${C.heading}; font-size: 24px; font-weight: 700; line-height: 1.3; margin: 0; word-break: break-word;">${escapeEmailHtml(opts.heading)}</h1>
                  </td>
                </tr>
              </table>
              ${blocksHtml}
              <hr style="border: none; border-top: 1px solid ${C.border}; margin: 28px 0 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 12px;">
                <tr>
                  <td valign="middle" width="40" style="width: 40px; padding-right: 10px;">
                    <img src="${opts.logoUrl}" alt="" width="30" height="30" style="display: block; width: 30px; height: 30px; border-radius: 8px; border: 0;">
                  </td>
                  <td valign="middle">
                    <p style="color: ${C.heading}; font-size: 14px; font-weight: 700; margin: 0;">MyLocalTrade</p>
                    <p style="color: ${C.muted}; font-size: 12px; line-height: 1.5; margin: 2px 0 0;">${escapeEmailHtml(tag1)}<br>${escapeEmailHtml(tag2)}</p>
                  </td>
                </tr>
              </table>
              ${opts.footer.reasonLine ? `<p style="color: ${C.faint}; font-size: 12px; text-align: center; line-height: 1.6; margin: 0 0 8px;">${escapeEmailHtml(opts.footer.reasonLine)}</p>` : ""}
              ${opts.footer.rawReason ? `<p style="color: ${C.faint}; font-size: 12px; text-align: center; line-height: 1.6; margin: 0 0 8px;">${opts.footer.rawReason.html}</p>` : ""}
              ${footerLinksHtml}
              ${opts.footer.notMonitored ? `<p style="color: ${C.faint}; font-size: 12px; text-align: center; line-height: 1.6; margin: 0 0 8px;">This mailbox isn't monitored — if you need to reach us, use the contact form on mylocaltrade.co.uk.</p>` : ""}
              ${opts.footer.companyIdentity ? `<p style="color: ${C.faint}; font-size: 11px; text-align: center; line-height: 1.6; margin: 0;">${escapeEmailHtml(COMPANY_IDENTITY_LINE)}</p>` : ""}
            </td>
          </tr>
          ${
            opts.securityNote
              ? `<tr><td style="padding: 12px 4px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td bgcolor="${C.card}" style="background-color: ${C.card}; border: 1px solid ${C.border}; border-radius: 10px; padding: 12px 16px;">
                  <p style="color: ${C.muted}; font-size: 12px; line-height: 1.6; text-align: center; margin: 0;">${escapeEmailHtml(opts.securityNote)}</p>
                </td>
              </tr>
            </table>
          </td></tr>`
              : ""
          }
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textParts: string[] = [];
  if (opts.bannerText) textParts.push(opts.bannerText);
  textParts.push(opts.heading);
  for (const block of opts.blocks) {
    const t = renderBlockText(block);
    if (t) textParts.push(t);
  }
  const footerText: string[] = ["—", `MyLocalTrade — ${tag1} ${tag2}`];
  if (opts.footer.reasonLine) footerText.push(opts.footer.reasonLine);
  if (opts.footer.rawReason) footerText.push(opts.footer.rawReason.text);
  if (opts.footer.unsubscribe) {
    footerText.push(
      `${opts.footer.unsubscribe.label ?? "Unsubscribe"}: ${opts.footer.unsubscribe.url}`,
    );
  }
  if (opts.footer.marketingLinks) {
    footerText.push(
      `Privacy Policy: ${opts.footer.marketingLinks.privacyUrl} · Contact: ${opts.footer.marketingLinks.contactUrl}`,
    );
  }
  if (opts.footer.notMonitored) {
    footerText.push(
      "This mailbox isn't monitored — if you need to reach us, use the contact form on mylocaltrade.co.uk.",
    );
  }
  if (opts.footer.companyIdentity) footerText.push(COMPANY_IDENTITY_LINE);
  if (opts.securityNote) footerText.push(opts.securityNote);
  textParts.push(...footerText);

  return { html, text: textParts.join("\n\n") };
}
