import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { contactMessagesTable } from "@workspace/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { sendContactEmail } from "../lib/email";

const router: IRouter = Router();

const RATE_LIMIT_MAX = 2;
const RATE_LIMIT_WINDOW_MS = 48 * 60 * 60 * 1000;

router.post("/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body as Record<string, unknown>;

    if (
      typeof name !== "string" || !name.trim() ||
      typeof email !== "string" || !email.includes("@") ||
      typeof subject !== "string" || !subject.trim() ||
      typeof message !== "string" || message.trim().length < 10
    ) {
      res.status(400).json({ error: "Please fill in all fields correctly." });
      return;
    }

    if (name.length > 100 || subject.length > 200 || message.length > 2000) {
      res.status(400).json({ error: "One or more fields exceed the maximum length." });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactMessagesTable)
      .where(and(
        eq(contactMessagesTable.email, trimmedEmail),
        gte(contactMessagesTable.sentAt, windowStart),
      ));

    if (count >= RATE_LIMIT_MAX) {
      const [oldest] = await db
        .select({ sentAt: contactMessagesTable.sentAt })
        .from(contactMessagesTable)
        .where(and(
          eq(contactMessagesTable.email, trimmedEmail),
          gte(contactMessagesTable.sentAt, windowStart),
        ))
        .orderBy(contactMessagesTable.sentAt)
        .limit(1);

      const nextAllowedAt = oldest
        ? new Date(oldest.sentAt.getTime() + RATE_LIMIT_WINDOW_MS).toISOString()
        : new Date(Date.now() + RATE_LIMIT_WINDOW_MS).toISOString();

      res.status(429).json({
        error: "Message limit reached",
        code: "CONTACT_RATE_LIMIT",
        nextAllowedAt,
        limit: RATE_LIMIT_MAX,
        windowHours: 48,
      });
      return;
    }

    await db.insert(contactMessagesTable).values({
      email: trimmedEmail,
      name: name.trim(),
      subject: subject.trim(),
      message: message.trim(),
    });

    sendContactEmail({
      fromName: name.trim(),
      fromEmail: trimmedEmail,
      subject: subject.trim(),
      message: message.trim(),
    }).catch((err) => req.log.error({ err }, "Failed to send contact email"));

    res.json({
      success: true,
      message: "Your message has been sent. We'll get back to you shortly.",
      remaining: RATE_LIMIT_MAX - (count + 1),
    });
  } catch (error: unknown) {
    req.log.error({ err: error }, "Contact form failed");
    res.status(500).json({ error: "Failed to send message. Please try again." });
  }
});

export default router;
