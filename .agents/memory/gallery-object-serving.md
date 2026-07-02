---
name: Gallery / customer-upload image serving
description: Why trader gallery photos need a dedicated public serving route and absolute URLs in RN <Image>
---

# Gallery / customer-upload image serving

Trader gallery photos (and any customer upload shown remotely) live in the
PRIVATE object-storage dir at `/objects/customer-uploads/{userId}/v/{uuid}`.
There is **no default public route** that serves `/objects/...` — the api-server
mounts everything under `/api`, and only trader-documents had an authenticated
owner-only download route. So a stored `/objects/...` path is unreachable until
you add a serving endpoint.

Two failure modes, both produce a BLACK image on iOS/Android:
1. React Native `<Image source={{uri}}>` cannot load a **relative** `/objects/...`
   URI. It needs an absolute http(s) URL. Resolve via `objectImageUrl()` in
   `artifacts/mobile/lib/api-url.ts` (built on `getApiUrl()`).
2. Even with an absolute URL, private objects 403/404 unless a route streams
   them. The public route is `GET /api/customer/uploads/gallery-file?path=...`.

**Why the route is membership-scoped, not a blanket `/objects/*` server:**
customer-uploads is a shared private namespace. Serving any path by request
would leak other users' uploads / trader documents (IDOR). The route only
streams a path that is present in some trader's published `gallery_urls`
(jsonb `@>` containment), so only images a trader chose to publish are exposed.

**How to apply:**
- Any new remote-image feature reading from `/objects/...` must (a) resolve to an
  absolute URL for RN `<Image>`, and (b) have a serving route — do not assume
  `/objects/...` is publicly fetchable.
- Freshly-picked-but-unsaved images are NOT yet in `gallery_urls`, so the serving
  route 404s them. Preview them from the local device URI (`localPreviews` map)
  until save+refetch swaps in the finalized `/v/` path.
- gallery_urls stores relative `/objects/...`; never store absolute display URLs
  there — profile PUT verification expects the relative form.
