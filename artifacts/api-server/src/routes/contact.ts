import { Router, type IRouter } from "express";
import { sendContactEmail } from "../lib/email";

const router: IRouter = Router();

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

    sendContactEmail({
      fromName: name.trim(),
      fromEmail: email.trim(),
      subject: subject.trim(),
      message: message.trim(),
    }).catch((err) => req.log.error({ err }, "Failed to send contact email"));

    res.json({ success: true, message: "Your message has been sent. We'll get back to you shortly." });
  } catch (error: unknown) {
    req.log.error({ err: error }, "Contact form failed");
    res.status(500).json({ error: "Failed to send message. Please try again." });
  }
});

export default router;
