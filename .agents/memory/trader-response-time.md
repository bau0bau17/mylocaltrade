---
name: Trader response-time display
description: One source of truth for trader reply speed; avoid qualitative buckets that contradict the exact figure
---

# Trader response-time display

`responseTimeMinutes` is a **real** median (server computes it from first
customer message -> first trader reply per conversation, last 90 days, needs >=2
samples). The precise label "Replies in ~Xm/~Xh/~Xd" (`formatResponseTime`) is
the single source of truth and is shown in the card footer and profile.

**Rule:** do not pair the exact figure with a loose qualitative badge that can
disagree with it. We removed the "Replies promptly" badge because its threshold
was anything up to 24h, so a trader with a ~9h median got "Replies promptly"
next to "Replies in ~9h" — a visible contradiction.

**What we keep:** the "Replies fast" badge (`isFastResponder`, <=60 min) only,
because it never contradicts the figure (it implies ~Xm or ~1h). Any future
speed badge must stay consistent with the displayed minutes.

**Why:** user reported the card showed two different reply-speed claims; reply
speed must be accurate everywhere it appears.

**How to apply:** lives in `artifacts/mobile/components/TraderCard.tsx`
(`formatResponseTime`, `isFastResponder`); also rendered in
`app/trader/[id].tsx` and a fast-only trust chip in `app/(tabs)/enquiry/[traderId].tsx`.
