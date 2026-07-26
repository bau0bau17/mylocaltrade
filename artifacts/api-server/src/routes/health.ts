import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getOpenLinkStatus } from "../lib/email";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  // Surface the email deep-link base so a misconfigured deployment is
  // visible from the health route, not just buried in send-time logs.
  // Additive field — the zod-validated shape stays intact.
  res.json({ ...data, openLink: getOpenLinkStatus() });
});

router.get("/", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
