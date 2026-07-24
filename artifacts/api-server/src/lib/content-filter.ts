const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const URL_RE =
  /\b((?:https?:\/\/|www\.)[^\s]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|uk|ca|au|de|fr|es|it|nl|eu|us|biz|info|app|dev|ai|me|tv|xyz|online|site|store|shop|gov|edu)\b(?:\/[^\s]*)?)/i;

// Allow slash, dash, and other common separators used to obfuscate phone numbers.
const PHONE_RE = /(?:\+?\d[-\s().\/ ]*){7,}\d/;

export type ContentViolation = "email" | "url" | "phone";

/**
 * Normalise common obfuscation tricks before applying the regexes, e.g.:
 *   alice(at)example.com       → alice@example.com
 *   alice [at] example dot com → alice@example.com
 *   alice   at   example.com   → alice@example.com
 *   example[dot]com            → example.com
 *   07/1234/56789              → caught by updated PHONE_RE
 */
function normalise(text: string): string {
  return (
    text
      // Collapse all whitespace runs to a single space so multi-space tricks
      // like "alice   at   example" are handled uniformly.
      .replace(/\s+/g, " ")
      // Bracketed / parenthesised forms with optional inner whitespace:
      // (at) [at] ( at ) [ at ] (dot) [dot] ( dot ) [ dot ]
      .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
      .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".")
      // Plain word forms surrounded by whitespace: " at " / " dot "
      .replace(/\s+at\s+/gi, "@")
      .replace(/\s+dot\s+/gi, ".")
  );
}

export function detectContactInfo(text: string): ContentViolation | null {
  const normalized = normalise(text);
  if (EMAIL_RE.test(normalized)) return "email";
  if (PHONE_RE.test(normalized)) return "phone";
  if (URL_RE.test(normalized)) return "url";
  return null;
}

export function contactViolationMessage(kind: ContentViolation): string {
  switch (kind) {
    case "email":
      return "For your safety, messages can't include email addresses. Please keep all communication on MyLocalTrade.";
    case "phone":
      return "For your safety, messages can't include phone numbers. Please keep all communication on MyLocalTrade.";
    case "url":
      return "For your safety, messages can't include website links. Please keep all communication on MyLocalTrade.";
  }
}
