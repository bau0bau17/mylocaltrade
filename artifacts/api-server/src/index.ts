import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { bootstrapAdminFromEnv } from "./lib/admin-bootstrap";
import { backfillJobReferences } from "./lib/job-reference-backfill";
import { backfillRequestGroups } from "./lib/request-group-backfill";

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

app.listen(port, () => {
  logger.info({ port }, "Server listening");
  startScheduler();
  void bootstrapAdminFromEnv();
  void backfillJobReferences();
  void backfillRequestGroups();
});
