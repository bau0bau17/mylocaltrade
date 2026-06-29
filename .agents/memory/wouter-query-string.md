---
name: wouter useLocation drops the query string
description: Why reading URL query params from wouter's useLocation() silently fails, and what to use instead.
---

# wouter v3 `useLocation()` returns the pathname only — no query string

Reading `?status=...` etc. by parsing the string from `useLocation()` always
comes up empty, so incoming filters from links/redirects are silently dropped
and the page falls back to its default state.

**Why:** in wouter v3 the location value is pathname-only by design; the search
string is a separate concern.

**How to apply:** read query params with wouter's `useSearch()` (returns the
search string without the leading `?`, feed straight into `URLSearchParams`), or
fall back to `window.location.search`. This bit the admin dashboard: status
deep-links like `/traders?status=PROFILE_INCOMPLETE` showed nothing because the
filter reset to the default. Note `navigate("/path?x=y")` still writes the query
fine — only the read path was broken.
