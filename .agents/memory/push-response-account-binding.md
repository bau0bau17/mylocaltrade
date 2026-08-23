---
name: Push response account binding
description: Safe navigation of push-notification responses after account switches on a shared device.
---

Every push-notification response that can navigate must be bound to its intended recipient by the central push sender, and mobile must require that immutable identity to match the currently authenticated user before routing.

**Why:** Push tokens can be reassigned when a shared device switches accounts. A conversation or dashboard identifier without a recipient binding can steer the newly active account toward a stale notification. API authorization prevents data disclosure, but should not be relied on for navigation correctness.

**How to apply:** Add recipient binding centrally rather than trusting individual notification producers. Treat legacy, malformed, or mismatched responses as consumed without navigation; retain server-side authorization as the final data-access guard.