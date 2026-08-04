---
name: Search screen state conventions
description: Search tab param-nonce navigation, draft-based filter sheet, and the deliberate removal of the Premium plan filter from customer search.
---

# Search screen state conventions (mobile)

The Search screen is a Tabs screen: it stays MOUNTED between visits and its
route params persist on the route. `useState(params.X)` captures only the
FIRST navigation into the tab.

**Rules:**

- Navigations into Search that must change its state carry nonce params:
  Home category cards send `category` + `ts` (nonce, so re-taps of the same
  category re-apply); Home's non-input search bar sends `reset` (fresh open =
  empty query, no stale results; location and committed filters untouched).
  Effects in the Search screen consume these, guarded by refs so ordinary
  re-renders never re-apply an already-consumed navigation.
- **Why:** stale mounted state + first-nav-only param capture made a
  previously tapped category ("Plumbing") reappear as a phantom query with
  stale results when Search was reopened from Home — it looked like the app
  was injecting a "plumber" search by itself.

- The filter sheet is DRAFT-based: opening snapshots committed → draft;
  sheet chips edit drafts only; Apply ("Show N results") commits and closes;
  X / backdrop tap / hardware back discard drafts; Clear-all resets drafts
  only and never touches query or location. Active-filter chips OUTSIDE the
  sheet commit instantly (no draft concept there). A second traders query
  keyed on draft params powers the accurate "Show N results" CTA and is
  enabled only while the sheet is open.
- **How to apply:** never mutate committed filter state from inside the
  sheet; keep the sheet Modal OUTSIDE the hasSearched ternary (it must be
  mountable before any search has run).

- The Premium **plan filter was deliberately removed** from customer search
  (plan = paid tier, not a quality signal; verification drives trust — see
  trader-public-visibility). Don't re-add it; the API still accepts `plan`
  but the mobile customer search must not send it.
