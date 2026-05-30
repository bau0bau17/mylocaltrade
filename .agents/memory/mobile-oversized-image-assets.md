---
name: Mobile oversized image assets
description: The 1024px store icons must not be used for in-app/web display; use small derived variants.
---
- `artifacts/mobile/assets/images/icon.png` and `splash-icon.png` are 1024x1024, 16-bit RGBA (~246KB each). Keep them large — App Store / Play Store / native splash need that resolution.
- Never `require()` these for in-app UI or web favicon. Displaying a 246KB 1024px image at ~80px causes slow download/decode (most noticeable on web).
- For in-app display use small derived PNGs: `logo.png` (160px) + `logo@2x.png` (320) + `logo@3x.png` (480), 8-bit, generated with ImageMagick `magick icon.png -resize NxN -strip -depth 8 PNG8:out.png`. Metro auto-picks density variants.
- Web favicon = `assets/images/favicon.png` (64px, ~1KB), set in `app.json` web.favicon. Do NOT point favicon at icon.png.

**Why:** User reported the Account-screen logo and browser-tab favicon loading slowly; root cause was reusing the 1024px store icon for tiny display.
**How to apply:** When adding any in-app logo/avatar/image, check the source PNG's real dimensions (`magick identify`) before `require()`-ing it; derive a right-sized variant if the source is far larger than the display size.
