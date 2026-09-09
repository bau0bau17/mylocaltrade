# Restricted CSEA manual operational step

This is an internal moderation procedure, not a public report category and not a
legal finding. When a moderator reasonably suspects child sexual exploitation or
abuse content in an existing suspected-illegal-content report, an allowlisted
specialist can review candidates at `GET /api/admin/csea-candidates` and use
`POST /api/admin/user-reports/:id/csea-escalate` or
`POST /api/admin/conversation-reports/:id/csea-escalate`. This records the
admin, report, and time; it is not a legal finding or moderation outcome.
After the manual step, use
`POST /api/admin/csea-reports/user/:id/complete` or
`POST /api/admin/csea-reports/conversation/:id/complete`. Completion removes
the item from the active restricted queue without changing its moderation
outcome.

Do not copy sensitive content into tickets, email, chat, or personal storage.
Do not contact a child or alleged perpetrator. Follow the organisation's
approved safeguarding/legal instructions and any applicable authority process
manually; this application does not claim to determine illegality and has no
external reporting integration. If there is an immediate danger, use emergency
services rather than treating MyLocalTrade as an emergency service.