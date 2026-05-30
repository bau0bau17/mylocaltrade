---
name: HMRC Check-a-UK-VAT-number API auth
description: The HMRC VAT lookup is application-restricted (OAuth), not open access.
---

# HMRC "Check a UK VAT number" API

The lookup endpoint `GET /organisations/vat/check-vat-number/lookup/{vrn}` on
`https://api.service.hmrc.gov.uk` is **application-restricted**, not open access.
Calling it with only `Accept: application/vnd.hmrc.2.0+json` returns
`401 MISSING_CREDENTIALS` on both production and the `test-api` sandbox host.

**Why:** It requires an OAuth2 *server token* via the `client_credentials`
grant against `POST /oauth/token` (form-encoded `grant_type`, `client_id`,
`client_secret`). The resulting bearer token is sent as `Authorization: Bearer`.
Credentials come from a free application on the HMRC Developer Hub
(developer.service.hmrc.gov.uk) subscribed to the "Check a UK VAT number" API.

**How to apply:** Read `HMRC_CLIENT_ID` / `HMRC_CLIENT_SECRET` from env. If
absent, treat VAT checks as ERROR/"Check failed" and degrade gracefully — do not
assume the endpoint is callable without a token. Note: post-Brexit GB VAT
numbers are no longer in the EU VIES service, so VIES is not a substitute for UK
VAT validation.
