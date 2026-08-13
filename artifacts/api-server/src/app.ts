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
import { buildAllowedOrigins, isOriginAllowed } from "./lib/cors";

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

// Strict-equality CORS allow-list (see lib/cors.ts). In production the list
// is mandatory (ALLOWED_ORIGINS, or derived from REPLIT_DOMAINS) and this
// throws at startup when absent; only dev/test may fall back to permissive.
const allowedOrigins = buildAllowedOrigins();
if (allowedOrigins === null) {
  logger.warn(
    "ALLOWED_ORIGINS is not set — CORS reflects any origin. This is a dev/test-only fallback; production requires an explicit allow-list.",
  );
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        // Non-browser clients (mobile app, curl, server-to-server) send no
        // Origin header; CORS does not apply to them.
        callback(null, true);
        return;
      }
      if (isOriginAllowed(origin, allowedOrigins)) {
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
  // Health endpoints MUST bypass this limiter: its store does a Postgres
  // upsert per request, so the deployment healthcheck (GET /api) would
  // inherit database latency — a slow/cold DB then reads as an unhealthy
  // instance and shows up as an outage. Health stays DB-free.
  skip: (req) => {
    const p = (req.originalUrl || req.url || "").split("?")[0];
    return (
      p === "/api" ||
      p === "/api/" ||
      p === "/api/healthz" ||
      p.startsWith("/api/webhooks") ||
      req.path.startsWith("/api/webhooks")
    );
  },
  store: createPgStore("api"),
});

// Company Teams: the public invitation lookup/accept endpoints take a raw
// invite token from anyone on the internet — throttle guessing attempts hard
// (tokens are 256-bit, this is defence in depth).
const companyInviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("company-invite"),
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

// Landing-site "Join Early Access" form: public + sends email, so throttle
// like the contact form but in its own bucket (one form must not eat the
// other's allowance).
const earlyAccessLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Too many signups from this connection. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  // Mounted on the /api/early-access prefix, so the confirm, unsubscribe and
  // webhook endpoints would otherwise share (and starve) the 5/hour form
  // bucket — each has its own limiter below. req.path is mount-relative here.
  skip: (req) =>
    req.path.startsWith("/confirm") ||
    req.path.startsWith("/unsubscribe") ||
    req.path.startsWith("/brevo-events"),
  store: createPgStore("early-access"),
});

// Double opt-in confirmation POST: takes a raw single-use token from anyone
// on the internet, so throttle guessing attempts (tokens are 256-bit — this
// is defence in depth), while leaving room for legitimate retries/resends.
const earlyAccessConfirmLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: { error: "Too many attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("early-access-confirm"),
});

// Unsubscribe POST (Phase 2B): takes a signed token from anyone on the
// internet. Tokens are HMAC-signed (unguessable), so this limiter only
// throttles brute-force noise while leaving room for legitimate retries.
const earlyAccessUnsubscribeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: { error: "Too many attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("early-access-unsub"),
});

// Brevo marketing webhook (Phase 2B): server-to-server, shared-secret
// gated. Brevo can burst events after a batch send, so the budget is
// deliberately generous — the limiter only caps runaway abuse.
const brevoWebhookLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  message: { error: "Too many requests." },
  standardHeaders: true,
  legacyHeaders: false,
  store: createPgStore("brevo-webhook"),
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
app.use("/api/early-access/confirm", earlyAccessConfirmLimiter);
app.use("/api/early-access/unsubscribe", earlyAccessUnsubscribeLimiter);
app.use("/api/early-access/brevo-events", brevoWebhookLimiter);
app.use("/api/early-access", earlyAccessLimiter);
app.use("/api/enquiries", enquiriesLimiter);
app.use(/^\/api\/conversations\/\d+\/messages$/, messagesLimiter);
app.use(/^\/api\/conversations\/\d+\/report$/, reportsLimiter);
app.use("/api/reports", reportsLimiter);
app.use("/api/trader/documents/upload-url", documentUploadLimiter);
app.use("/api/customer/uploads/upload-url", customerUploadLimiter);
app.use("/api/subscriptions/cancellation-request", cancellationRequestLimiter);
app.use("/api/company/invites/lookup", companyInviteLimiter);
app.use("/api/company/invites/accept", companyInviteLimiter);
app.use("/api", apiLimiter);

// Public, unauthenticated logo endpoint used by transactional emails. Brevo
// only renders <img src="..."> from absolute URLs (no CID embedding), so we
// host the brand logo here and reference it in every email shell.
//
// The asset is the canonical MyLocalTrade mark (byte-identical copy of the
// mobile app's logo@2x.png). The versioned "-v2" path busts email-client /
// CDN caches that stored the old pre-v2 icon; the legacy /api/public/logo.png
// path is kept as an alias to the SAME canonical file so images in
// already-delivered emails continue to load (and now show the correct mark).
const PUBLIC_LOGO_CANDIDATES = [
  path.resolve(process.cwd(), "dist/assets/mylocaltrade-logo-v2.png"),
  path.resolve(process.cwd(), "src/assets/mylocaltrade-logo-v2.png"),
  path.resolve(process.cwd(), "artifacts/api-server/dist/assets/mylocaltrade-logo-v2.png"),
  path.resolve(process.cwd(), "artifacts/api-server/src/assets/mylocaltrade-logo-v2.png"),
];
const PUBLIC_LOGO_PATH = PUBLIC_LOGO_CANDIDATES.find((p) => fs.existsSync(p));
const serveCanonicalLogo = (_req: express.Request, res: express.Response) => {
  if (!PUBLIC_LOGO_PATH) {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.setHeader("Content-Type", "image/png");
  res.sendFile(PUBLIC_LOGO_PATH);
};
app.get("/api/public/mylocaltrade-logo-v2.png", serveCanonicalLogo);
// Legacy path referenced by emails sent before the v2 rename.
app.get("/api/public/logo.png", serveCanonicalLogo);

app.use("/api", router);

export default app;
