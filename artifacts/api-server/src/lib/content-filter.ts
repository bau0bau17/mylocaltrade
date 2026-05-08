const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const URL_RE =
  /\b((?:https?:\/\/|www\.)[^\s]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|uk|ca|au|de|fr|es|it|nl|eu|us|biz|info|app|dev|ai|me|tv|xyz|online|site|store|shop|gov|edu)\b(?:\/[^\s]*)?)/i;

const PHONE_RE = /(?:\+?\d[\s().-]*){7,}\d/;

export type ContentViolation = "email" | "url" | "phone";

export function detectContactInfo(text: string): ContentViolation | null {
  const normalized = text
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s+dot\s+/gi, ".");
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
