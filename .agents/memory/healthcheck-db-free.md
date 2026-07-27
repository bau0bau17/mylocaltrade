---
name: Healthcheck must stay DB-free
description: Deployment healthcheck GET /api must bypass the Postgres-backed rate limiter; DB latency read as downtime.
---

The autoscale deployment healthchecks `GET /api` every ~90s with a 10s deadline. Every `/api` request passes through the global express-rate-limit whose store is a Postgres upsert (`rate_limit_hits`). Production logs showed the trivial health handler taking ~1–2s baseline and >10s spikes ("context deadline exceeded") → instance marked unhealthy → uptime-monitor "outages", with no app crash at all.

Fix: the global apiLimiter `skip` exempts `/api`, `/api/`, `/api/healthz` (and webhooks). Health endpoints must never touch the database or any external dependency.

**Why:** DB cold starts/latency otherwise translate directly into reported downtime.
**How to apply:** any new middleware added in front of `/api` (limiters, session lookups, logging that writes to DB) must exempt the health paths. Note: with `app.use("/api", mw)` Express strips the mount path — check `req.originalUrl`, not `req.path`, when matching `/api/...` prefixes inside such middleware.
