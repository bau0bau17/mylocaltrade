---
name: ESM decoder with CommonJS query-string
description: Compatibility constraint when remediating decode-uri-component beneath query-string 7.
---

`decode-uri-component@0.5.0` is ESM-default-exported, while `query-string@7.1.3` CommonJS-requires it as a callable value. Keep the pnpm-managed compatibility bridge that selects `.default` when present whenever this fixed decoder is resolved beneath Query String 7.

**Why:** A direct version override installs successfully and Metro can bundle, but `query-string.parse()` fails at runtime with `TypeError: decodeComponent is not a function`, breaking Expo Router's URL/deep-link query parsing.

**How to apply:** Preserve the exact decoder override and `query-string` patch together. Verify by resolving Query String from Expo Router, parsing valid, encoded, repeated, and malformed query strings, and inspecting the active patched snapshot rather than an arbitrary pnpm store directory.