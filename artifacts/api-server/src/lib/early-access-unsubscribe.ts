import crypto from "node:crypto";
import { getOpenLinkBase } from "./email";

/**
 * Stateless signed unsubscribe tokens for launch/marketing emails (Phase 2B).
 *
 * Design: `u1.<registrationId>.<sig>` where sig = base64url(HMAC-SHA256(
 * derivedKey, "ea-unsub.v1.<registrationId>")). Nothing is stored in the
 * database and the raw token is never logged — the token is recomputable
 * for the email template and verifiable without any lookup, cannot be
 * guessed without the server secret, and stays valid for the lifetime of
 * the list (unsubscribe links in old emails must keep working).
 *
 * The token only authorises UNSUBSCRIBE for one registration — a deliberately
 * low-privilege, idempotent capability (worst case: someone with the link
 * can opt that address out, same as any forwarded email's unsubscribe link).
 */

const TOKEN_PREFIX = "u1";

function unsubscribeKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required for unsubscribe tokens");
  }
  // Domain-separated key: never reuse the raw session secret directly.
  return crypto
    .createHash("sha256")
    .update(`mylocaltrade.early-access.unsubscribe.v1:${secret}`)
    .digest();
}

function signPayload(registrationId: number): string {
  return crypto
    .createHmac("sha256", unsubscribeKey())
    .update(`ea-unsub.v1.${registrationId}`)
    .digest("base64url");
}

export function buildUnsubscribeToken(registrationId: number): string {
  return `${TOKEN_PREFIX}.${registrationId}.${signPayload(registrationId)}`;
}

export function buildUnsubscribeUrl(registrationId: number): string {
  return `${getOpenLinkBase()}/unsubscribe?token=${encodeURIComponent(
    buildUnsubscribeToken(registrationId),
  )}`;
}

/**
 * Returns the registrationId for a valid token, or null. Constant-time
 * signature comparison; never throws on malformed input; never logs the
 * token.
 */
export function verifyUnsubscribeToken(token: unknown): number | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const id = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(id) || id <= 0 || String(id) !== parts[1]) return null;
  const expected = signPayload(id);
  const given = parts[2];
  if (given.length !== expected.length) return null;
  try {
    if (
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return id;
}
