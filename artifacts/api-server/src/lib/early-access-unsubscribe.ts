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

/**
 * SECRET & ROTATION MODEL
 *
 * Tokens are signed with the DEDICATED secret EARLY_ACCESS_UNSUBSCRIBE_SECRET
 * — never the session secret, a Brevo API key or the webhook secret, so
 * rotating any of those can never invalidate unsubscribe links, and this
 * secret can rotate without touching sessions.
 *
 * Rotation without breaking links in already-sent emails:
 *   1. move the old value to EARLY_ACCESS_UNSUBSCRIBE_SECRET_PREVIOUS,
 *   2. set a new EARLY_ACCESS_UNSUBSCRIBE_SECRET.
 * New emails are signed with the new secret; verification accepts BOTH, so
 * every previously emailed link keeps working for as long as the previous
 * value stays configured (keep it for at least the retention period of the
 * campaigns whose emails carry it).
 *
 * Neither secret is ever logged, stored or returned anywhere.
 */
function deriveKey(secret: string): Buffer {
  // Domain-separated key: never use the raw secret directly.
  return crypto
    .createHash("sha256")
    .update(`mylocaltrade.early-access.unsubscribe.v1:${secret}`)
    .digest();
}

function signingKeys(): Buffer[] {
  const current = process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET;
  if (!current) {
    throw new Error(
      "EARLY_ACCESS_UNSUBSCRIBE_SECRET is required for unsubscribe tokens",
    );
  }
  const keys = [deriveKey(current)];
  const previous = process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET_PREVIOUS;
  if (previous) keys.push(deriveKey(previous));
  return keys;
}

function signPayload(registrationId: number, key: Buffer): string {
  return crypto
    .createHmac("sha256", key)
    .update(`ea-unsub.v1.${registrationId}`)
    .digest("base64url");
}

export function buildUnsubscribeToken(registrationId: number): string {
  // Always sign with the CURRENT secret only.
  return `${TOKEN_PREFIX}.${registrationId}.${signPayload(registrationId, signingKeys()[0])}`;
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
  const given = parts[2];
  // Accept the current AND (during rotation) the previous secret so links
  // in already-sent emails keep working. Every candidate is compared in
  // constant time.
  for (const key of signingKeys()) {
    const expected = signPayload(id, key);
    if (given.length !== expected.length) continue;
    try {
      if (crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
        return id;
      }
    } catch {
      /* malformed input — try next key */
    }
  }
  return null;
}
