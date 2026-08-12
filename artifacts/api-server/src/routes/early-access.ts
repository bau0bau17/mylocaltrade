import { Router, type IRouter } from "express";
import {
  sendEarlyAccessConfirmationEmail,
  sendEarlyAccessNotificationEmail,
} from "../lib/email";

const router: IRouter = Router();

// Field values rendered by the landing-site form (prebuilt bundle).
const EARLY_ACCESS_TYPES = new Set(["customer", "trader", "other"]);

/**
 * Landing-site "Join Early Access" form (mylocaltrade.co.uk). There is no
 * waitlist table — the lead IS the notification email to the noreply@ inbox,
 * so delivery failure must fail the request loudly rather than telling the
 * visitor "success" while the signup evaporates.
 */
router.post("/early-access", async (req, res) => {
  try {
    const { name, email, type, town, message, consent, _hp } =
      req.body as Record<string, unknown>;

    // Honeypot field: humans never see it, bots fill it. Pretend success so
    // the bot moves on; send nothing.
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
    const trimmedEmail = email.trim().toLowerCase();

    const channel = await sendEarlyAccessNotificationEmail({
      name: trimmedName,
      email: trimmedEmail,
      type,
      town: typeof town === "string" ? town : null,
      message: typeof message === "string" ? message : null,
    });
    // "skipped" = reserved test address (never deliverable) — treat as done.
    if (channel === "none") {
      req.log.error("Early access signup could not be delivered (no email transport)");
      res.status(500).json({ error: "Failed to submit. Please try again later." });
      return;
    }

    // Best-effort auto-reply to the visitor; never fails the signup.
    sendEarlyAccessConfirmationEmail({
      toEmail: trimmedEmail,
      toName: trimmedName,
    }).catch((err) =>
      req.log.error({ err }, "Failed to send early access confirmation email"),
    );

    res.json({ success: true });
  } catch (error: unknown) {
    req.log.error({ err: error }, "Early access signup failed");
    res.status(500).json({ error: "Failed to submit. Please try again later." });
  }
});

export default router;
