---
name: Onboarding completion source of truth
description: Why the client must act on the server's completion verdict, not HTTP 200, when advancing trader onboarding steps.
---

# Onboarding step advancement must follow the server's verdict, not HTTP 200

A multi-field save (e.g. trader Business Profile PUT `/api/profile`) is gated for
completion on BOTH sides: the client has its own `computeRequirements`/`allMet`
check, and the server independently re-evaluates with `evaluateBusinessProfileComplete`
and only then flips `businessProfileCompleted` and transitions
`PROFILE_INCOMPLETE -> PENDING_DOCUMENTS`.

**Rule:** the client must advance onboarding ONLY when the server positively
confirms completion. Save endpoints return `businessProfileComplete` (boolean) +
`businessProfileMissing` (unmet requirement labels); the client gates navigation
on `=== true` and otherwise stays put and shows the missing items.

**Why:** previously the client navigated to the dashboard on any HTTP 200. When
the two gates diverged (nullable/missing `businessType`, server-side
normalisation, or a stale client), the server kept the trader incomplete while
the client bounced them to a dashboard that still read "Action required" — a
silent dead-end that looks like "saving did nothing / won't continue".

**How to apply:** any step whose completion the server decides independently must
echo that verdict in its save response, and the client must act on the verdict
rather than on the HTTP status. Don't add a second divergent copy of the rule;
surface the server's list. The dashboard already refetches on focus
(`useFocusEffect`), so stale UI was never the cause — the missing transition was.
