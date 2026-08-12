import crypto from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { earlyAccessEventsTable } from "@workspace/db/schema";
import { getOpenLinkBase } from "./email";

/**
 * Double opt-in confirmation tokens for the Early Access list (Phase 2A).
 *
 * SECURITY INVARIANTS:
 * - Tokens are 256-bit CSPRNG values; only their SHA-256 hex is ever stored.
 * - The raw token / full confirmation URL must NEVER be logged or written to
 *   the events table.
 * - Tokens are single-use (confirmationTokenUsedAt marker) and expire after
 *   CONFIRMATION_TOKEN_TTL_MS.
 */

export const CONFIRMATION_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Max confirmation emails per registration per rolling 24h — stops the
 * public form (and admin resend) being used to bombard an inbox, and keeps
 * Brevo's shared daily allowance safe.
 */
export const CONFIRMATION_SEND_CAP_PER_DAY = 3;

export function generateConfirmationToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashConfirmationToken(token) };
}

export function hashConfirmationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Landing-site confirmation page; the token rides in the query string and
 * the page strips it from history immediately (see confirm-early-access). */
export function buildConfirmUrl(token: string): string {
  return `${getOpenLinkBase()}/confirm-early-access?token=${encodeURIComponent(token)}`;
}

export type ConfirmationSendChannel =
  | "brevo"
  | "smtp"
  | "none"
  | "skipped"
  | "failed";

/**
 * Reserve a confirmation-email send INSIDE the same transaction that checked
 * the cap and holds the registration row lock. The reservation IS the
 * CONFIRMATION_SENT audit event (details start as channel:"pending"), so
 * concurrent requests serialising on the row lock see each other's committed
 * reservations and the 3-per-24h cap cannot be exceeded by racing sends.
 * details NEVER contain the token or URL — channel/success flags only.
 */
export async function reserveConfirmationSend(
  executor: Pick<typeof db, "insert">,
  registrationId: number,
  extra?: { resend?: true; performedBy?: number },
): Promise<number> {
  const [event] = await executor
    .insert(earlyAccessEventsTable)
    .values({
      registrationId,
      kind: "CONFIRMATION_SENT",
      performedBy: extra?.performedBy ?? null,
      details: {
        channel: "pending",
        ok: false,
        ...(extra?.resend ? { resend: true } : {}),
      },
    })
    .returning({ id: earlyAccessEventsTable.id });
  return event.id;
}

/**
 * Record the REAL dispatch outcome on the reserved event after the email
 * transport returned (never "sent" just because it was queued). If this
 * update itself fails, the event stays "pending" — still counted against
 * the cap, which errs on the safe side.
 */
export async function finalizeConfirmationSend(
  eventId: number,
  channel: ConfirmationSendChannel,
  extra?: { resend?: true },
): Promise<void> {
  await db
    .update(earlyAccessEventsTable)
    .set({
      details: {
        channel,
        ok: channel === "brevo" || channel === "smtp",
        ...(extra?.resend ? { resend: true } : {}),
      },
    })
    .where(eq(earlyAccessEventsTable.id, eventId));
}

/** True when the per-registration daily confirmation-email cap is reached. */
export async function confirmationSendCapReached(
  executor: Pick<typeof db, "select">,
  registrationId: number,
): Promise<boolean> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(earlyAccessEventsTable)
    .where(
      and(
        eq(earlyAccessEventsTable.registrationId, registrationId),
        eq(earlyAccessEventsTable.kind, "CONFIRMATION_SENT"),
        gt(
          earlyAccessEventsTable.createdAt,
          sql`now() - interval '24 hours'`,
        ),
      ),
    );
  return (row?.count ?? 0) >= CONFIRMATION_SEND_CAP_PER_DAY;
}
