import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  earlyAccessRegistrationsTable,
  earlyAccessEventsTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  sendEarlyAccessConfirmationEmail,
  sendEarlyAccessNotificationEmail,
} from "../lib/email";
import {
  LAUNCH_CONSENT_VERSION,
  MARKETING_CONSENT_VERSION,
} from "../lib/early-access-consent";
import {
  CONFIRMATION_TOKEN_TTL_MS,
  type ConfirmationSendChannel,
  buildConfirmUrl,
  confirmationSendCapReached,
  finalizeConfirmationSend,
  generateConfirmationToken,
  hashConfirmationToken,
  reserveConfirmationSend,
} from "../lib/early-access-confirmation";
import { verifyUnsubscribeToken } from "../lib/early-access-unsubscribe";
import crypto from "node:crypto";
import { and, inArray, isNull } from "drizzle-orm";
import { earlyAccessCampaignRecipientsTable } from "@workspace/db/schema";

const router: IRouter = Router();

// Field values rendered by the landing-site form (prebuilt bundle).
const EARLY_ACCESS_TYPES = new Set(["customer", "trader", "other"]);

/** Referer pathname only — never store full URLs (may carry query PII). */
function sourcePageFromReferer(referer: unknown): string | null {
  if (typeof referer !== "string" || !referer) return null;
  try {
    return new URL(referer).pathname.slice(0, 255);
  } catch {
    return null;
  }
}

/**
 * Landing-site "Join Early Access" form (mylocaltrade.co.uk) — Phase 2A
 * double opt-in.
 *
 * A submission only ever creates a PENDING confirmation request: the
 * checkbox choices + wording versions are stored as pending* fields with a
 * hashed single-use token (48h expiry), and a neutral confirmation email is
 * sent. No address becomes eligible for launch or marketing emails until
 * the explicit confirm POST proves mailbox ownership.
 *
 * Repeat submissions update basic details, never create duplicates, never
 * reveal that the email already exists, and NEVER lift an existing
 * unsubscribe/suppression by themselves. Admin-suppressed addresses never
 * even receive a confirmation email — that suppression is not overridable
 * through the public form.
 */
router.post("/early-access", async (req, res) => {
  try {
    const { name, email, type, town, message, consent, marketingConsent, _hp } =
      req.body as Record<string, unknown>;

    // Honeypot field: humans never see it, bots fill it. Pretend success so
    // the bot moves on; store and send nothing.
    if (typeof _hp === "string" && _hp.trim() !== "") {
      res.json({ success: true });
      return;
    }

    if (
      typeof name !== "string" || !name.trim() ||
      typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof type !== "string" || !EARLY_ACCESS_TYPES.has(type) ||
      consent !== true
    ) {
      res.status(400).json({ error: "Please fill in all required fields." });
      return;
    }

    if (
      name.length > 100 ||
      email.length > 254 ||
      (typeof town === "string" && town.length > 100) ||
      (typeof message === "string" && message.length > 2000)
    ) {
      res.status(400).json({ error: "One or more fields exceed the maximum length." });
      return;
    }

    const trimmedName = name.trim();
    const audienceType = type; // narrowed to string above; closures below lose it
    const submittedEmail = email.trim();
    const normalizedEmail = submittedEmail.toLowerCase();
    const trimmedTown =
      typeof town === "string" && town.trim() ? town.trim() : null;
    const trimmedMessage =
      typeof message === "string" && message.trim() ? message.trim() : null;
    // Marketing consent counts ONLY as an explicit boolean true.
    const marketingTicked = marketingConsent === true;
    const sourcePage = sourcePageFromReferer(req.get("referer"));
    const now = new Date();
    // Generated up front; only persisted (hash) when a confirmation flow is
    // actually started. The raw token exists solely in memory + the email.
    const { token, hash: tokenHash } = generateConfirmationToken();
    const tokenExpiresAt = new Date(now.getTime() + CONFIRMATION_TOKEN_TTL_MS);

    const pendingFields = {
      pendingRequestedAt: now,
      pendingLaunchConsentVersion: LAUNCH_CONSENT_VERSION,
      pendingMarketingConsentVersion: marketingTicked
        ? MARKETING_CONSENT_VERSION
        : null,
      confirmationTokenHash: tokenHash,
      confirmationTokenExpiresAt: tokenExpiresAt,
      confirmationTokenUsedAt: null,
    };

    const outcome = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(earlyAccessRegistrationsTable)
        .where(eq(earlyAccessRegistrationsTable.emailNormalized, normalizedEmail))
        .for("update");

      if (!existing) {
        const [inserted] = await tx
          .insert(earlyAccessRegistrationsTable)
          .values({
            name: trimmedName,
            email: submittedEmail,
            emailNormalized: normalizedEmail,
            audienceType: type,
            town: trimmedTown,
            message: trimmedMessage,
            sourcePage,
            joinedAt: now,
            // Double opt-in: consent columns stay NULL until confirmed.
            ...pendingFields,
          })
          .onConflictDoNothing({
            target: earlyAccessRegistrationsTable.emailNormalized,
          })
          .returning();

        if (inserted) {
          await tx.insert(earlyAccessEventsTable).values({
            registrationId: inserted.id,
            kind: "REGISTERED",
            details: { sourcePage, marketingRequested: marketingTicked },
          });
          const sendEventId = await reserveConfirmationSend(tx, inserted.id);
          return { isNew: true as const, id: inserted.id, sendEventId };
        }
        // Lost an insert race — fall through by re-reading the winner.
        const [raced] = await tx
          .select()
          .from(earlyAccessRegistrationsTable)
          .where(
            eq(earlyAccessRegistrationsTable.emailNormalized, normalizedEmail),
          )
          .for("update");
        if (!raced) throw new Error("early-access upsert race lost twice");
        return applyRepeatSubmission(tx, raced);
      }

      return applyRepeatSubmission(tx, existing);

      async function applyRepeatSubmission(
        txn: typeof tx,
        row: typeof earlyAccessRegistrationsTable.$inferSelect,
      ) {
        const adminSuppressed =
          row.unsubscribedAt !== null && row.unsubscribeSource === "admin";
        const userUnsubscribed =
          row.unsubscribedAt !== null && row.unsubscribeSource === "user";
        // Deliverability suppression (hard bounce / complaint / block) is a
        // separate axis: the mailbox is known-bad or actively complained, so
        // the public form must NOT trigger new email to it (Phase 2B).
        const emailSuppressed = row.emailSuppressedAt !== null;

        // Is there anything the person could newly confirm?
        // - never confirmed at all (incl. Phase 1 legacy + expired pendings)
        // - a NEW marketing request (box ticked, marketing not active)
        // - verified resubscription after a voluntary unsubscribe
        // Admin suppression is NOT overridable through the public form: no
        // confirmation flow is even started (and no email sent). Same for
        // bounce/complaint/block suppression.
        const somethingToConfirm =
          !adminSuppressed &&
          !emailSuppressed &&
          (row.confirmedAt === null ||
            (marketingTicked && row.marketingConsentAt === null) ||
            userUnsubscribed);

        // Per-address daily send cap: when reached, leave the existing
        // pending request (and its still-valid emailed link) untouched.
        // Checked while HOLDING the row lock, and the send is reserved (the
        // CONFIRMATION_SENT event inserted) in this same transaction below,
        // so concurrent submissions cannot overshoot the cap.
        const startFlow =
          somethingToConfirm && !(await confirmationSendCapReached(txn, row.id));

        const update: Partial<
          typeof earlyAccessRegistrationsTable.$inferInsert
        > = {
          name: trimmedName,
          email: submittedEmail,
          audienceType,
          town: trimmedTown,
          message: trimmedMessage ?? row.message,
          sourcePage: sourcePage ?? row.sourcePage,
          updatedAt: now,
          ...(startFlow ? pendingFields : {}),
        };

        await txn
          .update(earlyAccessRegistrationsTable)
          .set(update)
          .where(eq(earlyAccessRegistrationsTable.id, row.id));
        await txn.insert(earlyAccessEventsTable).values({
          registrationId: row.id,
          kind: "DETAILS_UPDATED",
          details: {
            sourcePage,
            marketingRequested: marketingTicked,
            ...(adminSuppressed
              ? { confirmationWithheld: "admin_suppressed" }
              : emailSuppressed
                ? { confirmationWithheld: "email_suppressed" }
                : {}),
            ...(somethingToConfirm && !startFlow
              ? { confirmationWithheld: "send_cap" }
              : {}),
          },
        });
        const sendEventId = startFlow
          ? await reserveConfirmationSend(txn, row.id)
          : null;
        return { isNew: false as const, id: row.id, sendEventId };
      }
    });

    // Internal heads-up only for NEW registrations; fire-and-forget.
    if (outcome.isNew) {
      sendEarlyAccessNotificationEmail({
        name: trimmedName,
        email: normalizedEmail,
        type,
        town: trimmedTown,
        message: trimmedMessage,
      }).catch((err) =>
        req.log.error({ err }, "Failed to send early access notification email"),
      );
    }

    // Confirmation email is AWAITED so the audit event records the real
    // dispatch channel — never "sent" just because it was queued locally.
    // The event itself was reserved inside the transaction (cap safety);
    // here we only fill in the actual outcome.
    if (outcome.sendEventId !== null) {
      let channel: ConfirmationSendChannel;
      try {
        channel = await sendEarlyAccessConfirmationEmail({
          toEmail: normalizedEmail,
          toName: trimmedName,
          confirmUrl: buildConfirmUrl(token),
        });
      } catch (err) {
        channel = "failed";
        req.log.error({ err }, "Failed to send early access confirmation email");
      }
      await finalizeConfirmationSend(outcome.sendEventId, channel).catch((err) =>
        req.log.error({ err }, "Failed to record confirmation send outcome"),
      );
    }

    // Identical response for new + repeat: never reveal whether an email is
    // already registered (or belongs to an app account).
    res.json({ success: true });
  } catch (error: unknown) {
    req.log.error({ err: error }, "Early access signup failed");
    res.status(500).json({ error: "Failed to submit. Please try again later." });
  }
});

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * Explicit double opt-in confirmation. POST-only BY DESIGN: automated link
 * scanners issue GETs against the emailed URL — the landing page they hit
 * is inert, and only this deliberate POST (button press) activates consent.
 *
 * Idempotent: replaying an already-used token returns success without
 * creating duplicate consent events. All failures collapse to ONE generic
 * message so the endpoint can't be used to probe token validity classes.
 */
router.post("/early-access/confirm", async (req, res) => {
  try {
    const token = (req.body as Record<string, unknown>)?.token;
    if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) {
      res.status(400).json({
        error: "This confirmation link is invalid or has expired.",
      });
      return;
    }
    const tokenHash = hashConfirmationToken(token);
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      // Row lock serialises concurrent confirmations of the same token: the
      // loser re-reads the committed usedAt marker and takes the idempotent
      // path — no duplicate consent events possible.
      const [row] = await tx
        .select()
        .from(earlyAccessRegistrationsTable)
        .where(
          eq(earlyAccessRegistrationsTable.confirmationTokenHash, tokenHash),
        )
        .for("update");

      if (!row) return { status: "invalid" as const };
      if (row.confirmationTokenUsedAt) return { status: "already" as const };
      if (
        !row.pendingLaunchConsentVersion ||
        !row.confirmationTokenExpiresAt ||
        row.confirmationTokenExpiresAt.getTime() <= now.getTime()
      ) {
        return { status: "invalid" as const };
      }

      const activateMarketing = row.pendingMarketingConsentVersion !== null;
      // Verified resubscription lifts a VOLUNTARY unsubscribe only; an admin
      // suppression survives confirmation (consent evidence is still kept so
      // an admin can act on it).
      const liftUserUnsubscribe =
        row.unsubscribedAt !== null && row.unsubscribeSource === "user";
      const adminSuppressed =
        row.unsubscribedAt !== null && row.unsubscribeSource === "admin";

      await tx
        .update(earlyAccessRegistrationsTable)
        .set({
          confirmationTokenUsedAt: now,
          confirmedAt: now,
          launchConsentAt: now,
          launchConsentVersion: row.pendingLaunchConsentVersion,
          ...(activateMarketing
            ? {
                marketingConsentAt: now,
                marketingConsentVersion: row.pendingMarketingConsentVersion,
              }
            : {}),
          ...(liftUserUnsubscribe
            ? { unsubscribedAt: null, unsubscribeSource: null }
            : {}),
          updatedAt: now,
        })
        .where(eq(earlyAccessRegistrationsTable.id, row.id));

      const events: (typeof earlyAccessEventsTable.$inferInsert)[] = [
        {
          registrationId: row.id,
          kind: "EMAIL_CONFIRMED",
          details: {
            marketing: activateMarketing,
            ...(liftUserUnsubscribe ? { unsubscribeLifted: "user" } : {}),
            ...(adminSuppressed ? { suppressionRetained: "admin" } : {}),
          },
        },
        {
          registrationId: row.id,
          kind: "LAUNCH_CONSENT",
          wordingVersion: row.pendingLaunchConsentVersion,
        },
      ];
      if (activateMarketing) {
        events.push({
          registrationId: row.id,
          kind: "MARKETING_CONSENT",
          wordingVersion: row.pendingMarketingConsentVersion,
        });
      }
      await tx.insert(earlyAccessEventsTable).values(events);
      return { status: "confirmed" as const };
    });

    if (result.status === "invalid") {
      res.status(400).json({
        error: "This confirmation link is invalid or has expired.",
      });
      return;
    }
    // "confirmed" and "already" are indistinguishable on purpose.
    res.json({ success: true });
  } catch (error: unknown) {
    req.log.error({ err: error }, "Early access confirmation failed");
    res.status(500).json({ error: "Failed to confirm. Please try again later." });
  }
});

/**
 * Self-service unsubscribe from launch/marketing emails (Phase 2B).
 *
 * POST-only mutation BY DESIGN — the static /unsubscribe landing page shows
 * a confirm button on GET and only this deliberate POST changes state, so
 * link-prefetching mail scanners can never unsubscribe someone. The signed
 * stateless token identifies exactly one registration and authorises ONLY
 * this idempotent opt-out. The raw token is never logged or stored.
 *
 * Never lifts or masks anything: admin suppression and bounce/complaint
 * suppression are separate axes that remain untouched. All invalid-token
 * shapes collapse to one generic 400.
 */
router.post("/early-access/unsubscribe", async (req, res) => {
  try {
    const registrationId = verifyUnsubscribeToken(
      (req.body as Record<string, unknown>)?.token,
    );
    if (registrationId === null) {
      res.status(400).json({ error: "This unsubscribe link is invalid." });
      return;
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: earlyAccessRegistrationsTable.id,
          unsubscribedAt: earlyAccessRegistrationsTable.unsubscribedAt,
        })
        .from(earlyAccessRegistrationsTable)
        .where(eq(earlyAccessRegistrationsTable.id, registrationId))
        .for("update");
      // Unknown id (deleted row) or already unsubscribed (any source):
      // idempotent success — repeat clicks must not error or flip sources.
      if (!row || row.unsubscribedAt !== null) return;
      await tx
        .update(earlyAccessRegistrationsTable)
        .set({ unsubscribedAt: now, unsubscribeSource: "user", updatedAt: now })
        .where(eq(earlyAccessRegistrationsTable.id, registrationId));
      await tx.insert(earlyAccessEventsTable).values({
        registrationId,
        kind: "UNSUBSCRIBED",
        details: { source: "link" },
      });
    });
    res.json({ success: true });
  } catch (error: unknown) {
    req.log.error({ err: error }, "Early access unsubscribe failed");
    res.status(500).json({ error: "Failed to process. Please try again later." });
  }
});

// ---------------------------------------------------------------------------
// Brevo marketing webhook — sync unsubscribes / bounces / complaints back
// ---------------------------------------------------------------------------

/**
 * Constant-time shared-secret check against the current secret and — during
 * rotation — BREVO_WEBHOOK_SECRET_PREVIOUS, so the Brevo-side header can be
 * updated without a window of dropped events. False when unset. The secret
 * is never logged and never appears in any response or URL.
 */
function webhookSecretValid(given: unknown): boolean {
  if (typeof given !== "string" || given.length === 0) return false;
  const candidates = [
    process.env.BREVO_WEBHOOK_SECRET,
    process.env.BREVO_WEBHOOK_SECRET_PREVIOUS,
  ].filter((s): s is string => Boolean(s));
  const a = Buffer.from(given);
  for (const expected of candidates) {
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/**
 * Normalised Brevo event names → local effect.
 *
 * Brevo MARKETING webhooks emit (exact names): `spam`, `hardBounce`,
 * `softBounce`, `unsubscribed`, `delivered`, `opened`, `click`,
 * `listAddition`. `blocked` and `complaint` exist only on Brevo's
 * TRANSACTIONAL webhook type — they are still accepted here defensively
 * (same suppression semantics) but must NOT be selected when configuring
 * the marketing webhook, because Brevo does not offer them there.
 * `spam` is treated as a permanent complaint suppression locally.
 */
function classifyBrevoEvent(
  event: string,
):
  | { kind: "unsubscribe" }
  | { kind: "suppress"; reason: "hard_bounce" | "complaint" | "blocked" }
  | { kind: "delivered" }
  | null {
  switch (event) {
    case "unsubscribe":
    case "unsubscribed":
      return { kind: "unsubscribe" };
    case "hard_bounce":
    case "hardBounce":
    case "invalid_email":
    case "invalid":
      return { kind: "suppress", reason: "hard_bounce" };
    case "spam":
    case "complaint":
      return { kind: "suppress", reason: "complaint" };
    case "blocked":
      return { kind: "suppress", reason: "blocked" };
    case "delivered":
      return { kind: "delivered" };
    default:
      return null; // opens, clicks, soft bounces etc. — ignored on purpose
  }
}

/**
 * Brevo webhook receiver (Phase 2B). Configure in Brevo as a MARKETING
 * webhook pointing at /api/early-access/brevo-events with the custom
 * request header `X-Webhook-Secret: <value of BREVO_WEBHOOK_SECRET>`
 * (Brevo webhooks support custom headers). Authentication is HEADER-ONLY
 * by design: a query-string secret would leak into proxy/access logs and
 * browser history, so it is deliberately NOT accepted. Returns 404 while
 * the secret env is unset (feature off) and a generic 401 for a missing or
 * wrong header. Invalid attempts are rate-limited upstream (app.ts) with a
 * budget far above Brevo's legitimate delivery rate.
 *
 * Local DB stays the source of truth: Brevo events only ever TIGHTEN state
 * (unsubscribe, suppress, mark delivered) — they never re-enable anyone.
 * Idempotent (Brevo delivery is at-least-once): replays hit conditional
 * updates and change nothing, and a suppression is never reversed here.
 * Response is always minimal; recipient details are never echoed or logged.
 */
router.post("/early-access/brevo-events", async (req, res) => {
  if (!process.env.BREVO_WEBHOOK_SECRET) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!webhookSecretValid(req.get("x-webhook-secret"))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const body = req.body as Record<string, unknown> | null;
    const event = typeof body?.event === "string" ? body.event : "";
    const email = typeof body?.email === "string" ? body.email : "";
    const effect = classifyBrevoEvent(event);
    if (!effect || !email) {
      res.json({ received: true });
      return;
    }
    const normalized = email.trim().toLowerCase();
    const now = new Date();

    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(earlyAccessRegistrationsTable)
        .where(
          eq(earlyAccessRegistrationsTable.emailNormalized, normalized),
        )
        .for("update");
      if (!row) return;

      const recipientStatusUpdate = async (
        from: string[],
        to: string,
      ): Promise<void> => {
        await tx
          .update(earlyAccessCampaignRecipientsTable)
          .set({ status: to, statusDetail: "brevo_webhook", updatedAt: now })
          .where(
            and(
              eq(
                earlyAccessCampaignRecipientsTable.registrationId,
                row.id,
              ),
              inArray(earlyAccessCampaignRecipientsTable.status, from),
            ),
          );
      };

      if (effect.kind === "delivered") {
        await recipientStatusUpdate(["sent"], "delivered");
        return;
      }

      if (effect.kind === "unsubscribe") {
        if (row.unsubscribedAt === null) {
          await tx
            .update(earlyAccessRegistrationsTable)
            .set({
              unsubscribedAt: now,
              unsubscribeSource: "user",
              updatedAt: now,
            })
            .where(eq(earlyAccessRegistrationsTable.id, row.id));
          await tx.insert(earlyAccessEventsTable).values({
            registrationId: row.id,
            kind: "UNSUBSCRIBED",
            details: { source: "brevo" },
          });
        }
        await recipientStatusUpdate(["sent", "delivered"], "unsubscribed");
        return;
      }

      // Deliverability suppression: keep the FIRST reason (conditional on
      // null) — a complaint after a bounce changes nothing.
      if (row.emailSuppressedAt === null) {
        await tx
          .update(earlyAccessRegistrationsTable)
          .set({
            emailSuppressedAt: now,
            emailSuppressionReason: effect.reason,
            updatedAt: now,
          })
          .where(
            and(
              eq(earlyAccessRegistrationsTable.id, row.id),
              isNull(earlyAccessRegistrationsTable.emailSuppressedAt),
            ),
          );
        await tx.insert(earlyAccessEventsTable).values({
          registrationId: row.id,
          kind: "EMAIL_SUPPRESSED",
          details: { reason: effect.reason, source: "brevo_webhook" },
        });
      }
      await recipientStatusUpdate(
        ["sent", "delivered"],
        effect.reason === "complaint" ? "complained" : "bounced",
      );
    });

    res.json({ received: true });
  } catch (error: unknown) {
    req.log.error({ err: error }, "Brevo webhook processing failed");
    // 500 lets Brevo retry the delivery later.
    res.status(500).json({ error: "Processing failed" });
  }
});

export default router;
