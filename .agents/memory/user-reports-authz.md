---
name: User-reports reporting authz
description: How profile-level user_reports resolve the reported party and why customer reports must derive from the conversation
---

# Profile-level reporting (user_reports) authz model

Login-only `POST /api/reports` (separate from `conversation_reports`). Two subjects: trader and customer.

- **Trader reports**: client sends `traderProfileId`; server looks up the owning user. An optional `conversationId` is only stored when the reporter is that conversation's customer.
- **Customer reports**: the client NEVER sends a customer user id. The server REQUIRES `conversationId`, verifies the reporting trader owns that conversation (`conv.traderProfileId === reporter's traderProfile.id`), then derives `reportedUserId = conv.customerId`.

**Why:** accepting a client-supplied `reportedUserId` lets a trader file reports against arbitrary users they never interacted with (IDOR / report-targeting abuse). Deriving from a verified shared conversation closes that. `reportedUserId` was removed from both the zod body schema and the OpenAPI `CreateReportRequest` so clients cannot drift back into the unsafe path.

**How to apply:** if you add new report entry points or change the request contract, keep customer-subject reports conversation-derived only; never reintroduce a client-provided reported user id. Self-report is also blocked after resolution.
