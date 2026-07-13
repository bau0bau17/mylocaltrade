import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { bootstrapAdminFromEnv } from "./lib/admin-bootstrap";
import { backfillJobReferences } from "./lib/job-reference-backfill";
import { backfillRequestGroups } from "./lib/request-group-backfill";
import { normalizeLegacyEmails } from "./lib/email-normalization-backfill";

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

// Normalize legacy email casing before accepting traffic so registrations
// can never race the backfill. Errors are logged and swallowed inside, so a
// failed normalization never blocks startup.
await normalizeLegacyEmails();

app.listen(port, () => {
  logger.info({ port }, "Server listening");
  startScheduler();
  void bootstrapAdminFromEnv();
  void backfillJobReferences();
  void backfillRequestGroups();
});
