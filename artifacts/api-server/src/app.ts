import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Too many resend requests. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/api/webhooks"),
});

// Phase 8: extra per-endpoint limits on top of the global limiter.
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Too many contact messages. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const enquiriesLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: "Too many enquiries. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

const messagesLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: "Too many messages. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

const reportsLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many reports. Please try again tomorrow." },
  standardHeaders: true,
  legacyHeaders: false,
});

const documentUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: "Too many document upload requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
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
app.use("/api/trader/phone/send-otp", resendLimiter);
app.use("/api/contact", contactLimiter);
app.use("/api/enquiries", enquiriesLimiter);
app.use(/^\/api\/conversations\/\d+\/messages$/, messagesLimiter);
app.use(/^\/api\/conversations\/\d+\/report$/, reportsLimiter);
app.use("/api/trader/documents/upload-url", documentUploadLimiter);
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
