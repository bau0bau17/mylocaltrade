---
name: Quote lifecycle invariants
description: How "one live quote per conversation" and lazy expiry are enforced for structured quotes.
---

- **Rule:** "One live PENDING quote per conversation" is enforced at the DB level by the partial unique index `quotes_one_pending_per_conversation` (`conversation_id WHERE status='PENDING'`), not just the application-level pre-check. Create/revise routes map Postgres 23505 on that constraint to an ordinary 409.
- **Why:** the check-then-insert pattern races under concurrent requests; the architect review flagged that two parallel creates could both insert PENDING. Any new write path that inserts PENDING quotes must go through the same 409 mapping.
- Expiry is lazy: rows may still say PENDING after validUntil passes; the wire status is computed (`effectiveQuoteStatus`) and accept uses a conditional UPDATE with a validUntil guard. No cron — never add a sweep that mutates rows without checking these paths.
- **How to apply:** if you change quote statuses or add bulk operations, keep the partial index satisfied (never two PENDING rows per conversation, e.g. revise must flip old→REVISED and insert in one transaction) and preserve the 23505→409 handling.
- Test-fixture gotcha: enquiry/message text containing long digit runs (e.g. `Date.now()` suffixes) trips the contact-info filter and 400s — use letters-only unique suffixes in integration tests.
