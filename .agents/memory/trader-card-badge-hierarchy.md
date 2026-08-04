---
name: Trader card & profile badge hierarchy
description: Verified is the ONLY verification signal on trader cards; profile perk badges are deliberately quiet outline chips
---

**Rule 1 — cards:** `TraderCard` shows a single aggregated "Verified" badge (+ green shield next to the name). Do NOT reintroduce per-item verification chips (Email/Phone/Profile/Docs) on cards.
**Why:** User-approved premium polish pass (Aug 2026): four equal-weight chips per card read as clutter and diluted the trust signal. The detailed breakdown still exists on the trader profile via the "What does Verified mean?" modal, so no information was lost.
**How to apply:** Any card-level "show more verification detail" request should link/route to the profile modal instead of adding chips back.

**Rule 2 — profile hero:** On `app/trader/[id].tsx`, Category + Verified are the only filled (loud) badges; Premium / Top rated / Replies fast use the quiet outline `secondaryBadge` style.
**Why:** Five equal-weight filled badges competed at the top of the profile; identity + trust must lead the hierarchy.
**How to apply:** New perk/plan badges on the profile hero should use `secondaryBadge`, not `planBadge` with a filled background.
