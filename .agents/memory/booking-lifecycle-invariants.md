---
name: Booking lifecycle invariants
description: Conversation appointment/booking rules — one live row, live-job gate on every mutation, notify direction.
---

Bookings are the lightweight appointments inside hired conversations (statuses PROPOSED / CONFIRMED / CANCELLED / SUPERSEDED).

Rules:
- **One live booking per conversation** is a partial unique index (`status IN ('PROPOSED','CONFIRMED')`); a concurrent propose loses with 23505 → 409. Reschedule = supersede-then-insert inside one transaction, never a silent update of a confirmed row.
- **Every booking mutation (propose, confirm, AND cancel) must pass the same live-job gate** (hired, not cancelled/completed/closed). Cancel was the one initially missed — without it, system messages get appended to closed jobs.
- Confirm is only valid for the party who did NOT propose; conditional UPDATE on `status='PROPOSED'` keeps it race-safe.
- Notify direction: propose/cancel → opposite party; confirm → the proposer. System message `notify` side mirrors push.
- Server formats appointment times with `timeZone: "Europe/London"` (physical UK visits); wire format is UTC ISO.

**Why:** booking is additive to the quotes/hire flow and must never leak activity into terminated jobs or double-book via races.
**How to apply:** any new booking mutation or admin surface must reuse `bookingClosedReason` + participant checks, and keep the partial unique index semantics.
