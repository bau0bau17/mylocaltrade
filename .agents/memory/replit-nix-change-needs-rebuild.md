---
name: .replit [nix] change kills workflows until rebuild
description: After a .replit [nix] packages edit, workflows start then die instantly until the workspace is reloaded/rebuilt; app code is fine.
---

Editing the `[nix]` section of `.replit` (e.g. adding `packages = ["zip"]`,
which the project-export feature does automatically when it creates an export
zip) changes the Nix environment and requires a full environment rebuild.

Until the workspace is reloaded so the environment reprovisions, the workflow
supervisor cannot keep workflows alive:
- `restart_workflow` returns "success" / "Screenshot captured" but lies.
- The auto status reminder briefly shows "running (new logs)" then flips back to
  "not started".
- `curl` of every service → 502; `ps` shows zero `tsx`/`vite`/`expo` processes a
  few seconds after each restart.
- Supervisor-launched processes die within seconds; a process launched MANUALLY
  from bash with `PORT=NNNN ... run dev` stays up and serves correctly — proving
  the app code is healthy and the fault is the environment, not the code.

**Why:** A `[nix]` change leaves the env in a "needs rebuild" state. The agent
cannot trigger the reprovision; only a workspace reload (user refreshes the tab)
or the Run/rebuild prompt applies it.

**How to apply:** If every workflow won't stay up and `git diff .replit` shows a
`[nix]` change, stop the restart loop. Confirm app health with a manual
`PORT=xxxx pnpm --filter <pkg> run dev` + curl localhost. Then tell the user to
reload the workspace to rebuild the environment; restarts only work after that.
Do NOT keep calling restart_workflow — it will keep reporting false success.
