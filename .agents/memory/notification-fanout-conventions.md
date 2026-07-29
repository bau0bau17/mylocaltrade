---
name: Notification fan-out conventions
description: How completion/lifecycle notifications avoid double-sends and how email/push failures are isolated.
---

**Rules:**
- Any status-transition notification must be gated by an **atomic conditional UPDATE** (`WHERE <timestamp_col> IS NULL ... RETURNING`) — only the request whose update affected a row sends. In-memory `if (!conv.field)` pre-checks alone are racy (concurrent double-taps double-send).
- Email and push sends are wrapped in **separate try/catch blocks**: an email provider failure must never kill the push (this was the root cause of traders missing message notifications).
- Fan-out runs fire-and-forget (`void (async () => { ... })()`) with a top-level catch + `req.log.warn`; never let it affect the HTTP response.

**Why:** RC/webhook overlap already taught us dedupe (see subscription-notification-dedupe); the same applies to job-completion flows (trader-mark-done, customer complete, review invite).
