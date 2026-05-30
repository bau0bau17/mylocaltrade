---
name: Mobile filter UX — no horizontal scroll
description: User-rejected pattern for the mobile Search filters; use a bottom-sheet instead of scroll rows.
---

On the mobile Search screen, filters must be reachable WITHOUT horizontal scroll.

**Why:** The user (MyLocalTrade owner) repeatedly rejected horizontal-scroll
filter rows because end customers won't know to swipe sideways to discover the
hidden filters ("clientii nu o sa stie ca trebuie sa dea slide"). Compacting the
pills did not satisfy this — discoverability, not size, was the objection.

**How to apply:** Keep the chosen pattern — a "Filters" button (with an active
count badge) plus inline removable active-filter chips on the bar, opening a
bottom-sheet Modal that groups every filter (Sort / Verification / Plan /
Specialism). Apply filters live; footer has Clear all + "Show N results". If
adding new filter dimensions, put them in the sheet, never in a new scroll row.
Any "clear filters" action (empty state included) should reset ALL dimensions,
sort included, since sort counts as an active filter here.
