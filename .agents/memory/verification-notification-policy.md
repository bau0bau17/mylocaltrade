---
name: Verification document notification policy
description: What trader-verification events do and do NOT trigger emails/pushes, and why.
---

# Verification document notification policy

The rule for trader-verification notifications (documents + profile):

- **No email or push on individual document APPROVAL.** Approved documents just
  show as approved in the trader dashboard/admin. The per-document approval email
  was removed (function + call site + import).
- **Document REJECTED** → email only, and it MUST include: document name/type,
  the admin's rejection reason, and a clear instruction to upload a replacement
  document. (`sendDocumentRejectedEmail`)
- **Profile-level events keep one notification each:** trader approve →
  single "You're verified" email + push (the go-live milestone); trader reject →
  email + push; request-info / more-info → email + push.

**Why:** the admin approves documents one at a time, so per-document approval
emails spammed traders (4 docs = 4 emails) and felt unprofessional. Traders only
need to hear from us when action is required (rejection / more-info) or at the
single moment their whole profile goes live. User explicitly confirmed keeping the
one final "You're verified" email + push.

**How to apply:** never reintroduce a per-document approval email/push. If adding
new verification steps, follow the same shape — notify on action-needed and on the
single go-live milestone, not on each positive sub-step.
