---
name: promo-video typecheck pre-broken
description: artifacts/promo-video fails tsc independently of your changes; relevant whenever a workspace-wide typecheck/build fails.
---

# artifacts/promo-video fails `tsc` on its own

Running `pnpm run typecheck` (or `pnpm run build`, which calls typecheck) at the
workspace root fails inside `artifacts/promo-video` with two pre-existing classes
of error:

1. `Cannot find name 'window' / 'document'` — `tsconfig.base.json` sets
   `lib: ["es2022"]` (no DOM) and promo-video does not add the DOM lib.
2. framer-motion `Variant` type incompatibilities in `src/lib/video/animations.ts`
   (e.g. `transition.staggerChildren` not assignable, `ease: "circOut"` literal).

**Why this matters:** the promo-video workflow runs `vite` dev, which does NOT
typecheck, so the artifact runs fine while `tsc` is broken. Do not assume your own
change caused a promo-video typecheck failure — verify whether your edited packages
are even in its dependency graph first.

**How to apply:** when a security/dependency or unrelated task trips the
workspace-wide typecheck only in promo-video, treat it as pre-existing and out of
scope. Confirm the packages you changed typecheck cleanly
(`pnpm --filter <pkg> run typecheck`) rather than fixing promo-video.
