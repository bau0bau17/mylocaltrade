---
name: Personal avatar vs business logo
description: Two distinct image identities for traders — serving gates, ownership checks, and the business-field permission choke point.
---

# Personal avatar vs business logo

- `users.avatarUrl` = the PERSON's photo (trader-only in Phase 1A). Set via `PATCH /auth/me/avatar` (ownership verified with `verifyCustomerUploadObject`). Served ONLY through authenticated `GET /api/customer/uploads/avatar-file` — caller must be the owner OR share a conversation with the owner (either direction); everything else is 404. NOT shown on public trader cards/lists by design; conversation DETAIL responses expose `traderAvatarUrl` (list responses leave it null). Mobile must pass `Authorization` headers on the `<Image>` request (`avatarImageUrl()` helper in `lib/api-url.ts`).
- `trader_profiles.logoUrl` = the COMPANY's mark. Ownership now verified in `PUT /api/profile` like gallery images; served publicly via the gallery-file route only while the trader passes `publicTraderSqlConditions()`.
- **Business-field choke point:** every business-level field mutation in `PUT /api/profile` (logo, name, services, areas, address/company details) must pass `canManageBusinessFields()` in `artifacts/api-server/src/lib/business-permissions.ts`. Trivially owner-only today; future Employee roles are denied INSIDE that helper — never by UI hiding alone.

**Why:** avatars are personal data scoped to real relationships (conversation membership), logos are public brand assets; conflating the two serving paths would leak personal photos publicly.
**How to apply:** any new surface showing a trader photo must decide which identity it is and use the matching serving route + gate; deletion/anonymisation paths must null `avatarUrl`.
