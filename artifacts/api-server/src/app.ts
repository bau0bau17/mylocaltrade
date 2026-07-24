import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { createPgStore } from "./lib/pg-rate-limit-store";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Phase 8: strict CSP — this server only emits JSON (no HTML pages, no inline
// scripts, no third-party assets), so we lock everything down to 'none' and
// keep CORP cross-origin so the mobile/admin clients can still consume it.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  }),
);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : null;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (!allowedOrigins) {
        callback(null, true);
        return;
      }
      const isAllowed =
        allowedOrigins.some((o) => origin === o || origin.endsWith(o));
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      }
    },
    credentials: true,
  }),
);

// All rate limiters use a PostgreSQL-backed shared store so that counters are
// enforced globally across every instance in an autoscaled deployment.  Each
// limiter gets a unique prefix so that keys from different limiters (same IP,
// different routes) never collide in the rate_limit_hits table.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  store: createPgStore("auth"),
});

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Too many resend requests. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("resend"),
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/api/webhooks"),
  store: createPgStore("api"),
});

// Phase 8: extra per-endpoint limits on top of the global limiter.
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Too many contact messages. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("contact"),
});

const enquiriesLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: "Too many enquiries. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("enquiries"),
});

const messagesLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: "Too many messages. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("messages"),
});

const reportsLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many reports. Please try again tomorrow." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("reports"),
});

const documentUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: "Too many document upload requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("doc-upload"),
});

// Customer upload-URL requests share the same abuse surface as trader
// document uploads: each request mints a presigned PUT URL into the private
// bucket, so an unthrottled endpoint lets one account mass-mint URLs for
// storage exhaustion. Same budget as documentUploadLimiter.
const customerUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: "Too many upload requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("customer-upload"),
});

const cancellationRequestLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many cancellation requests. Please contact support." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("cancellation"),
});

// Phone OTP: per-device (IP) hourly cap so a single device cannot burn through
// SMS credits. The per-number hourly cap, the per-account 60s resend cooldown
// and the per-account attempt limit live in routes/trader-phone.ts (they need
// the authenticated account / resolved number, which are not available at this
// middleware layer). Twilio Verify enforces its own per-number limits on top.
const phoneOtpIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: { error: "Too many verification requests from this device. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("phone-otp-ip"),
});

app.use(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/resend-verification", resendLimiter);
app.use("/api/auth/forgot-password", resendLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/trader/phone/send-otp", phoneOtpIpLimiter);
app.use("/api/profile/phone-change/send-otp", phoneOtpIpLimiter);
app.use("/api/customer/phone/send-otp", phoneOtpIpLimiter);
app.use("/api/contact", contactLimiter);
app.use("/api/enquiries", enquiriesLimiter);
app.use(/^\/api\/conversations\/\d+\/messages$/, messagesLimiter);
app.use(/^\/api\/conversations\/\d+\/report$/, reportsLimiter);
app.use("/api/reports", reportsLimiter);
app.use("/api/trader/documents/upload-url", documentUploadLimiter);
app.use("/api/customer/uploads/upload-url", customerUploadLimiter);
app.use("/api/subscriptions/cancellation-request", cancellationRequestLimiter);
app.use("/api", apiLimiter);

// Public, unauthenticated logo endpoint used by transactional emails. Brevo
// only renders <img src="..."> from absolute URLs (no CID embedding), so we
// host the brand logo here and reference it in every email shell.
const PUBLIC_LOGO_CANDIDATES = [
  path.resolve(process.cwd(), "dist/assets/logo.png"),
  path.resolve(process.cwd(), "src/assets/logo.png"),
  path.resolve(process.cwd(), "artifacts/api-server/dist/assets/logo.png"),
  path.resolve(process.cwd(), "artifacts/api-server/src/assets/logo.png"),
];
const PUBLIC_LOGO_PATH = PUBLIC_LOGO_CANDIDATES.find((p) => fs.existsSync(p));
app.get("/api/public/logo.png", (_req, res) => {
  if (!PUBLIC_LOGO_PATH) {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.setHeader("Content-Type", "image/png");
  res.sendFile(PUBLIC_LOGO_PATH);
});

app.use("/api", router);

export default app;
