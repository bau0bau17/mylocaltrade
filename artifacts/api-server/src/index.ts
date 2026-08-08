import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { bootstrapAdminFromEnv } from "./lib/admin-bootstrap";
import { ensureCompanyTeamsBackfill } from "./lib/company-backfill";
import { backfillJobReferences } from "./lib/job-reference-backfill";
import { backfillRequestGroups } from "./lib/request-group-backfill";
import { normalizeLegacyEmails } from "./lib/email-normalization-backfill";
import { assertOpenLinkBaseAtStartup } from "./lib/email";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// No top-level await here: the production bundle is CJS (esbuild), which
// does not support it. Startup is wrapped in an async function instead.
async function start(): Promise<void> {
  // Normalize legacy email casing before accepting traffic so registrations
  // can never race the backfill. Errors are logged and swallowed inside, so
  // a failed normalization never blocks startup.
  await normalizeLegacyEmails();

  app.listen(port, () => {
    logger.info({ port }, "Server listening");
    // Loudly assert at boot that email /open links resolve to an associated
    // domain (Universal Links); errors in production, warns in dev.
    assertOpenLinkBaseAtStartup();
    startScheduler();
    void bootstrapAdminFromEnv();
    void ensureCompanyTeamsBackfill();
    void backfillJobReferences();
    void backfillRequestGroups();
  });
}

void start();
