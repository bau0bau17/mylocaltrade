import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  earlyAccessRegistrationsTable,
  earlyAccessEventsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  sendEarlyAccessConfirmationEmail,
  sendEarlyAccessNotificationEmail,
} from "../lib/email";
import {
  LAUNCH_CONSENT_VERSION,
  MARKETING_CONSENT_VERSION,
} from "../lib/early-access-consent";

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
 * Landing-site "Join Early Access" form (mylocaltrade.co.uk).
 *
 * The registration is stored in early_access_registrations (source of
 * truth); the notification + confirmation emails are best-effort. Repeat
 * submissions for the same email update basic details and refresh launch
 * consent but NEVER create duplicates, never reveal that the email already
 * exists, and never silently restore marketing consent after an
 * unsubscribe/suppression (see rules inline).
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
            launchConsentAt: now,
            launchConsentVersion: LAUNCH_CONSENT_VERSION,
            marketingConsentAt: marketingTicked ? now : null,
            marketingConsentVersion: marketingTicked
              ? MARKETING_CONSENT_VERSION
              : null,
          })
          .onConflictDoNothing({
            target: earlyAccessRegistrationsTable.emailNormalized,
          })
          .returning();

        if (inserted) {
          const events: (typeof earlyAccessEventsTable.$inferInsert)[] = [
            { registrationId: inserted.id, kind: "REGISTERED", details: { sourcePage } },
            {
              registrationId: inserted.id,
              kind: "LAUNCH_CONSENT",
              wordingVersion: LAUNCH_CONSENT_VERSION,
            },
          ];
          if (marketingTicked) {
            events.push({
              registrationId: inserted.id,
              kind: "MARKETING_CONSENT",
              wordingVersion: MARKETING_CONSENT_VERSION,
            });
          }
          await tx.insert(earlyAccessEventsTable).values(events);
          return { isNew: true as const };
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
        const update: Partial<
          typeof earlyAccessRegistrationsTable.$inferInsert
        > = {
          name: trimmedName,
          email: submittedEmail,
          audienceType,
          town: trimmedTown,
          message: trimmedMessage ?? row.message,
          sourcePage: sourcePage ?? row.sourcePage,
          // Re-submitting the form is a fresh launch-updates agreement.
          launchConsentAt: now,
          launchConsentVersion: LAUNCH_CONSENT_VERSION,
          updatedAt: now,
        };
        const events: (typeof earlyAccessEventsTable.$inferInsert)[] = [
          { registrationId: row.id, kind: "DETAILS_UPDATED", details: { sourcePage } },
          {
            registrationId: row.id,
            kind: "LAUNCH_CONSENT",
            wordingVersion: LAUNCH_CONSENT_VERSION,
          },
        ];

        if (marketingTicked) {
          // Explicit new tick = new consent evidence, always recorded.
          update.marketingConsentAt = now;
          update.marketingConsentVersion = MARKETING_CONSENT_VERSION;
          events.push({
            registrationId: row.id,
            kind: "MARKETING_CONSENT",
            wordingVersion: MARKETING_CONSENT_VERSION,
            details: row.unsubscribedAt
              ? { unsubscribeRetained: row.unsubscribeSource }
              : null,
          });
          // SECURITY: this form is unauthenticated — anyone who knows an
          // email address can submit it, so a re-tick must NEVER lift an
          // existing unsubscribe/suppression (that would let a third party
          // reverse someone's opt-out). The evidence event above is kept so
          // a verified flow (Phase 2) or an admin can act on it.
        }
        // Checkbox left unticked: marketing + suppression state untouched.

        await txn
          .update(earlyAccessRegistrationsTable)
          .set(update)
          .where(eq(earlyAccessRegistrationsTable.id, row.id));
        await txn.insert(earlyAccessEventsTable).values(events);
        return { isNew: false as const };
      }
    });

    // Notify + confirm only for NEW registrations (repeat submissions must
    // not spam the inbox or the address owner); both best-effort — the DB
    // row above is the durable record.
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
      sendEarlyAccessConfirmationEmail({
        toEmail: normalizedEmail,
        toName: trimmedName,
      }).catch((err) =>
        req.log.error({ err }, "Failed to send early access confirmation email"),
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

export default router;
