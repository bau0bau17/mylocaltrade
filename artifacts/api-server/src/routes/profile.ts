import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { traderProfilesTable, usersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authMiddleware, traderOnly } from "../lib/auth";
import { UpdateTraderProfileBody } from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../lib/types";
import { TRADER_STATUS, evaluateBusinessProfileComplete, logAudit, REVALIDATION_INTERVAL_MS } from "../lib/trader-status";
import { ObjectStorageService } from "../lib/objectStorage";
import { reconcileDocumentsState } from "./trader-documents";
import { extractDomain } from "../lib/domain-check";
import { generateVerificationToken, sendBusinessEmailVerificationEmail } from "../lib/email";

const router: IRouter = Router();
const storage = new ObjectStorageService();

// Cooldown between business-email verification sends, and how long a confirm
// link stays valid. Mirrors the account email-verification flow.
const BUSINESS_EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;
const BUSINESS_EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const RFC5322_LITE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A small branded HTML page shown after clicking a confirm link in the browser. */
function businessEmailResultPage(title: string, message: string, success: boolean): string {
  const accent = success ? "#10B981" : "#EF4444";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0B1120;margin:0;padding:48px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#111827;border-radius:16px;padding:40px;border:1px solid #1F2937;text-align:center;">
    <div style="width:56px;height:56px;border-radius:50%;background:${accent}22;color:${accent};font-size:30px;line-height:56px;margin:0 auto 20px;">${success ? "&#10003;" : "&#10005;"}</div>
    <h1 style="color:#F9FAFB;font-size:22px;font-weight:700;margin:0 0 10px;">${title}</h1>
    <p style="color:#9CA3AF;font-size:15px;line-height:1.6;margin:0;">${message}</p>
  </div>
</body></html>`;
}

router.get("/profile", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;

    const [trader] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);

    if (!trader) {
      res.status(404).json({ error: "Trader profile not found" });
      return;
    }

    res.json({
      id: trader.id,
      userId: trader.userId,
      businessName: trader.businessName,
      contactName: trader.contactName,
      email: trader.email,
      phone: trader.phone,
      mainCategory: trader.mainCategory,
      additionalServices: trader.additionalServices || [],
      businessAddress: trader.businessAddress,
      town: trader.town,
      postcode: trader.postcode,
      serviceAreas: trader.serviceAreas || [],
      businessDescription: trader.businessDescription,
      website: trader.website,
      openingHours: trader.openingHours,
      logoUrl: trader.logoUrl,
      galleryUrls: trader.galleryUrls || [],
      socialLinks: trader.socialLinks,
      businessRole: trader.businessRole,
      authorisedRepresentative: trader.authorisedRepresentative,
      businessEmailDomain: trader.businessEmailDomain,
      businessEmailVerified: trader.businessEmailVerified,
      businessEmailVerifiedAddress: trader.businessEmailVerifiedAddress,
      businessEmailVerifiedAt: trader.businessEmailVerifiedAt
        ? trader.businessEmailVerifiedAt.toISOString()
        : null,
      businessEmailVerificationTarget: trader.businessEmailVerificationTarget,
      businessEmailVerificationSentAt: trader.businessEmailVerificationSentAt
        ? trader.businessEmailVerificationSentAt.toISOString()
        : null,
      vatNumber: trader.vatNumber,
      plan: trader.plan,
      isFeatured: trader.isFeatured,
      isActive: trader.isActive,
      rating: trader.rating,
      reviewCount: trader.reviewCount,
      revalidationDueAt: trader.revalidationDueAt
        ? trader.revalidationDueAt.toISOString()
        : null,
      revalidationRemindedAt: trader.revalidationRemindedAt
        ? trader.revalidationRemindedAt.toISOString()
        : null,
      revalidationOverdue: trader.revalidationOverdue,
      createdAt: trader.createdAt.toISOString(),
    });
  } catch (error) {
    req.log.error({ err: error }, "Get profile failed");
    res.status(500).json({ error: "Failed to get profile" });
  }
});

router.put("/profile", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = UpdateTraderProfileBody.parse(req.body);

    // Snapshot the verification-relevant fields BEFORE the update so we can
    // re-run (or clear) the advisory support checks when any of them change.
    const [prior] = await db
      .select({
        companyNumber: traderProfilesTable.companyNumber,
        businessRole: traderProfilesTable.businessRole,
        vatNumber: traderProfilesTable.vatNumber,
        businessEmailDomain: traderProfilesTable.businessEmailDomain,
        website: traderProfilesTable.website,
      })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    const allowedFields = [
      "businessName", "contactName", "phone", "mainCategory",
      "additionalServices", "businessAddress", "town", "postcode",
      "serviceAreas", "businessDescription", "website", "openingHours",
      "logoUrl", "galleryUrls", "socialLinks",
      "businessRole", "authorisedRepresentative", "businessEmailDomain",
      "vatNumber",
    ] as const;

    for (const field of allowedFields) {
      const value = (body as Record<string, unknown>)[field];
      if (value !== undefined) {
        updateData[field] = value;
      }
    }

    // If galleryUrls is being changed, verify each NEW path against the
    // customer-uploads namespace + actual stored object policy. Already-
    // persisted paths are trusted (they passed the same check on first save)
    // so re-saving the gallery doesn't re-fetch metadata for every image.
    if (Array.isArray(updateData.galleryUrls)) {
      const newUrls = updateData.galleryUrls as unknown[];
      if (newUrls.length > 999) {
        res.status(400).json({ error: "Too many gallery images." });
        return;
      }
      const [existing] = await db
        .select({ galleryUrls: traderProfilesTable.galleryUrls })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, userId));
      const existingSet = new Set<string>(existing?.galleryUrls ?? []);
      try {
        const verified: string[] = [];
        for (const raw of newUrls) {
          if (typeof raw !== "string" || !raw) continue;
          if (existingSet.has(raw)) {
            // Cheap re-check defends against payloads that smuggle in
            // strings the trader never owned (e.g. paths from other
            // features or other users) by replaying values that happen
            // to already sit in the gallery_urls array.
            if (!storage.isCustomerUploadPathFor(raw, userId)) {
              throw new Error("One of the gallery images does not belong to your account.");
            }
            verified.push(raw);
            continue;
          }
          const normalised = await storage.verifyCustomerUploadObject(raw, userId, {
            maxBytes: 8 * 1024 * 1024,
            allowedMimes: new Set([
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/heic",
              "image/heif",
            ]),
            label: "gallery image",
          });
          verified.push(normalised);
        }
        updateData.galleryUrls = verified;
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
    }

    const [updated] = await db
      .update(traderProfilesTable)
      .set(updateData)
      .where(eq(traderProfilesTable.userId, userId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Trader profile not found" });
      return;
    }

    // Re-evaluate business profile completion + transition status if needed.
    const evalResult = evaluateBusinessProfileComplete(updated);
    const wasCompleted = updated.businessProfileCompleted;
    const stateChange: Record<string, unknown> = {};
    if (evalResult.complete && !wasCompleted) {
      stateChange.businessProfileCompleted = true;
      if (updated.verificationStatus === TRADER_STATUS.PROFILE_INCOMPLETE) {
        stateChange.verificationStatus = TRADER_STATUS.PENDING_DOCUMENTS;
      }
    } else if (!evalResult.complete && wasCompleted) {
      stateChange.businessProfileCompleted = false;
      // Don't downgrade if already past documents stage; only revert if still in pending-docs.
      if (updated.verificationStatus === TRADER_STATUS.PENDING_DOCUMENTS) {
        stateChange.verificationStatus = TRADER_STATUS.PROFILE_INCOMPLETE;
      }
    }
    if (Object.keys(stateChange).length > 0) {
      stateChange.updatedAt = new Date();
      await db
        .update(traderProfilesTable)
        .set(stateChange)
        .where(eq(traderProfilesTable.userId, userId));
      Object.assign(updated, stateChange);
      if (stateChange.businessProfileCompleted === true) {
        logAudit({ userId, action: "BUSINESS_PROFILE_COMPLETED" });
      }
    }
    logAudit({ userId, action: "BUSINESS_PROFILE_UPDATED" });

    // If the admin asked for more information about profile details (rather than
    // documents), a profile update is the trader's resubmission. Reconcile so a
    // complete profile + document set returns them to UNDER_REVIEW and clears
    // the request note. Document-only resubmissions are reconciled on upload.
    if (updated.verificationStatus === TRADER_STATUS.NEEDS_MORE_INFO) {
      await reconcileDocumentsState(userId);
      const [refreshed] = await db
        .select()
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, userId))
        .limit(1);
      if (refreshed) Object.assign(updated, refreshed);
    }

    // When a verification-relevant field changes via a direct profile edit, the
    // stored support-layer verdict is now stale. Re-trigger the affected check —
    // each is fire-and-forget, advisory, and self-clears when its field is
    // absent, so this both refreshes a new value and wipes an obsolete verdict.
    const norm = (v: string | null | undefined) => (v ?? "").trim();
    const companyChanged =
      norm(prior?.companyNumber) !== norm(updated.companyNumber) ||
      norm(prior?.businessRole) !== norm(updated.businessRole);
    const vatChanged = norm(prior?.vatNumber) !== norm(updated.vatNumber);
    const domainChanged =
      norm(prior?.businessEmailDomain) !== norm(updated.businessEmailDomain) ||
      norm(prior?.website) !== norm(updated.website);
    if (companyChanged || vatChanged || domainChanged) {
      const [{ triggerAiVerification }, { triggerVatCheck }, { triggerDomainCheck }] =
        await Promise.all([
          import("../lib/trader-ai-verification"),
          import("../lib/vat-check"),
          import("../lib/domain-check"),
        ]);
      if (companyChanged) {
        triggerAiVerification({
          userId: updated.userId,
          businessName: updated.businessName,
          businessAddress: updated.businessAddress,
          town: updated.town,
          postcode: updated.postcode,
          companyNumber: updated.companyNumber,
          businessRole: updated.businessRole,
        });
      }
      if (vatChanged) {
        triggerVatCheck({ userId: updated.userId, vatNumber: updated.vatNumber });
      }
      if (domainChanged) {
        triggerDomainCheck({
          userId: updated.userId,
          businessEmailDomain: updated.businessEmailDomain,
          website: updated.website,
        });
      }
    }

    // When the declared business email domain changes, any prior round-trip
    // confirmation no longer applies — reset it. Then opportunistically
    // auto-confirm when the trader's already-verified LOGIN email is itself at
    // the new domain (they have already proven control of a mailbox there), so
    // they need not re-verify. This is the "cross-check against the login email"
    // path; it is a trust signal only and never affects approval.
    const emailDomainChanged =
      norm(prior?.businessEmailDomain) !== norm(updated.businessEmailDomain);
    if (emailDomainChanged) {
      const newDomain = updated.businessEmailDomain
        ? extractDomain(updated.businessEmailDomain)
        : null;
      const reset = {
        businessEmailVerified: false,
        businessEmailVerifiedAddress: null as string | null,
        businessEmailVerifiedAt: null as Date | null,
        businessEmailVerificationTarget: null as string | null,
        businessEmailVerificationToken: null as string | null,
        businessEmailVerificationSentAt: null as Date | null,
      };
      if (newDomain) {
        const [user] = await db
          .select({ email: usersTable.email, emailVerified: usersTable.emailVerified })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        if (user?.emailVerified && user.email && extractDomain(user.email) === newDomain) {
          reset.businessEmailVerified = true;
          reset.businessEmailVerifiedAddress = user.email;
          reset.businessEmailVerifiedAt = new Date();
        }
      }
      await db
        .update(traderProfilesTable)
        .set({ ...reset, updatedAt: new Date() })
        .where(eq(traderProfilesTable.userId, userId));
      Object.assign(updated, reset);
      logAudit({
        userId,
        action: "BUSINESS_EMAIL_VERIFICATION_RESET",
        details: { autoConfirmed: reset.businessEmailVerified, domain: newDomain },
        notes: reset.businessEmailVerified
          ? `Business email domain changed; auto-confirmed via verified login email at ${newDomain}.`
          : `Business email domain changed to ${newDomain ?? "(none)"}; prior confirmation cleared.`,
      });
    }

    res.json({
      id: updated.id,
      userId: updated.userId,
      businessName: updated.businessName,
      contactName: updated.contactName,
      email: updated.email,
      phone: updated.phone,
      mainCategory: updated.mainCategory,
      additionalServices: updated.additionalServices || [],
      businessAddress: updated.businessAddress,
      town: updated.town,
      postcode: updated.postcode,
      serviceAreas: updated.serviceAreas || [],
      businessDescription: updated.businessDescription,
      website: updated.website,
      openingHours: updated.openingHours,
      businessRole: updated.businessRole,
      authorisedRepresentative: updated.authorisedRepresentative,
      businessEmailDomain: updated.businessEmailDomain,
      businessEmailVerified: updated.businessEmailVerified,
      businessEmailVerifiedAddress: updated.businessEmailVerifiedAddress,
      businessEmailVerifiedAt: updated.businessEmailVerifiedAt
        ? updated.businessEmailVerifiedAt.toISOString()
        : null,
      businessEmailVerificationTarget: updated.businessEmailVerificationTarget,
      businessEmailVerificationSentAt: updated.businessEmailVerificationSentAt
        ? updated.businessEmailVerificationSentAt.toISOString()
        : null,
      vatNumber: updated.vatNumber,
      logoUrl: updated.logoUrl,
      galleryUrls: updated.galleryUrls || [],
      socialLinks: updated.socialLinks,
      plan: updated.plan,
      isFeatured: updated.isFeatured,
      isActive: updated.isActive,
      rating: updated.rating,
      reviewCount: updated.reviewCount,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid profile data" });
      return;
    }
    req.log.error({ err: error }, "Update profile failed");
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ---------------------------------------------------------------------------
// Business email domain ownership confirmation (Task #39)
// ---------------------------------------------------------------------------
//
// A round-trip email proof: the trader asks us to send a confirmation link to a
// specific address AT their declared business email domain. Clicking the link
// records the address as confirmed. This is an advisory trust signal surfaced to
// admins; it never gates or blocks approval.

router.post(
  "/profile/business-email/send",
  authMiddleware,
  traderOnly,
  async (req, res) => {
    try {
      const { userId } = req as AuthenticatedRequest;
      const { email } = (req.body ?? {}) as { email?: string };

      const [trader] = await db
        .select()
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, userId))
        .limit(1);
      if (!trader) {
        res.status(404).json({ error: "Trader profile not found" });
        return;
      }

      const rawDomain = trader.businessEmailDomain;
      const declaredDomain = rawDomain ? extractDomain(rawDomain) : null;
      if (!declaredDomain || !rawDomain) {
        res.status(400).json({
          error: "Add a business email domain to your profile before verifying it.",
        });
        return;
      }

      // Resolve the target address: the trader may supply a specific mailbox at
      // the domain, otherwise default to their login email when it is at the
      // declared domain.
      const candidate = (email ?? "").trim().toLowerCase() || trader.email.trim().toLowerCase();
      if (!RFC5322_LITE.test(candidate)) {
        res.status(400).json({ error: "Enter a valid email address." });
        return;
      }
      if (extractDomain(candidate) !== declaredDomain) {
        res.status(400).json({
          error: `The email address must be at your business email domain (@${declaredDomain}).`,
        });
        return;
      }

      // 60s resend cooldown enforced server-side.
      if (trader.businessEmailVerificationSentAt) {
        const elapsed = Date.now() - new Date(trader.businessEmailVerificationSentAt).getTime();
        if (elapsed < BUSINESS_EMAIL_RESEND_COOLDOWN_MS) {
          const waitSeconds = Math.ceil((BUSINESS_EMAIL_RESEND_COOLDOWN_MS - elapsed) / 1000);
          res.status(429).json({
            error: `Please wait ${waitSeconds}s before requesting another verification email.`,
          });
          return;
        }
      }

      const token = generateVerificationToken();
      // Compare-and-set: only write the token while the declared domain is still
      // the one we validated `candidate` against. If a concurrent PUT changed the
      // domain, this affects 0 rows and we abort rather than issue a token tied to
      // a stale domain.
      const sent = await db
        .update(traderProfilesTable)
        .set({
          businessEmailVerificationToken: token,
          businessEmailVerificationTarget: candidate,
          businessEmailVerificationSentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(traderProfilesTable.userId, userId),
            eq(traderProfilesTable.businessEmailDomain, rawDomain),
          ),
        )
        .returning({ userId: traderProfilesTable.userId });
      if (sent.length === 0) {
        res.status(409).json({
          error: "Your business email domain changed. Please reload your profile and try again.",
        });
        return;
      }

      sendBusinessEmailVerificationEmail(candidate, trader.contactName, trader.businessName, token).catch(
        (err) => req.log.error({ err }, "Failed to send business email verification"),
      );

      logAudit({
        userId,
        action: "BUSINESS_EMAIL_VERIFICATION_SENT",
        details: { target: candidate },
        notes: `Business email verification sent to ${candidate}.`,
      });

      res.json({ message: "Verification email sent.", target: candidate });
    } catch (error) {
      req.log.error({ err: error }, "Send business email verification failed");
      res.status(500).json({ error: "Failed to send verification email" });
    }
  },
);

// Unauthenticated: the trader clicks this from their inbox in a browser.
router.get("/profile/business-email/confirm", async (req, res) => {
  const { token } = req.query as { token?: string };
  if (!token) {
    res
      .status(400)
      .send(businessEmailResultPage("Invalid link", "No confirmation token was provided.", false));
    return;
  }

  try {
    const [trader] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.businessEmailVerificationToken, token))
      .limit(1);

    if (!trader) {
      res
        .status(404)
        .send(
          businessEmailResultPage(
            "Link expired",
            "This confirmation link is invalid or has already been used.",
            false,
          ),
        );
      return;
    }

    // Expiry check (24h from send). A missing sentAt is treated as invalid (the
    // token is in an inconsistent state) rather than as never-expiring.
    const sentAt = trader.businessEmailVerificationSentAt;
    const expired =
      !sentAt || Date.now() - new Date(sentAt).getTime() > BUSINESS_EMAIL_TOKEN_TTL_MS;
    if (expired) {
      await db
        .update(traderProfilesTable)
        .set({ businessEmailVerificationToken: null, updatedAt: new Date() })
        .where(eq(traderProfilesTable.userId, trader.userId));
      res
        .status(410)
        .send(
          businessEmailResultPage(
            "Link expired",
            "This confirmation link has expired. Please request a new one from the app.",
            false,
          ),
        );
      return;
    }

    // Domain re-check: the confirmed mailbox must still belong to the currently
    // declared business email domain. If the domain changed since the email was
    // sent, the token no longer attests to the current claim — reject it.
    const confirmedAddress = trader.businessEmailVerificationTarget;
    const currentDomain = trader.businessEmailDomain
      ? extractDomain(trader.businessEmailDomain)
      : null;
    if (!confirmedAddress || !currentDomain || extractDomain(confirmedAddress) !== currentDomain) {
      await db
        .update(traderProfilesTable)
        .set({
          businessEmailVerificationToken: null,
          businessEmailVerificationTarget: null,
          updatedAt: new Date(),
        })
        .where(eq(traderProfilesTable.userId, trader.userId));
      res
        .status(409)
        .send(
          businessEmailResultPage(
            "Link no longer valid",
            "Your business email domain has changed since this link was sent. Please request a new verification email from the app.",
            false,
          ),
        );
      return;
    }

    // Atomic confirm: only the holder of the still-current token succeeds. A
    // concurrent reset/resend invalidates the token, making this affect 0 rows.
    const confirmed = await db
      .update(traderProfilesTable)
      .set({
        businessEmailVerified: true,
        businessEmailVerifiedAddress: confirmedAddress,
        businessEmailVerifiedAt: new Date(),
        businessEmailVerificationToken: null,
        businessEmailVerificationTarget: null,
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.businessEmailVerificationToken, token))
      .returning({ userId: traderProfilesTable.userId });

    if (confirmed.length === 0) {
      res
        .status(404)
        .send(
          businessEmailResultPage(
            "Link expired",
            "This confirmation link is invalid or has already been used.",
            false,
          ),
        );
      return;
    }

    logAudit({
      userId: trader.userId,
      action: "BUSINESS_EMAIL_VERIFIED",
      details: { address: confirmedAddress },
      notes: `Business email confirmed: ${confirmedAddress}.`,
    });

    res.send(
      businessEmailResultPage(
        "Email confirmed",
        "Thanks — your business email address has been confirmed. You can close this window and return to the app.",
        true,
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Business email confirmation failed");
    res
      .status(500)
      .send(businessEmailResultPage("Error", "Something went wrong. Please try again.", false));
  }
});

// Trader re-confirms their key documents are still current, resetting the
// periodic re-validation clock and clearing any "due"/"overdue" state. This is
// the action prompted by the scheduler's re-validation sweep.
router.post("/profile/revalidate", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;

    const [trader] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);

    if (!trader) {
      res.status(404).json({ error: "Trader profile not found" });
      return;
    }

    if (trader.verificationStatus !== TRADER_STATUS.VERIFIED) {
      res.status(409).json({ error: "Only verified profiles can be re-confirmed." });
      return;
    }

    const nextDueAt = new Date(Date.now() + REVALIDATION_INTERVAL_MS);
    const [updated] = await db
      .update(traderProfilesTable)
      .set({
        revalidationDueAt: nextDueAt,
        revalidationRemindedAt: null,
        revalidationOverdue: false,
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, userId))
      .returning();

    await logAudit({
      userId,
      action: "REVALIDATION_CONFIRMED",
      performedBy: userId,
    });

    res.json({
      revalidationDueAt: updated?.revalidationDueAt
        ? updated.revalidationDueAt.toISOString()
        : nextDueAt.toISOString(),
      revalidationRemindedAt: null,
      revalidationOverdue: false,
    });
  } catch (error) {
    req.log.error({ err: error }, "Profile re-validation failed");
    res.status(500).json({ error: "Failed to re-confirm profile" });
  }
});

export default router;
