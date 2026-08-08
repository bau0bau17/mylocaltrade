---
name: Admin white-dialog text colors
description: Theme-variable text classes render near-invisible on the admin's forced-white dialogs; use explicit slate classes there
---

The admin web app is dark-themed (`--muted-foreground` etc. resolve to light values for dark backgrounds), but its Dialog component forces a white background and dark base text (`bg-white text-slate-900` + inline colors).

**Rule:** inside any white-forced surface (dialogs, and anything similar), never use theme-variable text classes — `text-muted-foreground`, `text-foreground/NN` — they resolve to the dark-theme (light grey / near-white) values and are unreadable on white. Use explicit slate classes instead: primary text inherits `text-slate-900`; labels `text-slate-700`; secondary/system text `text-slate-600`; timestamps/meta `text-slate-500`.

**Why:** the job-conversation moderation dialog rendered section labels and system messages in near-invisible light grey on white (TestFlight/admin review feedback); the cause was dark-theme CSS variables leaking into the white dialog, not a wrong opacity.

**How to apply:** when adding content to an existing admin dialog or creating a new white-surface component, grep the JSX for `muted-foreground` and `foreground/` and replace with slate equivalents. Background tints like `bg-muted/30` are usually fine — it's the text colors that break. Related: a `ScrollArea` that is a flex child of a `max-h-*` flex-col DialogContent needs `min-h-0` or tall content clips instead of scrolling.
