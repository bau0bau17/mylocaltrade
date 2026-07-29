---
name: Booking conflict & blocking rules
description: Which booking rows block a trader's calendar, where conflicts are enforced, and UK DST slot rules.
---

Single source: `artifacts/api-server/src/lib/booking-availability.ts`.

**Rules:**
- BLOCKING for a trader: future/ongoing CONFIRMED bookings across ALL conversations, PLUS the latest previously-confirmed SUPERSEDED row of any conversation whose reschedule proposal is still PROPOSED (the old slot stays reserved until the reschedule resolves).
- NOT blocking: plain PROPOSED, cancelled/declined, and any interval fully in the past.
- Legacy bookings with NULL duration = 60 min.
- Conflicts + working hours are enforced at BOTH propose and confirm (trader may narrow hours or another conversation may take the slot between propose and confirm). Both return 409 `code:"SLOT_TAKEN"` with the friendly message constant.
- Conflict checks exclude the acting conversation's own live booking.

**Why:** double-booking protection must survive the propose→confirm gap and pending reschedules; an unconfirmed proposal must never lock the trader's diary.

**UK time:** `ukLocalToUtc` returns **null** for nonexistent spring-forward wall times — callers must skip/reject. Slot generation is UK-local (Europe/London) with 30-min steps; traders without configured `workingHours` fall back permissively to 08:00–18:00.

**Tests gotcha:** bookings tests must give every proposal a distinct future slot (shared timestamps now 409 against each other); generic test slots start 30 days out to avoid the fixed-date conflict tests.
