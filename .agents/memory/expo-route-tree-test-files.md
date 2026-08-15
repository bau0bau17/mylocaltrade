---
name: No test files under Expo Router app/
description: Test files inside artifacts/mobile/app/ get bundled as routes by Metro and crash the running app; jest passing does not catch it.
---

Metro/expo-router treats EVERYTHING under `artifacts/mobile/app/` as application code/routes. A `.test.tsx` (or `__tests__/` dir) placed there gets bundled into the running app, and its test-only imports (`@testing-library/react-native`, jest globals) crash the device app with "Unable to resolve module ..." — a red error screen at bundle time.

**Why it slips through:** jest discovers and passes those tests fine, and typecheck is clean — nothing in the test toolchain touches Metro. Only a Metro bundle (dev restart or `expo export`) reveals it. A task-agent merge introduced exactly this once; the main-agent verification that preceded the merge was green because the files didn't exist yet.

**How to apply:**
- Mobile tests live OUTSIDE `app/`: `artifacts/mobile/__tests__/` (screens) and `hooks/__tests__/`. Import screens via the `@/app/...` alias.
- A regression guard exists: `artifacts/mobile/__tests__/no-test-files-in-app-routes.test.ts` scans `app/` and fails on any `.test.*`/`.spec.*`/`__tests__`/`__mocks__`. Don't delete it; it's the only automated tripwire.
- `@testing-library/react-native` stays a devDependency — never promote it to hide a routing mistake.
- After ANY merge touching `artifacts/mobile/app/`, a clean-cache Metro restart (or `expo export --platform ios --output-dir /tmp/...`) is the real verification, not jest.
