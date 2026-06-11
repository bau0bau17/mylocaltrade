---
name: Trader business-type / company-number gating
description: Where the LTD-only company-registration-number rule lives and what must stay in sync.
---

A trader's `businessType` (LIMITED_COMPANY | SOLE_TRADER, nullable until declared) is the single
source of truth for whether a Companies House company registration number is mandatory and whether
the automatic register check runs.

Rule: company number is REQUIRED **only** when `businessType === LIMITED_COMPANY`; sole traders
never supply it (and the server clears `companyNumber` to null whenever the effective type is
SOLE_TRADER). Format regex is `/^[A-Z0-9]{6,10}$/`, stored normalised (uppercase, spaces stripped).

**Why:** the LTD-only gate is duplicated in three places that must agree, or the mobile form and the
server will disagree on whether a profile is "complete":
- mobile `business-profile.tsx` (client-side validation + conditional company-number input)
- server `trader-status.ts` `evaluateBusinessProfileComplete` (authoritative completion gate)
- `profile.ts` PUT (normalisation + clearing companyNumber for sole traders; `companyChanged`
  must include `businessType` so verification side-effects re-run on a structure change)

**How to apply:** when changing the requirement, the regex, or the allowed business types, update all
three plus `openapi.yaml` (TraderProfile + UpdateTraderProfileRequest) and re-run api-spec codegen.
Both GET and PUT `/api/profile` must echo `businessType` + `companyNumber`.

**Stale-client trap:** because `businessType` is nullable and was added later, any client that
doesn't send it (old mobile bundle, or any partial PUT) leaves it null, so the server completion
gate fails silently — the PUT returns 200 but the profile never reaches PENDING_DOCUMENTS and the
documents step stays locked. Symptom: user "saves" repeatedly (audit log shows BUSINESS_PROFILE_UPDATED
with no BUSINESS_PROFILE_COMPLETED) but can't continue. Diagnose via trader_audit_log. The mobile
Save button must never be a disabled dead-end: keep it pressable so tapping surfaces an error that
names the missing requirement(s). Stale local Mac bundles need a pull + `expo start -c` to get the
selector.
