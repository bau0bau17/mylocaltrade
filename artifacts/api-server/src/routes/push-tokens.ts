import { Router, type IRouter } from "express";
import { z } from "zod";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { registerPushToken, unregisterPushToken } from "../lib/push-notifications";

const router: IRouter = Router();

const RegisterBody = z.object({
  token: z.string().trim().min(8).max(255),
  platform: z.enum(["ios", "android", "web"]).optional(),
});

const UnregisterBody = z.object({
  token: z.string().trim().min(8).max(255),
});

// POST /api/push-tokens — register/refresh an Expo push token for the current user
router.post("/push-tokens", authMiddleware, async (req, res) => {
  try {
    const body = RegisterBody.parse(req.body);
    const { userId } = req as AuthenticatedRequest;
    await registerPushToken(userId, body.token, body.platform ?? null);
    res.status(201).json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid push token", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Register push token failed");
    res.status(500).json({ error: "Failed to register push token" });
  }
});

// DELETE /api/push-tokens — unregister a push token (e.g. on logout)
router.delete("/push-tokens", authMiddleware, async (req, res) => {
  try {
    const body = UnregisterBody.parse(req.body);
    const { userId } = req as AuthenticatedRequest;
    await unregisterPushToken(userId, body.token);
    res.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid push token", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Unregister push token failed");
    res.status(500).json({ error: "Failed to unregister push token" });
  }
});

export default router;
