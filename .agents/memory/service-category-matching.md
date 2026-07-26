---
name: Canonical service/category matching
description: Category labels ↔ trader service synonyms live in one server module; never per-screen matching rules.
---

Customer-facing category labels ("Electrical", "Building") differ from stored trader service values ("Electrician", "Builder"). All matching goes through the canonical map in the API server's `lib/service-categories.ts` (`expandServiceTerms`), applied to BOTH the `/traders` `category` filter and the free-text `search` param, matched against `mainCategory` AND `additionalServices` via ILIKE %term%.

Rules:
- No fuzzy matching; every synonym is listed explicitly. Unknown inputs return null → plain substring fallback (previous behaviour).
- Terms may map to multiple categories (e.g. legacy "Heating & Gas" → heating + gas); expansion unions their terms deterministically.
- Avoid generic terms ("Repairs", bare "Property maintenance" in several categories) — they cause cross-category false positives.
- Trader data is never rewritten; mapping is query-time only.

**Why:** Home popular-category quick search passes its display label as free text; without expansion "Electrical" never matched "Electrician".
**How to apply:** any new screen/endpoint filtering traders by category or service must call expandServiceTerms rather than adding its own rules; keep the vocabulary in sync with the mobile uk-services autocomplete list.
