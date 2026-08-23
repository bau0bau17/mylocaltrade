---
name: GitHub publishing fallback
description: How to publish workspace changes when the shell Git remote lacks authentication.
---

When `git push origin main` fails because the workspace has no HTTPS credentials but the GitHub connection is attached, use the attached GitHub OAuth connector instead of requesting a token.

**Why:** OAuth credentials are safely injected by the connector and should not be read or copied into shell configuration or chat.

**How to apply:** Confirm `origin/main` has not moved incompatibly first. For a small focused change, update the changed files through GitHub's Contents API using the connector, reading each current blob SHA before writing. Preserve the local commit for workspace history and report that connector publication was used.