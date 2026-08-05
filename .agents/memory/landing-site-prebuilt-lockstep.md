---
name: Landing site is prebuilt — HTML + JS chunk lockstep
description: How to edit copy on the static landing site under the mobile artifact's server (no source project in repo)
---

The public landing site served by the mobile artifact's production server (`artifacts/mobile/server/landing-site/`) is a **compiled Vite build with no source project in the repo**. Every page exists twice:

1. Prerendered HTML (`<page>/index.html`) — what crawlers and first paint see.
2. A minified JS chunk (`assets/<Page>-<hash>.js`) with the same JSX strings — what React hydrates/renders client-side.

**Rule:** any copy change must be applied to BOTH files with byte-identical rendered text (same punctuation, apostrophes, em-dashes). If they diverge, the page flashes the old copy after hydration (or shows stale text for SPA navigation, since client-side route changes render only from the JS chunk).

**How to apply:**
- Keep file names/hashes and import structure untouched; edit only string content inside.
- Text ampersands: in HTML they are `&amp;` entities; avoid including `&` in match strings to dodge tool-escaping ambiguity.
- Avoid characters outside the self-hosted Inter latin subset (e.g. `→` U+2192 is NOT in the subset; use commas instead). Em-dash U+2014 is fine.
- Meta descriptions live in the HTML head (3x: description/og/twitter) AND in the chunk's SEO hook call — update all.
- `serve.js` caches files in memory — dev restart / prod redeploy needed to see changes.
- Verify with `grep -o "<phrase>" | wc -l` on both files (the HTML body is one line, so `grep -c` misleads).
