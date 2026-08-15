---
name: expo export dies under dev-server contention
description: How to get `npx expo export` to complete in this workspace without being killed.
---

- `npx expo export --platform ios --clear` gets silently killed mid-bundle (~80%) when the Metro dev workflow (and other dev servers) are running — memory contention. Detached launches (`nohup`/`setsid ... &`) from ShellExec also die when the shell session is reaped, leaving a truncated or empty log and no process.
- **How to apply:** stop the heavy workflows first (`stopWorkflow` for `artifacts/mobile: expo`, promo-video, admin, mockup-sandbox), run the export in the FOREGROUND with output to `/tmp` (finishes in ~2–3 min once uncontended), then restart the workflows. Don't trust a stale progress log — check the process actually exists (`pgrep -f "expo export"`) and the log mtime.
