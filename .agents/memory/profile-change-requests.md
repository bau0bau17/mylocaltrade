---
name: Profile change request workflow
description: Durable rules for the admin-reviewed profile change request system (protected fields, lifecycle triggers, phone OTP, event log).
---

# Profile change request workflow

- Protected field lists are exported from `lib/db` schema (`PROTECTED_TRADER_FIELDS`, `PROTECTED_CUSTOMER_FIELDS`) — the single source of truth. Do not re-declare them elsewhere; import them.
- Change control triggers: trader = `submittedForReviewAt` set (profile submitted for review); customer = `emailVerified` true. Before the trigger, edits apply directly.
- **Why:** spec requires the live value stays active while a proposed value awaits admin review; using any other lifecycle flag silently changes when locking kicks in.
- Phone changes are special: OTP (Twilio Verify SMS, email fallback in dev) must be verified BEFORE the request is created; admin approve is blocked unless `phoneOtpVerified`. Non-phone fields go straight to a PENDING request on save.
- Statuses: PENDING / NEEDS_INFO are "active" (field locked in mobile UI, only one active request per field); APPROVED applies the value in the same transaction; decisions require a >=3-char reason for sensitive fields (reject/request-info always).
- Event log table `profile_change_request_events` uses eventType SUBMITTED / APPROVED / REJECTED / INFO_REQUESTED / CANCELLED — admin UI history labels must match these exact strings.
- **How to apply:** when adding a new protected field, update the schema constant, the field-label map in the api-server profile-change lib, and the per-field lock/badge in the relevant mobile screen (trader edit-profile or customer personal-details).
